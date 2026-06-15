import type { StudentLmsBinding, StudentLmsTurnInState, SubmissionResult } from "@lockedscreen/shared-types";

interface GoogleClassroomGradeSyncInput {
  teacherAccessToken?: string;
  studentSubmissionId: string;
  studentEmail?: string;
}

class GoogleClassroomApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "GoogleClassroomApiError";
  }
}

const courseWorkBaseUrl = (binding: StudentLmsBinding): string =>
  `https://classroom.googleapis.com/v1/courses/${encodeURIComponent(binding.courseId)}/courseWork/${encodeURIComponent(binding.assignmentId)}`;

const googleClassroomJson = async <T>(url: string, init: RequestInit, fallbackMessage: string): Promise<T> => {
  const response = await fetch(url, init);
  if (response.status === 204) {
    return {} as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? ((await response.json().catch(() => ({}))) as Record<string, unknown>)
    : { message: contentType.includes("text/html") ? undefined : (await response.text()).trim() || undefined };
  const errorPayload =
    typeof payload.error === "object" && payload.error !== null ? (payload.error as Record<string, unknown>) : undefined;

  if (!response.ok) {
    throw new GoogleClassroomApiError(
      typeof payload.error_description === "string"
        ? payload.error_description
        : typeof errorPayload?.message === "string"
          ? errorPayload.message
          : typeof payload.message === "string"
            ? payload.message
            : fallbackMessage,
      response.status
    );
  }

  return payload as T;
};

const isGoogleClassroomNotFound = (error: unknown): boolean =>
  (error instanceof GoogleClassroomApiError && error.status === 404) ||
  (error instanceof Error && error.message.toLowerCase().includes("requested entity"));

const friendlyGoogleClassroomGradeSyncError = (
  error: unknown,
  binding: StudentLmsBinding,
  studentEmail?: string
): string => {
  if (isGoogleClassroomNotFound(error)) {
    return [
      "Google Classroom could not find the student's grade record for this assignment.",
      studentEmail ? `Signed-in student: ${studentEmail}.` : undefined,
      "Confirm the connected teacher account is a teacher in this class, the student is assigned to this exact Classroom assignment, and the assignment was posted/exported by this Lockedscreen Google Classroom app."
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (error instanceof GoogleClassroomApiError && error.status === 403) {
    return [
      "Google Classroom did not allow grade write-back for this assignment.",
      "Reconnect the teacher Google account with Classroom grade permissions, and confirm this assignment was created by this Lockedscreen Google Classroom app."
    ].join(" ");
  }

  return error instanceof Error
    ? error.message
    : "Google Classroom did not accept the grade update. Reconnect the teacher account and try again.";
};

const findTeacherVisibleStudentSubmissionId = async (
  binding: StudentLmsBinding,
  teacherAccessToken: string,
  studentEmail: string
): Promise<string> => {
  const submissionList = await googleClassroomJson<{ studentSubmissions?: Array<Record<string, unknown>> }>(
    `${courseWorkBaseUrl(binding)}/studentSubmissions?userId=${encodeURIComponent(studentEmail)}&pageSize=1`,
    {
      headers: { Authorization: `Bearer ${teacherAccessToken}` }
    },
    "Unable to find the student's Google Classroom submission."
  );
  const studentSubmission = submissionList.studentSubmissions?.find((candidate) => typeof candidate.id === "string");

  if (typeof studentSubmission?.id !== "string") {
    throw new GoogleClassroomApiError(`No Google Classroom submission was found for ${studentEmail}.`, 404);
  }

  return studentSubmission.id;
};

const patchGoogleClassroomGrade = async (
  binding: StudentLmsBinding,
  teacherAccessToken: string,
  studentSubmissionId: string,
  gradeValue: number
): Promise<void> => {
  await googleClassroomJson<Record<string, unknown>>(
    `${courseWorkBaseUrl(binding)}/studentSubmissions/${encodeURIComponent(studentSubmissionId)}?updateMask=assignedGrade,draftGrade`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${teacherAccessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        assignedGrade: gradeValue,
        draftGrade: gradeValue
      })
    },
    "Unable to sync the grade to Google Classroom."
  );
};

const readGoogleCourseWorkMaxPoints = async (
  binding: StudentLmsBinding,
  teacherAccessToken: string
): Promise<number | null> => {
  const response = await fetch(courseWorkBaseUrl(binding), {
    headers: { Authorization: `Bearer ${teacherAccessToken}` }
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    return null;
  }

  const maxPoints = Number(payload.maxPoints ?? Number.NaN);
  return Number.isFinite(maxPoints) && maxPoints > 0 ? maxPoints : null;
};

const googleGradeValue = async (
  binding: StudentLmsBinding,
  teacherAccessToken: string,
  submission: SubmissionResult
): Promise<number> => {
  const maxPoints = await readGoogleCourseWorkMaxPoints(binding, teacherAccessToken);
  const totalPoints = Number(submission.totalPoints);
  const score = Number(submission.score);

  if (maxPoints && Number.isFinite(totalPoints) && totalPoints > 0) {
    return Math.round((score / totalPoints) * maxPoints * 100) / 100;
  }

  return Math.round(score * 100) / 100;
};

export const syncGoogleClassroomGrade = async (
  binding: StudentLmsBinding,
  input: GoogleClassroomGradeSyncInput,
  submission: SubmissionResult
): Promise<Pick<StudentLmsTurnInState, "gradeSyncStatus" | "gradeSyncedAt" | "gradeValue" | "gradeSyncError">> => {
  if (!input.teacherAccessToken) {
    return {
      gradeSyncStatus: "skipped",
      gradeSyncError:
        "Grade sync needs the teacher's Google Classroom connection on this device. Student sign-in can turn in work, but students cannot write grades."
    };
  }

  try {
    const gradeValue = await googleGradeValue(binding, input.teacherAccessToken, submission);

    try {
      await patchGoogleClassroomGrade(binding, input.teacherAccessToken, input.studentSubmissionId, gradeValue);
    } catch (error) {
      if (!isGoogleClassroomNotFound(error) || !input.studentEmail) {
        throw error;
      }

      const teacherVisibleSubmissionId = await findTeacherVisibleStudentSubmissionId(
        binding,
        input.teacherAccessToken,
        input.studentEmail
      );
      if (teacherVisibleSubmissionId === input.studentSubmissionId) {
        throw error;
      }

      await patchGoogleClassroomGrade(binding, input.teacherAccessToken, teacherVisibleSubmissionId, gradeValue);
    }

    return {
      gradeSyncStatus: "success",
      gradeSyncedAt: new Date().toISOString(),
      gradeValue
    };
  } catch (error) {
    return {
      gradeSyncStatus: "failed",
      gradeSyncError: friendlyGoogleClassroomGradeSyncError(error, binding, input.studentEmail)
    };
  }
};
