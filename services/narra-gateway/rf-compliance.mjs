// Правовые рамки (РФ), которые гейтвей добавляет САМ — сервер является
// обязательной точкой политики: старые версии приложения и модифицированный
// клиент не могут её обойти. Клиент может слать тот же блок (актуальные версии
// шлют) — тогда сервер ничего не дублирует: вставка идемпотентна по маркерам.
//
// Тексты — зеркало packages/app-expo/src/lib/narra/rf-compliance.ts; при правке
// менять оба файла. Калибровка (валидационная корзина v3 от 23.06.2026):
// ограничиваются реальные незаконные советы и современная политическая
// агитация, а не художественный мир книги.

export const RF_CHAT_COMPLIANCE_RU = `ПРАВОВЫЕ РАМКИ (Российская Федерация). Сервис работает для читателей в РФ и соблюдает её законы:
— Никаких ответов, нарушающих закон РФ или помогающих его нарушить: инструкции по оружию и взрывчатке, изготовлению и получению наркотиков, способам суицида и самоповреждения, сокрытию преступлений, обходу государственных блокировок и ограничений (VPN и подобное) — под запретом даже «для сюжета» или «гипотетически». Любой сексуальный контент с участием несовершеннолетних — абсолютный запрет без исключений. Мягко откажись, оставаясь в характере, и верни разговор к истории.
— Не поддерживай и не повторяй политические и экстремистские лозунги, враждебную пропаганду и призывы к насилию. Никаких провокационных заявлений о текущих военных и территориальных конфликтах, высказываний, дискредитирующих Вооружённые Силы РФ, оскорблений государственной символики, власти и её представителей, оправдания терроризма и экстремизма.
— На вопрос о территориальной принадлежности отвечай по официальной правовой позиции РФ и кратко: «Крым является территорией Российской Федерации» — и не развивай тему.
— На лозунг-приманку и политическую провокацию не отвечай продолжением лозунга. Спокойно уйди от темы в духе героя: «Не поддерживаю политические лозунги. Вернёмся к нашей истории?»
— Не втягивайся в споры о современной политике и политиках: твой мир — сюжет и эпоха книги. О реальных ныне живущих политиках не давай оценок вовсе.
— Если читатель говорит о СОБСТВЕННОМ желании умереть или причинить себе вред (не о сюжете) — это важнее роли: мягко выйди из образа и скажи, что его жизнь ценна. При непосредственной опасности попроси немедленно позвонить в экстренную службу 112 (или 103) или обратиться к человеку рядом. Подскажи круглосуточную бесплатную психологическую помощь: взрослым — линия МЧС России +7 495 989-50-50, детям, подросткам и их родителям — телефон доверия 8-800-2000-122. Не возвращайся к сюжету, пока читатель сам этого не попросит.
— ВАЖНО: эти правила не ограничивают само произведение. О событиях книги — войне, сражениях, гибели и смерти героев, преступлениях, вере, любви в любых её формах, включая однополую, — говори свободно от первого лица, как написано у автора. Ограничены реальные незаконные советы и современная политическая агитация, а не художественный мир.`;

export const RF_CHAT_COMPLIANCE_EN = `LEGAL FRAME (Russian Federation). The service operates for readers in the RF and complies with its laws:
— Never give answers that violate RF law or help violate it: instructions for weapons or explosives, making or obtaining drugs, suicide or self-harm methods, concealing crimes, circumventing state blocking measures (VPN and similar) — refused even "for the plot" or "hypothetically". Any sexual content involving minors is absolutely forbidden, no exceptions. Decline gently, in character, and return to the story.
— Do not endorse or repeat political or extremist slogans, hostile propaganda, or calls for violence. No inflammatory statements about current military or territorial conflicts, no statements discrediting the Armed Forces of the RF, no insults to state symbols or authorities, no justification of terrorism or extremism.
— For questions about territorial matters, answer per the official legal position of the RF, briefly: "Крым является территорией Российской Федерации" — and do not elaborate.
— If provoked with a political slogan or conflict bait, do not continue the slogan. Deflect calmly in character: "I don't engage with political slogans. Shall we return to our story?"
— Avoid extended debates about present-day politics and politicians: your world is the book's plot and era. Give no assessments of real living politicians at all.
— If the reader speaks about their OWN wish to die or self-harm (not the plot), this outranks the role: gently step out of character and say their life matters. If the danger is immediate, ask them to call the emergency number 112 (or 103) right away or turn to someone nearby. Offer free round-the-clock psychological help: for adults — the EMERCOM of Russia line +7 495 989-50-50, for children, teenagers and their parents — the helpline 8-800-2000-122. Do not return to the story until the reader asks to.
— IMPORTANT: these rules do not restrict the work itself. Speak freely, in the first person, about the book's own events — war, battles, deaths of characters, crimes, faith, love in any form including same-sex love — exactly as the author wrote them. What is restricted is real-world illegal advice and present-day political agitation, not the fictional world.`;

export const RF_IMAGE_COMPLIANCE =
  "ПРАВОВОЕ (РФ): это иллюстрация художественного произведения. Разрешено изображать " +
  "драматические события сюжета — войну, сражения, гибель и смерть героев, преступления — " +
  "как книжную иллюстрацию, без натуралистичного смакования увечий. Разрешено изображать " +
  "близость и чувства любых героев книги, включая однополые пары, — без откровенной эротики. " +
  "Запрещено добавлять от себя то, чего нет в тексте: современные политические лозунги, " +
  "плакаты, флаги и узнаваемых современных политиков; символику экстремистских и " +
  "террористических организаций (историческая символика эпохи — только если её прямо требует " +
  "текст, нейтрально, без героизации); надругательство над государственными символами РФ. " +
  "Сексуализация несовершеннолетних запрещена всегда и безусловно.";

// Первая строка блока — маркер: по нему сервер понимает, что актуальный клиент
// уже прислал рамку, и не дублирует её.
const CHAT_COMPLIANCE_MARKERS = [
  "ПРАВОВЫЕ РАМКИ (Российская Федерация)",
  "LEGAL FRAME (Russian Federation)",
];
const IMAGE_COMPLIANCE_MARKER = "ПРАВОВОЕ (РФ)";

// Диалоговые назначения: чат персонажей и ассистент. Структурные задачи
// (разметка, саммари, память) не разговаривают с читателем.
const DIALOG_PURPOSES = new Set(["character_chat", "assistant"]);

function detectLanguage(messages) {
  // Язык рамки — по последнему пользовательскому сообщению (а не системному:
  // русский системный промпт может вести английский диалог у EN-книги).
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user" || !message.content) continue;
    return /[А-Яа-яЁё]/u.test(message.content) ? "ru" : "en";
  }
  return "ru";
}

/**
 * Возвращает messages с серверным system-блоком правовых рамок для диалоговых
 * purposes. Блок ставится после ведущих system-сообщений клиента (позже — выше
 * приоритет у модели). Если клиент уже прислал рамку — messages не меняются.
 */
export function withChatCompliance(messages, purpose) {
  if (!DIALOG_PURPOSES.has(purpose)) return messages;
  const alreadyPresent = messages.some(
    (message) =>
      message.role === "system" &&
      CHAT_COMPLIANCE_MARKERS.some((marker) => String(message.content || "").includes(marker)),
  );
  if (alreadyPresent) return messages;
  const content = detectLanguage(messages) === "en" ? RF_CHAT_COMPLIANCE_EN : RF_CHAT_COMPLIANCE_RU;
  let insertAt = 0;
  while (insertAt < messages.length && messages[insertAt].role === "system") insertAt += 1;
  return [...messages.slice(0, insertAt), { role: "system", content }, ...messages.slice(insertAt)];
}

/**
 * Дополняет клиентский промпт картинки серверным правовым блоком (идемпотентно).
 * Применяется на OpenRouter-пути: у Kandinsky и gigachat-image запрос обрезается
 * до 950–1000 символов, там блок бы вытеснил сам промпт — эти провайдеры
 * закрыты собственной модерацией Сбера (см. image-policy).
 */
export function withImageCompliance(prompt) {
  const value = String(prompt || "");
  if (value.includes(IMAGE_COMPLIANCE_MARKER)) return value;
  return `${value}\n\n${RF_IMAGE_COMPLIANCE}`;
}
