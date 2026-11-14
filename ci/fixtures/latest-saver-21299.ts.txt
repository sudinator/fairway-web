// One save in flight at a time; the NEWEST request always wins (206.1, review finding 9).
// While a save runs, further requests are held — only the latest is kept — and sent when it
// finishes. A save is acknowledged ("saved") only when what completed is the latest requested, so
// an earlier completion can never confirm (or overwrite) a later edit.
export type SaverState<T> = { status: "idle" | "saving" | "saved" | "error"; value: T | null; error?: string };

export function createLatestSaver<T>(save: (v: T) => Promise<void>, onState: (s: SaverState<T>) => void, same: (a: T, b: T) => boolean = (a, b) => JSON.stringify(a) === JSON.stringify(b),
  /** 206.2: "is this already the stored value?" — consulted ONLY when nothing is in flight. While a
   *  save runs, a request equal to the stored value (an edit reverted mid-save) is still queued, or
   *  the in-flight intermediate value would win. */
  isStored?: (v: T) => boolean) {
  let inFlight: T | null = null;
  let pending: T | null = null;
  let latest: T | null = null;
  const run = async (v: T): Promise<void> => {
    inFlight = v;
    onState({ status: "saving", value: v });
    try {
      await save(v);
      inFlight = null;
      if (pending !== null && !same(pending, v)) { const next = pending; pending = null; return run(next); }
      pending = null;
      if (latest !== null && same(latest, v)) onState({ status: "saved", value: v });
    } catch (e) {
      inFlight = null;
      const next = pending; pending = null;
      if (next !== null && !same(next, v)) return run(next);
      onState({ status: "error", value: v, error: e instanceof Error ? e.message : String(e) });
    }
  };
  return {
    request(v: T): Promise<void> {
      latest = v;
      if (inFlight !== null) { pending = v; return Promise.resolve(); }
      if (isStored?.(v)) return Promise.resolve();
      return run(v);
    },
  };
}
