/** 212.72 (owner, Oct 29): the live scores link takes the same readable form as the line-up link (the server resolves it). */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { ShareLinks } from "@/components/game/setup/one-step";
const t = renderScreen(<ShareLinks lineupToken="oak-hollow-oct25-k7m2px" liveToken="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" onShare={async () => {}} />);
const txt = t.el.textContent || "";
ok(txt.includes("/lineup/oak-hollow-oct25-k7m2px") && txt.includes("/live/oak-hollow-oct25-k7m2px"), `both links use the readable slug (got "${txt.match(/\/(lineup|live)\/[^\s]+/g)?.join(" ")}")`);
ok(!txt.includes("0123456789abcdef"), "the long private token is never shown");
t.unmount();
report("share links form");
