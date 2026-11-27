import { useState } from "react";
import { embeddedMediaType } from "@lockedscreen/exam-engine";
import type { Exam, SharedExamMedia } from "@lockedscreen/shared-types";

function MediaFigure({ media }: { media: SharedExamMedia }) {
  const [failed, setFailed] = useState(false);
  const kind = embeddedMediaType(media.dataUrl)?.split("/")[0];
  const playerProps = {
    src: media.dataUrl,
    controls: true,
    controlsList: "nodownload noremoteplayback nofullscreen",
    disableRemotePlayback: true,
    preload: "metadata",
    "aria-label": media.name,
    onError: () => setFailed(true)
  };

  return (
    <figure className="my-3 min-w-0 rounded-2xl border border-slate-300 p-3 dark:border-slate-600">
      <figcaption className="mb-2 break-words text-sm font-semibold">{media.name}</figcaption>
      {failed || !kind ? <p role="status">This file could not be displayed. Let your teacher know.</p>
        : kind === "image" ? <img src={media.dataUrl} alt={media.name} className="max-h-96 max-w-full object-contain" onError={playerProps.onError} />
        : kind === "audio" ? <audio {...playerProps} className="w-full" />
        : <video {...playerProps} playsInline disablePictureInPicture className="max-h-96 w-full" />}
    </figure>
  );
}

export function QuestionMedia({ exam, questionId }: { exam: Exam; questionId?: string }) {
  return (exam.sharedMedia ?? [])
    .filter(media => questionId && media.questionIds.includes(questionId))
    .map(media => <MediaFigure key={media.id} media={media} />);
}
