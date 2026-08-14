from pathlib import Path
src = Path('components/manage/courses.tsx').read_text()
required = [
    'type CourseProviderSource =',
    'const canonicalId = await findExistingCourseId(supabase',
    '.from("favorite_courses")',
    'setProviderSource({ provider, stored, existingId: canonicalId })',
    'setCourse(stored)',
    'ALREADY IN BNN',
    'stored BNN course data',
    'latest provider data was fetched separately',
    'Load provider data for review',
    'NEW COURSE FROM GOLFCOURSEAPI',
    'saveFormDraft(courseDraftKey, { course, providerSource })',
    'applyCourseDraft(courseDraft.data, courseDraft.providerSource)',
]
missing = [x for x in required if x not in src]
if missing:
    raise SystemExit('course source transparency contract failed: ' + ', '.join(missing))
start = src.index('const pick = async')
end = src.index('const startManual', start)
pick = src[start:end]
if 'setCourse(stored)' not in pick or 'setCourse(provider); setMode("form")' not in pick:
    raise SystemExit('course source transparency contract failed: source selection branches missing')
if pick.index('setCourse(stored)') > pick.index('setCourse(provider); setMode("form")'):
    raise SystemExit('course source transparency contract failed: stored canonical branch must precede provider fallback')
print('course source transparency contract: PASS')
