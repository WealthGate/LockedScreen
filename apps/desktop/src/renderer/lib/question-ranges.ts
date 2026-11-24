import type { Question } from "@lockedscreen/shared-types";

export function parseQuestionRange(input: string, questions: Question[]): string[] {
  const selected = new Set<string>();
  for (const part of input.split(",")) {
    const match = /^\s*(\d+)(?:\s*[-–]\s*(\d+))?\s*$/.exec(part);
    if (!match) throw new Error("Enter question numbers or ranges, such as 1–10, 12.");
    const first = Number(match[1]);
    const last = Number(match[2] ?? match[1]);
    if (first < 1 || last < first || last > questions.length) {
      throw new Error("Choose existing questions in ascending order within each range.");
    }
    for (let index = first - 1; index < last; index++) selected.add(questions[index]!.id);
  }
  return [...selected];
}

export function formatQuestionRange(questionIds: string[], questions: Question[]): string {
  const selected = new Set(questionIds);
  const ranges: string[] = [];
  for (let index = 0; index < questions.length; index++) {
    if (!selected.has(questions[index]!.id)) continue;
    const first = index + 1;
    while (index + 1 < questions.length && selected.has(questions[index + 1]!.id)) index++;
    const last = index + 1;
    ranges.push(first === last ? String(first) : first + "–" + last);
  }
  return ranges.join(", ");
}
