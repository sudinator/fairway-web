// 212.135 (owner): the activity log names the device behind an action — a stable id and a decipherable name.
import { ok, report } from "./screen-harness";
import { deviceId, deviceName, DEVICE_ID_KEY } from "./device-identity";
import { clearLocalStateForSignOut } from "./sign-out";

const ls = window.localStorage; ls.clear();
const first = deviceId(ls);
ok(/^[0-9a-f-]{36}$/.test(first), `an id is minted once (${first})`);
ok(deviceId(ls) === first && ls.getItem(DEVICE_ID_KEY) === first, "and kept");
ls.setItem("bnn_app_boot_v1", "{}");
clearLocalStateForSignOut("someone", ls);
ok(ls.getItem(DEVICE_ID_KEY) === first && ls.getItem("bnn_app_boot_v1") === null, "sign-out keeps the device id while clearing the rest");
const ios = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1";
ok(deviceName(ios, true) === "iPhone - home-screen app", `the owner's phone reads as the home-screen app (got ${deviceName(ios, true)})`);
ok(deviceName(ios, false) === "iPhone - Safari", "the same phone in Safari says so");
ok(deviceName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", false) === "Windows PC - Chrome", "a Windows laptop in Chrome");
ok(deviceName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0", false) === "Windows PC - Edge", "Edge is not mistaken for Chrome");
ok(deviceName("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36", true) === "Android - home-screen app", "an Android phone");
ok(/^[\x20-\x7e]+$/.test(deviceName(ios, true)), "the name is plain ASCII (it travels as a request header)");
report("device identity");
