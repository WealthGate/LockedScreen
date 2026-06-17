import { buildGoogleClassroomStudentSubmissionActionUrl } from "./student-lms-url";

export interface GoogleClassroomUploadedFile {
  id: string;
  name: string;
  webViewLink?: string;
}

class GoogleClassroomAttachmentError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "GoogleClassroomAttachmentError";
  }
}

const readGoogleClassroomJson = async <T>(response: Response, fallbackMessage: string): Promise<T> => {
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
    throw new GoogleClassroomAttachmentError(
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

export const buildGoogleClassroomDriveFileAttachmentRequest = (
  uploadedFile: GoogleClassroomUploadedFile
): Record<string, unknown> => ({
  addAttachments: [
    {
      driveFile: {
        id: uploadedFile.id
      }
    }
  ]
});

export const buildGoogleClassroomLinkAttachmentRequest = (
  uploadedFile: GoogleClassroomUploadedFile
): Record<string, unknown> => ({
  addAttachments: [
    {
      link: {
        url: uploadedFile.webViewLink
      }
    }
  ]
});

const postGoogleClassroomAttachment = async (
  url: string,
  accessToken: string,
  body: Record<string, unknown>
): Promise<void> => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  await readGoogleClassroomJson<Record<string, unknown>>(
    response,
    "Unable to attach the Lockedscreen submission to Google Classroom."
  );
};

const attachmentFailureWarning = (error: unknown): string => {
  const detail = error instanceof Error ? error.message : "Google Classroom rejected the attachment.";
  return `Google Classroom did not accept the Lockedscreen result file attachment. The local exam result is saved, and Lockedscreen will still try to turn in the assignment and sync the grade. Google said: ${detail}`;
};

export const attachGoogleClassroomSubmissionArtifact = async (
  courseWorkBaseUrl: string,
  studentSubmissionId: string,
  accessToken: string,
  uploadedFile: GoogleClassroomUploadedFile
): Promise<string | undefined> => {
  const attachmentUrl = buildGoogleClassroomStudentSubmissionActionUrl(
    courseWorkBaseUrl,
    studentSubmissionId,
    "modifyAttachments"
  );

  try {
    await postGoogleClassroomAttachment(
      attachmentUrl,
      accessToken,
      buildGoogleClassroomDriveFileAttachmentRequest(uploadedFile)
    );
    return undefined;
  } catch (driveFileError) {
    if (uploadedFile.webViewLink) {
      try {
        await postGoogleClassroomAttachment(
          attachmentUrl,
          accessToken,
          buildGoogleClassroomLinkAttachmentRequest(uploadedFile)
        );
        return undefined;
      } catch (linkError) {
        return attachmentFailureWarning(linkError);
      }
    }

    return attachmentFailureWarning(driveFileError);
  }
};
