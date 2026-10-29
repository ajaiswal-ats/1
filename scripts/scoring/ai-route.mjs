/* AI routes for the local assessment flow (replaceable: the local CLI route is not the eventual hosted backend).
   A route takes { system, user, schema } and returns { ok, output, raw, meta } or { ok: false, error, meta }. It never
   repairs or invents output; validation happens afterwards (src/scoring/aiAssessment.ts).
   Routes:
   - "claude-cli": the installed Claude Code command line, non-interactive, signed in with the user's claude.ai
     subscription. No tools, structured output, no saved session, a hard spending cap per run, and an environment with
     no API keys so it can only use the subscription login. Rate-limit or usage-limit errors stop the run (no retry).
   - "synthetic-test": returns a fixed fictional output from a file. For tests only; it is labelled as not AI.
   Selected by SCORING_AI_ROUTE; nothing is called when no route is configured. */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";

const KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "OPENAI_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"];

/** The configured route, or null with the reason no route can be used. */
export function routeFromEnv(env = process.env) {
  const id = env.SCORING_AI_ROUTE;
  if (!id) return { route: null, reason: "No AI route is configured for this local server (set SCORING_AI_ROUTE)." };
  if (id === "claude-cli") {
    const model = env.SCORING_AI_MODEL || "sonnet", cap = Number(env.SCORING_AI_MAX_USD || "1");
    if (!(cap > 0 && cap <= 5)) return { route: null, reason: "SCORING_AI_MAX_USD must be between 0 and 5 dollars per run." };
    return { route: claudeCli({ bin: env.SCORING_AI_CLI || "claude", model, cap, timeoutMs: Number(env.SCORING_AI_TIMEOUT_MS || 420000) }) };
  }
  if (id === "synthetic-test") {
    if (!env.SCORING_AI_FIXTURE) return { route: null, reason: "The synthetic test route needs SCORING_AI_FIXTURE." };
    return { route: syntheticTest(env.SCORING_AI_FIXTURE, Number(env.SCORING_AI_DELAY_MS || 0)) };
  }
  return { route: null, reason: `Unknown AI route "${id}".` };
}

/* `delayMs`: waits before answering, to imitate a slow AI route in tests (no AI is called). */
function syntheticTest(file, delayMs = 0) {
  return {
    id: "synthetic-test", isAi: false, label: "Synthetic test route (not AI): returns a fixed, invented output",
    async run() {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      const raw = fs.readFileSync(file, "utf8");
      try { return { ok: true, output: JSON.parse(raw), raw, meta: { route: "synthetic-test", models: [], costUsd: 0 } }; }
      catch { return { ok: false, error: "The synthetic output is not valid JSON.", raw, meta: { route: "synthetic-test" } }; }
    },
  };
}

/** The Claude Code CLI as an AI route (subscription login only). */
export function claudeCli({ bin, model, cap, timeoutMs }) {
  return {
    id: "claude-cli", isAi: true, label: `Claude (${model}) through the Claude Code command line, using the signed-in claude.ai subscription; spending cap $${cap} per run`,
    run({ system, user, schema }) {
      const env = { ...process.env };
      for (const k of KEYS) delete env[k];
      /* An empty working folder: no project instructions, settings or files are loaded or reachable. */
      const cwd = fs.mkdtempSync(`${os.tmpdir()}/scoring-ai-`);
      const args = ["-p", "--output-format", "json", "--json-schema", JSON.stringify(schema), "--system-prompt", system, "--tools", "", "--model", model,
        "--max-budget-usd", String(cap), "--no-session-persistence", "--setting-sources", "local", "--disable-slash-commands", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}'];
      return new Promise((resolve) => {
        const started = Date.now(), child = spawn(bin, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
        let out = "", err = "", done = false;
        const finish = (r) => { if (done) return; done = true; clearTimeout(timer); fs.rmSync(cwd, { recursive: true, force: true }); resolve({ ...r, meta: { route: "claude-cli", requestedModel: model, capUsd: cap, durationMs: Date.now() - started, ...r.meta } }); };
        const timer = setTimeout(() => { child.kill("SIGTERM"); finish({ ok: false, error: `The AI route did not finish within ${Math.round(timeoutMs / 1000)} seconds.`, meta: {} }); }, timeoutMs);
        child.stdout.on("data", (d) => { out += d; });
        child.stderr.on("data", (d) => { err += d; });
        child.on("error", (e) => finish({ ok: false, error: e.code === "ENOENT" ? "The Claude command line is not installed or not on PATH." : "The AI route could not be started.", meta: {} }));
        child.on("close", (code) => {
          let j = null;
          try { j = JSON.parse(out); } catch { /* reported below */ }
          const meta = j ? { models: Object.keys(j.modelUsage ?? {}), costUsd: j.total_cost_usd ?? null, subtype: j.subtype ?? null, sessionPersisted: false, numTurns: j.num_turns ?? null } : {};
          const text = `${j?.result ?? ""} ${err}`;
          if (/rate.?limit|usage limit|limit reached|quota|overloaded|credit/i.test(text) && (!j || j.is_error)) return finish({ ok: false, error: "The AI route reported a usage or rate limit. Stopped without retrying.", meta });
          if (!j) return finish({ ok: false, error: code === 0 ? "The AI route returned output that is not JSON." : `The AI route failed (exit code ${code}).`, raw: out.slice(0, 2000), meta });
          if (j.is_error || j.subtype !== "success") return finish({ ok: false, error: j.subtype === "error_max_budget_usd" ? `The run reached its $${cap} spending cap and was stopped.` : `The AI route reported an error (${j.subtype ?? "unknown"}).`, raw: out, meta });
          let output = j.structured_output ?? null;
          if (!output && typeof j.result === "string") { try { output = JSON.parse(j.result.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { /* reported */ } }
          if (!output) return finish({ ok: false, error: "The AI route did not return the required structured output.", raw: out, meta });
          finish({ ok: true, output, raw: out, meta });
        });
        child.stdin.end(user);
      });
    },
  };
}
