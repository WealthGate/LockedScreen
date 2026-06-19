import { useRef, useState, type ChangeEvent, type ComponentType } from "react";

import {
  Bold,
  Divide,
  ImagePlus,
  Italic,
  List,
  Sigma,
  Subscript,
  Superscript,
  Underline
} from "lucide-react";

import { Button, Textarea, cn } from "@lockedscreen/ui";

import { RichContent } from "./rich-content";

const maxEmbeddedImageBytes = 6 * 1024 * 1024;
const supportedImageTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

const escapeAttribute = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

interface RichContentEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  textareaClassName?: string;
  previewClassName?: string;
}

interface ToolbarAction {
  label: string;
  icon?: ComponentType<{ className?: string }>;
  symbol?: string;
  apply: () => void;
}

export const RichContentEditor = ({
  value,
  onChange,
  placeholder,
  textareaClassName,
  previewClassName
}: RichContentEditorProps) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  const replaceSelection = (before: string, after: string, fallback: string) => {
    const node = textareaRef.current;
    const start = node?.selectionStart ?? value.length;
    const end = node?.selectionEnd ?? value.length;
    const selected = value.slice(start, end) || fallback;
    const next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`;
    const selectionStart = start + before.length;
    const selectionEnd = selectionStart + selected.length;

    onChange(next);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(selectionStart, selectionEnd);
    });
  };

  const insertText = (text: string, selectStartOffset = text.length, selectEndOffset = text.length) => {
    const node = textareaRef.current;
    const start = node?.selectionStart ?? value.length;
    const end = node?.selectionEnd ?? value.length;
    const next = `${value.slice(0, start)}${text}${value.slice(end)}`;

    onChange(next);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(start + selectStartOffset, start + selectEndOffset);
    });
  };

  const uploadImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    setImageError(null);

    if (!file) {
      return;
    }

    if (!supportedImageTypes.has(file.type)) {
      setImageError("Use a PNG, JPG, GIF, or WebP image.");
      return;
    }

    if (file.size > maxEmbeddedImageBytes) {
      setImageError("Use an image smaller than 6 MB.");
      return;
    }

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        setImageError("Unable to read that image.");
        return;
      }

      const alt = escapeAttribute(file.name.replace(/\.[^.]+$/, "") || "Question image");
      insertText(`\n<img src="${reader.result}" alt="${alt}" />\n`);
    });
    reader.addEventListener("error", () => setImageError("Unable to read that image."));
    reader.readAsDataURL(file);
  };

  const actions: ToolbarAction[] = [
    {
      label: "Bold",
      icon: Bold,
      apply: () => replaceSelection("<strong>", "</strong>", "bold text")
    },
    {
      label: "Italic",
      icon: Italic,
      apply: () => replaceSelection("<em>", "</em>", "italic text")
    },
    {
      label: "Underline",
      icon: Underline,
      apply: () => replaceSelection("<u>", "</u>", "underlined text")
    },
    {
      label: "Superscript",
      icon: Superscript,
      apply: () => replaceSelection("<sup>", "</sup>", "2")
    },
    {
      label: "Subscript",
      icon: Subscript,
      apply: () => replaceSelection("<sub>", "</sub>", "2")
    },
    {
      label: "Inline equation",
      icon: Sigma,
      apply: () => replaceSelection("\\(", "\\)", "x^2 + y^2 = z^2")
    },
    {
      label: "Display equation",
      icon: Sigma,
      apply: () => replaceSelection("\n$$", "$$\n", "x^2 + y^2 = z^2")
    },
    {
      label: "Fraction",
      symbol: "a/b",
      apply: () => replaceSelection("\\(\\frac{", "}{b}\\)", "a")
    },
    {
      label: "Power",
      symbol: "x^2",
      apply: () => replaceSelection("\\(", "^{2}\\)", "x")
    },
    {
      label: "Division",
      icon: Divide,
      apply: () => replaceSelection("\\(", " \\div b\\)", "a")
    },
    {
      label: "Bulleted list",
      icon: List,
      apply: () => replaceSelection("<ul><li>", "</li></ul>", "List item")
    }
  ];

  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950">
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <Button
              key={action.label}
              variant="secondary"
              className="h-9 w-9 rounded-xl p-0"
              title={action.label}
              aria-label={action.label}
              onClick={action.apply}
            >
              {Icon ? <Icon className="size-4" /> : <span className="text-xs font-bold">{action.symbol}</span>}
              {Icon && action.symbol ? <span className="text-[10px] font-bold leading-none">{action.symbol}</span> : null}
            </Button>
          );
        })}
        <Button
          variant="secondary"
          className="h-9 w-9 rounded-xl p-0"
          title="Add image"
          aria-label="Add image"
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus className="size-4" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={uploadImage}
        />
      </div>
      {imageError ? <div className="break-words border-b border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{imageError}</div> : null}
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={cn(
          "min-h-[144px] resize-y rounded-none border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0",
          textareaClassName
        )}
      />
      <div className="border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
        Preview
      </div>
      <RichContent
        content={value.trim() ? value : "Formatted preview appears here."}
        className={cn(
          "min-h-[72px] bg-white px-3 py-3 text-sm leading-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100",
          previewClassName
        )}
      />
    </div>
  );
};
