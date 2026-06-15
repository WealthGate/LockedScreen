import type { Exam, ExamConfigPackage, LmsCourseWork, StudentLmsBinding } from "@lockedscreen/shared-types";

const normalizeTitle = (value?: string): string =>
  value?.trim().replace(/\s+/g, " ").toLocaleLowerCase() ?? "";

export const selectMatchingCourseWork = (
  courseWork: LmsCourseWork[],
  expectedTitles: Array<string | undefined>
): LmsCourseWork | null => {
  const titles = new Set(expectedTitles.map(normalizeTitle).filter(Boolean));
  if (titles.size === 0) {
    return null;
  }

  const matches = courseWork.filter((item) => titles.has(normalizeTitle(item.title)));
  return matches.length === 1 ? matches[0] ?? null : null;
};

export const recoverGoogleAssignmentBinding = async (
  configPackage: ExamConfigPackage,
  exam: Exam,
  accessToken: string
): Promise<StudentLmsBinding> => {
  const binding = configPackage.studentLmsBinding;
  if (binding.assignmentId.trim()) {
    return binding;
  }

  const courseId = binding.courseId.trim();
  if (!courseId) {
    throw new Error("This package is missing the LMS class reference.");
  }

  const courseWork: LmsCourseWork[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      courseWorkStates: "PUBLISHED",
      pageSize: "100"
    });
    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const response = await fetch(
      `https://classroom.googleapis.com/v1/courses/${encodeURIComponent(courseId)}/courseWork?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );
    const payload = (await response.json().catch(() => ({}))) as {
      courseWork?: Array<Record<string, unknown>>;
      nextPageToken?: unknown;
      error?: { message?: unknown };
    };
    if (!response.ok) {
      const detail = typeof payload.error?.message === "string" ? ` Google said: ${payload.error.message}` : "";
      throw new Error(`Lockedscreen could not look up the Classroom assignment for this older package.${detail}`);
    }

    courseWork.push(
      ...(payload.courseWork ?? [])
        .filter((item) => typeof item.id === "string" && typeof item.title === "string")
        .map((item) => ({
          id: String(item.id),
          courseId,
          title: String(item.title),
          alternateLink: typeof item.alternateLink === "string" ? item.alternateLink : undefined,
          state: typeof item.state === "string" ? item.state : undefined
        }))
    );
    pageToken = typeof payload.nextPageToken === "string" ? payload.nextPageToken : "";
  } while (pageToken);

  const match = selectMatchingCourseWork(courseWork, [
    binding.assignmentLabel,
    exam.title,
    configPackage.label
  ]);
  if (!match) {
    throw new Error(
      "This older package does not contain an assignment reference, and Lockedscreen could not identify one unique Classroom assignment with the same title. Ask the teacher to post or export the package again."
    );
  }

  return {
    ...binding,
    assignmentId: match.id,
    assignmentLabel: match.title
  };
};
