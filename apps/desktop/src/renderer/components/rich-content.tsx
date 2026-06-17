import DOMPurify from "dompurify";
import katex from "katex";

const findClosingDelimiter = (source: string, delimiter: string, from: number): number => {
  let index = source.indexOf(delimiter, from);

  while (index >= 0) {
    if (source[index - 1] !== "\\") {
      return index;
    }

    index = source.indexOf(delimiter, index + delimiter.length);
  }

  return -1;
};

const findNextMath = (
  source: string,
  from: number
): { start: number; end: number; expression: string; displayMode: boolean; closeLength: number } | null => {
  const candidates = [
    { delimiter: "$$", close: "$$", displayMode: true },
    { delimiter: "\\[", close: "\\]", displayMode: true },
    { delimiter: "\\(", close: "\\)", displayMode: false },
    { delimiter: "$", close: "$", displayMode: false }
  ]
    .map((candidate) => ({ ...candidate, start: source.indexOf(candidate.delimiter, from) }))
    .filter((candidate) => candidate.start >= 0)
    .sort((a, b) => a.start - b.start || b.delimiter.length - a.delimiter.length);

  for (const candidate of candidates) {
    if (candidate.delimiter === "$" && source[candidate.start + 1] === "$") {
      continue;
    }

    const expressionStart = candidate.start + candidate.delimiter.length;
    const end = findClosingDelimiter(source, candidate.close, expressionStart);
    if (end > expressionStart) {
      return {
        start: candidate.start,
        end,
        expression: source.slice(expressionStart, end),
        displayMode: candidate.displayMode,
        closeLength: candidate.close.length
      };
    }
  }

  return null;
};

const renderMathExpression = (expression: string, displayMode: boolean): string =>
  katex.renderToString(expression, {
    displayMode,
    throwOnError: false,
    output: "html",
    trust: false
  });

const renderMath = (source: string): string => {
  let cursor = 0;
  let rendered = "";
  let match = findNextMath(source, cursor);

  while (match) {
    rendered += source.slice(cursor, match.start);
    rendered += renderMathExpression(match.expression, match.displayMode);
    cursor = match.end + match.closeLength;
    match = findNextMath(source, cursor);
  }

  return rendered + source.slice(cursor);
};

interface RichContentProps {
  content: string;
  className?: string;
}

export const RichContent = ({ content, className }: RichContentProps) => {
  const html = DOMPurify.sanitize(renderMath(content), {
    ALLOWED_TAGS: [
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "sub",
      "sup",
      "ul",
      "ol",
      "li",
      "p",
      "br",
      "span",
      "div",
      "img",
      "blockquote",
      "code",
      "pre",
      "hr",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td"
    ],
    ALLOWED_ATTR: ["aria-hidden", "alt", "class", "height", "loading", "src", "style", "title", "width"],
    ADD_DATA_URI_TAGS: ["img"],
    ALLOWED_URI_REGEXP: /^(?:(?:https?:|data:image\/(?:png|jpe?g|gif|webp);base64,))/i
  });

  return <div className={["rich-content", className].filter(Boolean).join(" ")} dangerouslySetInnerHTML={{ __html: html }} />;
};
