"use client";

import { useEffect, useState, useSyncExternalStore } from 'react';
import { C } from '@/lib/golf';
import { btn } from '@/components/ui';
import { buildPhoneDiagnosticReport, diagnosticError, installPhoneDiagnostics, phoneDiagnosticRevision, phoneDiagnosticStatus, recordPhoneDiagnostic, serverPhoneDiagnosticRevision, subscribePhoneDiagnostics } from '@/lib/phone-diagnostics';
import { scoringDeviceState, storageWriteFailed, subscribeScoringDevice } from '@/lib/scoring-device';

export function PhoneDiagnosticsRecorder() {
  useEffect(() => {
    const stop = installPhoneDiagnostics();
    let role = '', failed = false;
    const observe = () => {
      const next = scoringDeviceState();
      if (role !== next) { role = next; recordPhoneDiagnostic('device.state', { state: next }); }
      if (!failed && storageWriteFailed()) { failed = true; recordPhoneDiagnostic('storage.failed'); }
    };
    observe(); const unsubscribe = subscribeScoringDevice(observe);
    return () => { unsubscribe(); stop(); };
  }, []);
  return null;
}

export function PhoneDiagnosticsPanel() {
  useSyncExternalStore(subscribePhoneDiagnostics, phoneDiagnosticRevision, serverPhoneDiagnosticRevision);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const status = phoneDiagnosticStatus();
  async function exportReport() {
    if (busy) return;
    setBusy(true); setMessage('Preparing report…');
    try {
      const report = await buildPhoneDiagnosticReport(scoringDeviceState());
      const json = JSON.stringify(report, null, 2);
      const filename = `BNN-diagnostics-${report.exportedAt.replace(/[:.]/g, '-')}.json`;
      const file = new File([json], filename, { type: 'application/json' });
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'BNN diagnostic report' }); setMessage('Report shared or saved.'); return; }
        catch (error) { if (diagnosticError(error).errorName === 'AbortError') { setMessage('Export canceled. You can try again.'); return; } }
      }
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); const revokeTimer = setTimeout(() => URL.revokeObjectURL(url), 10000);
      (revokeTimer as unknown as { unref?: () => void }).unref?.();
      setMessage('Report download requested. Check Downloads or Files.');
    } catch (error) {
      recordPhoneDiagnostic('runtime.error', diagnosticError(error));
      setMessage('Could not export the report. Please try again.');
    } finally { setBusy(false); }
  }
  return <details data-phone-diagnostics style={{ marginTop: 16, border: `1px solid ${C.borderGreen}`, borderRadius: 12, padding: 12, textAlign: 'left' }}>
    <summary style={{ color: C.cream, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Diagnostics &amp; support</summary>
    <p style={{ color: C.sage, fontSize: 13, lineHeight: 1.5 }}>Export recent technical activity from this device when something goes wrong. Recording is automatic and stays on this device until you choose to share a report.</p>
    <div style={{ color: C.sage, fontSize: 12 }}>{status.count} recent events in this session. {status.persisted ? 'Recent history survives reopening.' : 'Phone storage is unavailable; only this session’s memory can be exported.'}</div>
    <button onClick={() => { void exportReport(); }} disabled={busy} style={{ ...btn(true), marginTop: 12 }}>{busy ? 'Preparing…' : 'Export diagnostic report'}</button>
    {message && <div role="status" style={{ marginTop: 8, color: C.cream, fontSize: 13, lineHeight: 1.4 }}>{message}</div>}
    <p style={{ color: C.sage, fontSize: 12, lineHeight: 1.5 }}>Includes versions, save/sync outcomes and request status—not score values or sign-in credentials. Earlier app versions cannot supply historical records. Saved score recovery copies are a separate export.</p>
  </details>;
}
