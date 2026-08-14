import { isSafeCourseProviderId, normalizeCourseProviderId } from "./course-provider-id";

function ok(name: string, cond: boolean) {
  if (!cond) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

// Golden real-world GolfCourseAPI ids verified against Production on 2026-08-13.
const currentIds = [
  "vqbyfsjx", "1wewazqg", "p69gkgne", "vvg9vsa7", "fjk8jxy3", "5wng1nrq",
  "6ep6g28a", "vm2kn2bz", "zr1d76hs", "x8xdjb3z", "svcsvbhv", "tdcw9a0j",
  "dm2xnm4k", "npjk17jn", "sh98rvpq", "j8wp0c0t", "sq8txgf0", "chepnead",
];

for (const id of currentIds) {
  ok(`current provider id accepted: ${id}`, normalizeCourseProviderId(id) === id);
}

// Legacy GolfCourseAPI ids remain syntactically valid opaque ids.
ok("legacy numeric provider id accepted", normalizeCourseProviderId(23554) === "23554");
ok("trimmed provider id normalized", normalizeCourseProviderId(" 5wng1nrq ") === "5wng1nrq");

for (const bad of ["", " ", "../../etc", "abc/def", "abc?x=1", "abc#frag", "abc def", "abc%2Fdef", "a".repeat(65)]) {
  ok(`unsafe provider id rejected: ${JSON.stringify(bad)}`, normalizeCourseProviderId(bad) === null);
}

ok("safe helper matches normalized fixtures", currentIds.every(isSafeCourseProviderId));
