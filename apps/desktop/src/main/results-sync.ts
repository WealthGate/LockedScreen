import type { Exam, ResultDestination, SubmissionResult, SubmissionSyncState } from "@lockedscreen/shared-types";

const destinationMatchesExam = (destination: ResultDestination, exam: Exam): boolean => {
  const examIdMatch = destination.examIds.length === 0 || destination.examIds.includes(exam.id);
  const classMatch = !destination.className || destination.className.trim() === exam.className.trim();
  return examIdMatch && classMatch;
};

const buildHeaders = (destination: ResultDestination): Record<string, string> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (destination.authMode === "bearer" && destination.authToken) {
    headers.Authorization = `Bearer ${destination.authToken}`;
  }

  if (destination.authMode === "api-key" && destination.authToken) {
    headers[destination.apiKeyHeader?.trim() || "x-api-key"] = destination.authToken;
  }

  return headers;
};

const buildPayload = (destination: ResultDestination, exam: Exam, submission: SubmissionResult) => ({
  provider: destination.type,
  syncedAt: new Date().toISOString(),
  destination: {
    id: destination.id,
    label: destination.label,
    type: destination.type,
    className: destination.className,
    courseId: destination.courseId,
    sheetName: destination.sheetName
  },
  exam: {
    id: exam.id,
    title: exam.title,
    subject: exam.subject,
    className: exam.className,
    form: exam.form,
    durationMinutes: exam.durationMinutes
  },
  submission: {
    id: submission.id,
    examId: submission.examId,
    examTitle: submission.examTitle,
    candidateName: submission.candidateName,
    candidateId: submission.candidateId,
    submittedAt: submission.submittedAt,
    score: submission.score,
    totalPoints: submission.totalPoints,
    percentage: submission.percentage,
    responses: destination.includeResponses ? submission.responses : []
  }
});

export const createDisabledSyncState = (
  destination: ResultDestination,
  reason?: string
): SubmissionSyncState => ({
  destinationId: destination.id,
  destinationLabel: destination.label,
  destinationType: destination.type,
  status: "disabled",
  lastAttemptAt: new Date().toISOString(),
  lastError: reason
});

export const syncSubmissionToDestination = async (
  destination: ResultDestination,
  exam: Exam,
  submission: SubmissionResult
): Promise<SubmissionSyncState> => {
  const attemptedAt = new Date().toISOString();

  if (!destination.enabled) {
    return createDisabledSyncState(destination, "Destination disabled.");
  }

  if (!destinationMatchesExam(destination, exam)) {
    return createDisabledSyncState(destination, "Destination does not match this exam or class.");
  }

  if (!destination.endpointUrl.trim()) {
    return {
      destinationId: destination.id,
      destinationLabel: destination.label,
      destinationType: destination.type,
      status: "failed",
      lastAttemptAt: attemptedAt,
      lastError: "Destination endpoint is empty."
    };
  }

  try {
    const response = await fetch(destination.endpointUrl, {
      method: "POST",
      headers: buildHeaders(destination),
      body: JSON.stringify(buildPayload(destination, exam, submission))
    });

    let externalReference: string | undefined;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await response.json()) as Record<string, unknown>;
      const referenceCandidate = body.referenceId ?? body.id ?? body.submissionId;
      if (typeof referenceCandidate === "string") {
        externalReference = referenceCandidate;
      }
    } else {
      const body = await response.text();
      if (body.trim().length > 0) {
        externalReference = body.trim().slice(0, 200);
      }
    }

    if (!response.ok) {
      return {
        destinationId: destination.id,
        destinationLabel: destination.label,
        destinationType: destination.type,
        status: "failed",
        lastAttemptAt: attemptedAt,
        lastError: `Remote endpoint responded with ${response.status}.`,
        externalReference,
        httpStatus: response.status
      };
    }

    return {
      destinationId: destination.id,
      destinationLabel: destination.label,
      destinationType: destination.type,
      status: "success",
      lastAttemptAt: attemptedAt,
      externalReference,
      httpStatus: response.status
    };
  } catch (error) {
    return {
      destinationId: destination.id,
      destinationLabel: destination.label,
      destinationType: destination.type,
      status: "failed",
      lastAttemptAt: attemptedAt,
      lastError: error instanceof Error ? error.message : "Network request failed."
    };
  }
};
