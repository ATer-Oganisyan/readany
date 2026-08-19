import { NativeThemePicker } from "@/components/profile/NativeThemePicker";
import { hapticSelection } from "@/lib/haptics";
import type { ReactElement } from "react";
import {
  Children,
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { type LayoutChangeEvent, Platform, StyleSheet, View, type ViewStyle } from "react-native";
import PagerView from "react-native-pager-view";

interface NativeSegmentedPagerProps {
  values: readonly string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  colorScheme: "light" | "dark";
  accessibilityLabel: string;
  children: ReactElement[];
  scrollableSegments?: boolean;
  controlsStyle?: ViewStyle;
  minimumPageHeight?: number;
  initialPageHeight?: number;
  pageGap?: number;
  stablePageHeight?: boolean;
  /**
   * Пейджер занимает всю доступную высоту, а прокрутка живёт внутри страниц.
   * В этом режиме высота страниц не измеряется: контейнер не меняет размер при
   * переключении, поэтому нет ни рывка, ни обрезанного низа, ни выхода общей
   * прокрутки за пределы содержимого. Каждая страница помнит своё положение.
   */
  fillHeight?: boolean;
  onSwipeStateChange?: (swiping: boolean) => void;
}

export interface NativeSegmentedPagerHandle {
  selectPage: (index: number, animated?: boolean) => void;
}

export const NativeSegmentedPager = forwardRef<
  NativeSegmentedPagerHandle,
  NativeSegmentedPagerProps
>(function NativeSegmentedPager(
  {
    values,
    selectedIndex,
    onSelect,
    colorScheme,
    accessibilityLabel,
    children,
    scrollableSegments = false,
    controlsStyle,
    minimumPageHeight = 1,
    initialPageHeight = minimumPageHeight,
    pageGap = 0,
    stablePageHeight = false,
    fillHeight = false,
    onSwipeStateChange,
  },
  ref,
) {
  const pagerRef = useRef<PagerView>(null);
  const activePageRef = useRef(-1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [pageHeights, setPageHeights] = useState<Record<number, number>>({});
  const [swiping, setSwiping] = useState(false);
  const pageCount = Children.count(children);
  const safePageGap = Math.max(0, Math.round(pageGap));
  const pagerWidth =
    Platform.OS === "ios" && safePageGap > 0 && containerWidth > 0
      ? containerWidth + safePageGap
      : undefined;
  const safeSelectedIndex = Math.max(0, Math.min(selectedIndex, Math.max(0, pageCount - 1)));
  const tallestPageHeight = Math.max(0, ...Object.values(pageHeights));
  const selectedPageHeight = pageHeights[safeSelectedIndex];
  const hasUsableSelectedPageHeight = selectedPageHeight !== undefined && selectedPageHeight > 1;
  const selectedPageMinimumHeight = !hasUsableSelectedPageHeight
    ? Math.max(minimumPageHeight, initialPageHeight)
    : minimumPageHeight;
  // Во время жеста контейнер держим по самой высокой странице: PagerView режет
  // содержимое по своей высоте, и на переходе низ более длинной страницы
  // обрезался по высоте короткой. В покое возвращаемся к высоте выбранной
  // страницы, иначе на короткой вкладке остаётся хвост пустой прокрутки.
  const pagerHeight = Math.max(
    selectedPageMinimumHeight,
    stablePageHeight || swiping
      ? tallestPageHeight
      : hasUsableSelectedPageHeight
        ? selectedPageHeight
        : 0,
  );
  const pages = Children.toArray(children) as ReactElement[];

  useLayoutEffect(() => {
    if (safeSelectedIndex === activePageRef.current) return;
    activePageRef.current = safeSelectedIndex;
    pagerRef.current?.setPageWithoutAnimation(safeSelectedIndex);
  }, [safeSelectedIndex]);

  const selectPage = useCallback(
    (index: number, animated = true) => {
      const nextIndex = Math.max(0, Math.min(index, Math.max(0, pageCount - 1)));
      if (nextIndex === activePageRef.current) return;
      activePageRef.current = nextIndex;
      onSelect(nextIndex);
      if (animated) pagerRef.current?.setPage(nextIndex);
      else pagerRef.current?.setPageWithoutAnimation(nextIndex);
    },
    [onSelect, pageCount],
  );

  useImperativeHandle(ref, () => ({ selectPage }), [selectPage]);

  // Тап по сегменту — действие пользователя, поэтому отдача нужна. Свайп её уже
  // получает в onPageSelected, а сюда она не долетает: selectPage выставляет
  // activePageRef.current до setPage, и защита в onPageSelected гасит повтор.
  // В самом selectPage вызывать нельзя — он торчит наружу через ref, и
  // программное переключение вибрировать не должно.
  const handleSegmentSelect = useCallback(
    (index: number) => {
      if (index !== activePageRef.current) hapticSelection();
      selectPage(index);
    },
    [selectPage],
  );

  const rememberPageHeight = (index: number, event: LayoutChangeEvent) => {
    const nextHeight = Math.ceil(event.nativeEvent.layout.height);
    setPageHeights((current) =>
      current[index] === nextHeight ? current : { ...current, [index]: nextHeight },
    );
  };

  const handlePageScrollStateChanged = useCallback(
    ({ nativeEvent }: { nativeEvent: { pageScrollState: "idle" | "dragging" | "settling" } }) => {
      const nextSwiping = nativeEvent.pageScrollState !== "idle";
      setSwiping(nextSwiping);
      onSwipeStateChange?.(nextSwiping);
    },
    [onSwipeStateChange],
  );

  return (
    <View
      style={fillHeight ? styles.containerFill : styles.container}
      onLayout={({ nativeEvent }) => {
        const nextWidth = Math.round(nativeEvent.layout.width);
        setContainerWidth((current) => (current === nextWidth ? current : nextWidth));
      }}
    >
      <View style={controlsStyle}>
        <NativeThemePicker
          values={values}
          selectedIndex={safeSelectedIndex}
          onSelect={handleSegmentSelect}
          colorScheme={colorScheme}
          accessibilityLabel={accessibilityLabel}
          scrollable={scrollableSegments}
        />
      </View>
      <PagerView
        ref={pagerRef}
        style={[
          styles.pager,
          fillHeight ? styles.pagerFill : { height: pagerHeight },
          pagerWidth ? { width: pagerWidth } : null,
        ]}
        initialPage={safeSelectedIndex}
        orientation="horizontal"
        // Без overdrag палец на первой и последней странице упирается в жёсткую
        // стену. У двух вкладок крайние обе, поэтому системное оттягивание с
        // отпружиниванием нужно всегда.
        overdrag
        pageMargin={safePageGap}
        onPageScrollStateChanged={handlePageScrollStateChanged}
        onPageSelected={({ nativeEvent }) => {
          const nextIndex = nativeEvent.position;
          // Сравниваем до присваивания: при свайпе пальцем onSelect мог уже
          // обновить selectedIndex, и по нему смену страницы не поймать.
          // Одна отдача на смену страницы — не на dragging и settling.
          if (nextIndex !== activePageRef.current) hapticSelection();
          activePageRef.current = nextIndex;
          if (nextIndex !== selectedIndex) onSelect(nextIndex);
        }}
      >
        {pages.map((page, index) => (
          <View
            collapsable={false}
            key={page.key ?? `page-${index}`}
            style={fillHeight ? styles.pageFill : styles.page}
          >
            {fillHeight ? (
              page
            ) : (
              <View onLayout={(event) => rememberPageHeight(index, event)}>{page}</View>
            )}
          </View>
        ))}
      </PagerView>
    </View>
  );
});

const styles = StyleSheet.create({
  container: { width: "100%" },
  containerFill: { flex: 1, width: "100%" },
  pager: { width: "100%" },
  pagerFill: { flex: 1 },
  page: { width: "100%" },
  pageFill: { flex: 1, width: "100%" },
});
