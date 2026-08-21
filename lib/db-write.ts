/**
 * One place to make a failed database write visible.
 *
 * The app has 64 writes that never inspect their error. Most were deliberate — a notification
 * mark-read that self-corrects on reload does not need an alert. But three shapes are not
 * defensible, and this helper exists for those:
 *
 *   1. A write followed by a refetch. The change silently reverts, so the user cannot tell
 *      whether they mis-tapped or the app failed. Worse than an error message.
 *   2. A write followed by a LOG or a NOTIFY. The activity log records "vetted this course" and
 *      a member is told their course was restored, when neither happened. The evidence becomes
 *      wrong, not just the state.
 *   3. A cascade. Five deletes in sequence with no checks: if the second fails, the first is
 *      already gone and there is no rollback — a half-deleted user with orphaned rows.
 *
 * Usage — the message is what the USER reads, so say what happened and what to do:
 *
 *     if (!(await write(
 *       supabase.from("games").update({ pairings }).eq("id", game.id),
 *       "Couldn't save the pairing",
 *     ))) return;
 *
 * Returns true on success, false after showing a toast. Callers must return on false: continuing
 * past a failed write is how the log ends up describing something that did not happen.
 */
import { notifyError } from "@/components/toast";
import { adviceFor, failureMessage } from "./errors";

/** Anything awaitable that resolves to Supabase's `{ error }` shape. */
type Writable<T> = PromiseLike<{ error: { message?: string } | null } & T>;

export async function write<T>(op: Writable<T>, whatFailed: string): Promise<boolean> {
  try {
    const { error } = await op;
    if (!error) return true;
    // Plain English plus a quotable code. The raw Postgres text goes to the console, not the
    // toast: "new row violates row-level security policy" is diagnostic language, and a golfer
    // reading it learns nothing they can act on.
    notifyError(failureMessage(whatFailed, error));
    return false;
  } catch (e: unknown) {
    // A network drop rejects rather than resolving with an error, and reads identically to the
    // user: the thing they did did not happen.
    notifyError(failureMessage(whatFailed, { message: e instanceof Error ? e.message : "no connection" }));
    return false;
  }
}

/**
 * A sequence that must not half-apply. Stops at the first failure and reports which step failed,
 * because "couldn't delete" is not actionable when five tables are involved and some already went.
 */
export async function writeAll(
  steps: { op: Writable<unknown>; label: string }[],
  whatFailed: string,
): Promise<boolean> {
  for (let i = 0; i < steps.length; i++) {
    const { error } = await Promise.resolve(steps[i].op).catch((e) => ({
      error: { message: e instanceof Error ? e.message : "no connection" },
    }));
    if (error) {
      const done = steps.slice(0, i).map((s) => s.label).join(", ");
      const { action, code } = adviceFor(error);
      notifyError(
        `${whatFailed}, and it stopped partway.` +
        (done ? ` Already done: ${done}.` : "") +
        ` ${action} (error code ${code})`,
      );
      if (typeof console !== "undefined") console.error(`[${whatFailed}] step "${steps[i].label}"`, error);
      return false;
    }
  }
  return true;
}
