import type { Exam, ResultDestination, SubmissionResult, SubmissionSyncState } from "@lockedscreen/shared-types";

interface ResultSyncOptions {
  googleAccessToken?: string;
}

const destinationMatchesExam = (destination: ResultDestination, exam: Exam): boolean => {
  const explicitlyMatchesExam = destination.examIds.includes(exam.id);
  if (explicitlyMatchesExam) {
    return true;
  }

  const examIdMatch = destination.examIds.length === 0;
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

/**
 * Payload sent to a school-owned server-side grade sync bridge.
 *
 * Lockedscreen desktop should not carry a teacher refresh token inside exported
 * student packages. For automatic Google Classroom grade passback across
 * student machines, the desktop posts the local result to a trusted school
 * service. That service owns its Google authorization storage and writes
 * draftGrade/assignedGrade to Classroom server-side.
 */
const buildServerGradeSyncPayload = (destination: ResultDestination, exam: Exam, submission: SubmissionResult) => ({
  provider: destination.type,
  schema: "lockedscreen.google-classroom.grade-sync.v1",
  requestedAction: "sync-grade",
  syncedAt: new Date().toISOString(),
  destination: {
    id: destination.id,
    label: destination.label,
    type: destination.type,
    courseId: destination.courseId,
    assignmentId: destination.assignmentId,
    assignmentLabel: destination.assignmentLabel,
    connectionId: destination.connectionId,
    className: destination.className
  },
  classroom: {
    courseId: destination.courseId || exam.className,
    courseWorkId: destination.assignmentId || exam.id,
    lockedscreenExamId: exam.id,
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
    sort: {
      enabled: destination.sortByLastName !== false,
      by: "student.lastName",
      direction: "asc"
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

const buildPayload = (destination: ResultDestination, exam: Exam, submission: SubmissionResult) => {
  if (destination.type === "google-sheets" && destination.bridgeEndpointUrl?.trim()) {
    return buildGoogleSheetBridgePayload(destination, exam, submission);
  }

  if (destination.type === "google-classroom-grade-sync") {
    // Video/demo note: this is the automatic grade-sync path. The app sends the score to a school server,
    // and that server writes the grade to Google Classroom using protected server-side credentials.
    return buildServerGradeSyncPayload(destination, exam, submission);
  }

  return {
  provider: destination.type,
  syncedAt: new Date().toISOString(),
  destination: {
    id: destination.id,
    label: destination.label,
    type: destination.type,
    className: destination.className,
    courseId: destination.courseId,
    assignmentId: destination.assignmentId,
    assignmentLabel: destination.assignmentLabel,
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
  };
};

const parseGoogleSpreadsheetId = (input: string): string | null => {
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match?.[1]) {
    return match[1];
  }

  return /^[a-zA-Z0-9-_]{20,}$/.test(trimmed) ? trimmed : null;
};

const googleSheetsRange = (destination: ResultDestination): string => {
  const sheetName = destination.sheetName?.trim();
  if (!sheetName) {
    return "A:K";
  }

  const escaped = sheetName.replace(/'/g, "''");
  return `'${escaped}'!A:K`;
};

const buildSheetRow = (exam: Exam, submission: SubmissionResult) => [
  submission.submittedAt,
  submission.candidateName,
  submission.candidateId,
  submission.candidateClassName ?? exam.className,
  exam.title,
  exam.subject,
  submission.score,
  submission.totalPoints,
  submission.percentage,
  submission.studentLmsTurnIn?.gradeValue ?? "",
  submission.id
];

const syncSubmissionToGoogleSheet = async (
  destination: ResultDestination,
  exam: Exam,
  submission: SubmissionResult,
  options: ResultSyncOptions
): Promise<SubmissionSyncState> => {
  const attemptedAt = new Date().toISOString();
  const spreadsheetId = parseGoogleSpreadsheetId(destination.endpointUrl);

  if (!spreadsheetId) {
    return {
      destinationId: destination.id,
      destinationLabel: destination.label,
      destinationType: destination.type,
      status: "failed",
      lastAttemptAt: attemptedAt,
      lastError: "Enter a valid Google Sheets link or spreadsheet ID."
    };
  }

  if (!options.googleAccessToken) {
    return {
      destinationId: destination.id,
      destinationLabel: destination.label,
      destinationType: destination.type,
      status: "failed",
      lastAttemptAt: attemptedAt,
      lastError: "Reconnect the teacher Google account with Google Sheets permission, then sync again."
    };
  }

  try {
    const range = encodeURIComponent(googleSheetsRange(destination));
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.googleAccessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          majorDimension: "ROWS",
          values: [buildSheetRow(exam, submission)]
        })
      }
    );
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      const error = typeof payload.error === "object" && payload.error !== null ? (payload.error as Record<string, unknown>) : {};
      return {
        destinationId: destination.id,
        destinationLabel: destination.label,
        destinationType: destination.type,
        status: "failed",
        lastAttemptAt: attemptedAt,
        lastError:
          typeof error.message === "string"
            ? error.message
            : "Google Sheets could not accept this grade row. Check sheet sharing and reconnect Google.",
        httpStatus: response.status
      };
    }

    const updates = typeof payload.updates === "object" && payload.updates !== null ? (payload.updates as Record<string, unknown>) : {};
    return {
      destinationId: destination.id,
      destinationLabel: destination.label,
      destinationType: destination.type,
      status: "success",
      lastAttemptAt: attemptedAt,
      externalReference: typeof updates.updatedRange === "string" ? updates.updatedRange : spreadsheetId,
      httpStatus: response.status
    };
  } catch (error) {
    return {
      destinationId: destination.id,
      destinationLabel: destination.label,
      destinationType: destination.type,
      status: "failed",
      lastAttemptAt: attemptedAt,
      lastError: error instanceof Error ? error.message : "Google Sheets sync failed."
    };
  }
};

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
  submission: SubmissionResult,
  options: ResultSyncOptions = {}
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

  if (destination.type === "google-sheets" && destination.bridgeEndpointUrl?.trim()) {
    try {
      const response = await fetch(destination.bridgeEndpointUrl.trim(), {
        method: "POST",
        headers: buildHeaders(destination),
        body: JSON.stringify(buildPayload(destination, exam, submission))
      });
      const contentType = response.headers.get("content-type") ?? "";
      const body = contentType.includes("application/json")
        ? ((await response.json().catch(() => ({}))) as Record<string, unknown>)
        : { referenceId: await response.text().catch(() => "") };

      const referenceCandidate = body.referenceId ?? body.id ?? body.updatedRange;
      return {
        destinationId: destination.id,
        destinationLabel: destination.label,
        destinationType: destination.type,
        status: response.ok ? "success" : "failed",
        lastAttemptAt: attemptedAt,
        lastError: response.ok
          ? undefined
          : typeof body.message === "string"
            ? body.message
            : `School Google Sheets sync endpoint responded with ${response.status}.`,
        externalReference: typeof referenceCandidate === "string" ? referenceCandidate : undefined,
        httpStatus: response.status
      };
    } catch (error) {
      return {
        destinationId: destination.id,
        destinationLabel: destination.label,
        destinationType: destination.type,
        status: "failed",
        lastAttemptAt: attemptedAt,
        lastError: error instanceof Error ? error.message : "School Google Sheets sync endpoint could not be reached."
      };
    }
  }

  if (destination.type === "google-sheets") {
    return syncSubmissionToGoogleSheet(destination, exam, submission, options);
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
