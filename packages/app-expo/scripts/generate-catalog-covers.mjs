#!/usr/bin/env node

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(SCRIPT_DIR, "..");
const OUTPUT_DIR = path.join(APP_DIR, "assets", "catalog", "covers");
const ENV_FILE = path.join(APP_DIR, ".env.local");
const COVER_GENERATION_CONFIG_FILE = path.join(
  APP_DIR,
  "src",
  "lib",
  "book",
  "cover-generation-config.json",
);
const REQUEST_TIMEOUT_MS = 180_000;
const MAX_THEME_CHARS = 1_200;
const coverGenerationConfig = JSON.parse(await readFile(COVER_GENERATION_CONFIG_FILE, "utf8"));
const DEFAULT_MODEL = coverGenerationConfig.openRouterModel;
const coverPromptTemplate = coverGenerationConfig.promptParagraphs.join("\n\n");

const books = [
  {
    id: "fathers-and-sons",
    title: "Отцы и дети",
    author: "Иван Тургенев",
    metaphor: "две крупные перекрывающиеся формы разных поколений, рассечённые узким клином",
    color1: "приглушённый кирпично-красный",
    color2: "серо-оливковый",
    scene:
      "A serious young 1860s Russian physician-naturalist examines a botanical specimen at a provincial manor study table while an older landowner watches quietly from the doorway, expressing generational distance.",
  },
  {
    id: "anna-karenina",
    title: "Анна Каренина",
    author: "Лев Толстой",
    metaphor: "светлый овал, который пересекает и необратимо разрывает чёрная диагональ",
    color1: "карминовый красный",
    color2: "холодный дымчато-голубой",
    scene:
      "An elegant woman in 1870s dress stands alone on a snowy railway platform in drifting steam, with distant society figures and cold iron tracks creating emotional isolation.",
  },
  {
    id: "war-and-peace",
    title: "Война и мир",
    author: "Лев Толстой",
    metaphor: "единый круг, наполовину собранный из строгой сетки и наполовину расколотый",
    color1: "прусский синий",
    color2: "приглушённый алый",
    scene:
      "An early-19th-century Russian ballroom seen through tall windows at dawn; a young aristocratic woman pauses in the foreground while the reflection in the glass subtly reveals soldiers and a distant battlefield.",
  },
  {
    id: "crime-and-punishment",
    title: "Преступление и наказание",
    author: "Фёдор Достоевский",
    metaphor: "тяжёлый чёрный квадрат с тесной внутренней пустотой, прорезанный тонкой дугой",
    color1: "тёмный бордовый",
    color2: "грязно-охристый",
    scene:
      "A gaunt young man sits in a cramped 1860s Saint Petersburg attic beside a rain-streaked window, a small pawned object on the bare table, with the city pressing in around his moral dread.",
  },
  {
    id: "government-inspector",
    title: "Ревизор",
    author: "Николай Гоголь",
    metaphor: "строй повторяющихся кругов, в который вторгается один нелепо повёрнутый пустой круг",
    color1: "горчично-жёлтый",
    color2: "бюрократический зелёный",
    scene:
      "Provincial Russian officials crowd anxiously around a table in an 1830s government office, flattering a self-important young visitor while papers and nervous gestures reveal comic panic.",
  },
  {
    id: "dead-souls",
    title: "Мёртвые души",
    author: "Николай Гоголь",
    metaphor: "сетка пустых прямоугольных ячеек, из одной из которых выдвинута чёрная пустота",
    color1: "землистый терракотовый",
    color2: "выцветший серо-синий",
    scene:
      "A charming 1840s traveler studies a ledger beside a muddy Russian road and waiting troika, while wary provincial landowners gather on a manor porch under a vast overcast sky.",
  },
  {
    id: "hero-of-our-time",
    title: "Герой нашего времени",
    author: "Михаил Лермонтов",
    metaphor: "одинокая высокая чёрная вертикаль на пересечении двух далёких диагональных полей",
    color1: "глубокий кобальтовый",
    color2: "сухой песочно-охристый",
    scene:
      "A solitary 1830s Russian officer stands with his horse on a high Caucasus ridge above a remote fortress, his detached gaze set against immense mountains and unsettled weather.",
  },
  {
    id: "captains-daughter",
    title: "Капитанская дочка",
    author: "Александр Пушкин",
    metaphor: "малый светлый ромб, удерживаемый между двумя крупными встречными клиньями",
    color1: "суриково-красный",
    color2: "ледяной серо-голубой",
    scene:
      "A young Russian officer protects a resolute young woman near a wooden frontier fortress during a fierce 1770s snowstorm, with a rebel camp only faintly visible beyond.",
  },
  {
    id: "eugene-onegin",
    title: "Евгений Онегин",
    author: "Александр Пушкин",
    metaphor: "две несовпадающие формы, которые почти соприкасаются, но расходятся по разным осям",
    color1: "чернильно-синий",
    color2: "винно-красный",
    scene:
      "A bored young dandy in an 1820s Saint Petersburg salon turns away from the room while a thoughtful young woman appears reflected in a dark country-house window, conveying missed intimacy.",
  },
  {
    id: "gentleman-from-san-francisco",
    title: "Господин из Сан-Франциско",
    author: "Иван Бунин",
    metaphor: "тяжёлый чёрный овал роскоши, зависший над тонкой проваливающейся линией горизонта",
    color1: "тусклый латунно-золотой",
    color2: "глубокий морской зелёно-синий",
    scene:
      "An impeccably dressed wealthy traveler sits in the opulent dining room of an early-1900s ocean liner, surrounded by indifferent luxury as a cold dark sea fills the windows.",
  },
  {
    id: "dark-avenues",
    title: "Тёмные аллеи",
    author: "Иван Бунин",
    metaphor: "две тёмные ленты, ненадолго пересекающиеся и снова исчезающие в разных краях",
    color1: "сливово-фиолетовый",
    color2: "жжёный оранжевый",
    scene:
      "A middle-aged man and woman unexpectedly meet again in a dim late-19th-century roadside inn; autumn rain, restrained posture, and warm lamplight carry the weight of lost love.",
  },
  {
    id: "golden-key",
    title: "Золотой ключик, или Приключения Буратино",
    author: "Алексей Толстой",
    metaphor: "предельно упрощённый золотой ключ, собранный из круга и двух прямоугольников",
    color1: "насыщенный золотисто-жёлтый",
    color2: "ультрамариновый синий",
    scene:
      "A lively wooden boy with a long nose discovers a small golden key among painted theater scenery and old stage machinery, with curious puppet friends peeking from the wings.",
  },
  {
    id: "twelve-chairs",
    title: "Двенадцать стульев",
    author: "Илья Ильф и Евгений Петров",
    metaphor: "ритм из двенадцати одинаковых прямоугольных модулей, один из которых резко смещён",
    color1: "приглушённый изумрудный",
    color2: "томатно-красный",
    scene:
      "Two mismatched schemers in worn 1920s coats inspect an upholstered chair in a crowded Soviet auction hall, surrounded by comic suspicion, hurried gestures, and faded grandeur.",
  },
  {
    id: "three-sisters",
    title: "Три сестры",
    author: "Антон Чехов",
    metaphor: "три вытянутых овала на разной глубине, связанные одной тонкой горизонталью",
    color1: "пыльно-розовый",
    color2: "сумеречный кобальтовый",
    scene:
      "Three sisters in turn-of-the-century Russian dress occupy different depths of a provincial drawing room at twilight, emotionally separated while distant city light glows beyond the window.",
  },
  {
    id: "seagull",
    title: "Чайка",
    author: "Антон Чехов",
    metaphor: "одно белое крыло-вырез, пересекающее тяжёлый чёрный диск",
    color1: "выцветший небесно-синий",
    color2: "киноварно-красный",
    scene:
      "A young actress stands beside a rough improvised lakeside stage at dusk in 1890s Russia, with family figures watching from afar and a single seagull crossing the pale sky.",
  },
  {
    id: "cherry-orchard",
    title: "Вишнёвый сад",
    author: "Антон Чехов",
    metaphor: "хрупкое скопление светлых кругов-цветов, которое рассекает жёсткая вертикаль",
    color1: "бледный вишнёво-розовый",
    color2: "мшистый зелёный",
    scene:
      "A Russian family stands among a white cherry orchard at early dawn near an old estate house, their quiet distance and the first fallen blossoms conveying beauty about to disappear.",
  },
  {
    id: "thunderstorm",
    title: "Гроза",
    author: "Александр Островский",
    metaphor: "массивный ломаный чёрный клин, разрывающий сжатую горизонтальную сетку",
    color1: "грозовой сине-фиолетовый",
    color2: "приглушённый ржаво-красный",
    scene:
      "A young woman in mid-19th-century merchant-town dress stands above the Volga as a thunderstorm gathers, with dark wooden houses, wind-bent trees, and charged light expressing confinement and resolve.",
  },
];

function parseEnv(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1).replace(/^['"]|['"]$/g, "")];
      }),
  );
}

function buildPrompt(book) {
  const replacements = {
    "{{BOOK_TITLE}}": book.title,
    "{{AUTHOR}}": book.author,
    "{{BOOK_DESCRIPTION}}": book.scene.replace(/\s+/gu, " ").slice(0, MAX_THEME_CHARS),
    "{{BACKGROUND_COLOR}}": book.color1,
  };

  return Object.entries(replacements).reduce(
    (prompt, [placeholder, value]) => prompt.replaceAll(placeholder, value),
    coverPromptTemplate,
  );
}

async function generateCover({ apiKey, baseUrl, model, book }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/images`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt: buildPrompt(book),
        aspect_ratio: "2:3",
        quality: "high",
        output_format: "jpeg",
        output_compression: 86,
        n: 1,
      }),
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error?.message || `Image request failed (${response.status})`);
    }
    const image = payload?.data?.[0];
    if (!image?.b64_json) throw new Error("Image response did not contain image data");
    if (image.media_type && image.media_type !== "image/jpeg") {
      throw new Error(`Expected image/jpeg, received ${image.media_type}`);
    }
    return Buffer.from(image.b64_json.replace(/^data:[^;]+;base64,/, ""), "base64");
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const localEnv = parseEnv(await readFile(ENV_FILE, "utf8"));
  const apiKey = process.env.OPENROUTER_API_KEY || localEnv.EXPO_PUBLIC_OPENROUTER_API_KEY;
  const baseUrl =
    process.env.OPENROUTER_BASE_URL ||
    localEnv.EXPO_PUBLIC_OPENROUTER_BASE_URL ||
    "https://openrouter.ai/api/v1";
  const model =
    process.env.OPENROUTER_IMAGE_MODEL ||
    localEnv.EXPO_PUBLIC_OPENROUTER_IMAGE_MODEL ||
    DEFAULT_MODEL;
  const requestedId = process.argv.find((arg) => arg.startsWith("--id="))?.slice(5);
  const force = process.argv.includes("--force");
  const selectedBooks = requestedId ? books.filter((book) => book.id === requestedId) : books;

  if (!apiKey)
    throw new Error("OpenRouter API key is not configured in packages/app-expo/.env.local");
  if (requestedId && selectedBooks.length === 0)
    throw new Error(`Unknown catalog book: ${requestedId}`);

  await mkdir(OUTPUT_DIR, { recursive: true });
  for (const [index, book] of selectedBooks.entries()) {
    const outputPath = path.join(OUTPUT_DIR, `${book.id}.jpg`);
    process.stdout.write(`[${index + 1}/${selectedBooks.length}] ${book.id}... `);
    if (!force) {
      try {
        await readFile(outputPath);
        process.stdout.write("уже есть\n");
        continue;
      } catch {
        // Generate a missing cover.
      }
    }
    const temporaryPath = `${outputPath}.${process.pid}.tmp`;
    try {
      const jpeg = await generateCover({ apiKey, baseUrl, model, book });
      await writeFile(temporaryPath, jpeg);
      await rename(temporaryPath, outputPath);
      process.stdout.write("готово\n");
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
}

await main();
