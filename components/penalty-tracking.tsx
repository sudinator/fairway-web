"use client";
import React, { useEffect, useRef, useState } from 'react';
import { C, type Round } from '@/lib/golf';
import { completeScoringRound } from '@/lib/analytics-quality';
import { btn } from '@/components/ui';
import { createClient } from '@/lib/supabase';
const db=createClient();
export function PenaltyTracking({round,onUpdated}:{round:Round;onUpdated?:(round:Round)=>void}) {
 const currentId=useRef<string|null>(round.id), visit=useRef(0);
 useEffect(()=>{visit.current++;currentId.current=round.id;return()=>{visit.current++;currentId.current=null;};},[round.id,round.penalties_tracked]);
 const [confirmed,setConfirmed]=useState(round.penalties_tracked===true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{setBusy(false);setConfirmed(round.penalties_tracked===true);setError('');},[round.id,round.penalties_tracked]);
 const complete=completeScoringRound(round,18)||completeScoringRound(round,9);
 const change=async()=>{if(busy)return;setBusy(true);setError('');const next=!confirmed;const id=round.id,generation=visit.current;
  try {const {data,error}=await db.rpc('set_round_penalties_tracked',{p_round:round.id,p_tracked:next,p_expected:next?[...round.holes].sort((a,b)=>a.hole_number-b.hole_number).map(h=>[h.hole_number,h.strokes,h.penalties]):null});if(error||data!==next)throw new Error();if(currentId.current!==id || visit.current!==generation)return;setConfirmed(next);onUpdated?.({...round,penalties_tracked:next});}
  catch {if(currentId.current===id && visit.current===generation)setError('Could not save the confirmation. Your previous status is unchanged. Reload the round if the card changed, or make this device primary if scoring is active elsewhere, then retry.');}finally{if(currentId.current===id && visit.current===generation)setBusy(false);}
 };
 return <div data-penalty-tracking style={{background:C.greenLight,borderRadius:12,padding:16,marginTop:14}}><div style={{color:C.cream,fontSize:14,fontWeight:700}}>Penalty tracking · {confirmed?'Confirmed':'Not confirmed'}</div><div style={{color:C.sage,fontSize:12,lineHeight:1.5,marginTop:6}}>{confirmed?'This round can contribute to penalty averages, including a confirmed zero. Editing a score or penalty requires a fresh confirmation.':'Review penalties on every hole, including holes with zero penalties. Until confirmed, this round is excluded from penalty averages.'}</div>{complete&&<button type="button" style={{...btn(false),fontSize:13,marginTop:10}} disabled={busy} onClick={()=>void change()}>{busy?'Saving…':confirmed?'Remove confirmation':'I recorded penalties on every hole'}</button>}{!complete&&<div style={{color:C.sage,fontSize:12,marginTop:8}}>Complete the hole-by-hole card before confirming.</div>}{error&&<div role="alert" style={{color:C.cream,fontSize:12,lineHeight:1.5,marginTop:8}}>{error}<button type="button" style={{...btn(false),fontSize:12,marginTop:8}} onClick={()=>void change()}>Retry</button></div>}</div>;
}
