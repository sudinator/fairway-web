from pathlib import Path
src = Path('components/manage/courses.tsx').read_text()
required = [
    'type CourseProviderSource =',
    'selectedSource?: CourseSourceMode',
    'const canonicalId = await findExistingCourseId(supabase',
    '.from("favorite_courses")',
    'setProviderSource({ provider, stored, existingId: canonicalId, selectedSource: "stored" })',
    'setCourse(stored)',
    'ALREADY IN BNN',
    'stored BNN course data',
    'latest provider data was fetched separately',
    'REVIEWING GOLFCOURSEAPI DATA',
    'Load provider data for review',
    'Return to stored BNN data',
    'buildCourseSourceView(mode, sourceCourse)',
    'setRatingTexts(next.ratingTexts)',
    'setYardTee(null)',
    'selectedSource: mode',
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
form_start = src.index('export function CourseForm')
form = src[form_start:]
if 'switchCourseSource("provider", providerSource.provider)' not in form:
    raise SystemExit('course source transparency contract failed: provider review action is not wired through synchronized state transition')
if 'switchCourseSource("stored", providerSource.stored!)' not in form:
    raise SystemExit('course source transparency contract failed: stored-data return action is missing')
print('course source transparency contract: PASS')
