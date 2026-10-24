/* The development test-run recorder: only whitelisted fields, local requests only, file readable by the owner only. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cleanEntry, createRunFile, isLocalRequest } from "./move-record-lib.mjs";

const KEY = "0b0a3f5e-8f4c-4c38-9a77-1d2b3c4d5e6f", SUB = "8edf003b-eec6-0899-c724-5047e76ef68f";
const sent = { phase: "sent", key: KEY, submission_id: SUB, expected_version: 1, seen_stage: "To review", to_stage: "Interview", attempt: 0 };

describe("record entries", () => {
  it("keeps exactly the allowed fields, with a server time", () => {
    expect(cleanEntry(sent)).toEqual({ ...sent, at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
    expect(cleanEntry({ phase: "outcome", key: KEY, submission_id: SUB, outcome: "error:version_conflict" })).toMatchObject({ outcome: "error:version_conflict" });
    expect(cleanEntry({ phase: "outcome", key: KEY, submission_id: SUB, outcome: "uncertain" })).toMatchObject({ outcome: "uncertain" });
  });
  it("rejects anything else, including an entry carrying a token or password", () => {
    const bad = [
      { ...sent, access_token: "eyJhbGciOi" }, { ...sent, password: "x" }, { ...sent, key: "not-a-uuid" }, { ...sent, submission_id: "s11" },
      { ...sent, to_stage: "Shortlisted" }, { ...sent, seen_stage: undefined }, { ...sent, expected_version: 0 }, { ...sent, attempt: -1 },
      { phase: "outcome", key: KEY, submission_id: SUB, outcome: "ok; drop table" }, { phase: "other" }, null, [], "text",
    ];
    for (const b of bad) expect(cleanEntry(b), JSON.stringify(b)).toBeNull();
  });
});

describe("run file", () => {
  it("is created on the first entry, readable only by its owner, and rewritten whole after every entry", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-moves-")), f = createRunFile(dir, "abcdefghijklmnopqrst");
    expect(fs.existsSync(f.file)).toBe(false);
    f.append(cleanEntry(sent));
    f.append(cleanEntry({ phase: "outcome", key: KEY, submission_id: SUB, outcome: "ok" }));
    expect(fs.statSync(f.file).mode & 0o777).toBe(0o600);
    const run = JSON.parse(fs.readFileSync(f.file, "utf8"));
    expect(run).toMatchObject({ kind: "ui-moves", project: "abcdefghijklmnopqrst", entries: [{ phase: "sent", key: KEY }, { phase: "outcome", outcome: "ok" }] });
    expect(path.basename(f.file)).toMatch(/^ui-moves-\d{8}T\d{6}-[0-9a-f]{8}\.json$/);
  });
});

describe("local requests only", () => {
  it("accepts the local dev server, refuses other hosts and web origins", () => {
    expect(isLocalRequest({ host: "127.0.0.1:5173", origin: "http://127.0.0.1:5173" })).toBe(true);
    expect(isLocalRequest({ host: "127.0.0.1:5173" })).toBe(true);
    expect(isLocalRequest({ host: "127.0.0.1:5173", origin: "https://evil.example" })).toBe(false);
    expect(isLocalRequest({ host: "192.168.1.5:5173", origin: "http://192.168.1.5:5173" })).toBe(false);
  });
});
