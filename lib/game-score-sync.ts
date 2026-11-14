import { recordPhoneDiagnostic, diagnosticError } from "./phone-diagnostics";
import { changedCols, pickCols, type ScoreCol } from "./sync-cols";

export type ScoreBundle = { scores: any[]; putts: any[]; fairways: any[]; penalties: any[]; sand: any[] };
type SyncDeps = {
  backup: (rowId: string) => ScoreBundle | null;
  watermark: (rowId: string) => ScoreBundle | null;
  confirm: (rowId: string, bundle: ScoreBundle) => void;
  locked: (rowId: string) => boolean;
  paused: () => boolean;
  revision: () => void;
  send: (rowId: string, body: Partial<ScoreBundle>, locked: boolean, clock?: Record<string, unknown>) => Promise<boolean>;
};

// One admitted request per row. Queued retries read the durable backup at execution
// time; only an acknowledged snapshot advances the watermark. Other rows may sync
// independently. Reset waits for idle and blocks admission through paused().
export function createGameScoreWriter(deps: SyncDeps) {
  const queues = new Map<string, Promise<boolean>>();
  return {
    get busy() { return queues.size > 0; },
    async idle() { await Promise.allSettled([...queues.values()]); },
    write(rowId: string, clock?: Record<string, unknown>): Promise<boolean> {
      if (deps.paused()) { recordPhoneDiagnostic("sync.held", { phase: "paused", entityId: rowId }); return Promise.resolve(false); }
      const previous = queues.get(rowId) ?? Promise.resolve(true);
      const task = previous.catch(() => false).then(async () => {
        if (deps.paused()) { recordPhoneDiagnostic("sync.held", { phase: "paused", entityId: rowId }); return false; }
        const bundle = deps.backup(rowId);
        if (!bundle) { recordPhoneDiagnostic("sync.held", { phase: "missing", entityId: rowId }); return false; }
        const wm = deps.watermark(rowId);
        const dirty = changedCols(bundle, wm);
        const locked = deps.locked(rowId);
        const cols: ScoreCol[] = locked ? dirty.filter(c => c !== "scores") : dirty;
        if (!cols.length) { recordPhoneDiagnostic("sync.held", { phase: locked ? "locked" : "unchanged", entityId: rowId }); return dirty.length === 0; }
        deps.revision();
        recordPhoneDiagnostic("sync.start", { entityId: rowId, columns: cols.length });
        try {
          if (!await deps.send(rowId, pickCols(bundle, cols), locked, clock)) { recordPhoneDiagnostic("sync.failed", { entityId: rowId }); return false; }
          deps.confirm(rowId, { scores: [], putts: [], fairways: [], penalties: [], sand: [], ...wm, ...pickCols(bundle, cols) });
          // A new tap while this request was in flight stays pending.
          const newest = deps.backup(rowId);
          const synced = !!newest && changedCols(newest, deps.watermark(rowId)).length === 0;
          recordPhoneDiagnostic("sync.confirmed", { entityId: rowId, pending: synced ? 0 : 1 });
          return synced;
        } catch (error) {
          recordPhoneDiagnostic("sync.failed", { entityId: rowId, ...diagnosticError(error) });
          return false;
        } finally {
          deps.revision();
        }
      });
      queues.set(rowId, task);
      void task.finally(() => { if (queues.get(rowId) === task) queues.delete(rowId); });
      return task;
    },
  };
}
