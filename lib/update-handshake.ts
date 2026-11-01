import { updatesBlocked, holdUpdateInput, releaseUpdateInput } from "./update-safety";

/** The same responder is used by the live app and the two-release browser test. */
export function updateHandshake() {
  let request = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const receive = (e: MessageEvent) => {
    if (e.data?.kind === "bnn-update-check" && e.ports[0]) {
      const ready = !updatesBlocked();
      if (ready) {
        request = e.data.requestId;
        holdUpdateInput();
        clearTimeout(timer);
        timer = setTimeout(() => { request = ""; releaseUpdateInput(); }, 15000);
      }
      e.ports[0].postMessage({ ready });
    } else if (e.data?.kind === "bnn-update-release" && e.data.requestId === request) {
      request = ""; clearTimeout(timer); releaseUpdateInput();
    }
  };
  return { receive, dispose: () => { clearTimeout(timer); releaseUpdateInput(); } };
}
