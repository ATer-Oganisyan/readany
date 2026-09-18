import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it } from "vitest";

// Выгрузки с фикбука кладут главу одним полотном <br>-абзацев, а внутрь ставят
// разделители <p>***</p> и заголовки. Раньше такой сосед отменял разбивку, и
// глава оставалась без абзацев: подчёркивание имён и врезки сцен не работали.
const template = readFileSync("assets/reader/reader.template.html", "utf8");
const source = template.slice(
  template.indexOf("    function normalizeBrOnlyParagraphs(doc) {"),
  template.indexOf("    function normalizeBrParagraphContainer(doc, container) {"),
);

const text = (value: string) => ({ nodeType: 3, nodeValue: value });
const element = (localName: string, textContent = "") => ({
  nodeType: 1,
  localName,
  textContent,
  childNodes: [],
});
const br = () => element("br");

function run(
  paragraphs: unknown[],
  containers: { childNodes: unknown[]; contains?: (other: unknown) => boolean }[],
) {
  const normalized: unknown[] = [];
  const textOf = (nodes: unknown[]) =>
    nodes.map((n) => (n as { nodeValue?: string; textContent?: string }).nodeValue ?? "").join("");
  const body = {
    childNodes: [],
    textContent: textOf(paragraphs) + textOf(containers.flatMap((c) => c.childNodes)),
    querySelectorAll: (selector: string) => (selector === "p" ? paragraphs : containers),
    contains: () => false,
  };
  const context = vm.createContext({
    isBrNode: (node: { localName?: string }) => node?.localName === "br",
    normalizeBrParagraphContainer: (_doc: unknown, container: unknown) => {
      normalized.push(container);
      return true;
    },
  });
  vm.runInContext(source, context);
  (context as { normalizeBrOnlyParagraphs: (doc: unknown) => void }).normalizeBrOnlyParagraphs({
    body,
  });
  return normalized;
}

const flatChapter = (): { childNodes: unknown[]; contains?: (other: unknown) => boolean } => ({
  childNodes: [
    text("Юнги стоял в ванной, не решаясь снять толстовку и посмотреть на метку."),
    br(),
    br(),
    text("Он почувствовал покалывание между лопаток почти сразу, как пожал руку."),
    br(),
    br(),
    element("p", "***"),
    text("Хосок улыбнулся, а младший возмущённо пихнул его в плечо и уволок."),
  ],
});

it("режет полотно, даже когда внутри стоят разделители и заголовок", () => {
  const container = flatChapter();
  container.childNodes.push(element("h3", "Примечание к части"));
  const normalized = run([element("p", "***"), element("p", "***")], [container]);
  expect(normalized).toEqual([container]);
});

it("режет полотно, даже когда внутри десяток центрированных записок", () => {
  // Записок много, но по тексту это крохи на фоне главы.
  const container = flatChapter();
  for (let i = 0; i < 10; i += 1) container.childNodes.push(...flatChapter().childNodes);
  const notes = Array.from({ length: 12 }, () =>
    element("p", "Малфой, я сожалею о своём вчерашнем поведении. Грейнджер."),
  );
  expect(run(notes, [container])).toEqual([container]);
});

it("не трогает книгу, где абзацы уже свёрстаны", () => {
  const realParagraphs = Array.from({ length: 30 }, () =>
    element("p", "Полноценный абзац книги, свёрстанный издателем как положено."),
  );
  expect(run(realParagraphs, [flatChapter()])).toEqual([]);
});

it("не трогает контейнер без полотна текста", () => {
  const wrapper = { childNodes: [element("div", "Глава"), element("h2", "Часть первая")] };
  expect(run([], [wrapper])).toEqual([]);
});

it("берёт внутреннюю главу, а не обёртку вокруг неё", () => {
  const inner = flatChapter();
  const wrapper = flatChapter();
  wrapper.childNodes.push(inner);
  for (const container of [wrapper, inner]) {
    container.contains = (other: unknown) => container === wrapper && other === inner;
  }
  expect(run([], [wrapper, inner])).toEqual([inner]);
});
