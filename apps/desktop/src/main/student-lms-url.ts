export type GoogleClassroomSubmissionAction = "modifyAttachments" | "turnIn";

export const buildGoogleClassroomStudentSubmissionActionUrl = (
  courseWorkBaseUrl: string,
  studentSubmissionId: string,
  action: GoogleClassroomSubmissionAction
): string =>
  `${courseWorkBaseUrl}/studentSubmissions/${encodeURIComponent(studentSubmissionId)}:${action}`;
