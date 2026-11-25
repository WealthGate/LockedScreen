import type {
  Candidate,
  Exam,
  ExamResponse,
  ExamSession,
  SubmissionResult
} from "@lockedscreen/shared-types";

export * from "./shared-media";
export * from "./reading-passages";

const addMinutes = (input: Date, minutes: number): Date => {
  return new Date(input.getTime() + minutes * 60000);
};

export const createSession = (exam: Exam, candidate: Candidate, startedAt = new Date()): ExamSession => {

  return {
    examId: exam.id,
    candidate,
    mode: exam.mode,
    startedAt: startedAt.toISOString(),
    endsAt: addMinutes(startedAt, exam.durationMinutes).toISOString(),
    responses: exam.questions.map((question) => ({
      questionId: question.id,
      selectedOptionId: undefined,
      flagged: false
    }))
  };
};

export const updateResponse = (
  responses: ExamResponse[],
  questionId: string,
  patch: Partial<ExamResponse>
): ExamResponse[] =>
  responses.map((response) =>
    response.questionId === questionId ? { ...response, ...patch } : response
  );

export const getRemainingSeconds = (session: ExamSession, now = new Date()): number =>
  Math.max(0, Math.floor((new Date(session.endsAt).getTime() - now.getTime()) / 1000));

export const calculateCompletion = (session: ExamSession): number => {
  if (session.responses.length === 0) {
    return 0;
  }

  const answered = session.responses.filter((response) => response.selectedOptionId).length;
  return answered / session.responses.length;
};

export const scoreSubmission = (
  exam: Exam,
  session: ExamSession,
  submittedAt = new Date()
): SubmissionResult => {
  const answerMap = new Map(session.responses.map((response) => [response.questionId, response]));
  const totalPoints = exam.questions.reduce((sum, question) => sum + question.points, 0);
  const score = exam.questions.reduce((sum, question) => {
    const response = answerMap.get(question.id);
    return response?.selectedOptionId === question.correctOptionId ? sum + question.points : sum;
  }, 0);
  const percentage = totalPoints === 0 ? 0 : Number(((score / totalPoints) * 100).toFixed(2));
  const recordings: Record<string, string> = Object.create(null);
  let bytes = 0;
  for (const q of exam.questions) {
    const value = session.spokenAnswers?.[q.id];
    if (exam.mode !== "app" || !q.spokenAnswer || value === undefined) continue;
    if (typeof value !== "string" || value.length > 1000000 || (bytes += value.length) > 16000000 ||
      !/^data:audio\/webm;base64,[a-zA-Z0-9+/]+=*$/.test(value)) throw new Error("Invalid or oversized spoken answer.");
    recordings[q.id] = value;
  }

  return {
    id: `${exam.id}-${session.candidate.id}-${submittedAt.getTime()}`,
    examId: exam.id,
    examTitle: exam.title,
    candidateName: session.candidate.name,
    candidateId: session.candidate.id,
    candidateClassName: session.candidate.className?.trim() || undefined,
    submittedAt: submittedAt.toISOString(),
    score,
    totalPoints,
    percentage,
    responses: session.responses,
    ...(Object.keys(recordings).length ? { spokenAnswers: recordings } : {}),
    ...(exam.mode === "link" && ["attempted", "not-attempted"].includes(session.linkedTimeout ?? "") ? { linkedTimeout: session.linkedTimeout } : {}),
    syncStates: []
  };
};
