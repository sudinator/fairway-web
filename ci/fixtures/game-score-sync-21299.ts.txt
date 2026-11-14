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
      if (deps.paused()) return Promise.resolve(false);
      const previous = queues.get(rowId) ?? Promise.resolve(true);
      const task = previous.catch(() => false).then(async () => {
        if (deps.paused()) return false;
        const bundle = deps.backup(rowId);
        if (!bundle) return false;
        const wm = deps.watermark(rowId);
        const dirty = changedCols(bundle, wm);
        const locked = deps.locked(rowId);
        const cols: ScoreCol[] = locked ? dirty.filter(c => c !== "scores") : dirty;
        if (!cols.length) return dirty.length === 0;
        deps.revision();
        try {
          if (!await deps.send(rowId, pickCols(bundle, cols), locked, clock)) return false;
          deps.confirm(rowId, { scores: [], putts: [], fairways: [], penalties: [], sand: [], ...wm, ...pickCols(bundle, cols) });
          // A new tap while this request was in flight stays pending.
          const newest = deps.backup(rowId);
          return !!newest && changedCols(newest, deps.watermark(rowId)).length === 0;
        } catch {
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
