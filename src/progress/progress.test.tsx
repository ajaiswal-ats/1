/* Empty states and scope wording of the four charts, rendered to HTML (test_2f.py "empty states" and info checks).
   The populated page is compared with 2h pixel for pixel by scripts/compare-progress.mjs. */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FIXTURE, TODAY, type Dataset } from "../data/fixtures";
import { pipelineModel, roleRows, scheduledCount, weeklyCounts, type RoleFilter } from "../reporting/metrics";
import { ByRole } from "./ByRole";
import { Pipeline } from "./Pipeline";
import { TimeInStage } from "./TimeInStage";
import { Weekly } from "./Weekly";

const none = () => {};
function render(data: Dataset, filter: RoleFilter = "all", includeOnHold = false) {
  const M = pipelineModel(data, filter, TODAY), role = data.roles.find((r) => r.id === filter) ?? null;
  const html = (el: React.ReactElement) => renderToStaticMarkup(el);
  return {
    pipeline: html(<Pipeline data={data} filter={filter} role={role} M={M} today={TODAY} view="reached" onView={none} />),
    roles: html(<ByRole data={data} filter={filter} rows={roleRows(data, filter, includeOnHold, "fewest")} includeOnHold={includeOnHold} sort="fewest" onIncludeOnHold={none} onSort={none} />),
    time: html(<TimeInStage data={data} filter={filter} role={role} M={M} today={TODAY} />),
    weekly: html(<Weekly filter={filter} weeks={weeklyCounts(data, filter)} scheduled={scheduledCount(data, filter)} />),
  };
}
const count = (s: string, sub: string) => s.split(sub).length - 1;

describe("empty states", () => {
  it("no data: Pipeline, Time and Weekly show their empty messages; open roles still appear with 'None shared yet'", () => {
    const h = render({ ...structuredClone(FIXTURE), subs: [], search: [], held: [], moves: [] });
    expect(h.pipeline).toContain('<div class="rempty">No candidates yet for this selection.</div>');
    expect(h.time).toContain('<div class="rempty">No completed stays yet for this selection.</div>');
    expect(h.weekly).toContain('<div class="rempty">No submissions or interviews held in these 6 weeks.</div>');
    expect(count(h.roles, 'class="rc-col"')).toBe(3);
    expect(count(h.roles, "None shared yet")).toBe(3);
    expect(h.weekly + h.time).not.toMatch(/wk-trend|tsa-who|tsa-ongoing/);
    for (const k of ["pipeline", "time", "weekly", "roles"] as const) expect(count(h[k], 'class="fo-info"'), k).toBe(1);
  });
  it("all roles on hold: 'No open roles right now.'", () => {
    const data = structuredClone(FIXTURE); data.roles.forEach((r) => (r.status = "On hold"));
    expect(render(data).roles).toContain('<div class="rempty">No open roles right now.</div>');
  });
  it("one on-hold role selected: says it is on hold and how to show it", () => {
    expect(render(FIXTURE, "rsm").roles).toContain("Regional Sales Manager is on hold. Tick &quot;Include on-hold roles&quot; to show it.");
  });
});

describe("scope wording", () => {
  const h = render(FIXTURE);
  it("Pipeline and Time in stage include every role, including on hold; the on-hold control applies to the role chart only", () => {
    for (const s of [h.pipeline, h.time]) {
      expect(s).toContain("every role, including roles that are on hold now");
      expect(s).toContain("applies only to Candidates by role");
    }
  });
  it("Weekly includes history from roles now on hold; the role chart names the hidden on-hold role", () => {
    expect(h.weekly).toContain("including roles that are on hold now, because these weeks have already happened");
    expect(h.roles).toContain("This control affects this chart only. Not shown now: Regional Sales Manager (on hold).");
  });
  it("no candidate names on the page", () => {
    const all = Object.values(h).join("");
    for (const n of FIXTURE.subs.map((s) => s.name.split(" ")[0])) expect(all).not.toContain(n);
  });
});
