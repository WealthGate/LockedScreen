import type { Exam, ResultDestination, SubmissionResult, SubmissionSyncState } from "@lockedscreen/shared-types";

const destinationMatchesExam = (destination: ResultDestination, exam: Exam): boolean => {
  const examIdMatch = destination.examIds.length === 0 || destination.examIds.includes(exam.id);
  const classMatch = !destination.className || destination.className.trim() === exam.className.trim();
  return examIdMatch && classMatch;
};

const splitStudentName = (name: string): { firstName: string; lastName: string } => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstName: "", lastName: "" };
  }

  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts.at(-1) ?? parts[0] ?? ""
  };
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

const buildGoogleSheetBridgePayload = (destination: ResultDestination, exam: Exam, submission: SubmissionResult) => {
  const studentName = splitStudentName(submission.candidateName);
  return {
    provider: "google-sheets",
    schema: "lockedscreen.google-sheets.grade-row.v1",
    requestedAction: "append-grade-row",
    syncedAt: new Date().toISOString(),
    destination: {
      id: destination.id,
      label: destination.label,
      sheetUrl: destination.endpointUrl,
      sheetName: destination.sheetName,
      className: destination.className,
      sortByLastName: destination.sortByLastName !== false
    },
    exam: {
      id: exam.id,
      title: exam.title,
      subject: exam.subject,
      className: exam.className,
      form: exam.form
    },
    student: {
      name: submission.candidateName,
      firstName: studentName.firstName,
      lastName: studentName.lastName,
      candidateId: submission.candidateId,
      className: submission.candidateClassName ?? exam.className
    },
    grade: {
      score: submission.score,
      totalPoints: submission.totalPoints,
      percentage: submission.percentage,
      submittedAt: submission.submittedAt
    },
    submission: {
      id: submission.id,
      responses: destination.includeResponses ? submission.responses : []
    }
  };
};

const buildClassroomGradeSyncPayload = (destination: ResultDestination, exam: Exam, submission: SubmissionResult) => ({
  provider: destination.type,
  schema: "lockedscreen.google-classroom.grade-sync.v1",
  requestedAction: "sync-grade",
  syncedAt: new Date().toISOString(),
  destination: {
    id: destination.id,
    label: destination.label,
    type: destination.type,
    courseId: destination.courseId,
    connectionId: destination.connectionId,
    className: destination.className
  },
  classroom: {
    courseId: destination.courseId || exam.className,
    courseWorkId: destination.assignmentId || exam.id,
    assignmentId: destination.assignmentId,
    assignmentLabel: destination.assignmentLabel,
    teacherConfiguredClassName: destination.className || exam.className,
    studentSubmissionId: submission.studentLmsTurnIn?.externalReference
  },
  exam: {
    id: exam.id,
    title: exam.title,
    subject: exam.subject,
    className: exam.className,
    form: exam.form,
    durationMinutes: exam.durationMinutes
  },
  student: {
    name: submission.candidateName,
    candidateId: submission.candidateId,
    className: submission.candidateClassName
  },
  grade: {
    score: submission.score,
    totalPoints: submission.totalPoints,
    percentage: submission.percentage,
    submittedAt: submission.submittedAt
  },
  submission: {
    id: submission.id,
    responses: destination.includeResponses ? submission.responses : []
  }
});

const buildGenericPayload = (destination: ResultDestination, exam: Exam, submission: SubmissionResult) => ({
  provider: destination.type,
  syncedAt: new Date().toISOString(),
  destination: {
    id: destination.id,
    label: destination.label,
    type: destination.type,
    className: destination.className,
    courseId: destination.courseId,
    connectionId: destination.connectionId,
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

const buildPayload = (destination: ResultDestination, exam: Exam, submission: SubmissionResult) => {
  if (destination.type === "google-sheets" && destination.bridgeEndpointUrl?.trim()) {
    return buildGoogleSheetBridgePayload(destination, exam, submission);
  }

  if (destination.type === "google-classroom-grade-sync") {
    return buildClassroomGradeSyncPayload(destination, exam, submission);
  }

  return buildGenericPayload(destination, exam, submission);
};

const endpointForDestination = (destination: ResultDestination): string =>
  destination.type === "google-sheets" && destination.bridgeEndpointUrl?.trim()
    ? destination.bridgeEndpointUrl.trim()
    : destination.endpointUrl.trim();

export const syncSubmissionDestinations = async (
  destinations: ResultDestination[],
  exam: Exam,
  submission: SubmissionResult
): Promise<SubmissionSyncState[]> => {
  const eligible = destinations.filter(
    (destination) =>
      destination.enabled &&
      destination.trigger === "auto-on-submit" &&
      destinationMatchesExam(destination, exam) &&
      endpointForDestination(destination).length > 0
  );

  return Promise.all(
    eligible.map(async (destination) => {
      const now = new Date().toISOString();
      try {
        const response = await fetch(endpointForDestination(destination), {
          method: "POST",
          headers: buildHeaders(destination),
          body: JSON.stringify(buildPayload(destination, exam, submission))
        });

        if (!response.ok) {
          throw new Error(`Remote sync returned ${response.status}.`);
        }

        return {
          destinationId: destination.id,
          destinationLabel: destination.label,
          destinationType: destination.type,
          status: "success",
          lastAttemptAt: now,
          httpStatus: response.status
        } satisfies SubmissionSyncState;
      } catch (error) {
        return {
          destinationId: destination.id,
          destinationLabel: destination.label,
          destinationType: destination.type,
          status: "failed",
          lastAttemptAt: now,
          lastError: error instanceof Error ? error.message : "Remote sync failed."
        } satisfies SubmissionSyncState;
      }
    })
  );
};
