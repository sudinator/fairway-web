/**
 * The setup draft must not outlive the game it was drafting.
 *
 * Reported from staging: after creating a game, the NEXT Create Game offered to resume the setup
 * that had just been completed. clearSetupDraft ran correctly on creation — but the component keeps
 * its form state, so the next render, or the pagehide/visibility checkpoint whose listeners are
 * still attached, wrote the same snapshot straight back.
 *
 * A store-level test, because the bug is about ORDERING around the store rather than about any one
 * function: each of save, clear and load was individually correct.
 */
import { loadSetupDraft, saveSetupDraft, clearSetupDraft } from "./setup-draft";

let pass = 0, fail = 0; const fails: string[] = [];
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; fails.push("FAIL " + n); } };

// A minimal localStorage, since this runs outside a browser.
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => mem.clear(),
} as never;

const GROUP = "grp1";
const draft = { name: "Saturday", course: "Berkshire", gameType: "fourball" } as never;

// ── the basics ────────────────────────────────────────────────────────────
{
  saveSetupDraft(GROUP, null, draft);
  ok("a saved draft loads back", loadSetupDraft(GROUP, null) != null);
  clearSetupDraft(GROUP, null);
  ok("a cleared draft is gone", loadSetupDraft(GROUP, null) == null);
}

// ── the reported bug: a save AFTER the clear resurrects it ────────────────
{
  saveSetupDraft(GROUP, null, draft);
  clearSetupDraft(GROUP, null);
  // This is what the component did: form state unchanged, so the effect fires again.
  saveSetupDraft(GROUP, null, draft);
  ok("a save after the clear DOES resurrect the draft — which is why the component must stop saving",
     loadSetupDraft(GROUP, null) != null);
  clearSetupDraft(GROUP, null);
}

// ── the keys must be symmetrical ─────────────────────────────────────────
// A save and a clear that disagree on the key would leave a draft behind for a different reason.
{
  saveSetupDraft(GROUP, "tee1", draft);
  clearSetupDraft(GROUP, "tee1");
  ok("cleared under the same tee-time key", loadSetupDraft(GROUP, "tee1") == null);
}
{
  // Drafts are keyed per tee time, so clearing one must not touch another.
  saveSetupDraft(GROUP, "tee1", draft);
  saveSetupDraft(GROUP, "tee2", draft);
  clearSetupDraft(GROUP, "tee1");
  ok("clearing one tee time leaves the other", loadSetupDraft(GROUP, "tee2") != null);
  clearSetupDraft(GROUP, "tee2");
}
{
  // A draft with no tee time and one with a tee time are DIFFERENT drafts.
  saveSetupDraft(GROUP, null, draft);
  clearSetupDraft(GROUP, "tee1");
  ok("clearing a tee-time draft leaves the no-tee-time one", loadSetupDraft(GROUP, null) != null);
  clearSetupDraft(GROUP, null);
}
{
  // And groups are isolated: two organisers must not share a draft.
  saveSetupDraft("grpA", null, draft);
  saveSetupDraft("grpB", null, draft);
  clearSetupDraft("grpA", null);
  ok("clearing one group leaves the other", loadSetupDraft("grpB", null) != null);
  clearSetupDraft("grpB", null);
  ok("and both can be cleared", loadSetupDraft("grpB", null) == null);
}

// ── clearing something that was never saved must not throw ───────────────
{
  let threw = false;
  try { clearSetupDraft("never-used", null); } catch { threw = true; }
  ok("clearing an absent draft is safe", !threw);
  ok("and still reads as absent", loadSetupDraft("never-used", null) == null);
}

console.log(`setup draft lifecycle: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
