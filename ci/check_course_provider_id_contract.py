from pathlib import Path

root = Path(__file__).resolve().parents[1]
route = (root / "app/api/courses/route.ts").read_text(encoding="utf-8")
manage = (root / "components/manage/courses.tsx").read_text(encoding="utf-8")
round_setup = (root / "components/round-setup.tsx").read_text(encoding="utf-8")
yardage = (root / "components/yardage-backfill.tsx").read_text(encoding="utf-8")
helper_test = (root / "lib/course-provider-id.test.ts").read_text(encoding="utf-8")

checks = {
    "detail endpoint validates opaque provider id": "normalizeCourseProviderId(id)" in route,
    "search endpoint normalizes returned provider id": "normalizeCourseProviderId(c.id)" in route,
    "detail endpoint URL-encodes provider id": "courses/${encodeURIComponent(providerId)}" in route,
    "numeric-only course id validation removed": r"/^\\d{1,12}$/" not in route and r"/^\\d+$/" not in manage,
    "manage course search ids are strings": "useState<{ id: string; name: string; location: string }[] | null>" in manage,
    "round setup search ids are strings": "useState<{ id: string; club?: string; name: string; location: string }[] | null>" in round_setup,
    "yardage lookup ids are strings": "useState<{ id: string; club: string; name: string; location: string }[] | null>" in yardage,
    "facility refresh validates provider id through shared helper": "const providerId = normalizeCourseProviderId(ext);" in manage,
    "new course writes canonical external_id": "external_id: normalizeCourseProviderId(course.externalId)" in manage,
    "Francis Byrne golden id is permanent regression fixture": '"5wng1nrq"' in helper_test,
}

bad = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(("PASS" if ok else "FAIL") + ": " + name)
if bad:
    raise SystemExit("Course provider id contract failed: " + "; ".join(bad))
