"use client";
import React from "react";
import { C } from "@/lib/golf";
import { SCORE_CORRECTION_EVENT, scoreCorrectionHref, type ScoreCorrectionTarget } from "@/lib/score-correction-links";
export function ScoreCorrectionLink({ target, children }: { target: ScoreCorrectionTarget; children: React.ReactNode }) {
  return <a href={scoreCorrectionHref(target)} style={{ color: C.cream, textDecoration: "underline", textDecorationColor: C.gold, textUnderlineOffset: 3, overflowWrap: "anywhere" }} onClick={event => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const request = new window.CustomEvent(SCORE_CORRECTION_EVENT, { detail: target, cancelable: true });
    if (!window.dispatchEvent(request)) event.preventDefault();
  }}>{children}</a>;
}
