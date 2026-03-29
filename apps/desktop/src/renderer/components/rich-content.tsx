import DOMPurify from "dompurify";
import katex from "katex";

const renderMath = (source: string): string =>
  source.replace(/\$\$(.+?)\$\$/gs, (_match, expression: string) =>
    katex.renderToString(expression, {
      displayMode: true,
      throwOnError: false
    })
  );

interface RichContentProps {
  content: string;
  className?: string;
}

export const RichContent = ({ content, className }: RichContentProps) => {
  const html = DOMPurify.sanitize(renderMath(content), {
    ALLOWED_TAGS: ["strong", "em", "u", "sub", "sup", "ul", "ol", "li", "p", "br", "span", "div"],
    ALLOWED_ATTR: ["class"]
  });

  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
};
