// recharts Bar `shape` plumbing helper.
// recharts builds each bar's shape props as { ...entry, value: value[1], payload: entry } — i.e.
// props.value is the numeric bar value, while props.payload is a WRAPPER around the datum, NOT the
// datum itself. So props.payload[key] is usually undefined (the real row sits at props.payload.payload).
// Reading it wrong silently yields one uniform color for conditional bars (regression fixed here).
// Prefer props.value; fall back through the payload nesting only if needed.
export function barShapeValue(props: any, key?: string): number | null {
  if (props && typeof props.value === "number") return props.value;
  if (Array.isArray(props?.value) && typeof props.value[props.value.length - 1] === "number") {
    return props.value[props.value.length - 1];
  }
  const p = props?.payload;
  if (p && key) {
    if (typeof p[key] === "number") return p[key];
    if (p.payload && typeof p.payload[key] === "number") return p.payload[key];
  }
  return null;
}
