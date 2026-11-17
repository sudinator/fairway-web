/** Livingston Early Morning Golfers — the 10 own-ball games of 2026 (exported Nov 17, 2026, standings_data_2026.sql),
 *  transcribed compactly: holes as [si, par] by hole number; players as [user, name, team, course handicap, index, rating, slope, scores]. */
import type { Game, Player } from "@/lib/game-types";

const U: Record<string, string> = {
  nihar: "79ce0874-179e-4fdb-bf8f-9146b02edd0f", sujoy: "34095622-5bab-41bb-b983-39b0f35b228f", gaurav: "9b8c13c0-c65b-43b0-a38d-d75ae6ac3d28", pavan: "f7f443c5-b1d4-462a-a854-27cfdd4f842e",
  sanjay: "3115c9b1-f639-4d77-9b50-beb2f688153a", masud: "9efce746-9fc0-42db-b1c0-946dbb1382b0", bk: "7afdee8d-4361-49da-a3b8-cc2585582426", sachin: "94916c8a-1913-41aa-bb78-c5c572716dbf",
  karan: "bbe388ee-dc27-4272-b450-a9f230563e38", probir: "e93f5a84-ef92-443e-9782-00d8224473ff", amit: "66cccf4b-bc8e-4895-a4ca-a33e61d2a79b", ashu: "a89d81d4-2b9d-4fd3-966b-4bd432354328",
  alok: "ea7e006c-1fcc-42d0-ac68-8fbdf9db1c16", preet: "97c52b0f-0849-4166-a3fd-094ac3b50a70", prateek: "f04017ba-5bf1-4c0c-bc86-03ad552f5fd4", rahul: "7ac70d31-2708-4050-ae60-ca831c220ed7",
  nitin: "907ddd0d-beb2-48e2-821c-3b48517d5e7b", pj: "6aa8654f-8f34-4716-9f79-4cb08cf729ef", rajat: "fa8d6132-6a75-432f-8df6-e78caf13551e", ankur: "22e1687a-c88d-49ba-9c12-dd1277e71cf4", sidd: "f74ddd81-cdf0-4107-ad86-979e274a068b",
  nikhil: "8259b466-f958-45c4-98bd-d552d9d2ca58", mihir: "960c25b2-5a95-43e8-820b-cc93d1e0c16a", mohan: "63e72ff1-b0d4-4db7-a055-bd8d8b7b833b", bhutani: "12728358-d597-404a-96e8-ef14dcf85ba7", manoj: "8c92e2e1-0f9e-4ca8-9d1b-ece4171d8577",
  jigar: "521c7979-e0ab-4495-b420-1ac12f56379e", sudhir: "07790c1b-86e7-4865-8933-9980580d9310", hparikh: "03d5516c-4a1d-45b4-a5cf-be601be3631a", vimal: "d4f84452-0228-466d-8d66-d591b4966696", karthik: "52d08ab4-016e-495b-8f87-135353d8eedf",
  amitjain: "53a8098c-5623-4823-a3e5-8f6a0dacf37a", nish: "a2e38f38-1188-4b3b-8941-e62664a692e7",
};
const NAME: Record<string, string> = { nihar: "Nihar Vasavada", sujoy: "Sujoy Menon", gaurav: "Gaurav Mathur", pavan: "Pavan Avula", sanjay: "Sanjay Rijhwani", masud: "A Masud", bk: "BK Jain", sachin: "Sachin Manchanda", karan: "Karan Sarin", probir: "Probir Rao", amit: "Amit Sud", ashu: "Ashutosh Rathore", alok: "Alok Jha", preet: "Preet Takkar", prateek: "Prateek Kumar Solanki", rahul: "Rahul Shah", nitin: "Nitin Patel", pj: "PJ Juvekar", rajat: "Rajat Beri", ankur: "Ankur Tiku", sidd: "Sidd Ghosh", nikhil: "Nikhil Mehta", mihir: "Mihir Mehta", mohan: "Mohan Reddy", bhutani: "Amit Bhutani", manoj: "Manoj Gupta", jigar: "Jigar Shukla", sudhir: "Sudhir Sirohy", hparikh: "H Parikh", vimal: "Vimal Narayanan", karthik: "Karthik Balakrishnan", amitjain: "Amit Jain", nish: "Nish Gajarawala" };

const weequahic = [[7,4],[17,3],[11,4],[13,3],[5,5],[1,5],[9,4],[15,3],[3,4],[14,3],[8,5],[12,4],[16,3],[10,4],[2,4],[6,5],[18,3],[4,4]];
const fbOld = [[5,4],[11,3],[7,4],[13,4],[17,3],[1,4],[15,4],[9,4],[3,4],[10,4],[8,4],[2,4],[6,4],[18,3],[16,5],[4,4],[12,3],[14,5]];
const fbNew = [[5,4],[11,3],[7,4],[13,4],[17,3],[1,4],[15,4],[9,4],[3,4],[10,4],[8,4],[2,4],[6,4],[18,3],[16,5],[4,4],[14,3],[12,5]];
const architects = [[11,5],[13,3],[5,5],[7,4],[9,4],[17,3],[3,4],[15,3],[1,4],[14,4],[10,5],[18,3],[6,5],[4,4],[2,4],[8,4],[16,3],[12,4]];
const bowling = [[17,4],[13,4],[9,3],[5,5],[15,4],[3,4],[1,4],[7,3],[11,5],[8,4],[18,3],[4,4],[14,4],[12,5],[16,4],[10,3],[6,4],[2,5]];
const holes = (h: number[][]) => h.map(([si, par], i) => ({ n: i + 1, si, par, yards: null }));
type P = [string, string | null, number, number | null, number, number, (number | null)[]];
const g = (id: string, name: string, type: string, played: string, par: number, h: number[][], extra: Record<string, unknown>, rows: P[]) => ({
  game: { id, code: id, name, game_type: type, status: "ended", played_at: played, course: name.split(" / ")[1] ?? name, course_par: par, holes_meta: holes(h), pairings: [], teams: null, foursomes: null, leg_config: null, flight_mode: null, stroke_basis: null, team_score_mode: "best_ball", allowance_pct: 100, group_id: "club", ...extra } as unknown as Game,
  players: rows.map(([k, team, ch, hi, rating, slope, scores]) => ({ id: `${id}:${k}`, game_id: id, user_id: U[k], display_name: NAME[k], is_guest: false, no_show: false, team, tee_group: 1, course_handicap: ch, course_handicap_source: hi == null ? "manual" : "derived", handicap_index: hi, rating, slope, scores, putts: [], fairways: [] }) as unknown as Player),
});
const F = (a: string[], b: string[], id: string, swap?: boolean) => ({ id, name: id, a: a.map((k) => U[k]), b: b.map((k) => U[k]), ...(swap ? { swap } : {}) });
const KJ = [{ key: "A", name: "Khiladi" }, { key: "B", name: "Jugadu" }];

export const REAL_2026 = [
  g("316975", "Match Play / Weequahic Golf Course / Jun 20, 2026", "trifecta", "2026-06-17", 70, weequahic, { allowance_pct: 85, teams: KJ, foursomes: [F(["nihar", "sujoy"], ["gaurav", "pavan"], "F1"), F(["sanjay", "masud"], ["bk", "sachin"], "F2"), F(["karan", "probir"], ["amit", "ashu"], "F3")] }, [
    ["ashu", "B", 7, 11, 66.4, 114, [5,4,4,3,4,6,4,4,4,3,5,4,3,6,4,5,3,6]], ["pavan", "B", 14, 17, 66.4, 114, [4,5,6,4,6,7,5,4,5,4,6,5,3,5,4,7,4,4]], ["bk", "B", 13, 16, 66.4, 114, [6,5,5,4,7,8,6,3,6,5,6,4,5,5,6,7,3,6]],
    ["karan", "A", 5, 8.8, 66.4, 114, [5,3,3,3,4,6,5,4,6,4,6,5,4,5,5,6,4,4]], ["amit", "B", 7, 11, 66.4, 114, [3,5,4,4,6,6,4,5,5,3,6,4,3,6,6,7,3,6]], ["probir", "A", 0, 3.2, 66.4, 114, [5,3,5,3,4,5,5,4,5,3,6,4,3,6,4,5,3,6]],
    ["sanjay", "A", 12, 15, 66.4, 114, [6,5,5,3,6,8,6,4,6,5,5,5,4,5,5,8,4,7]], ["sujoy", "A", 13, 16, 66.4, 114, [6,5,6,4,6,6,6,3,6,5,5,5,3,5,6,7,4,6]], ["nihar", "A", 17, 20, 66.4, 114, [6,4,5,3,7,7,5,4,6,5,7,5,5,5,5,7,4,5]],
    ["masud", "A", 10, 13, 66.4, 114, [6,4,5,3,5,6,5,4,5,4,6,5,4,5,5,6,3,5]], ["sachin", "B", 9, 12, 66.4, 114, [6,3,5,5,7,7,5,4,5,5,7,4,3,5,4,7,3,5]], ["gaurav", "B", 20, 23, 66.4, 114, [6,5,6,4,6,7,7,4,7,4,6,6,4,6,5,7,5,5]],
  ]),
  g("121208", "FB 6/21", "trifecta", "2026-06-21", 70, fbOld, { allowance_pct: 85, teams: [{ key: "A", name: "G+K" }, { key: "B", name: "A+A" }], foursomes: [F(["karan", "gaurav"], ["amit", "masud"], "F1", false)] }, [
    ["karan", "A", 14, 9, 72.9, 137, [4,5,5,4,4,5,5,5,4,5,5,4,6,3,6,4,4,5]], ["amit", "B", 16, 11, 72.9, 137, [5,4,5,6,5,6,5,5,5,5,5,5,5,4,6,6,4,5]], ["masud", "B", 19, 13, 72.9, 137, [4,4,6,6,4,6,5,7,4,6,6,6,4,3,6,7,4,6]], ["gaurav", "A", 28, 23, 70.9, 135, [6,6,5,7,4,6,5,5,6,6,6,8,6,5,7,6,5,7]],
  ]),
  g("635770", "Skins / Francis Byrne Golf Course / Jun 28, 2026", "stableford", "2026-06-28", 70, fbOld, { skins_mode: "carryover" }, [
    ["amit", null, 19, 13, 72.9, 137, [6,5,5,5,3,6,6,4,5,5,5,5,4,3,6,5,5,7]], ["ashu", null, 16, 11, 72.9, 137, [5,4,6,5,3,6,5,5,4,5,4,4,5,4,7,6,5,6]], ["sidd", null, 27, 20, 72.9, 137, [7,4,6,5,4,7,5,6,7,7,6,6,6,5,5,8,4,7]],
  ]),
  g("826246", "Trifecta / The Architects Golf Club / Jul 5, 2026", "trifecta", "2026-07-05", 71, architects, { allowance_pct: 90, team_score_mode: "aggregate", teams: KJ, leg_config: { metric: "pts", points: { B9: 0.5, F9: 0.5, Total: 1 }, scheme: "nines" }, foursomes: [F(["karan", "sachin"], ["ashu", "bk"], "F1"), F(["probir", "masud"], ["amit", "alok"], "F2"), F(["preet", "gaurav"], ["nihar", "prateek"], "F3")] }, [
    ["masud", "A", 16, 14, 71.5, 129, [4,4,5,5,5,3,5,4,6,5,6,5,7,5,5,4,4,4]], ["nihar", "B", 21, 20, 69.6, 127, [5,5,8,6,7,4,6,6,5,5,6,4,7,5,5,7,5,5]], ["sachin", "A", 13, 13, 69.6, 127, [7,3,7,7,4,4,6,4,5,5,6,3,5,3,4,5,3,4]],
    ["bk", "B", 17, 16, 69.6, 127, [5,4,6,6,4,5,7,5,4,5,6,5,7,4,6,6,3,6]], ["karan", "A", 11, 9, 71.5, 129, [4,4,7,6,4,3,4,4,5,6,5,4,6,5,5,4,4,5]], ["gaurav", "A", 28, 26, 69.6, 127, [7,4,6,5,5,4,7,4,7,6,7,5,6,6,8,5,3,6]],
    ["preet", "A", 23, 22, 69.6, 127, [6,6,6,7,4,4,4,4,7,5,6,4,7,5,5,7,5,5]], ["alok", "B", 15, 13, 71.5, 129, [6,3,5,4,5,3,4,4,7,6,5,3,6,5,5,6,3,6]], ["probir", "A", 4, 3, 71.5, 129, [4,5,5,5,4,3,4,3,5,5,6,5,4,5,5,5,3,5]],
    ["prateek", "B", 18, 17, 69.6, 127, [8,4,6,5,6,3,4,4,6,5,6,5,7,5,6,5,5,5]], ["amit", "B", 14, 12, 71.5, 129, [5,5,5,5,5,3,5,3,6,6,5,4,6,6,5,5,4,6]], ["ashu", "B", 12, 10, 71.5, 129, [5,4,5,5,4,3,4,3,5,4,5,4,7,5,5,6,3,4]],
  ]),
  g("957964", "Stableford / Francis Byrne Golf Course / Jul 10, 2026", "stableford", "2026-07-10", 70, fbOld, {}, [
    ["ashu", null, 16, 11, 72.9, 137, [5,5,5,5,4,5,4,5,6,4,4,6,5,5,5,null,null,null]], ["amit", null, 19, 13.6, 72.9, 137, [6,5,6,5,3,6,5,5,6,5,5,5,4,4,5,null,null,null]],
  ]),
  g("312906", "Bowling Green Ryder Cup", "trifecta", "2026-10-10", 72, bowling, { allowance_pct: 90, teams: [{ key: "A", name: "Red" }, { key: "B", name: "Blue" }], leg_config: { metric: "pts", points: {}, scheme: "none" }, flight_mode: "off", foursomes: [F(["nihar", "nikhil"], ["mihir", "mohan"], "G1", true), F(["karan", "bhutani"], ["probir", "manoj"], "G2"), F(["ashu", "jigar"], ["amit", "sudhir"], "G3"), F(["hparikh", "pavan"], ["sanjay", "gaurav"], "G4", true), F(["vimal", "karthik"], ["amitjain", "nish"], "G5", true)] }, [
    ["amitjain", "B", 18, 16.8, 70.2, 130, [6,6,4,6,5,6,6,5,7,5,4,6,6,5,6,3,6,7]], ["hparikh", "A", 24, 22, 70.2, 130, [5,6,5,6,6,5,6,4,7,6,4,6,4,5,6,5,6,6]], ["mihir", "B", 15, 15, 70.2, 130, [5,6,4,7,6,6,5,5,6,6,4,5,6,6,5,4,5,7]],
    ["nihar", "A", 20, 19, 70.2, 130, [5,5,4,6,6,6,6,4,7,5,5,6,6,6,5,5,6,7]], ["nikhil", "A", 17, 16, 70.2, 130, [4,3,5,7,5,5,7,5,7,4,4,6,6,7,5,5,4,6]], ["nish", "B", 20, 19, 70.2, 130, [6,6,5,7,5,6,6,5,7,6,3,5,5,7,5,5,6,6]],
    ["pavan", "A", 17, 16, 70.2, 130, [5,5,5,6,5,5,6,5,7,5,4,3,5,7,5,5,6,5]], ["mohan", "B", 25, 23, 70.2, 130, [6,5,5,8,5,7,6,4,7,6,3,4,6,7,6,4,6,8]], ["sanjay", "B", 17, 16.4, 70.2, 130, [6,6,4,7,6,6,6,3,7,5,4,4,5,5,6,4,6,6]],
    ["sudhir", "B", 25, 23.1, 70.2, 130, [6,6,5,8,6,4,6,5,7,6,5,4,7,6,6,4,5,7]], ["vimal", "A", 22, 21, 70.2, 130, [6,5,5,6,6,6,6,5,7,6,4,6,6,7,5,5,5,7]], ["jigar", "A", 26, 23.8, 70.2, 130, [6,6,5,8,5,6,6,6,6,6,5,4,6,7,4,5,7,5]],
    ["bhutani", "A", 29, 26.4, 70.2, 130, [6,7,5,6,5,6,6,5,8,5,4,4,6,7,5,5,5,7]], ["karthik", "A", 25, 23, 70.2, 130, [6,6,4,7,6,6,6,5,7,5,4,6,6,6,5,4,6,7]], ["gaurav", "B", 21, 20, 70.2, 130, [6,5,5,6,5,6,6,4,6,5,4,6,6,7,6,4,6,7]],
    ["ashu", "A", 9, 9, 71, 131, [4,4,3,6,5,4,5,5,6,4,4,4,5,5,4,4,6,6]], ["karan", "A", 6, 6.4, 71, 131, [5,4,3,4,5,5,5,5,5,6,4,6,4,4,5,3,4,6]], ["manoj", "B", 33, 30, 70.2, 130, [7,6,4,6,6,7,7,5,8,7,5,6,5,6,6,4,7,7]],
    ["probir", "B", 5, 4.9, 71, 131, [4,4,3,5,5,4,5,4,7,4,4,5,4,4,4,4,5,5]], ["amit", "B", 15, 14, 71, 131, [5,5,4,7,4,5,6,4,6,5,5,5,4,6,5,5,5,5]],
  ]),
  g("494730", "Stroke Play / Francis Byrne Golf Course / Oct 24, 2026", "stroke", "2026-10-24", 70, fbNew, { stroke_basis: "net", flight_mode: "off" }, [
    ["bk", null, 22, 18, 70.7, 132, [6,4,5,6,5,6,6,5,5,5,4,6,6,4,6,6,4,5]], ["amit", null, 20, 14.7, 72.3, 133, [8,4,6,6,5,5,5,5,5,4,6,5,4,4,6,6,4,4]], ["sanjay", null, 20, 16.8, 70.7, 132, [5,5,5,8,4,6,4,6,7,5,5,7,4,4,7,4,5,6]],
    ["rahul", null, 24, 19.6, 70.7, 132, [6,5,7,5,3,6,5,6,6,5,5,5,6,4,7,6,5,6]], ["probir", null, 8, 5.1, 72.3, 133, [4,4,4,5,2,5,6,4,5,4,3,6,6,5,5,4,4,5]], ["nihar", null, 23, 19.4, 70.7, 132, [5,4,6,6,4,7,7,7,7,4,6,6,7,5,6,7,5,6]],
    ["ashu", null, 14, 9.7, 72.3, 133, [5,4,5,5,4,6,5,5,5,5,5,6,4,5,7,5,4,6]], ["karan", null, 10, 6.4, 72.3, 133, [4,3,6,5,4,5,6,5,7,4,6,4,4,3,5,4,4,5]],
  ]),
  g("947286", "Stableford / Francis Byrne Golf Course / Oct 31, 2026", "stableford", "2026-10-31", 70, fbNew, { flight_mode: "off" }, [
    ["pj", null, 22, null, 70.7, 132, [5,4,6,3,3,7,5,5,7,5,5,5,5,3,8,6,5,6]], ["probir", null, 8, 5.1, 72.3, 133, [5,3,5,5,4,5,4,4,4,4,4,5,4,3,5,5,3,5]], ["rahul", null, 24, 19.6, 70.7, 132, [6,4,4,6,4,7,5,5,8,4,5,7,5,4,8,7,5,8]],
    ["rajat", null, 10, null, 72.3, 133, [5,2,6,5,5,4,4,5,5,4,6,5,5,4,6,4,3,6]], ["ashu", null, 13, 9, 72.3, 133, [6,3,6,5,5,5,5,5,7,4,4,5,6,5,5,6,4,4]], ["ankur", null, 18, 13, 72.3, 133, [5,5,5,4,5,4,6,7,5,7,5,7,4,4,4,6,5,6]],
    ["sanjay", null, 20, 16.8, 70.7, 132, [4,6,5,5,6,7,4,6,7,5,6,7,4,4,6,5,4,8]], ["amit", null, 20, 14.7, 72.3, 133, [5,5,5,6,6,6,5,5,6,4,5,6,5,4,7,5,4,7]],
  ]),
  g("729308", "Trifecta / Francis Byrne Golf Course / Nov 8, 2026", "trifecta", "2026-11-08", 70, fbNew, { allowance_pct: 85, flight_mode: "off", teams: [{ key: "A", name: "Ram" }, { key: "B", name: "Lakhan" }], foursomes: [F(["amit", "gaurav"], ["karan", "rahul"], "G1"), F(["probir", "alok"], ["ashu", "nitin"], "G2")] }, [
    ["ashu", "B", 12, 8.6, 72.3, 133, [6,3,5,5,6,6,5,5,4,5,4,5,5,4,5,6,4,6]], ["amit", "A", 20, 15, 72.3, 133, [5,5,5,3,4,4,5,5,5,4,5,5,5,4,5,5,4,5]], ["nitin", "B", 22, 18, 70.7, 132, [6,5,6,5,4,7,5,4,6,6,5,7,6,4,6,6,5,6]],
    ["rahul", "B", 24, 20, 70.7, 132, [5,5,6,6,3,4,5,6,7,6,6,7,7,5,6,6,5,6]], ["probir", "A", 7, 4.3, 72.3, 133, [4,4,4,4,4,4,4,4,5,5,5,5,5,3,5,5,4,5]], ["alok", "A", 17, 12.9, 72.3, 133, [4,6,7,6,4,5,6,5,4,5,4,5,3,3,6,5,3,5]],
    ["gaurav", "A", 24, 20, 70.7, 132, [5,4,7,6,4,7,5,6,7,5,5,6,7,3,6,7,4,7]], ["karan", "B", 10, 6.4, 72.3, 133, [5,4,5,5,3,5,5,4,6,4,5,4,5,4,6,4,4,5]],
  ]),
  g("677085", "Trifecta / Francis Byrne Golf Course / Nov 15, 2026", "trifecta", "2026-11-15", 70, fbNew, { allowance_pct: 85, flight_mode: "off", teams: [{ key: "A", name: "Blue" }, { key: "B", name: "Gold" }], foursomes: [F(["amit", "probir"], ["masud", "ashu"], "G1")] }, [
    ["probir", "A", 7, 4.2, 72.3, 133, [5,5,4,5,3,6,5,4,5,4,5,4,5,3,5,6,4,5]], ["ashu", "B", 12, 8.6, 72.3, 133, [4,4,4,5,2,5,6,6,7,4,4,5,5,3,7,5,3,5]], ["amit", "A", 19, 14.6, 72.3, 133, [7,5,5,6,3,6,5,5,7,4,4,6,5,3,5,7,3,6]], ["masud", "B", 17, 12.2, 72.3, 133, [6,4,5,4,5,7,6,5,6,4,4,4,4,4,5,6,4,8]],
  ]),
];
export const realGames = REAL_2026.map((x) => x.game);
export const realPlayersByGame: Record<string, Player[]> = Object.fromEntries(REAL_2026.map((x) => [x.game.id, x.players]));
