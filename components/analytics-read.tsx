"use client";
import { useCallback, useEffect, useState } from 'react';
import { C } from '@/lib/golf';
import { btn } from '@/components/ui';
import { rpcAll } from '@/lib/fetch-all';

/** Same-query failures retain good data; query changes never show another scope's data. */
export function useAnalyticsRpc(db: any, name: string, args?: Record<string, unknown>, order?: string | string[], enabled = true) {
  const key = JSON.stringify({ name, args: args || {}, order, enabled });
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; data: any; loadedAt: string } | null>(null);
  const [error, setError] = useState<{ key: string; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    let live = true; const controller = new AbortController();
    setLoading(true); setError(null);
    const timer = setTimeout(() => { controller.abort(); if (live) { live = false; setError({ key, text: 'These figures took too long to load.' }); setLoading(false); } }, 20_000);
    const request = JSON.parse(key);
    const query = request.order ? rpcAll(db, request.name, request.args, request.order) : db.rpc(request.name, request.args);
    const pending = typeof query.abortSignal === 'function' ? query.abortSignal(controller.signal) : query;
    void Promise.resolve(pending).then(({ data, error }: any) => {
      if (!live) return;
      if (error) throw new Error('These figures could not be loaded.');
      if (data == null) throw new Error('The analytics response was empty.');
      setResult({ key, data, loadedAt: new Date().toISOString() });
    }).catch(() => { if (live) setError({ key, text: 'These figures could not be loaded.' }); }).finally(() => { clearTimeout(timer); if (live) setLoading(false); });
    return () => { live = false; clearTimeout(timer); controller.abort(); };
  }, [db, key, attempt, enabled]);
  const retry = useCallback(() => setAttempt(n => n + 1), []);
  return { data: result?.key === key ? result.data : null, loadedAt: result?.key === key ? result.loadedAt : null, error: error?.key === key ? error.text : null, loading, retry, revision: attempt };
}
export function AnalyticsReadStatus({ loadedAt, error, retry, loading }: { loadedAt: string | null; error: string | null; retry: () => void; loading: boolean }) {
  return <div data-analytics-status style={{ color: C.sage, fontSize: 12, lineHeight: 1.5, margin: '8px 0' }}>
    {error && <div role="alert" style={{ color: C.cream }}>{error}{loadedAt ? ' Showing the last loaded figures.' : ''}</div>}
    {loadedAt && <span>Loaded {new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(loadedAt))} Eastern · </span>}
    <button type="button" style={{ ...btn(false), fontSize: 12, padding: '8px 12px' }} disabled={loading} onClick={retry}>{loading ? 'Updating…' : error ? 'Retry' : 'Refresh'}</button>
  </div>;
}
