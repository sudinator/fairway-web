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
import { BottomSheet, btn } from "@/components/ui";

export type ConfirmOptions = { title: string; message?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };
let host: ((p: Pending) => void) | null = null;

export function askConfirm(opts: ConfirmOptions | string): Promise<boolean> {
  const o: ConfirmOptions = typeof opts === "string" ? { title: opts } : opts;
  if (!host) return Promise.resolve(typeof window !== "undefined" ? window.confirm(o.message ? `${o.title}\n\n${o.message}` : o.title) : false);
  return new Promise((resolve) => host!({ ...o, resolve }));
}

export function ConfirmHost() {
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
        {ask.message ? <div style={{ color: C.cream, fontSize: 14, lineHeight: 1.5 }}>{ask.message}</div> : null}
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
