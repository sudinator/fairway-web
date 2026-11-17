"use client";
/**
 * The app's own yes/no question (212.122, owner, Nov 17: "how the app looks and presents is super high on the priority
 * list"). Replaces the browser's confirm(), which on a phone shows a grey system box headed with the web address
 * ("birdienumnum.vercel.app says…"). askConfirm(...) returns a Promise<boolean>; one <ConfirmHost/> (mounted beside
 * the Toaster in Home) renders it as the standard BottomSheet. If no host is mounted (a route outside Home), it falls
 * back to the native dialog so a question is never silently skipped. Messages for errors go to the toast
 * (notifyError / notifyInfo), never to alert(). ci/check_native_dialogs.py keeps new native dialogs out.
 */
import React, { useEffect, useState } from "react";
import { C } from "@/lib/golf";
import { BottomSheet, btn, inputStyle } from "@/components/ui";

export type ConfirmOptions = { title: string; message?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };
let host: ((p: Pending) => void) | null = null;

const DANGER = /^(delete|remove|discard|wipe|end|clear|void|reset|revoke|suspend|cancel|unmark|merge|archive|leave|kick|reject|deny|replace|overwrite|close)\b/i;
/** A plain-string question (most legacy call sites) becomes title + detail: "Remove Sam from the game? Their scores
 *  stay." → title "Remove Sam from the game?", message "Their scores stay."; the confirm button takes the leading verb
 *  ("Remove") and is marked destructive when the verb is one. */
export function questionFrom(text: string): ConfirmOptions {
  const t = text.trim();
  const [head, ...rest] = t.split(/\n\s*\n/);
  let title = head, message = rest.join("\n\n").trim();
  const m = head.match(/^([\s\S]{12,140}?[?.!])\s+([\s\S]+)$/);   // the first sentence is the question
  if (m) { title = m[1]; message = [m[2], message].filter(Boolean).join("\n\n"); }
  const verb = title.match(DANGER)?.[1];
  return { title, message: message || undefined, ...(verb ? { confirmLabel: verb[0].toUpperCase() + verb.slice(1).toLowerCase(), danger: true } : {}) };
}

export function askConfirm(opts: ConfirmOptions | string): Promise<boolean> {
  const o: ConfirmOptions = typeof opts === "string" ? questionFrom(opts) : opts;
  if (!host) return Promise.resolve(typeof window !== "undefined" ? window.confirm(o.message ? `${o.title}\n\n${o.message}` : o.title) : false);
  return new Promise((resolve) => host!({ ...o, resolve }));
}

export type TextOptions = { title: string; message?: string; initial?: string; placeholder?: string; confirmLabel?: string; danger?: boolean };
type PendingText = TextOptions & { resolve: (v: string | null) => void };
let textHost: ((p: PendingText) => void) | null = null;

/** The app's own replacement for prompt(): resolves the typed text, or null on Cancel (as prompt() does). */
export function askText(title: string, initialOrOpts?: string | Omit<TextOptions, "title">): Promise<string | null> {
  const extra = typeof initialOrOpts === "string" ? { initial: initialOrOpts } : (initialOrOpts ?? {});
  const q = questionFrom(title);
  const o: TextOptions = { title: q.title, message: q.message, ...extra };
  if (!textHost) return Promise.resolve(typeof window !== "undefined" ? window.prompt(o.message ? `${o.title}\n\n${o.message}` : o.title, o.initial ?? "") : null);
  return new Promise((resolve) => textHost!({ ...o, resolve }));
}

export function ConfirmHost() {
  const [text, setText] = useState<PendingText | null>(null);
  useEffect(() => {
    textHost = (p) => setText((cur) => { cur?.resolve(null); return p; });
    return () => { textHost = null; };
  }, []);
  return <>
    <ConfirmQuestionHost />
    {text ? <TextSheet ask={text} onDone={(v) => { text.resolve(v); setText(null); }} /> : null}
  </>;
}

/** The typed-input sheet (also rendered by the design gallery). */
export function TextSheet({ ask, onDone }: { ask: TextOptions; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(ask.initial ?? "");
  return (
    <BottomSheet dismissOnBackdrop={false} onClose={() => onDone(null)} maxWidth={440}
      header={<div style={{ padding: 16, marginRight: 32, color: C.cream, fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 700 }}>{ask.title}</div>}>
      <div data-text-sheet>
        {ask.message ? <div style={{ color: C.cream, fontSize: 14, lineHeight: 1.5, marginBottom: 12, whiteSpace: "pre-line" }}>{ask.message}</div> : null}
        <input autoFocus data-text-input value={v} placeholder={ask.placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onDone(v); }} style={inputStyle} />
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button type="button" data-text-cancel onClick={() => onDone(null)} style={{ ...btn(false), flex: 1 }}>Cancel</button>
          {ask.danger
            ? <button type="button" data-text-ok onClick={() => onDone(v)} style={{ ...btn(false), flex: 1, color: C.overRedDark }}>{ask.confirmLabel ?? "OK"}</button>
            : <button type="button" data-text-ok onClick={() => onDone(v)} style={{ ...btn(true), flex: 1 }}>{ask.confirmLabel ?? "OK"}</button>}
        </div>
      </div>
    </BottomSheet>
  );
}

function ConfirmQuestionHost() {
  const [ask, setAsk] = useState<Pending | null>(null);
  useEffect(() => {
    host = (p) => setAsk((cur) => { cur?.resolve(false); return p; });   // a new question cancels an unanswered one
    return () => { host = null; };
  }, []);
  if (!ask) return null;
  return <ConfirmSheet ask={ask} onDone={(ok) => { ask.resolve(ok); setAsk(null); }} />;
}

/** The sheet itself (also rendered by the design gallery). */
export function ConfirmSheet({ ask, onDone }: { ask: ConfirmOptions; onDone: (ok: boolean) => void }) {
  const done = onDone;
  return (
    <BottomSheet dismissOnBackdrop={false} onClose={() => done(false)} maxWidth={440}
      header={<div style={{ padding: 16, marginRight: 32, color: C.cream, fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 700 }}>{ask.title}</div>}>
      <div data-confirm-sheet>
        {ask.message ? <div style={{ color: C.cream, fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-line" }}>{ask.message}</div> : null}
        <div style={{ display: "flex", gap: 10, marginTop: ask.message ? 20 : 4 }}>
          <button type="button" data-confirm-cancel onClick={() => done(false)} style={{ ...btn(false), flex: 1 }}>{ask.cancelLabel ?? "Cancel"}</button>
          {ask.danger
            ? <button type="button" data-confirm-ok onClick={() => done(true)} style={{ ...btn(false), flex: 1, color: C.overRedDark }}>{ask.confirmLabel ?? "OK"}</button>
            : <button type="button" data-confirm-ok onClick={() => done(true)} style={{ ...btn(true), flex: 1 }}>{ask.confirmLabel ?? "OK"}</button>}
        </div>
      </div>
    </BottomSheet>
  );
}
