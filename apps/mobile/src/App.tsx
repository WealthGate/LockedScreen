import { useCallback, useEffect, useMemo, useState } from "react";

import { createSession, getRemainingSeconds, scoreSubmission, updateResponse } from "@lockedscreen/exam-engine";
import type { Candidate, ExamResponse, ExamSession, SubmissionResult } from "@lockedscreen/shared-types";

import { enterMobileExamShell, leaveMobileExamShell } from "./lib/mobileShell";
import { importPackageFromFile, type ImportedProtectedPackage, verifyExamStartCode } from "./lib/packageCrypto";
import { syncSubmissionDestinations } from "./lib/resultSync";

type AppPhase = "import" | "ready" | "active" | "submitted";

interface CandidateDraft {
  name: string;
  candidateId: string;
  className: string;
  startCode: string;
}

const blankCandidate: CandidateDraft = {
  name: "",
  candidateId: "",
  className: "",
  startCode: ""
};

const formatDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`;
};

const candidateFromDraft = (draft: CandidateDraft): Candidate => ({
  id: draft.candidateId.trim(),
  name: draft.name.trim(),
  className: draft.className.trim() || undefined
});

const assignedToCandidate = (imported: ImportedProtectedPackage, candidate: Candidate): string | null => {
  const { studentAccessPolicy } = imported.configPackage;
  const assignedIds = studentAccessPolicy.assignedCandidateIds.map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  const assignedClasses = studentAccessPolicy.assignedClassNames.map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  const hasExplicitAssignment = assignedIds.length > 0 || assignedClasses.length > 0;

  if (!hasExplicitAssignment) {
    return "This exam package has not been assigned to this student.";
  }

  const idMatches = assignedIds.includes(candidate.id.toLowerCase());
  const classMatches = assignedClasses.includes((candidate.className ?? "").toLowerCase());
  if (!idMatches && !classMatches) {
    return "This student is not assigned to this exam package.";
  }

  return null;
};

const availableNow = (imported: ImportedProtectedPackage): string | null => {
  const { availableFrom, availableUntil } = imported.configPackage.studentAccessPolicy;
  const now = Date.now();

  if (availableFrom && now < new Date(availableFrom).getTime()) {
    return "This exam is not open yet.";
  }

  if (availableUntil && now > new Date(availableUntil).getTime()) {
    return "This exam is already closed.";
  }

  return null;
};

const App = () => {
  const [phase, setPhase] = useState<AppPhase>("import");
  const [imported, setImported] = useState<ImportedProtectedPackage | null>(null);
  const [candidateDraft, setCandidateDraft] = useState<CandidateDraft>(blankCandidate);
  const [session, setSession] = useState<ExamSession | null>(null);
  const [submission, setSubmission] = useState<SubmissionResult | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shellWarnings, setShellWarnings] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const exam = imported?.exam ?? null;
  const configPackage = imported?.configPackage ?? null;
  const answeredCount = session?.responses.filter((response) => response.selectedOptionId).length ?? 0;
  const showScore = Boolean(configPackage?.teacherOptions.showScoreAfterSubmit);

  const canStart = useMemo(
    () => Boolean(imported && candidateDraft.name.trim() && candidateDraft.candidateId.trim()),
    [candidateDraft.candidateId, candidateDraft.name, imported]
  );

  const handleImport = async (file: File | undefined) => {
    if (!file) {
      return;
    }

    setError(null);
    setStatus("Reading exam package...");
    setSubmission(null);
    setSession(null);

    try {
      const nextImported = await importPackageFromFile(file);
      setImported(nextImported);
      setCandidateDraft((current) => ({
        ...current,
        className: current.className || nextImported.exam.className
      }));
      setPhase("ready");
      setStatus("Exam package loaded.");
    } catch (nextError) {
      setImported(null);
      setPhase("import");
      setError(nextError instanceof Error ? nextError.message : "The package could not be opened.");
      setStatus(null);
    }
  };

  const submitSession = useCallback(
    async (reason: "student" | "timer") => {
      if (!imported || !session || submitting) {
        return;
      }

      setSubmitting(true);
      setStatus(reason === "timer" ? "Time is up. Submitting your exam..." : "Submitting your exam...");
      const result = scoreSubmission(imported.exam, session);
      const syncStates = await syncSubmissionDestinations(imported.configPackage.resultDestinations, imported.exam, result);
      const completed = {
        ...result,
        syncStates
      };

      setSubmission(completed);
      setPhase("submitted");
      setStatus("Exam submitted.");
      setSubmitting(false);
      await leaveMobileExamShell();
    },
    [imported, session, submitting]
  );

  useEffect(() => {
    if (!session || phase !== "active") {
      return undefined;
    }

    const tick = () => {
      const nextRemaining = getRemainingSeconds(session);
      setRemainingSeconds(nextRemaining);
      if (nextRemaining <= 0) {
        void submitSession("timer");
      }
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [phase, session, submitSession]);

  const startExam = async () => {
    if (!imported || !canStart) {
      return;
    }

    const candidate = candidateFromDraft(candidateDraft);
    const availabilityError = availableNow(imported);
    const assignmentError = assignedToCandidate(imported, candidate);
    if (availabilityError || assignmentError) {
      setError(availabilityError ?? assignmentError);
      return;
    }

    if (!(await verifyExamStartCode(candidateDraft.startCode, imported.configPackage))) {
      setError("The exam start code is incorrect.");
      return;
    }

    if (imported.exam.mode !== "app") {
      setError("This first mobile version supports app-based Lockedscreen exams only. Use the Windows app for link-based exams.");
      return;
    }

    setError(null);
    setStatus("Starting secure mobile session...");
    setShellWarnings(await enterMobileExamShell());
    const nextSession = createSession(imported.exam, candidate);
    setSession(nextSession);
    setRemainingSeconds(getRemainingSeconds(nextSession));
    setPhase("active");
    setStatus(null);
  };

  const selectOption = (questionId: string, selectedOptionId: string) => {
    setSession((current) =>
      current
        ? {
            ...current,
            responses: updateResponse(current.responses, questionId, { selectedOptionId })
          }
        : current
    );
  };

  const toggleFlag = (response: ExamResponse) => {
    setSession((current) =>
      current
        ? {
            ...current,
            responses: updateResponse(current.responses, response.questionId, { flagged: !response.flagged })
          }
        : current
    );
  };

  const resetForNextPackage = async () => {
    await leaveMobileExamShell();
    setPhase("import");
    setImported(null);
    setCandidateDraft(blankCandidate);
    setSession(null);
    setSubmission(null);
    setError(null);
    setStatus(null);
    setShellWarnings([]);
  };

  return (
    <main className={`app-shell app-shell-${phase}`}>
      <section className="hero">
        <div>
          <div className="eyebrow">Lockedscreen Mobile</div>
          <h1>{exam?.title ?? "Phone fallback exam runtime"}</h1>
          <p>
            Import a teacher-exported Lockedscreen package, enter student details, and run the exam in a focused
            mobile session.
          </p>
        </div>
        <div className="status-card">
          <span>{phase === "active" ? "Exam active" : phase === "submitted" ? "Submitted" : "Ready"}</span>
          <strong>{phase === "active" ? formatDuration(remainingSeconds) : exam?.className ?? "Android first"}</strong>
        </div>
      </section>

      {status ? <div className="notice notice-info">{status}</div> : null}
      {error ? <div className="notice notice-error">{error}</div> : null}
      {shellWarnings.length > 0 ? (
        <div className="notice notice-warn">
          {shellWarnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      ) : null}

      {phase === "import" || phase === "ready" ? (
        <section className="panel-grid">
          <div className="panel">
            <h2>1. Load exam package</h2>
            <p>Choose the `.lscp` package exported by the teacher from Lockedscreen desktop.</p>
            <label className="file-picker">
              <input
                type="file"
                accept=".lscp,application/json,text/plain"
                onChange={(event) => void handleImport(event.target.files?.[0])}
              />
              Choose package
            </label>
            {exam && configPackage ? (
              <div className="package-summary">
                <strong>{configPackage.label}</strong>
                <span>{exam.subject}</span>
                <span>{exam.durationMinutes} minutes</span>
                <span>{configPackage.securityMode === "full-kiosk" ? "Kiosk expected" : "Restricted app"}</span>
              </div>
            ) : null}
          </div>

          <div className="panel">
            <h2>2. Student details</h2>
            <label>
              Student name
              <input
                value={candidateDraft.name}
                onChange={(event) => setCandidateDraft((current) => ({ ...current, name: event.target.value }))}
                autoComplete="name"
              />
            </label>
            <label>
              Candidate ID
              <input
                value={candidateDraft.candidateId}
                onChange={(event) => setCandidateDraft((current) => ({ ...current, candidateId: event.target.value }))}
                autoComplete="off"
              />
            </label>
            <label>
              Class
              <input
                value={candidateDraft.className}
                onChange={(event) => setCandidateDraft((current) => ({ ...current, className: event.target.value }))}
                autoComplete="off"
              />
            </label>
            {configPackage?.studentAccessPolicy.startCodeHash ? (
              <label>
                Exam start code
                <input
                  type="password"
                  value={candidateDraft.startCode}
                  onChange={(event) => setCandidateDraft((current) => ({ ...current, startCode: event.target.value }))}
                  autoComplete="off"
                />
                {configPackage.studentAccessPolicy.startCodeHint ? (
                  <small>Hint: {configPackage.studentAccessPolicy.startCodeHint}</small>
                ) : null}
              </label>
            ) : null}
            <button className="primary-button" disabled={!canStart} onClick={() => void startExam()}>
              Start exam
            </button>
          </div>
        </section>
      ) : null}

      {phase === "active" && exam && session ? (
        <section className="exam-layout">
          <div className="exam-toolbar">
            <div>
              <strong>{answeredCount}</strong> of <strong>{exam.questions.length}</strong> answered
            </div>
            <button className="submit-button" disabled={submitting} onClick={() => void submitSession("student")}>
              Submit exam
            </button>
          </div>

          {exam.questions.map((question, index) => {
            const response = session.responses.find((entry) => entry.questionId === question.id);
            return (
              <article className="question-card" key={question.id}>
                <div className="question-heading">
                  <span>Question {index + 1}</span>
                  <button type="button" className="flag-button" onClick={() => response && toggleFlag(response)}>
                    {response?.flagged ? "Flagged" : "Flag"}
                  </button>
                </div>
                <h2>{question.prompt}</h2>
                <div className="options">
                  {question.options.map((option) => (
                    <button
                      type="button"
                      key={option.id}
                      className={response?.selectedOptionId === option.id ? "option selected" : "option"}
                      onClick={() => selectOption(question.id, option.id)}
                    >
                      <span className="option-label">{option.label}</span>
                      <span>{option.content}</span>
                    </button>
                  ))}
                </div>
              </article>
            );
          })}
        </section>
      ) : null}

      {phase === "submitted" && submission ? (
        <section className="panel submitted-panel">
          <h2>Submission recorded</h2>
          <p>{submission.candidateName}, your exam has been submitted.</p>
          {showScore ? (
            <div className="score-box">
              <span>Score</span>
              <strong>
                {submission.score} / {submission.totalPoints}
              </strong>
              <span>{submission.percentage}%</span>
            </div>
          ) : (
            <div className="notice notice-info">Your teacher has not enabled score display on this package.</div>
          )}
          <div className="sync-list">
            {submission.syncStates.length === 0 ? (
              <div>No remote grade destination was included in this package.</div>
            ) : (
              submission.syncStates.map((syncState) => (
                <div className={`sync-row sync-${syncState.status}`} key={syncState.destinationId}>
                  <strong>{syncState.destinationLabel}</strong>
                  <span>{syncState.status === "success" ? "Synced" : syncState.lastError ?? "Sync failed"}</span>
                </div>
              ))
            )}
          </div>
          <button className="secondary-button" onClick={() => void resetForNextPackage()}>
            Load another package
          </button>
        </section>
      ) : null}

      <section className="security-note">
        <strong>Mobile lockdown note</strong>
        <span>
          Strong Android lockdown requires school-managed kiosk or lock-task provisioning. This app provides the
          student runtime; device-owner setup is required before phones can be treated like managed exam devices.
        </span>
      </section>
    </main>
  );
};

export default App;
