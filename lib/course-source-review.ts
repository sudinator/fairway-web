export type CourseSourceMode = "stored" | "provider";

type RatingTee = { rating?: number | null };
type CourseWithTees = { tees: RatingTee[] };

export type CourseSourceView<T extends CourseWithTees> = {
  mode: CourseSourceMode;
  course: T;
  ratingTexts: Record<number, string>;
};

function cloneCourse<T>(course: T): T {
  return JSON.parse(JSON.stringify(course)) as T;
}

export function buildCourseRatingTexts(course: CourseWithTees): Record<number, string> {
  const out: Record<number, string> = {};
  course.tees.forEach((tee, index) => {
    out[index] = tee.rating != null && !Number.isNaN(tee.rating) ? String(tee.rating) : "";
  });
  return out;
}

export function buildCourseSourceView<T extends CourseWithTees>(mode: CourseSourceMode, course: T): CourseSourceView<T> {
  const cloned = cloneCourse(course);
  return {
    mode,
    course: cloned,
    ratingTexts: buildCourseRatingTexts(cloned),
  };
}
