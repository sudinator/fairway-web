function assert(v: unknown, msg = "assertion failed"): asserts v { if (!v) throw new Error(msg); }
function assertEqual(a: unknown, b: unknown) { if (a !== b) throw new Error(`expected ${String(a)} === ${String(b)}`); }

import { BoundedTtlCache } from "./ttl-cache";
const c = new BoundedTtlCache<number>(2, 100);
c.set("a", 1, 0); c.set("b", 2, 0);
assertEqual(c.get("a", 50), 1);
c.set("c", 3, 50);
assertEqual(c.get("b", 50), undefined);
assertEqual(c.get("a", 99), 1);
assertEqual(c.get("a", 100), undefined);
assert(c.size <= 2);
console.log("ttl-cache tests passed");
