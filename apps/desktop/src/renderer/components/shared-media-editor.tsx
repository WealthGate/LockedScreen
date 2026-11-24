import { useEffect, useRef, useState, type FormEvent } from "react";
import { maxMediaBytes, mediaMimeByExtension } from "@lockedscreen/exam-engine";
import type { Exam, Question, SharedExamMedia } from "@lockedscreen/shared-types";
import { Button, Input } from "@lockedscreen/ui";
import { formatQuestionRange, parseQuestionRange } from "../lib/question-ranges";

const acceptedFiles = Object.keys(mediaMimeByExtension).map(extension => "." + extension).join(",");

function readMedia(file: File): Promise<string> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!Object.hasOwn(mediaMimeByExtension, extension)) {
    throw new Error("Choose one of the supported image, audio or video formats.");
  }
  if (file.size === 0 || file.size > maxMediaBytes) throw new Error("Choose a nonempty file up to 25 MiB.");
  const mime = extension === "webm" && file.type === "audio/webm" ? file.type : mediaMimeByExtension[extension];
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("The file could not be read. Choose it again."));
    reader.readAsDataURL(file.slice(0, file.size, mime));
  });
}

function AssignmentDialog({ media, questions, onApply, onClose }: {
  media?: SharedExamMedia;
  questions: Question[];
  onApply: (media: SharedExamMedia) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [range, setRange] = useState(media ? formatQuestionRange(media.questionIds, questions) : "1");
  const [file, setFile] = useState<File>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => node.close();
  }, []);

  async function apply(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const questionIds = parseQuestionRange(range, questions);
      if (media) {
        onApply({ ...media, questionIds });
      } else {
        if (!file) throw new Error("Choose a file to attach.");
        setBusy(true);
        const dataUrl = await readMedia(file);
        onApply({ id: crypto.randomUUID(), name: file.name, dataUrl, questionIds });
      }
      onClose();
    } catch (reason) {
      setBusy(false);
      setError(reason instanceof Error ? reason.message : "The attachment could not be saved.");
    }
  }

  return (
    <dialog ref={dialog} aria-labelledby="media-dialog-title"
      onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
      className="m-auto w-full max-w-md rounded-2xl bg-white p-6 text-slate-950 shadow-xl backdrop:bg-slate-950/50 dark:bg-slate-900 dark:text-white">
      <h2 id="media-dialog-title" className="mb-4 break-words text-lg font-semibold">{media ? media.name : "Attach shared media"}</h2>
      <form onSubmit={apply}>
        <fieldset disabled={busy} className="space-y-4">
          {!media && <label className="block space-y-2">
            <span className="text-sm font-semibold">Media file</span>
            <input type="file" accept={acceptedFiles} onChange={event => setFile(event.target.files?.[0])} className="block w-full text-sm" />
            <span className="block text-xs">PNG, JPG, GIF, WebP, MP3, WAV, M4A, Ogg, MP4 or WebM. Up to 25 MiB.</span>
          </label>}
          <label className="block space-y-2">
            <span className="text-sm font-semibold">Questions</span>
            <Input value={range} onChange={event => setRange(event.target.value)} aria-describedby="media-range-help" />
          </label>
          <p id="media-range-help" className="text-sm">Choose from questions 1–{questions.length}. Use a range or a list, such as 1–10 or 1, 3–5.</p>
          {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit">{busy ? "Attaching…" : media ? "Apply changes" : "Attach file"}</Button>
          </div>
        </fieldset>
      </form>
    </dialog>
  );
}

export function SharedMediaEditor({ exam, onChange }: {
  exam: Exam;
  onChange: (media: SharedExamMedia[]) => void;
}) {
  const [editing, setEditing] = useState<SharedExamMedia | "new" | null>(null);
  const attachments = exam.sharedMedia ?? [];

  return (
    <section aria-label="Shared media" className="space-y-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Shared media</h3>
        <Button variant="secondary" disabled={!exam.questions.length} onClick={() => setEditing("new")}>Attach media</Button>
      </div>
      <p className="text-sm">{exam.questions.length ? "Attach one file to all the questions that use it." : "Add a question to attach audio, images or video."}</p>
      {attachments.map(media => (
        <div key={media.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <div className="min-w-0">
            <div className="break-words font-medium">{media.name}</div>
            <div className="text-sm">Questions {formatQuestionRange(media.questionIds, exam.questions)}</div>
          </div>
          <div className="flex gap-1">
            <Button variant="secondary" onClick={() => setEditing(media)}>Edit questions</Button>
            <Button variant="ghost" aria-label={"Remove " + media.name} onClick={() => onChange(attachments.filter(item => item.id !== media.id))}>Remove</Button>
          </div>
        </div>
      ))}
      {editing && <AssignmentDialog media={editing === "new" ? undefined : editing} questions={exam.questions}
        onClose={() => setEditing(null)}
        onApply={next => onChange(editing === "new" ? [...attachments, next] : attachments.map(item => item.id === next.id ? next : item))} />}
    </section>
  );
}
