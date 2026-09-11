export interface ChapterSegment {
  text: string;
  cfi?: string;
  paragraphId?: string;
}
export interface NarrationChapter {
  id: string;
  title: string;
  segments: ChapterSegment[];
}

function stripCfiAssertions(value: string) {
  return value.replace(/\[[^\]]*\]/g, "");
}

export function getTTSCfiStartIdentity(cfi?: string | null) {
  const raw = (cfi || "").trim();
  if (!raw) return "";
  const inner = raw.startsWith("epubcfi(") && raw.endsWith(")") ? raw.slice(8, -1) : raw;
  const bangIndex = inner.indexOf("!");
  if (bangIndex < 0) return stripCfiAssertions(inner);

  const sectionPath = stripCfiAssertions(inner.slice(0, bangIndex));
  const localPath = stripCfiAssertions(inner.slice(bangIndex + 1));
  const commaIndex = localPath.indexOf(",");
  if (commaIndex < 0) return `${sectionPath}!${localPath}`;

  const commonPath = localPath.slice(0, commaIndex);
  const rangePath = localPath.slice(commaIndex + 1);
  const rangeEndIndex = rangePath.indexOf(",");
  const startPath = rangeEndIndex >= 0 ? rangePath.slice(0, rangeEndIndex) : rangePath;
  return `${sectionPath}!${commonPath}${startPath}`;
}

export function chapterSegmentIndex(segments: readonly ChapterSegment[], cfi?: string | null) {
  const identity = getTTSCfiStartIdentity(cfi);
  return identity
    ? segments.findIndex((segment) => getTTSCfiStartIdentity(segment.cfi) === identity)
    : -1;
}

export function findNarrationChapter(chapters: readonly NarrationChapter[], cfi?: string | null) {
  for (const chapter of chapters) {
    const index = chapterSegmentIndex(chapter.segments, cfi);
    if (index >= 0) return { chapter, index };
  }
  return null;
}
