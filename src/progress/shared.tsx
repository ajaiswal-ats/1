import type { ReactNode } from "react";
import type { Role, Stage } from "../data/fixtures";

/* Small pieces shared by the four Hiring progress charts, matching 2h's markup. */

export const stageColor = (s: Stage) =>
  ({ "To review": "var(--ramp-1)", Interview: "var(--ramp-2)", Offer: "var(--ramp-3)", Hired: "var(--ramp-4)", Declined: "var(--seg-grey)" })[s];
/** Text colour on a stage segment. */
export const stageText = (s: Stage) => (s === "To review" ? "#0d2342" : "#fff");

export const plural = (n: number, one: string, many = one + "s") => (n === 1 ? one : many);

export function EmptyBox({ children }: { children: ReactNode }) {
  return <div className="rempty">{children}</div>;
}

export function Swatch({ color, className }: { color?: string; className?: string }) {
  return <i className={"sw" + (className ? " " + className : "")} style={color ? { background: color } : undefined} />;
}

export function Legend({ items, className }: { items: [string, string][]; className?: string }) {
  return (
    <div className={"legend" + (className ? " " + className : "")}>
      {items.map(([label, color]) => <span key={label}><Swatch color={color} />{label}</span>)}
    </div>
  );
}

export const SEARCH_LEGEND: [string, string][] = [["Revenue Optics search", "var(--seg-grey)"], ["Shared with you", "var(--s1)"]];

export function ChartHead({ title, hint, children }: { title: string; hint: string; children?: ReactNode }) {
  return <div className="fo-h"><div><h2>{title}</h2><p className="fo-hint">{hint}</p></div>{children}</div>;
}

export function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{text}</button>)}
    </div>
  );
}

/** "How this is counted": definitions, then the chart's numbers as a table. */
export function CountingInfo({ items, head, rows }: { items: ReactNode[]; head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="fo-info">
      <summary><span className="fo-i" aria-hidden="true">i</span>How this is counted</summary>
      <ul className="defs">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
      <div className="ltab-wrap">
        <table className="rtab" style={{ marginTop: 8 }}>
          <thead><tr>{head.map((h, i) => <th key={i} className={i ? "n" : ""}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, j) => <tr key={j}>{r.map((x, i) => <td key={i} className={i ? "n" : ""}>{x}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

/** The "Roles included" line on Pipeline and Time in stage. */
export function rolesIncludedItem(role: Role | null): ReactNode {
  const scope = role ? `${role.title}${role.status !== "Open" ? " (on hold now)" : ""}` : "every role, including roles that are on hold now";
  return <><b>Roles included:</b>{` ${scope}. The "Include on-hold roles" control applies only to Candidates by role.`}</>;
}
