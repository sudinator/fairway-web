function eq(a: unknown, b: unknown, m: string) { if (a !== b) throw new Error(`${m}: expected ${b}, got ${a}`); }
import { shouldResumeGame } from "./draft";
// 210.11 (owner): open into an unfinished game while it's still being played — never into a finished one.
eq(shouldResumeGame("active", "active"), true, "a game still being played: resume it");
eq(shouldResumeGame("ended", "active"), false, "finished (even if this phone's copy still says active — finished on another phone): open the dashboard");
eq(shouldResumeGame(null, "active"), false, "the game no longer exists: open the dashboard");
eq(shouldResumeGame(undefined, "ended"), false, "offline, and this phone knows it finished: open the dashboard");
eq(shouldResumeGame(undefined, "active"), true, "offline, mid-round: resume (scoring must work without signal)");
eq(shouldResumeGame(undefined, undefined), true, "offline, nothing known: resume, as before");
console.log("resume-game tests passed");
