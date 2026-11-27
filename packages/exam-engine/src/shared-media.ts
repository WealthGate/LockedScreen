import type { SharedExamMedia } from "@lockedscreen/shared-types";

export const mediaMimeByExtension: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", oga: "audio/ogg",
  mp4: "video/mp4", webm: "video/webm", ogv: "video/ogg"
};

export const maxMediaBytes = 25 * 1024 * 1024;
const mediaMimeTypes = new Set([...Object.values(mediaMimeByExtension), "audio/webm"]);

export function embeddedMediaType(dataUrl: string): string | undefined {
  const header = /^data:([\w/-]+);base64,/.exec(dataUrl.slice(0, 64));
  const mime = header?.[1];
  if (header && mime && mediaMimeTypes.has(mime) && dataUrl.length > header[0].length) return mime;
}

export function isSharedMediaList(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every((media: Partial<SharedExamMedia> | null) => {
    if (!media || typeof media.id !== "string" || !media.id || ids.has(media.id)) return false;
    if (typeof media.name !== "string" || typeof media.dataUrl !== "string") return false;
    if (media.dataUrl.length > 64 + Math.ceil(maxMediaBytes / 3) * 4 || !embeddedMediaType(media.dataUrl)) return false;
    if (!Array.isArray(media.questionIds) || !media.questionIds.every(id => typeof id === "string")) return false;
    ids.add(media.id);
    return true;
  });
}
