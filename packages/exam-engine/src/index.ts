import type {
  Candidate,
  Exam,
  ExamResponse,
  ExamSession,
  SubmissionResult
} from "@lockedscreen/shared-types";

const addMinutes = (input: Date, minutes: number): Date => {
  const copy = new Date(input);
  copy.setMinutes(copy.getMinutes() + minutes);
  return copy;
};

export const createSession = (exam: Exam, candidate: Candidate): ExamSession => {
  const startedAt = new Date();

  return {
    examId: exam.id,
    candidate,
    mode: exam.mode,
    startedAt: startedAt.toISOString(),
    endsAt: addMinutes(startedAt, exam.durationMinutes).toISOString(),
    mediaPlayCounts: {},
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
    syncStates: []
  };
};
