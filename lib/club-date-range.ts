/** Format civil period dates without changing them in the viewer's time zone. */
export function formatClubDateRange({ from, to }: { from: string; to: string }): string {
  const parse = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
  };
  const start = parse(from), end = parse(to);
  if (!start || !end || from > to) return "Dates unavailable";
  const differentYears = start.getUTCFullYear() !== end.getUTCFullYear();
  const display = (date: Date) => date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", ...(differentYears ? { year: "numeric" } : {}) });
  return `${display(start)} – ${display(end)}`;
}
