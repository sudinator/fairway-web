"use client";
import React, { useMemo, useState } from 'react';
import { C, type Round } from '@/lib/golf';
import { analyticsNameKey } from '@/lib/analytics-quality';
import { BottomSheet, btn, inputStyle } from '@/components/ui';
/** Draft edits are committed together by Apply. Closing/cancelling discards the draft. */
export function AnalyticsFilterSheet({ rounds, course, tee, onApply, onClose }: { rounds: Round[]; course: string; tee: string; onApply: (course: string, tee: string) => void; onClose: () => void }) {
  const [draftCourse, setCourse] = useState(course), [draftTee, setTee] = useState(tee);
  const courses = useMemo(() => [...new Map(rounds.filter(r => r.course).map(r => [analyticsNameKey(r.course), r.course])).entries()].sort((a,b)=>a[1].localeCompare(b[1])), [rounds]);
  const tees = useMemo(() => draftCourse ? [...new Map(rounds.filter(r => analyticsNameKey(r.course) === draftCourse && r.tee_name).map(r => [analyticsNameKey(r.tee_name), r.tee_name!])).entries()].sort((a,b)=>a[1].localeCompare(b[1])) : [], [rounds,draftCourse]);
  const validTee = draftCourse && tees.some(([key]) => key === draftTee) ? draftTee : '';
  return <BottomSheet dismissOnBackdrop={false} onClose={onClose} maxWidth={440} header={<div style={{ padding:16, marginRight:32, color:C.cream, fontFamily:'Georgia, serif', fontSize:22, fontWeight:700 }}>Filter summary</div>}>
    <div role="dialog" aria-modal="true" aria-label="Filter summary">
      <label style={{ display:'block', color:C.cream, fontSize:13, fontWeight:700 }}>Course
        <select aria-label="Analytics course" value={draftCourse} onChange={e=>{setCourse(e.target.value);setTee('');}} style={{...inputStyle, marginTop:8, width:'100%'}}><option value="">All courses</option>{courses.map(([key,name])=><option key={key} value={key}>{name}</option>)}</select>
      </label>
      {draftCourse ? <label style={{display:'block',color:C.cream,fontSize:13,fontWeight:700,marginTop:18}}>Tee
        <select aria-label="Analytics tee" value={validTee} onChange={e=>setTee(e.target.value)} style={{...inputStyle,marginTop:8,width:'100%'}}><option value="">All tees at this course</option>{tees.map(([key,name])=><option key={key} value={key}>{name}</option>)}</select>
      </label> : <div style={{color:C.sage,fontSize:13,lineHeight:1.5,marginTop:14}}>Choose a course to see its tees.</div>}
      {draftCourse && !tees.length && <div style={{color:C.sage,fontSize:12,marginTop:8}}>No tee names were recorded for this course. Course filtering still works.</div>}
      <div style={{color:C.sage,fontSize:12,lineHeight:1.5,marginTop:16}}>Uses the course and tee recorded on your rounds. Your selected time range stays in place.</div>
      <button type="button" onClick={()=>{setCourse('');setTee('');}} style={{...btn(false),marginTop:16,fontSize:13}}>Clear filters</button>
      <div style={{display:'flex',gap:10,marginTop:20}}><button type="button" onClick={onClose} style={{...btn(false),flex:1}}>Cancel</button><button type="button" onClick={()=>onApply(draftCourse,validTee)} style={{...btn(true),flex:1}}>Apply filters</button></div>
    </div>
  </BottomSheet>;
}
