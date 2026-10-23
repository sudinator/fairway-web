// Preloaded by ci/test-ticking-clock.cjs: Date.now() advances 1 ms on every read (a slow CI runner, made certain).
let t = Date.now(); Date.now = () => (t += 1);
