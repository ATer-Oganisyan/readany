import { MarkdownIt } from "react-native-markdown-display";

const parser = new MarkdownIt({ html: false, typographer: false });
type Token = ReturnType<typeof parser.parse>[number];

/** Старые ответы и разметка, которую модель всё-таки прислала, остаются обычным текстом. */
export function plainChatText(content: string): string {
  const read = (tokens: Token[]): string =>
    tokens
      .map((token, index) => {
        if (token.children) return read(token.children);
        switch (token.type) {
          case "text":
          case "code_inline":
            return token.content;
          case "fence":
          case "code_block":
            return `${token.content}\n\n`;
          case "softbreak":
          case "hardbreak":
          case "tr_close":
            return "\n";
          case "paragraph_close":
          case "heading_close":
          case "list_item_close":
            return "\n\n";
          case "th_close":
          case "td_close":
            return "  ";
          case "link_close": {
            const opening = tokens.slice(0, index).findLast((item) => item.type === "link_open");
            const href = opening?.attrGet("href");
            return href && /^https?:\/\//.test(href) && tokens[index - 1]?.content !== href
              ? ` (${href})`
              : "";
          }
          default:
            return "";
        }
      })
      .join("");

  return read(parser.parse(content, {}))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
