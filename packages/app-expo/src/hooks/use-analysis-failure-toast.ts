import { retryBackendBookAnalysis, useBackendBookStatus } from "@/lib/narra/backend-book-sync";
import { toast } from "@/lib/notifications";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

/**
 * Показывает тост «Не удалось разметить книгу» с кнопкой повтора, когда серверная
 * разметка книги упала. Один тост на одно открытие экрана: ref живёт вместе с ним.
 * Возвращает колбэк повтора, чтобы другие тосты экрана переиспользовали его.
 */
export function useAnalysisFailureToast(bookId: string, active = true) {
  const { t } = useTranslation();
  const availability = useBackendBookStatus((state) => state.books[bookId]?.manifest?.availability);
  const updatedAt = useBackendBookStatus(
    (state) => state.books[bookId]?.manifest?.analysis?.updatedAt,
  );
  const retry = useCallback(() => {
    void retryBackendBookAnalysis(bookId)
      .then(() => toast.success(t("narra.analysisRetried", "Разметка запущена заново")))
      .catch(() => undefined);
  }, [bookId, t]);
  const shownFor = useRef<string | null>(null);
  useEffect(() => {
    const terminal = availability === "failed" || availability === "cancelled";
    if (!terminal) {
      shownFor.current = null;
      return;
    }
    if (!active) return;
    const key = `${availability}:${updatedAt ?? ""}`;
    if (shownFor.current === key) return;
    shownFor.current = key;
    toast.error(t("narra.analysisFailed", "Не удалось разметить книгу"), {
      action: { label: t("narra.analysisRetry", "Попробовать ещё раз"), onClick: retry },
    });
  }, [active, availability, updatedAt, retry, t]);
  return retry;
}
