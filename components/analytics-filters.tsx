"use client";
import React, { useMemo, useState } from 'react';
import { C, type Round } from '@/lib/golf';
import { analyticsNameKey } from '@/lib/analytics-quality';
import { BottomSheet, btn, Eyebrow } from '@/components/ui';

/**
 * The Summary's course / tee filter (212.109, owner, Nov 14: "make it conform to the display rules … a clear way to
 * reset the filters and dismiss the popup").
 *  - Courses are the app's own option rows (not the OS's dropdown): one tap selects, the chosen one is gold-outlined.
 *  - Tees are pills under the chosen course (greyed when the course has none recorded).
 *  - RESET applies at once — no filter, sheet closed. APPLY commits the draft. The X (and the scrim) dismiss without
 *    changing anything. Draft edits never apply on their own.
 */
export function AnalyticsFilterSheet({ rounds, course, tee, onApply, onClose }: { rounds: Round[]; course: string; tee: string; onApply: (course: string, tee: string) => void; onClose: () => void }) {
  const [draftCourse, setCourse] = useState(course), [draftTee, setTee] = useState(tee);
  const courses = useMemo(() => [...new Map(rounds.filter(r => r.course).map(r => [analyticsNameKey(r.course), r.course])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rounds]);
  const tees = useMemo(() => draftCourse ? [...new Map(rounds.filter(r => analyticsNameKey(r.course) === draftCourse && r.tee_name).map(r => [analyticsNameKey(r.tee_name), r.tee_name!])).entries()].sort((a, b) => a[1].localeCompare(b[1])) : [], [rounds, draftCourse]);
  const validTee = draftCourse && tees.some(([key]) => key === draftTee) ? draftTee : '';
  const roundsAt = (key: string) => rounds.filter(r => analyticsNameKey(r.course) === key).length;
  const row = (on: boolean): React.CSSProperties => ({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, width: '100%', textAlign: 'left',
    background: C.greenMid, color: C.cream, border: on ? `2px solid ${C.gold}` : `1px solid ${C.borderGreen}`, borderRadius: 10, padding: '13px 16px', fontSize: 14, fontWeight: on ? 800 : 500, cursor: 'pointer', font: 'inherit' });
  const pill = (on: boolean): React.CSSProperties => ({ background: on ? C.gold : 'none', color: on ? C.green : C.cream, border: `1px solid ${on ? C.gold : C.borderGreen}`, borderRadius: 999, padding: '8px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer', font: 'inherit' });
  const dirty = draftCourse !== course || validTee !== tee;
  return <BottomSheet dismissOnBackdrop={false} onClose={onClose} maxWidth={440}
    header={<div style={{ padding: 16, marginRight: 32, color: C.cream, fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 700 }}>Filter summary</div>}>
    <div role="dialog" aria-modal="true" aria-label="Filter summary" data-summary-filter>
      <Eyebrow style={{ marginTop: 0 }}>COURSE</Eyebrow>
      <div style={{ display: 'grid', gap: 8, marginTop: 8 }} data-summary-filter-courses>
        <button type="button" aria-pressed={!draftCourse} onClick={() => { setCourse(''); setTee(''); }} style={row(!draftCourse)}>
          <span>All courses</span><span style={{ color: C.sage, fontSize: 12 }}>{rounds.length} round{rounds.length === 1 ? '' : 's'}</span>
        </button>
        {courses.map(([key, name]) => (
          <button key={key} type="button" aria-pressed={draftCourse === key} onClick={() => { setCourse(key); setTee(''); }} style={row(draftCourse === key)}>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span><span style={{ color: C.sage, fontSize: 12, flexShrink: 0 }}>{roundsAt(key)} round{roundsAt(key) === 1 ? '' : 's'}</span>
          </button>
        ))}
      </div>
      {draftCourse ? (
        <div style={{ marginTop: 18 }} data-summary-filter-tees>
          <Eyebrow style={{ marginTop: 0 }}>TEE</Eyebrow>
          {tees.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              <button type="button" aria-pressed={!validTee} onClick={() => setTee('')} style={pill(!validTee)}>All tees</button>
              {tees.map(([key, name]) => <button key={key} type="button" aria-pressed={validTee === key} onClick={() => setTee(key)} style={pill(validTee === key)}>{name}</button>)}
            </div>
          ) : <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>No tee names were recorded at this course — the course filter still applies.</div>}
        </div>
      ) : null}
      <div style={{ color: C.sage, fontSize: 12, lineHeight: 1.5, marginTop: 16 }}>Uses the course and tee recorded on your rounds. Your time range stays as it is.</div>
      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button type="button" data-summary-filter-reset onClick={() => onApply('', '')} disabled={!course && !tee && !draftCourse} style={{ ...btn(false), flex: 1, opacity: (!course && !tee && !draftCourse) ? 0.5 : 1 }}>Reset</button>
        <button type="button" data-summary-filter-apply onClick={() => onApply(draftCourse, validTee)} disabled={!dirty} style={{ ...btn(true), flex: 1, opacity: dirty ? 1 : 0.6 }}>Apply</button>
      </div>
    </div>
  </BottomSheet>;
}
