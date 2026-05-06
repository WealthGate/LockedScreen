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
      packageJson: string;
      maxPoints?: number;
    }
  ): Promise<GoogleClassroomPublishResult>;
}

const classroomApiError = (status: number, payload: unknown): Error => {
  const record = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  const errorRecord = typeof record.error === "object" && record.error !== null ? (record.error as Record<string, unknown>) : {};
  const message = typeof errorRecord.message === "string" ? errorRecord.message : "";
  const statusText = typeof errorRecord.status === "string" ? errorRecord.status : "";
  const detail = `${statusText} ${message}`.toLowerCase();

  if (status === 401 || detail.includes("invalid authentication") || detail.includes("invalid credentials")) {
    return new Error("Google Classroom needs you to sign in again. Reconnect Google Classroom and try loading classes once more.");
  }

  if (status === 400 && (detail.includes("client_secret") || detail.includes("invalid_grant"))) {
    return new Error(
      "Google Classroom needs the Desktop app client secret. Ask an admin to enter the client secret from the Google OAuth JSON, save settings, and reconnect Google Classroom."
    );
  }

  if (
    status === 403 &&
    (detail.includes("insufficient") || detail.includes("scope") || detail.includes("permission"))
  ) {
    return new Error(
      "Lockedscreen does not have the needed Google Classroom permission. Ask an admin to confirm the Classroom and Drive permissions, then reconnect Google Classroom."
    );
  }

  if (status === 403) {
    return new Error(
      "Google Classroom did not allow this request. Ask your school Google administrator to allow the Lockedscreen Classroom app, then reconnect."
    );
  }

  return new Error("Google Classroom could not load classes right now. Check your connection and try again.");
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

export class GoogleClassroomService implements GoogleClassroomApi {
  constructor(private readonly oauth: GoogleOAuthFlow) {}

  async listCourses(connectionId: string, settings: GoogleIntegrationSettings): Promise<LmsCourse[]> {
    const accessToken = await this.oauth.getAccessToken(connectionId, settings);
    const courses: Array<Record<string, unknown>> = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        teacherId: "me",
        pageSize: "100"
      });
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

    return courses.map((course) => ({
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
      packageJson: string;
      maxPoints?: number;
    }
  ): Promise<GoogleClassroomPublishResult> {
    const normalizedCourseId = request.courseId.trim();
    if (!normalizedCourseId) {
      throw new Error("Select a Google Classroom class before posting the package.");
    }

    const accessToken = await this.oauth.getAccessToken(connectionId, settings);
    const boundary = `lockedscreen-${Date.now().toString(36)}`;
    const metadata = {
      name: request.fileName,
      mimeType: "application/json"
    };
    const uploadBody = [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify(metadata),
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      request.packageJson,
      `--${boundary}--`,
      ""
    ].join("\r\n");

    const uploadResponse = await fetch(
      `${googleClassroomDesktopOAuth.driveUploadBaseUrl}/files?uploadType=multipart&fields=id,name,webViewLink`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`
        },
        body: uploadBody
      }
    );
    const driveFile = await readClassroomJson<Record<string, unknown>>(uploadResponse);
    const driveFileId = String(driveFile.id ?? "");
    if (!driveFileId) {
      throw new Error("Google Drive did not return a file id for the exported package.");
    }

    const courseWorkBody: Record<string, unknown> = {
      title: request.title,
      description: request.description,
      workType: "ASSIGNMENT",
      state: "PUBLISHED",
      materials: [
        {
          driveFile: {
            driveFile: {
              id: driveFileId,
              title: request.fileName
            },
            shareMode: "VIEW"
          }
        }
      ]
    };
    if (typeof request.maxPoints === "number" && request.maxPoints > 0) {
      courseWorkBody.maxPoints = request.maxPoints;
    }

    const courseWorkResponse = await fetch(
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
    const courseWork = await readClassroomJson<Record<string, unknown>>(courseWorkResponse);

    return {
      courseWork: parseCourseWork(courseWork, normalizedCourseId),
      driveFileId,
      driveFileName: typeof driveFile.name === "string" ? driveFile.name : request.fileName,
      driveFileLink: typeof driveFile.webViewLink === "string" ? driveFile.webViewLink : undefined
    };
  }
}
