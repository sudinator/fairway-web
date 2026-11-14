// Local, bounded support evidence. Never collects request/response bodies,
// query strings, authentication headers, cookies, tokens, names or scores.
// Only allowlisted request-correlation response headers are read.
import { APP_VERSION, APP_BUILD_ID, APP_BUILT_AT } from './app-version';

export const DIAGNOSTIC_PREFIX = 'bnn_phone_diagnostics_v1:';
const MAX_EVENTS = 150, MAX_CHARS = 48 * 1024, MAX_SESSIONS = 4;
const MAX_AGE = 7 * 86400000;
const EVENTS = new Set([
  'app.launch', 'app.visible', 'app.hidden', 'app.online', 'app.offline', 'app.pagehide', 'app.pageshow', 'app.screen',
  'auth.start', 'auth.result', 'auth.state', 'network.result', 'network.failure', 'runtime.error', 'runtime.rejection',
  'worker.failure', 'update.check', 'update.result', 'update.start', 'update.navigate', 'update.failure', 'worker.state',
  'realtime.state', 'storage.saved', 'recovery.discarded', 'score.input', 'save.start', 'save.queued', 'save.skipped', 'save.confirmed', 'save.failed', 'save.superseded', 'sync.held',
  'sync.start', 'sync.confirmed', 'sync.failed', 'round.event', 'storage.failed', 'device.state', 'diagnostics.export',
]);
const LABELS = new Set([
  'checking', 'primary', 'viewer', 'idle', 'saving', 'saved', 'error', 'start', 'complete', 'failure', 'queued', 'pending',
  'download', 'cache', 'install', 'activate', 'open', 'closed', 'connecting', 'closing', 'stored', 'paused', 'missing', 'locked', 'unchanged', 'superseded', 'active', 'waiting', 'installing', 'activated',
  'installed', 'redundant', 'none', 'timeout', 'access', 'invalid', 'server', 'network', 'unknown', 'online', 'offline',
  'supabase', 'app', 'GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'round', 'game', 'shared-ball',
  'mount', 'unmount', 'ensure', 'flush', 'insert', 'adopt', 'reuse', 'finish', 'delete', 'reset', 'save', 'load',
  'SIGNED_IN', 'SIGNED_OUT', 'INITIAL_SESSION', 'TOKEN_REFRESHED', 'USER_UPDATED', 'PASSWORD_RECOVERY', 'MFA_CHALLENGE_VERIFIED',
  'dashboard', 'rounds', 'games', 'courses', 'players', 'groups', 'money', 'teetimes', 'tours', 'tournaments', 'admin', 'help', 'more',
  'Error', 'TypeError', 'AbortError', 'QuotaExceededError', 'SecurityError', 'NetworkError', 'RangeError', 'SyntaxError',
]);
type Details = Record<string, unknown>;
export type PhoneDiagnosticEvent = { at: string; seq: number; session: string; version: string; event: string; details: Record<string, string | number | boolean> };
let account: string | null = null;
let sequence = 0;
let session = '', events: PhoneDiagnosticEvent[] = [], revision = 0, storageAvailable = true;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
const subscribers = new Set<() => void>();
let owners = 0, uninstall: (() => void) | undefined;
function notify() { revision++; for (const fn of subscribers) { try { fn(); } catch { /* diagnostics cannot break a subscriber */ } } }
function storageStatus(next: boolean) { if (storageAvailable !== next) { storageAvailable = next; notify(); } }
export const subscribePhoneDiagnostics = (fn: () => void) => { subscribers.add(fn); return () => { subscribers.delete(fn); }; };
export const phoneDiagnosticRevision = () => revision;
export const serverPhoneDiagnosticRevision = () => 0;
function identity() {
  if (!session) session = globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return session;
}
function detailsOf(input: Details): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (['status', 'line', 'column', 'durationMs', 'count', 'attempt', 'columns', 'pending', 'holeCount'].includes(key) && typeof value === 'number' && Number.isFinite(value)) out[key] = Math.max(0, Math.min(1e9, Math.round(value)));
    else if (['online', 'redirected', 'opaqueRedirect', 'ok', 'persisted', 'authenticated', 'hasWorker', 'hasWaiting'].includes(key) && typeof value === 'boolean') out[key] = value;
    else if (['state', 'phase', 'category', 'method', 'service', 'screen', 'errorName'].includes(key) && typeof value === 'string' && LABELS.has(value)) out[key] = value;
    else if (['latest', 'target'].includes(key) && typeof value === 'string' && /^\d+\.\d+\.\d{6}$/.test(value)) out[key] = value;
    else if (key === 'requestId' && typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(value)) out[key] = value;
    else if (key === 'asset' && typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,96}\.js$/.test(value)) out[key] = value;
    else if (key === 'entityId' && typeof value === 'string' && /^(?:[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}|\d{4,9})$/i.test(value)) out[key] = value;
    else if (key === 'code' && typeof value === 'string' && /^(?:[A-Z]{2,12}\d{0,8}|[0-9]{5})$/.test(value)) out[key] = value;
    else if (key === 'resource' && typeof value === 'string' && value.length <= 100 && /^\/(?:api|auth|rest\/v1|storage|app-version\.json|sw\.js)(?:\/[a-z0-9_:-]+)*$/.test(value)) out[key] = value;
  }
  return out;
}
function validEvent(e: unknown): e is PhoneDiagnosticEvent {
  if (!e || typeof e !== 'object') return false;
  const v = e as PhoneDiagnosticEvent;
  return Number.isSafeInteger(v.seq) && v.seq >= 0 && EVENTS.has(v.event) && typeof v.at === 'string' && Number.isFinite(Date.parse(v.at)) && Date.parse(v.at) > Date.now() - MAX_AGE &&
    typeof v.session === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(v.session) && typeof v.version === 'string' && /^\d+\.\d+\.\d{6}$/.test(v.version) && !!v.details && typeof v.details === 'object';
}
function bounded(items: PhoneDiagnosticEvent[]) {
  const result = items.slice(-MAX_EVENTS);
  while (result.length && JSON.stringify(result).length > MAX_CHARS - 256) result.shift();
  return result;
}
function keys() {
  const storage = window.localStorage;
  return Array.from({ length: storage.length }, (_, i) => storage.key(i)!).filter(k => k?.startsWith(DIAGNOSTIC_PREFIX));
}
function prune() {
  try {
    const ranked = keys().map(key => {
      try { const value = window.localStorage.getItem(key) || ''; if (value.length > MAX_CHARS) return { key, at: 0 }; const block = JSON.parse(value); const parsed = block?.events; return { key, at: Array.isArray(parsed) && validEvent(parsed[parsed.length - 1]) ? Date.parse(parsed[parsed.length - 1].at) : 0 }; }
      catch { return { key, at: 0 }; }
    }).sort((a, b) => b.at - a.at);
    for (const [i, item] of ranked.entries()) if (!item.at || i >= MAX_SESSIONS) window.localStorage.removeItem(item.key);
  } catch { storageStatus(false); }
}
export function flushPhoneDiagnostics() {
  try {
    if (persistTimer !== undefined) { clearTimeout(persistTimer); persistTimer = undefined; }
    if (typeof window === 'undefined' || !events.length) return;
    window.localStorage.setItem(DIAGNOSTIC_PREFIX + identity(), JSON.stringify({ owner: account, events })); storageStatus(true); prune();
  } catch { storageStatus(false); /* Keep memory evidence, never evict score data or retry recursively. */ }
}
export function recordPhoneDiagnostic(event: string, details: Details = {}) {
  try {
    if (typeof window === 'undefined' || !EVENTS.has(event)) return;
    events = bounded([...events, { at: new Date().toISOString(), seq: ++sequence, session: identity(), version: APP_VERSION, event, details: detailsOf(details) }]);
    notify();
    if (persistTimer === undefined) { persistTimer = setTimeout(flushPhoneDiagnostics, 1000); (persistTimer as unknown as { unref?: () => void }).unref?.(); }
  } catch { /* An unavailable clock/storage/subscriber never affects application work. */ }
}
export function setPhoneDiagnosticAccount(uid: string | null) {
  try {
    const next = typeof uid === 'string' && /^[a-f0-9-]{36}$/i.test(uid) ? uid : null;
    if (next === account) return;
    flushPhoneDiagnostics();
    if (account !== null) { events = []; session = ''; }
    account = next; notify();
  } catch { /* Account boundaries may reduce evidence, never block authentication. */ }
}
export function resetPhoneDiagnostics() {
  try { if (persistTimer !== undefined) clearTimeout(persistTimer); persistTimer = undefined; events = []; session = ''; account = null; if (typeof window !== 'undefined') for (const key of keys()) window.localStorage.removeItem(key); storageStatus(true); notify(); }
  catch { storageStatus(false); }
}
export function phoneDiagnosticStatus() { return { count: events.length, persisted: storageAvailable }; }
function collectedEvents() {
  flushPhoneDiagnostics(); const all: PhoneDiagnosticEvent[] = [];
  try {
    for (const key of keys()) {
      const text = window.localStorage.getItem(key) || ''; if (text.length > MAX_CHARS) continue;
      try {
        const block = JSON.parse(text); const parsed: unknown = block?.events;
        if (block?.owner !== account) continue;
        if (Array.isArray(parsed)) for (const event of parsed.filter(validEvent)) all.push({ at: new Date(event.at).toISOString(), seq: event.seq, session: event.session, version: event.version, event: event.event, details: detailsOf(event.details) });
      } catch { /* One corrupt session does not suppress other evidence. */ }
    }
  } catch { storageStatus(false); }
  const unique = new Map<string, PhoneDiagnosticEvent>();
  for (const event of [...all, ...events]) if (validEvent(event)) unique.set(JSON.stringify(event), event);
  return [...unique.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-MAX_EVENTS * MAX_SESSIONS);
}
const APP_PATHS = new Set(['api', 'auth', 'callback', 'deployment-access', 'courses', 'games', 'completed', 'push', 'test', 'admin', 'merge-accounts', 'club-engagement', 'member-stats', 'round-emails', 'unsubscribe', 'analyze-round', 'freshness', 'apply-selected']);
export function diagnosticRequest(input: RequestInfo | URL, init?: RequestInit) {
  try {
    if (typeof window === 'undefined') return null;
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.origin);
    const method = String(init?.method || (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
    if (url.origin === window.location.origin && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') || ['/app-version.json', '/sw.js'].includes(url.pathname))) {
      const resource = ['/app-version.json', '/sw.js'].includes(url.pathname) ? url.pathname : '/' + url.pathname.split('/').filter(Boolean).map(p => APP_PATHS.has(p) ? p : ':id').join('/');
      return { service: 'app', method, resource };
    }
    const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (configured && url.origin === new URL(configured).origin) {
      const parts = url.pathname.split('/').filter(Boolean);
      const resource = parts[0] === 'rest' && parts[1] === 'v1' ? '/rest/v1/' + parts.slice(2, 4).map(p => /^[a-z_]{1,60}$/.test(p) ? p : ':id').join('/') : parts[0] === 'auth' ? '/auth/:id' : parts[0] === 'storage' ? '/storage/:id' : null;
      return resource ? { service: 'supabase', method, resource } : null;
    }
  } catch { /* Invalid/unrelated URLs are not recorded. */ }
  return null;
}
export function diagnosticError(error: unknown) {
  try { const e = error as { name?: unknown; code?: unknown }; return detailsOf({ errorName: e?.name, code: e?.code }); } catch { return {}; }
}
export function installPhoneDiagnostics() {
  if (typeof window === 'undefined') return () => {};
  owners++;
  if (owners === 1) {
    recordPhoneDiagnostic('app.launch', { online: navigator.onLine }); prune();
    const original = window.fetch;
    const wrapped: typeof fetch = async function(this: unknown, input, init) {
      const context = diagnosticRequest(input, init);
      if (!context) return original.call(this, input, init);
      const began = Date.now();
      let response: Response;
      try { response = await original.call(this, input, init); }
      catch (error) {
        try { recordPhoneDiagnostic('network.failure', { ...context, ...diagnosticError(error), durationMs: Date.now() - began, online: navigator.onLine }); } catch { /* preserve original rejection */ }
        throw error;
      }
      try { recordPhoneDiagnostic('network.result', { ...context, status: response.status, durationMs: Date.now() - began, ok: response.ok, redirected: response.redirected, opaqueRedirect: response.type === 'opaqueredirect', requestId: response.headers.get('x-vercel-id') || response.headers.get('sb-request-id') }); } catch { /* preserve original success even if observation fails */ }
      return response;
    };
    if (typeof original === 'function') window.fetch = wrapped;
    const online = () => recordPhoneDiagnostic(navigator.onLine ? 'app.online' : 'app.offline');
    const visibility = () => { recordPhoneDiagnostic(document.visibilityState === 'hidden' ? 'app.hidden' : 'app.visible'); if (document.visibilityState === 'hidden') flushPhoneDiagnostics(); };
    const hide = () => { recordPhoneDiagnostic('app.pagehide'); flushPhoneDiagnostics(); };
    const show = (e: PageTransitionEvent) => recordPhoneDiagnostic('app.pageshow', { persisted: e.persisted });
    const workerChange = () => recordPhoneDiagnostic('worker.state', { state: navigator.serviceWorker.controller?.state || 'none' });
    const workerEvent = (e: MessageEvent) => { if (e.data?.kind === 'bnn-diagnostic-event') recordPhoneDiagnostic('worker.failure', { phase: e.data.phase, status: e.data.status, errorName: e.data.errorName, latest: e.data.version }); };
    if ('serviceWorker' in navigator) { navigator.serviceWorker.addEventListener('controllerchange', workerChange); navigator.serviceWorker.addEventListener('message', workerEvent); }
    const error = (e: ErrorEvent) => {
      let asset: string | undefined;
      try { const u = new URL(e.filename); if (u.origin === window.location.origin && u.pathname.startsWith('/_next/static/')) asset = u.pathname.split('/').pop(); } catch { /* no raw filename */ }
      recordPhoneDiagnostic('runtime.error', { ...diagnosticError(e.error), asset, line: e.lineno, column: e.colno });
    };
    const rejection = (e: PromiseRejectionEvent) => recordPhoneDiagnostic('runtime.rejection', diagnosticError(e.reason));
    window.addEventListener('online', online); window.addEventListener('offline', online);
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show);
    window.addEventListener('error', error); window.addEventListener('unhandledrejection', rejection);
    uninstall = () => {
      if (window.fetch === wrapped) window.fetch = original;
      window.removeEventListener('online', online); window.removeEventListener('offline', online); document.removeEventListener('visibilitychange', visibility);
      if ('serviceWorker' in navigator) { navigator.serviceWorker.removeEventListener('controllerchange', workerChange); navigator.serviceWorker.removeEventListener('message', workerEvent); }
      window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show); window.removeEventListener('error', error); window.removeEventListener('unhandledrejection', rejection); flushPhoneDiagnostics();
    };
  }
  let released = false;
  return () => { if (released) return; released = true; if (--owners === 0) { uninstall?.(); uninstall = undefined; } };
}
async function diagnosticDeadline<T>(work: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work.catch(() => fallback), new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), 1200); })]); }
  finally { clearTimeout(timer); }
}
async function workerSnapshot() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return { supported: false };
  try {
    const lookup = await diagnosticDeadline(navigator.serviceWorker.getRegistration().then(reg => ({ reg })), null);
    if (!lookup) return { supported: true, state: 'unavailable' };
    const reg = lookup.reg;
    if (!reg) return { supported: true, registered: false };
    const controller = navigator.serviceWorker.controller;
    const result: Record<string, unknown> = { supported: true, registered: true, controller: controller?.state || 'none', active: reg.active?.state || 'none', waiting: reg.waiting?.state || 'none', installing: reg.installing?.state || 'none', workerVersion: 'unavailable' };
    if (controller && typeof MessageChannel !== 'undefined') {
      const channel = new MessageChannel(); let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        result.workerVersion = await new Promise<string>(resolve => {
          timer = setTimeout(() => resolve('timeout'), 1200);
          channel.port1.onmessage = e => { const v = e.data?.version; resolve(typeof v === 'string' && /^\d+\.\d+\.\d{6}$/.test(v) ? v : 'invalid'); };
          controller.postMessage({ kind: 'bnn-diagnostic-status' }, [channel.port2]);
        });
      } finally { clearTimeout(timer); channel.port1.close(); channel.port2.close(); }
    }
    return result;
  } catch { return { supported: true, state: 'unavailable' }; }
}
function configuredBackend() { try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').origin; } catch { return 'unavailable'; } }
export async function buildPhoneDiagnosticReport(deviceState = 'unknown') {
  recordPhoneDiagnostic('diagnostics.export');
  const timeline = collectedEvents();
  const worker = await workerSnapshot();
  let cachesFound: string[] = [], storedScoreKeys = 0;
  try { if (typeof caches !== 'undefined') cachesFound = (await diagnosticDeadline(caches.keys(), [] as string[])).filter(k => /^bnn-shell-\d+\.\d+\.\d{6}$/.test(k)).slice(-12); } catch { /* unavailable cache API is diagnostic, not fatal */ }
  try { const s = window.localStorage; for (let i = 0; i < s.length; i++) if (/^bnn_(?:device_scores:|game_scores_|round_draft_v1)|^bnn:altshot-side-drafts:/.test(s.key(i) || '')) storedScoreKeys++; } catch { /* no draft values or key contents are read */ }
  return {
    schema: 'bnn-phone-diagnostics/v1', exportedAt: new Date().toISOString(),
    app: { origin: window.location.origin, backendOrigin: configuredBackend(), version: APP_VERSION, buildId: APP_BUILD_ID, builtAt: APP_BUILT_AT, environment: typeof document !== 'undefined' && document.documentElement.dataset.env === 'staging' ? 'staging' : 'production' },
    device: { userAgent: navigator.userAgent, timezoneOffsetMinutes: new Date().getTimezoneOffset(), viewport: { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio }, notifications: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission, pushSupported: 'PushManager' in window, online: navigator.onLine, standalone: !!(navigator as Navigator & { standalone?: boolean }).standalone || !!window.matchMedia?.('(display-mode: standalone)').matches, scoringRole: LABELS.has(deviceState) ? deviceState : 'unknown' },
    storage: { diagnosticsPersistent: storageAvailable, storedScoreKeys, note: 'Counts are not a verdict on whether scores are synced.', limits: { eventsPerSession: MAX_EVENTS, sessions: MAX_SESSIONS, maxCharsPerSession: MAX_CHARS, days: 7 } },
    worker, caches: cachesFound, events: timeline,
    limitations: ['Records begin with this diagnostic-enabled version; earlier phone activity cannot be reconstructed.', 'No cookies, credentials, request bodies, personal names or score values are included. No automatic upload.', 'HTTP success is a transport result, not proof that a business action succeeded. Realtime state is sampled, not a record of every message.', 'Cross-origin redirects may appear as opaque status 0. Cookie state and redirect Location are not recorded.'],
  };
}
