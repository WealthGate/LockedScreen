import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@lockedscreen/ui";

export const ExamConfirmation = ({ title, children, confirmLabel, busy, onConfirm, onCancel }: {
  title: string; children: ReactNode; confirmLabel: string; busy?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) => {
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-slate-950/80 p-3 sm:p-6">
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="exam-confirm-title" aria-describedby="exam-confirm-description"
        className="my-auto w-full max-w-lg space-y-5 rounded-lg border border-slate-300 bg-white p-5 text-slate-950 shadow-xl dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50"
        onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); if (!busy) onCancel(); }
          if (event.key !== "Tab") return;
          const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
          const first = buttons[0], last = buttons.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}>
        <h2 id="exam-confirm-title" className="text-lg font-semibold">{title}</h2>
        <div id="exam-confirm-description" className="space-y-3 text-sm">{children}</div>
        <div className="flex flex-wrap justify-end gap-3">
          <Button ref={cancel} variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button disabled={busy} onClick={onConfirm}>{busy ? "Working..." : confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
};
