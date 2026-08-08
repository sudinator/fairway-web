// BASELINE — flightTagColor exactly as it was inlined in GameRoom before extraction (transcribed
// independently from tournaments.tsx). Used only by the differential test.
import { C } from "./golf";
export function flightTagColor(key: string): string {
  return key === "A" ? "#5AA9E6" : key === "B" ? C.gold : key === "C" ? "#8FE0B0" : key === "D" ? "#E0915B" : C.sage;
}
