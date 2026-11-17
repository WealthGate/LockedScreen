import type { GoogleClassroomPublishResult, GoogleIntegrationSettings, LmsCourse, LmsCourseWork, LmsStudent } from "@lockedscreen/shared-types";

import { googleClassroomDesktopOAuth } from "./google-integration-settings";
import type { GoogleOAuthFlow } from "./google-oauth-service";

export interface GoogleClassroomApi {
  listCourses(connectionId: string, settings: GoogleIntegrationSettings): Promise<LmsCourse[]>;
  listCourseWork(connectionId: string, settings: GoogleIntegrationSettings, courseId: string): Promise<LmsCourseWork[]>;
  listStudents(connectionId: string, settings: GoogleIntegrationSettings, courseId: string): Promise<LmsStudent[]>;
  publishPackageCourseWork(
    connectionId: string,
    settings: GoogleIntegrationSettings,
    request: {
      courseId: string;
      title: string;
      description: string;
      fileName: string;
      packageJson: PublishPackageJsonBuilder;
      maxPoints?: number;
    }
  ): Promise<GoogleClassroomPublishResult>;
}

type ClassroomRequestError = Error & { status?: number };
type PublishPackageJsonContext = Pick<LmsCourseWork, "id" | "title"> | null;
type PublishPackageJsonBuilder = string | ((context: PublishPackageJsonContext) => string);

const lockedscreenPackageMimeType = "application/octet-stream";

const classroomApiError = (status: number, payload: unknown): ClassroomRequestError => {
  const record = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  const errorRecord = typeof record.error === "object" && record.error !== null ? (record.error as Record<string, unknown>) : {};
  const message = typeof errorRecord.message === "string" ? errorRecord.message : "";
  const statusText = typeof errorRecord.status === "string" ? errorRecord.status : "";
  const detail = `${statusText} ${message}`.toLowerCase();

  if (status === 401 || detail.includes("invalid authentication") || detail.includes("invalid credentials")) {
    const error = new Error("Google Classroom needs you to sign in again. Reconnect Google Classroom and try loading classes once more.") as ClassroomRequestError;
    error.status = status;
    return error;
  }

  if (status === 400 && (detail.includes("client_secret") || detail.includes("invalid_grant"))) {
    const error = new Error(
      "Google Classroom needs the Desktop app client secret. Ask an admin to enter the client secret from the Google OAuth JSON, save settings, and reconnect Google Classroom."
    ) as ClassroomRequestError;
    error.status = status;
    return error;
  }

  if (
    status === 403 &&
    (detail.includes("insufficient") || detail.includes("scope") || detail.includes("permission"))
  ) {
    const error = new Error(
      "Lockedscreen does not have the needed Google Classroom permission. Ask an admin to confirm the Classroom and Drive permissions, then reconnect Google Classroom."
    ) as ClassroomRequestError;
    error.status = status;
    return error;
  }

  if (status === 403) {
    const error = new Error(
      "Google Classroom did not allow this request. Ask your school Google administrator to allow the Lockedscreen Classroom app, then reconnect."
    ) as ClassroomRequestError;
    error.status = status;
    return error;
  }

  const error = new Error("Google Classroom could not load classes right now. Check your connection and try again.") as ClassroomRequestError;
  error.status = status;
  return error;
};

const parseCourseWork = (item: Record<string, unknown>, courseId: string): LmsCourseWork => {
  const dueDate = item.dueDate as Record<string, unknown> | undefined;
  const dueTime = item.dueTime as Record<string, unknown> | undefined;
  const year = Number(dueDate?.year ?? 0);
  const month = Number(dueDate?.month ?? 0);
  const day = Number(dueDate?.day ?? 0);
  const hours = Number(dueTime?.hours ?? 0);
  const minutes = Number(dueTime?.minutes ?? 0);
  const seconds = Number(dueTime?.seconds ?? 0);
  const dueAt =
    year > 0 && month > 0 && day > 0
      ? new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds)).toISOString()
      : undefined;

  return {
    id: String(item.id ?? ""),
    courseId,
    title: String(item.title ?? "Untitled coursework"),
    alternateLink: typeof item.alternateLink === "string" ? item.alternateLink : undefined,
    dueAt,
    state: typeof item.state === "string" ? item.state : undefined
  };
};

const readClassroomJson = async <T>(response: Response): Promise<T> => {
  const payload = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) {
    throw classroomApiError(response.status, payload);
  }

  return payload as T;
};

const packageJsonForContext = (builder: PublishPackageJsonBuilder, context: PublishPackageJsonContext): string =>
  typeof builder === "function" ? builder(context) : builder;

const driveDownloadLink = (driveFileId: string, driveFile: Record<string, unknown>): string =>
  typeof driveFile.webContentLink === "string"
    ? driveFile.webContentLink
    : `https://drive.google.com/uc?export=download&id=${encodeURIComponent(driveFileId)}`;

const createPackageUploadBody = (boundary: string, fileName: string, packageJson: string): string =>
  [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify({
      name: fileName,
      mimeType: lockedscreenPackageMimeType
    }),
    `--${boundary}`,
    `Content-Type: ${lockedscreenPackageMimeType}`,
    "",
    packageJson,
    `--${boundary}--`,
    ""
  ].join("\r\n");

const requiredPublishScopes = [
  "https://www.googleapis.com/auth/classroom.coursework.students",
  "https://www.googleapis.com/auth/drive.file"
] as const;

const assertPublishScopesConfigured = (settings: GoogleIntegrationSettings): void => {
  const configuredScopes = new Set(settings.requestedScopes.map((scope) => scope.trim()).filter(Boolean));
  const missingScopes = requiredPublishScopes.filter((scope) => !configuredScopes.has(scope));
  if (missingScopes.length === 0) {
    return;
  }

  throw new Error(
    `Posting a package to Google Classroom needs these Google permissions: ${missingScopes.join(", ")}. Ask an admin to save the Google Classroom settings, then reconnect the teacher Google account.`
  );
};

type PublishStep = "Drive upload" | "Classroom draft creation" | "Drive package update" | "Classroom publication";

const publishRequest = async (step: PublishStep, url: string, init: RequestInit): Promise<Record<string, unknown>> => {
  const drive = step.startsWith("Drive");
  const api = drive ? "Google Drive" : "Google Classroom";
  const retryNote = step === "Drive upload" ? "" : " Check Drive and Classroom Classwork for the file or draft before retrying.";
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new Error(`${step} failed: LockedScreen did not receive a response from ${api}. Check your network connection.${retryNote}`);
  }

  const payload = await response.json().catch(() => null);
  if (response.ok && payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }

  const error = payload?.error;
  const details = [
    error?.message,
    ...(Array.isArray(error?.errors) ? error.errors.map((entry: { reason?: unknown } | null) => entry?.reason) : []),
    ...(Array.isArray(error?.details) ? error.details.map((entry: { reason?: unknown } | null) => entry?.reason) : [])
  ].filter((value): value is string => typeof value === "string").join(" ");
  const knownReasons = [
    [/AttachmentNotVisible/i, "AttachmentNotVisible", "Make sure the signed-in teacher can open the Drive attachment and share it with the class."],
    [/CourseNotModifiable/i, "CourseNotModifiable", "Select an active class where the signed-in account is a teacher."],
    [/SERVICE_DISABLED|accessNotConfigured/i, "SERVICE_DISABLED", `Ask the OAuth project owner to enable the ${api} API.`],
    [/storageQuotaExceeded/i, "storageQuotaExceeded", "Free up space in the teacher's Google Drive or ask your school administrator about storage."]
  ] as const;
  const known = knownReasons.find(([pattern]) => pattern.test(details));
  const googleStatus = typeof error?.status === "string" && /^[A-Z][A-Z_]{2,39}$/.test(error.status) ? error.status : "";
  const code = [`HTTP ${response.status}`, googleStatus, known?.[1]].filter(Boolean).join(", ");
  const advice = known?.[2] ?? (
    response.ok ? "Google returned an unexpected response." :
    response.status === 401 ? "Reconnect Google Classroom with your school account." :
    response.status === 403 ? (drive
      ? "Reconnect with Google Drive file access and check that your school allows the app to write to Drive."
      : "Reconnect with Classroom assignment write access and check that the signed-in account teaches this class.") :
    response.status === 404 ? (drive
      ? "Check that the exam file still exists in Drive and belongs to the signed-in account."
      : "Check that the class or draft still exists and is accessible to the signed-in teacher.") :
    response.status === 400 ? (drive
      ? "Check that the exam package can be exported locally. If the error repeats, report this code."
      : "Check the assignment title, points, class status, and Drive attachment. If the error repeats, report this code.") :
    response.status === 429 || response.status >= 500 ? "Wait a moment and try again." :
    "Report this code if the error repeats."
  );
  throw new Error(`${step} failed (${api}: ${code}). ${advice}${retryNote}`);
};

export class GoogleClassroomService implements GoogleClassroomApi {
  constructor(private readonly oauth: GoogleOAuthFlow) {}

  async listCourses(connectionId: string, settings: GoogleIntegrationSettings): Promise<LmsCourse[]> {
    const accessToken = await this.oauth.getAccessToken(connectionId, settings);

    const loadPages = async (teacherOnly: boolean): Promise<Array<Record<string, unknown>>> => {
      const courses: Array<Record<string, unknown>> = [];
      let pageToken: string | undefined;

      do {
        const params = new URLSearchParams({
          pageSize: "100"
        });
        if (teacherOnly) {
          params.set("teacherId", "me");
        }
        ["ACTIVE", "PROVISIONED"].forEach((state) => params.append("courseStates", state));
        if (pageToken) {
          params.set("pageToken", pageToken);
        }

        const response = await fetch(`${googleClassroomDesktopOAuth.classroomApiBaseUrl}/courses?${params.toString()}`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const payload = await readClassroomJson<{ courses?: Array<Record<string, unknown>>; nextPageToken?: string }>(response);
        courses.push(...(payload.courses ?? []));
        pageToken = payload.nextPageToken;
      } while (pageToken);

      return courses;
    };

    let courses: Array<Record<string, unknown>>;
    try {
      courses = await loadPages(true);
    } catch (error) {
      if ((error as ClassroomRequestError).status !== 400) {
        throw error;
      }
      courses = await loadPages(false);
    }
    if (courses.length === 0) {
      courses = await loadPages(false);
    }

    const uniqueCourses = Array.from(new Map(courses.map((course) => [String(course.id ?? ""), course])).values()).filter(
      (course) => String(course.id ?? "").length > 0
    );

    return uniqueCourses.map((course) => ({
      id: String(course.id ?? ""),
      name: String(course.name ?? "Untitled course"),
      section: typeof course.section === "string" ? course.section : undefined,
      alternateLink: typeof course.alternateLink === "string" ? course.alternateLink : undefined
    }));
  }

  async listCourseWork(
    connectionId: string,
    settings: GoogleIntegrationSettings,
    courseId: string
  ): Promise<LmsCourseWork[]> {
    const normalizedCourseId = courseId.trim();
    if (!normalizedCourseId) {
      return [];
    }

    const accessToken = await this.oauth.getAccessToken(connectionId, settings);
    const response = await fetch(
      `${googleClassroomDesktopOAuth.classroomApiBaseUrl}/courses/${encodeURIComponent(normalizedCourseId)}/courseWork?pageSize=50`,
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );
    const payload = await readClassroomJson<{ courseWork?: Array<Record<string, unknown>> }>(response);
    return (payload.courseWork ?? []).map((item) => parseCourseWork(item, normalizedCourseId));
  }

  async listStudents(connectionId: string, settings: GoogleIntegrationSettings, courseId: string): Promise<LmsStudent[]> {
    const normalizedCourseId = courseId.trim();
    if (!normalizedCourseId) {
      return [];
    }

    const accessToken = await this.oauth.getAccessToken(connectionId, settings);
    const response = await fetch(
      `${googleClassroomDesktopOAuth.classroomApiBaseUrl}/courses/${encodeURIComponent(normalizedCourseId)}/students?pageSize=100`,
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );
    const payload = await readClassroomJson<{ students?: Array<Record<string, unknown>> }>(response);
    return (payload.students ?? []).map((student) => {
      const profile = student.profile as Record<string, unknown> | undefined;
      const name = profile?.name as Record<string, unknown> | undefined;
      return {
        id: String(profile?.id ?? student.userId ?? ""),
        name: String(name?.fullName ?? profile?.emailAddress ?? "Unnamed student"),
        email: typeof profile?.emailAddress === "string" ? profile.emailAddress : undefined
      };
    });
  }

  async publishPackageCourseWork(
    connectionId: string,
    settings: GoogleIntegrationSettings,
    request: {
      courseId: string;
      title: string;
      description: string;
      fileName: string;
      packageJson: PublishPackageJsonBuilder;
      maxPoints?: number;
    }
  ): Promise<GoogleClassroomPublishResult> {
    assertPublishScopesConfigured(settings);

    const normalizedCourseId = request.courseId.trim();
    if (!normalizedCourseId) {
      throw new Error("Select a Google Classroom class before posting the package.");
    }

    const accessToken = await this.oauth.getAccessToken(connectionId, settings).catch(() => {
      throw new Error("Classroom authorization failed before uploading the package. Reconnect Google Classroom with your school account.");
    });
    const boundary = `lockedscreen-${Date.now().toString(36)}`;
    const uploadBody = createPackageUploadBody(boundary, request.fileName, packageJsonForContext(request.packageJson, null));

    let driveFile = await publishRequest(
      "Drive upload",
      `${googleClassroomDesktopOAuth.driveUploadBaseUrl}/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink,mimeType`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`
        },
        body: uploadBody
      }
    );
    const driveFileId = String(driveFile.id ?? "");
    if (!driveFileId) {
      throw new Error("Drive upload did not return a file ID. Check Google Drive for the exam file before retrying.");
    }
    const courseWorkBody: Record<string, unknown> = {
      title: request.title,
      description: request.description,
      workType: "ASSIGNMENT",
      state: "DRAFT",
      materials: [
        {
          driveFile: {
            driveFile: {
              id: driveFileId
            },
            shareMode: "VIEW"
          }
        }
      ]
    };
    if (typeof request.maxPoints === "number" && request.maxPoints > 0) {
      courseWorkBody.maxPoints = request.maxPoints;
    }

    const createdCourseWork = await publishRequest(
      "Classroom draft creation",
      `${googleClassroomDesktopOAuth.classroomApiBaseUrl}/courses/${encodeURIComponent(normalizedCourseId)}/courseWork`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(courseWorkBody)
      }
    );
    const draftCourseWork = parseCourseWork(createdCourseWork, normalizedCourseId);
    if (!draftCourseWork.id) {
      throw new Error("Classroom draft creation did not return an assignment ID. Check Classroom Classwork for the draft before retrying.");
    }

    if (typeof request.packageJson === "function") {
      const updateBoundary = `lockedscreen-${Date.now().toString(36)}-final`;
      driveFile = await publishRequest(
        "Drive package update",
        `${googleClassroomDesktopOAuth.driveUploadBaseUrl}/files/${encodeURIComponent(driveFileId)}?uploadType=multipart&fields=id,name,webViewLink,webContentLink,mimeType`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": `multipart/related; boundary=${updateBoundary}`
          },
          body: createPackageUploadBody(
            updateBoundary,
            request.fileName,
            packageJsonForContext(request.packageJson, draftCourseWork)
          )
        }
      );
    }

    const publishedCourseWork = await publishRequest(
      "Classroom publication",
      `${googleClassroomDesktopOAuth.classroomApiBaseUrl}/courses/${encodeURIComponent(normalizedCourseId)}/courseWork/${encodeURIComponent(draftCourseWork.id)}?updateMask=state`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ state: "PUBLISHED" })
      }
    );
    if (String(publishedCourseWork.id ?? "") !== draftCourseWork.id || publishedCourseWork.state !== "PUBLISHED") {
      throw new Error("Classroom publication could not be confirmed. Check Classwork for the assignment before retrying.");
    }

    return {
      courseWork: parseCourseWork(publishedCourseWork, normalizedCourseId),
      driveFileId,
      driveFileName: typeof driveFile.name === "string" ? driveFile.name : request.fileName,
      driveFileLink: typeof driveFile.webViewLink === "string" ? driveFile.webViewLink : undefined,
      driveFileDownloadLink: driveDownloadLink(driveFileId, driveFile)
    };
  }
}
