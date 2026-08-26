/**
 * Rewrite `require("@/...")` in compiled test output to relative paths.
 *
 * tsc resolves the @/ alias for TYPES only — the emitted JavaScript keeps the literal specifier,
 * which Node cannot resolve. Without this, any test that imports a real component fails at
 * require time, which is what made the screens untestable in the first place.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = process.argv[2];
if (!root) {
  console.error("usage: patch_test_aliases.mjs <dir>");
  process.exit(1);
}

let patched = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".js")) {
      const src = readFileSync(p, "utf8");
      const depth = relative(root, p).split(sep).length - 1;
      const up = depth ? "../".repeat(depth) : "./";
      const out = src.replace(/require\("@\/(.*?)"\)/g, (_m, rest) => `require("${up}${rest}")`);
      if (out !== src) {
        writeFileSync(p, out);
        patched++;
      }
    }
  }
};
walk(root);
console.log(`patched ${patched} file(s) in ${root}`);
