import { NativeThemePicker } from "@/components/profile/NativeThemePicker";
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
  pageGap?: number;
  stablePageHeight?: boolean;
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
    pageGap = 0,
    stablePageHeight = false,
    onSwipeStateChange,
  },
  ref,
) {
  const pagerRef = useRef<PagerView>(null);
  const activePageRef = useRef(-1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [pageHeights, setPageHeights] = useState<Record<number, number>>({});
  const pageCount = Children.count(children);
  const safePageGap = Math.max(0, Math.round(pageGap));
  const pagerWidth =
    Platform.OS === "ios" && safePageGap > 0 && containerWidth > 0
      ? containerWidth + safePageGap
      : undefined;
  const safeSelectedIndex = Math.max(0, Math.min(selectedIndex, Math.max(0, pageCount - 1)));
  const tallestPageHeight = Math.max(0, ...Object.values(pageHeights));
  const pagerHeight = Math.max(
    minimumPageHeight,
    stablePageHeight ? tallestPageHeight : (pageHeights[safeSelectedIndex] ?? 0),
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

  const rememberPageHeight = (index: number, event: LayoutChangeEvent) => {
    const nextHeight = Math.ceil(event.nativeEvent.layout.height);
    setPageHeights((current) =>
      current[index] === nextHeight ? current : { ...current, [index]: nextHeight },
    );
  };

  const handlePageScrollStateChanged = useCallback(
    ({ nativeEvent }: { nativeEvent: { pageScrollState: "idle" | "dragging" | "settling" } }) => {
      const swiping = nativeEvent.pageScrollState !== "idle";
      onSwipeStateChange?.(swiping);
    },
    [onSwipeStateChange],
  );

  return (
    <View
      style={styles.container}
      onLayout={({ nativeEvent }) => {
        const nextWidth = Math.round(nativeEvent.layout.width);
        setContainerWidth((current) => (current === nextWidth ? current : nextWidth));
      }}
    >
      <View style={controlsStyle}>
        <NativeThemePicker
          values={values}
          selectedIndex={safeSelectedIndex}
          onSelect={selectPage}
          colorScheme={colorScheme}
          accessibilityLabel={accessibilityLabel}
          scrollable={scrollableSegments}
        />
      </View>
      <PagerView
        ref={pagerRef}
        style={[styles.pager, { height: pagerHeight }, pagerWidth ? { width: pagerWidth } : null]}
        initialPage={safeSelectedIndex}
        orientation="horizontal"
        pageMargin={safePageGap}
        onPageScrollStateChanged={handlePageScrollStateChanged}
        onPageSelected={({ nativeEvent }) => {
          const nextIndex = nativeEvent.position;
          activePageRef.current = nextIndex;
          if (nextIndex !== selectedIndex) onSelect(nextIndex);
        }}
      >
        {pages.map((page, index) => (
          <View collapsable={false} key={page.key ?? `page-${index}`} style={styles.page}>
            <View onLayout={(event) => rememberPageHeight(index, event)}>{page}</View>
          </View>
        ))}
      </PagerView>
    </View>
  );
});

const styles = StyleSheet.create({
  container: { width: "100%" },
  pager: { width: "100%" },
  page: { width: "100%" },
});
