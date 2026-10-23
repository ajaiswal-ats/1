/* Regression tests for the persistence bugs:
   1. A save in one tab overwrote actions another tab had saved (each tab appended to its own stale list).
   2. A malformed saved action (for example null, or a move without a note) crashed the app on load.
   3. With readable storage but failing writes, a second action dropped the first one's session-only change. */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { parseActions, replay, type DemoAction } from "../domain/actions";
import { DataProvider, useData } from "./DataProvider";
import { DEMO_KEY, loadSaved, refresh, saveAction, shown, type DemoState } from "./demoStore";
import { FIXTURE, TODAY } from "./fixtures";

/** One browser's localStorage, shared by every tab. */
function browserStorage(initial?: string) {
  const m = new Map<string, string>(initial === undefined ? [] : [[DEMO_KEY, initial]]);
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), saved: () => JSON.parse(m.get(DEMO_KEY) ?? "null") };
}
const decline = (sid: string): DemoAction => ({ type: "decline", sid, text: "Not the right fit.", cat: "No category", d: TODAY });
const move = (sid: string, to: "To review" | "Interview" | "Offer" | "Hired"): DemoAction => ({ type: "move", sid, to, note: "", d: TODAY });
const stage = (actions: unknown, sid: string) => replay(FIXTURE, actions).data.subs.find((s) => s.id === sid)!.stage;

describe("saves from two tabs", () => {
  const opened = (store: ReturnType<typeof browserStorage>): DemoState => ({ stored: loadSaved(store)!, unsaved: [] });
  it("a save in a tab that loaded earlier keeps what the other tab saved since", () => {
    const store = browserStorage();
    const tabA = opened(store), tabB = opened(store); /* both tabs open with nothing saved */
    const a = saveAction(store, FIXTURE, decline("tb-isl"), tabA);
    const b = saveAction(store, FIXTURE, move("pr-isl", "Interview"), tabB); /* tab B still holds its old, empty list */
    expect([a.saved, b.saved]).toEqual([true, true]);
    expect(store.saved()).toEqual([decline("tb-isl"), move("pr-isl", "Interview")]);
    expect(shown(b.state)).toEqual(store.saved()); /* tab B now shows both */
    expect([stage(store.saved(), "tb-isl"), stage(store.saved(), "pr-isl")]).toEqual(["Declined", "Interview"]);
  });
  it("an action another tab has made impossible is refused and saves nothing", () => {
    const store = browserStorage(), tabB = opened(store);
    saveAction(store, FIXTURE, decline("en-pa"), opened(store));
    const b = saveAction(store, FIXTURE, move("en-pa", "Offer"), tabB);
    expect(b.saved).toBe(false);
    expect(store.saved()).toEqual([decline("en-pa")]);
    expect(stage(shown(b.state), "en-pa")).toBe("Declined"); /* tab B is refreshed to the saved state */
  });
  it("the same decline from two tabs is saved once", () => {
    const store = browserStorage(), tabA = opened(store), tabB = opened(store);
    saveAction(store, FIXTURE, decline("tb-isl"), tabA);
    expect(saveAction(store, FIXTURE, decline("tb-isl"), tabB).saved).toBe(false);
    expect(store.saved()).toHaveLength(1);
  });
  it("saved entries already in storage, valid or not, are kept when a new action is added", () => {
    const store = browserStorage(JSON.stringify([null, decline("tb-isl")]));
    saveAction(store, FIXTURE, move("ab-fsr", "Offer"), opened(store));
    expect(store.saved()).toEqual([null, decline("tb-isl"), move("ab-fsr", "Offer")]);
  });
  it("another tab's save is picked up without losing this tab's unsaved actions", () => {
    const store = browserStorage(JSON.stringify([decline("tb-isl")]));
    expect(refresh(store, { stored: [], unsaved: [decline("en-pa")] })).toEqual({ stored: [decline("tb-isl")], unsaved: [decline("en-pa")] });
  });
  it("if storage cannot be read or written, the tab's own actions are used and the change still applies for this visit", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    const r = saveAction(broken, FIXTURE, move("ab-fsr", "Offer"), { stored: [decline("tb-isl")], unsaved: [] });
    expect(r).toEqual({ saved: true, state: { stored: [decline("tb-isl")], unsaved: [move("ab-fsr", "Offer")] } });
  });
});

/* Regression: storage could be read but writes threw (QuotaExceededError). Each save re-read the unchanged saved list
   and dropped the previous unsaved action, so after declining Taylor and then Elena, Taylor was back in To review. */
describe("readable storage, failing writes (storage full)", () => {
  function fullStorage(initial: unknown[] = []) {
    const s = browserStorage(JSON.stringify(initial));
    return { ...s, setItem: () => { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); } };
  }
  it("two successive declines both stay applied, and storage is left as it was", () => {
    const store = fullStorage();
    let state: DemoState = { stored: loadSaved(store)!, unsaved: [] };
    for (const sid of ["tb-isl", "en-pa"]) { const r = saveAction(store, FIXTURE, decline(sid), state); expect(r.saved).toBe(true); state = r.state; }
    expect([stage(shown(state), "tb-isl"), stage(shown(state), "en-pa")]).toEqual(["Declined", "Declined"]);
    expect(state).toEqual({ stored: [], unsaved: [decline("tb-isl"), decline("en-pa")] });
    expect(store.saved()).toEqual([]);
  });
  it("valid saved actions stay applied underneath the unsaved ones", () => {
    const store = fullStorage([move("ab-fsr", "Offer")]);
    let state: DemoState = { stored: loadSaved(store)!, unsaved: [] };
    state = saveAction(store, FIXTURE, decline("tb-isl"), state).state;
    state = saveAction(store, FIXTURE, decline("en-pa"), state).state;
    expect(["ab-fsr", "tb-isl", "en-pa"].map((sid) => stage(shown(state), sid))).toEqual(["Offer", "Declined", "Declined"]);
  });
  it("an unsaved action still blocks a conflicting one: Taylor cannot be declined twice", () => {
    const store = fullStorage();
    const first = saveAction(store, FIXTURE, decline("tb-isl"), { stored: [], unsaved: [] });
    expect(saveAction(store, FIXTURE, decline("tb-isl"), first.state).saved).toBe(false);
  });
  it("once writing works again, the unsaved actions are written with the next one, in order", () => {
    const m = new Map<string, string>([[DEMO_KEY, "[]"]]);
    let full = true;
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { if (full) throw new DOMException("full", "QuotaExceededError"); m.set(k, v); } };
    let state: DemoState = { stored: [], unsaved: [] };
    state = saveAction(store, FIXTURE, decline("tb-isl"), state).state;
    full = false;
    state = saveAction(store, FIXTURE, decline("en-pa"), state).state;
    expect(JSON.parse(m.get(DEMO_KEY)!)).toEqual([decline("tb-isl"), decline("en-pa")]);
    expect(state).toEqual({ stored: [decline("tb-isl"), decline("en-pa")], unsaved: [] });
  });
});

describe("malformed saved actions", () => {
  const valid = [decline("tb-isl"), move("ab-fsr", "Offer"), { type: "feedback", sid: "tb-rsm", about: "Interview on 6 Oct", text: "Good.", d: TODAY }];
  const malformed = [
    null, 42, "decline", [], {},
    { type: "move", sid: "pr-isl", to: "Interview", d: TODAY },                 /* no note: crashed when applied */
    { type: "move", sid: "pr-isl", to: "Declined", note: "", d: TODAY },        /* not a move target */
    { type: "move", sid: "pr-isl", to: "Interview", note: "", times: 3, d: TODAY },
    { type: "decline", sid: "en-pa", text: 7, cat: "No category", d: TODAY },   /* text not a string: crashed in validation */
    { type: "decline", sid: "en-pa", text: "x", d: TODAY },                     /* no category */
    { type: "feedback", sid: "je-isl", text: "x", d: TODAY },                   /* no "about" */
    { type: "move", sid: 5, to: "Offer", note: "", d: TODAY },
    { type: "move", sid: "je-isl", to: "Offer", note: "", d: "yesterday" },
    { type: "move", sid: "je-isl", to: "Offer", note: "", d: "2026-13-45" },
    { type: "archive", sid: "je-isl", d: TODAY },
  ];
  it("only well-formed actions are read, in their saved order", () => {
    expect(parseActions([malformed[0], valid[0], ...malformed.slice(1), valid[1], valid[2]])).toEqual(valid);
    for (const raw of [null, undefined, {}, "[]", 3]) expect(parseActions(raw)).toEqual([]);
  });
  it("replaying malformed entries never throws, and the valid ones still take effect", () => {
    for (const m of malformed) expect(() => replay(FIXTURE, [m]), JSON.stringify(m)).not.toThrow();
    const r = replay(FIXTURE, [...malformed, ...valid]);
    expect(r.applied).toEqual(valid);
    expect(r.data).toEqual(replay(FIXTURE, valid).data);
  });
  it("unreadable saved text gives an empty list instead of an error", () => {
    expect(loadSaved(browserStorage("{not json"))).toEqual([]);
    expect(loadSaved(browserStorage('{"a":1}'))).toEqual([]);
    expect(loadSaved(browserStorage())).toEqual([]);
  });

  afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage; });
  it("the app renders with malformed saved data and shows the valid saved changes", () => {
    (globalThis as { localStorage?: unknown }).localStorage = browserStorage(JSON.stringify([...malformed, decline("tb-isl")]));
    const Probe = () => <b>{useData().subs.find((s) => s.id === "tb-isl")!.stage}</b>;
    expect(renderToStaticMarkup(<DataProvider><Probe /></DataProvider>)).toBe("<b>Declined</b>");
  });
});
