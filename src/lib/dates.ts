/* Date helpers shared by the Candidates page and the reports. Dates are ISO "YYYY-MM-DD" calendar days, compared as strings and counted in UTC
   so results do not depend on the viewer's time zone. */

const DAY = 864e5;
const ms = (s: string) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Calendar days from a to b. */
export const days = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY);

export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "12 Oct" */
export const fd = (s: string) => { const d = new Date(ms(s)); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
/** "Thu 15 Oct" */
export const fdw = (s: string) => { const d = new Date(ms(s)); return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };

export const inRange = (d: string, a: string, b: string) => d >= a && d <= b;

/** Mean rounded to one decimal place, or null when there is nothing to average (as in 2h). */
export const avg = (v: number[]) => (v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null);

/** The 6 full Monday-to-Sunday weeks before the week that contains `today` (UTC calendar days), oldest first. */
export function weeksBefore(today: string): [string, string][] {
  const monday = ms(today) - ((new Date(ms(today)).getUTCDay() + 6) % 7) * DAY;
  return Array.from({ length: 6 }, (_, i) => { const a = monday - (6 - i) * 7 * DAY; return [iso(a), iso(a + 6 * DAY)]; });
}

/** The 6 full Monday-to-Sunday weeks before the demo date, as in 2h: 31 Aug – 11 Oct 2026. */
export const WEEKS: [string, string][] = Array.from({ length: 6 }, (_, i) => {
  const a = ms("2026-08-31") + i * 7 * DAY;
  return [iso(a), iso(a + 6 * DAY)];
});
