import type { ReadingPassage } from "@lockedscreen/shared-types";

export function isReadingPassageList(value: unknown, questions: unknown[]): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  const questionIds = new Set(questions.map(q => (q as { id?: unknown } | null)?.id));
  const ids = new Set<string>();
  return value.every((passage: Partial<ReadingPassage> | null) => {
    if (!passage || typeof passage.id !== "string" || !passage.id || ids.has(passage.id)) return false;
    if (typeof passage.title !== "string" || !passage.title.trim() || typeof passage.text !== "string" || !passage.text.trim()) return false;
    if (!Array.isArray(passage.questionIds) || !passage.questionIds.length ||
        !passage.questionIds.every(id => typeof id === "string" && questionIds.has(id))) return false;
    ids.add(passage.id);
    return true;
  });
}

export function removeQuestionAssignment<T extends { questionIds: string[] }>(items: T[] | undefined, id: string) {
  return items?.map(item => ({ ...item, questionIds: item.questionIds.filter(ref => ref !== id) }))
    .filter(item => item.questionIds.length > 0);
}

export function duplicateQuestionAssignment<T extends { questionIds: string[] }>(items: T[] | undefined, id: string, copyId: string) {
  return items?.map(item => item.questionIds.includes(id) ? { ...item, questionIds: [...item.questionIds, copyId] } : item);
}

export function importPassages(passages: ReadingPassage[] | undefined, newIds: Map<string, string>): ReadingPassage[] {
  return (passages ?? []).map(passage => ({
    ...passage, id: crypto.randomUUID(),
    questionIds: passage.questionIds.map(id => {
      const mapped = newIds.get(id);
      if (!mapped) throw new Error("A passage refers to a missing imported question.");
      return mapped;
    })
  }));
}
