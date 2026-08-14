import { buildCourseSourceView } from "./course-source-review";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const stored = {
  id: "bnn-francis",
  externalId: "5wng1nrq",
  club: "Francis Byrne Golf Course",
  name: "Francis Byrne Golf Course",
  location: "West Orange, NJ, United States",
  tees: [
    { name: "Blue", rating: 68.1, slope: 121, par: 70 },
    { name: "White", rating: 66.9, slope: 118, par: 70 },
  ],
  holes: [{ n: 1, par: 4, si: 7 }],
};

const provider = {
  ...stored,
  tees: [
    { name: "Blue", rating: 69.4, slope: 124, par: 70 },
    { name: "White", rating: 67.8, slope: 120, par: 70 },
  ],
};

const providerView = buildCourseSourceView("provider", provider);
assert(providerView.mode === "provider", "provider mode should be explicit");
assert(providerView.course.tees[0].rating === 69.4, "provider course values should become active");
assert(providerView.ratingTexts[0] === "69.4", "provider rating text should synchronize with provider course");
assert(providerView.ratingTexts[1] === "67.8", "all provider rating text should synchronize");

providerView.course.tees[0].rating = 1;
assert(provider.tees[0].rating === 69.4, "source transition must clone provider data rather than mutate source snapshot");

const storedView = buildCourseSourceView("stored", stored);
assert(storedView.mode === "stored", "stored mode should be explicit");
assert(storedView.course.tees[0].rating === 68.1, "return transition should restore stored values");
assert(storedView.ratingTexts[0] === "68.1", "return transition should restore stored rating text");

console.log("course source review transition: PASS");
