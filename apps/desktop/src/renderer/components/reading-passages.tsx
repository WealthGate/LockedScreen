import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Exam, Question, ReadingPassage } from "@lockedscreen/shared-types";
import { Button, Input, Textarea } from "@lockedscreen/ui";
import { formatQuestionRange, parseQuestionRange } from "../lib/question-ranges";

export function PassageText({ passage }: { passage: ReadingPassage }) {
  return (
    <article aria-label={passage.title} className="my-3 min-w-0 rounded-2xl border border-teal-200 bg-teal-50/50 p-4 dark:border-teal-800 dark:bg-slate-900">
      <h3 className="mb-2 break-words text-lg font-semibold">{passage.title}</h3>
      <div tabIndex={0} aria-label={"Passage text: " + passage.title} role="region"
        className="max-h-[42vh] overflow-y-auto whitespace-pre-wrap break-words pr-2 text-base leading-7">
        {passage.text}
      </div>
    </article>
  );
}

export function QuestionPassages({ exam, questionId }: { exam: Exam; questionId?: string }) {
  return exam.passages?.filter(p => questionId && p.questionIds.includes(questionId))
    .map(p => <PassageText key={p.id} passage={p} />);
}

interface EditorProps {
  exam: Exam;
  makeQuestion: () => Question;
  onChange: (passages: ReadingPassage[], added: Question[]) => void;
}

function PassageDialog({ passage, exam, makeQuestion, onApply, onClose }: {
  passage?: ReadingPassage;
  onApply: (passage: ReadingPassage, added: Question[]) => void;
  onClose: () => void;
} & Pick<EditorProps, "exam" | "makeQuestion">) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(passage?.title ?? "");
  const [text, setText] = useState(passage?.text ?? "");
  const [range, setRange] = useState(passage ? formatQuestionRange(passage.questionIds, exam.questions) : "1");
  const [createQuestions, setCreateQuestions] = useState(exam.questions.length === 0);
  const [count, setCount] = useState("3");
  const [error, setError] = useState("");
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => node.close();
  }, []);

  function save(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !text.trim()) { setError("Enter a title and the passage text."); return; }
    try {
      const added = createQuestions ? Array.from({ length: Number(count) }, makeQuestion) : [];
      const questionIds = createQuestions ? added.map(q => q.id) : parseQuestionRange(range, exam.questions);
      onApply({ id: passage?.id ?? crypto.randomUUID(), title: title.trim(), text: text.trim(), questionIds }, added);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Check the selected questions.");
    }
  }

  return (
    <dialog ref={dialog} aria-labelledby="passage-dialog-title" onCancel={event => { event.preventDefault(); onClose(); }}
      className="m-auto max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 text-slate-950 backdrop:bg-slate-950/50 dark:bg-slate-900 dark:text-white">
      <h2 id="passage-dialog-title" className="mb-4 text-lg font-semibold">{passage ? "Edit passage" : "Create comprehension passage"}</h2>
      <form onSubmit={save} className="space-y-4">
        <label className="block">Passage title<Input required value={title} onChange={e => setTitle(e.target.value)} /></label>
        <label className="block">Passage text<Textarea required rows={8} value={text} onChange={e => setText(e.target.value)} placeholder="Type or paste the passage, keeping its paragraphs." /></label>
        {!passage && exam.questions.length > 0 && <label className="flex items-center gap-2">
          <input type="checkbox" checked={createQuestions} onChange={e => setCreateQuestions(e.target.checked)} />Add new questions for this passage
        </label>}
        {createQuestions
          ? <label className="block">Number of questions to add<Input type="number" required min={1} max={50} step={1} value={count} onChange={e => setCount(e.target.value)} /></label>
          : <label className="block">Questions<Input required value={range} onChange={e => setRange(e.target.value)} />
              <span className="text-sm">Use a range or list, such as 1–10 or 1, 3–5. This exam has {exam.questions.length} questions.</span>
            </label>}
        {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">Save passage</Button>
        </div>
      </form>
    </dialog>
  );
}

export function PassageEditor({ exam, makeQuestion, onChange }: EditorProps) {
  const [editing, setEditing] = useState<ReadingPassage | "new" | null>(null);
  const passages = exam.passages ?? [];
  return (
    <section aria-label="Comprehension passages" className="space-y-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Comprehension passages</h3>
        <Button variant="secondary" onClick={() => setEditing("new")}>Create passage</Button>
      </div>
      {passages.map(p => <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <div className="min-w-0"><div className="break-words font-medium">{p.title}</div>
          <div className="text-sm">Questions {formatQuestionRange(p.questionIds, exam.questions)}</div></div>
        <div className="flex gap-1">
          <Button variant="secondary" onClick={() => setEditing(p)}>Edit passage</Button>
          <Button variant="ghost" aria-label={"Remove " + p.title} onClick={() => onChange(passages.filter(item => item.id !== p.id), [])}>Remove</Button>
        </div>
      </div>)}
      {editing && <PassageDialog passage={editing === "new" ? undefined : editing} exam={exam} makeQuestion={makeQuestion}
        onClose={() => setEditing(null)} onApply={(p, added) => onChange(editing === "new" ? [...passages, p] : passages.map(old => old.id === p.id ? p : old), added)} />}
    </section>
  );
}
