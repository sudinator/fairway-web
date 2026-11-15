"use client";
import React, { useMemo, useState } from 'react';
import { C, type Round } from '@/lib/golf';
import { analyticsNameKey } from '@/lib/analytics-quality';
import { BottomSheet, btn, FieldLabel, inputStyle } from '@/components/ui';

/**
 * The Summary's course / tee filter (212.109, owner, Nov 14): dropdowns — a list of every course does not scale past a
 * few ("I dont like listing all the 15 courses i might have played") — in the app's own field style (inputStyle and
 * FieldLabel, as every other select in the app), each course with its round count; the tee list depends on the course.
 *  - RESET applies "no filter" at once and closes. APPLY commits the draft and is live only when something changed.
 *  - The X (and the scrim) dismiss without applying. Draft edits never apply on their own.
 */
export function AnalyticsFilterSheet({ rounds, course, tee, onApply, onClose }: { rounds: Round[]; course: string; tee: string; onApply: (course: string, tee: string) => void; onClose: () => void }) {
  const [draftCourse, setCourse] = useState(course), [draftTee, setTee] = useState(tee);
  const courses = useMemo(() => [...new Map(rounds.filter(r => r.course).map(r => [analyticsNameKey(r.course), r.course])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rounds]);
  const tees = useMemo(() => draftCourse ? [...new Map(rounds.filter(r => analyticsNameKey(r.course) === draftCourse && r.tee_name).map(r => [analyticsNameKey(r.tee_name), r.tee_name!])).entries()].sort((a, b) => a[1].localeCompare(b[1])) : [], [rounds, draftCourse]);
  const validTee = draftCourse && tees.some(([key]) => key === draftTee) ? draftTee : '';
  const roundsAt = (key: string) => rounds.filter(r => analyticsNameKey(r.course) === key).length;
  const dirty = draftCourse !== course || validTee !== tee;
  const canReset = !!course || !!tee || !!draftCourse;
  return <BottomSheet dismissOnBackdrop={false} onClose={onClose} maxWidth={440}
    header={<div style={{ padding: 16, marginRight: 32, color: C.cream, fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 700 }}>Filter summary</div>}>
    <div role="dialog" aria-modal="true" aria-label="Filter summary" data-summary-filter>
      <FieldLabel>Course</FieldLabel>
      <select aria-label="Analytics course" data-summary-filter-course value={draftCourse} onChange={e => { setCourse(e.target.value); setTee(''); }} style={inputStyle}>
        <option value="">All courses · {rounds.length} round{rounds.length === 1 ? '' : 's'}</option>
        {courses.map(([key, name]) => <option key={key} value={key}>{name} · {roundsAt(key)} round{roundsAt(key) === 1 ? '' : 's'}</option>)}
      </select>
      {draftCourse ? (
        <div style={{ marginTop: 16 }} data-summary-filter-tees>
          <FieldLabel>Tee</FieldLabel>
          {tees.length ? (
            <select aria-label="Analytics tee" data-summary-filter-tee value={validTee} onChange={e => setTee(e.target.value)} style={inputStyle}>
              <option value="">All tees at this course</option>
              {tees.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
            </select>
          ) : <div style={{ color: C.sage, fontSize: 12 }}>No tee names were recorded at this course — the course filter still applies.</div>}
        </div>
      ) : <div style={{ color: C.sage, fontSize: 13, lineHeight: 1.5, marginTop: 12 }}>Choose a course to filter by its tees.</div>}
      <div style={{ color: C.sage, fontSize: 12, lineHeight: 1.5, marginTop: 16 }}>Uses the course and tee recorded on your rounds. Your time range stays as it is.</div>
      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button type="button" data-summary-filter-reset onClick={() => onApply('', '')} disabled={!canReset} style={{ ...btn(false), flex: 1, opacity: canReset ? 1 : 0.5 }}>Reset</button>
        <button type="button" data-summary-filter-apply onClick={() => onApply(draftCourse, validTee)} disabled={!dirty} style={{ ...btn(true), flex: 1, opacity: dirty ? 1 : 0.6 }}>Apply</button>
      </div>
    </div>
  </BottomSheet>;
}
