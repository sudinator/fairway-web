"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { C } from '@/lib/golf';
import { btn, inputStyle } from '@/components/ui';
import { buildPhoneDiagnosticReport, diagnosticError, installPhoneDiagnostics, phoneDiagnosticRevision, phoneDiagnosticStatus, recordPhoneDiagnostic, serverPhoneDiagnosticRevision, subscribePhoneDiagnostics, workerSnapshot } from '@/lib/phone-diagnostics';
import { scoringDeviceState, storageWriteFailed, subscribeScoringDevice } from '@/lib/scoring-device';
import { APP_VERSION } from '@/lib/app-version';
import { automaticUpdateState, serverAutomaticUpdateState, subscribeAutomaticUpdates, checkAutomaticVersion, updateOutcomeMessage } from '@/lib/automatic-updates';

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
  const updates = useSyncExternalStore(subscribeAutomaticUpdates, automaticUpdateState, serverAutomaticUpdateState);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [description, setDescription] = useState(''), [open, setOpen] = useState(false);
  const [worker, setWorker] = useState<Record<string, unknown> | null>(null), [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(false), request = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current++; }; }, []);
  const refreshSummary = useCallback(async (checkVersion = false) => {
    const id = ++request.current; setRefreshing(true);
    const [snapshot] = await Promise.all([workerSnapshot(), checkVersion ? checkAutomaticVersion() : Promise.resolve()]);
    if (mounted.current && id === request.current) { setWorker(snapshot); setRefreshing(false); }
  }, []);
  useEffect(() => { if (open) void refreshSummary(); }, [open, refreshSummary]);
  const status = phoneDiagnosticStatus();
  const workerVersion = worker?.workerVersion;
  const workerLabel = !worker ? 'Not checked yet' : worker.supported === false ? 'Not supported' : worker.registered === false ? 'Not registered' : workerVersion === 'timeout' ? 'Could not read — no reply' : typeof workerVersion === 'string' && /^\d+\.\d+\.\d{6}$/.test(workerVersion) ? workerVersion : 'Could not read';
  const time = (value: string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
  async function exportReport() {
    if (busy) return;
    setBusy(true); setMessage('Preparing report…');
    try {
      const report = { ...await buildPhoneDiagnosticReport(scoringDeviceState(), description), updateStatus: { latest: updates.latest, checkedAt: updates.checkedAt, checkFailure: updates.checkFailure, lastOutcome: updates.outcome } };
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
  return <details data-phone-diagnostics onToggle={event => setOpen(event.currentTarget.open)} style={{ marginTop: 16, border: `1px solid ${C.borderGreen}`, borderRadius: 12, padding: 12, textAlign: 'left' }}>
    <summary style={{ color: C.cream, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Diagnostics &amp; support</summary>
    <div data-diagnostic-summary style={{ marginTop: 12, color: C.cream, fontSize: 13, lineHeight: 1.6, overflowWrap: 'anywhere' }}>
      <div style={{ fontWeight: 700 }}>This device</div>
      <dl style={{ margin: '8px 0', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.3fr)', columnGap: 12, rowGap: 6 }}>
        <dt style={{ color: C.sage }}>Installed app</dt><dd style={{ margin: 0 }}>{APP_VERSION}</dd>
        <dt style={{ color: C.sage }}>Active worker</dt><dd style={{ margin: 0 }}>{refreshing ? 'Checking…' : workerLabel}{!refreshing && workerVersion === APP_VERSION && <div style={{ color: C.sage, fontSize: 12 }}>Matches installed app</div>}{!refreshing && typeof workerVersion === 'string' && /^\d+\.\d+\.\d{6}$/.test(workerVersion) && workerVersion !== APP_VERSION && <div style={{ color: C.gold, fontSize: 12 }}>Differs from installed app</div>}</dd>
        <dt style={{ color: C.sage }}>Waiting worker</dt><dd style={{ margin: 0 }}>{!worker ? 'Not checked yet' : worker.waiting === 'none' ? 'None' : worker.waiting === 'installed' ? 'Downloaded; waiting to activate' : 'Could not read'}</dd>
        <dt style={{ color: C.sage }}>{updates.checkFailure ? 'Last known release' : 'Latest release'}</dt><dd style={{ margin: 0 }}>{updates.latest || 'Not checked yet'}</dd>
        <dt style={{ color: C.sage }}>Last version check</dt><dd style={{ margin: 0 }}>{updates.checking ? 'Checking…' : updates.checkedAt ? `${time(updates.checkedAt)} · ${updates.checkFailure ? 'Failed' : 'Succeeded'}` : 'Not checked yet'}</dd>
        <dt style={{ color: C.sage }}>Diagnostic storage</dt><dd style={{ margin: 0 }}>{status.persisted ? 'Available on this device' : 'Memory only — history may be lost on close'}</dd>
      </dl>
      {updates.checkFailure && <div style={{ color: C.gold, fontSize: 12 }}>{updates.message}{updates.checkFailure === 'access' && <div><a href="/auth/deployment-access" style={{ color: C.cream }}>Reconnect to app</a></div>}</div>}
      {updates.outcome && <div style={{ marginTop: 8 }}><b>Last update attempt</b><div>{updateOutcomeMessage(updates.outcome)}</div><div style={{ color: C.sage, fontSize: 12 }}>{time(updates.outcome.at)}</div></div>}
      <button data-refresh-diagnostics style={{ ...btn(false), marginTop: 8 }} disabled={refreshing || updates.checking} onClick={() => { void refreshSummary(true); }}>{refreshing || updates.checking ? 'Refreshing…' : 'Refresh summary'}</button>
    </div>
    <p style={{ color: C.sage, fontSize: 13, lineHeight: 1.5 }}>Export recent technical activity from this device when something goes wrong. Recording is automatic and stays on this device until you choose to share a report.</p>
    <div style={{ color: C.sage, fontSize: 12 }}>{status.count} recent events in this session. {status.persisted ? 'Recent history survives reopening.' : 'Phone storage is unavailable; only this session’s memory can be exported.'}</div>
    <label style={{ display: 'block', color: C.cream, fontSize: 13, marginTop: 12 }}>What went wrong? (optional)
      <textarea aria-label="What went wrong? (optional)" value={description} maxLength={500} disabled={busy} onChange={event => setDescription(event.target.value.slice(0, 500))} rows={3} placeholder="What were you doing, and what happened?" style={{ ...inputStyle, boxSizing: 'border-box', width: '100%', marginTop: 6, fontFamily: 'inherit', fontSize: 16, resize: 'vertical' }} />
    </label>
    <div style={{ color: C.sage, fontSize: 12, lineHeight: 1.5 }}>{description.length}/500. Included only in the report you export; not saved in diagnostic history. Do not include passwords or other sensitive information.</div>
    <button data-export-diagnostics onClick={() => { void exportReport(); }} disabled={busy} style={{ ...btn(true), marginTop: 12 }}>{busy ? 'Preparing…' : 'Export diagnostic report'}</button>
    {message && <div role="status" style={{ marginTop: 8, color: C.cream, fontSize: 13, lineHeight: 1.4 }}>{message}</div>}
    <p style={{ color: C.sage, fontSize: 12, lineHeight: 1.5 }}>Automatic records include versions, save/sync outcomes and request status; score values and sign-in credentials are excluded. Your optional description includes what you type. Earlier app versions cannot supply historical records. Saved score recovery copies are a separate export.</p>
  </details>;
}
