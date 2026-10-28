/**
 * The MCP server, tested as shipped: the same core and HTTP handler Netlify runs,
 * over the same exported corpus.
 *
 * Most of what matters here is the honesty contract, not the protocol. A warning
 * that fails to travel with its text, or a "MANDATORY" quote that is not word for
 * word what the corpus holds, would pass any protocol check and still mislead.
 */
import { readFileSync } from "node:fs";

process.env.MCP_KEY = "test-key";
// @ts-expect-error - plain ES module, deliberately untyped: the deploy has no build step
const { handleMessage, TOOLS, OUT_OF_SCOPE } = await import("../netlify/functions/mcp/core.mjs");
// @ts-expect-error - as above
const { default: http } = await import("../netlify/functions/mcp/mcp.mjs");

const failures: string[] = [];
const check = (ok: unknown, what: string) => { if (!ok) failures.push(what); };

let nextId = 1;
const call = (name: string, args: Record<string, unknown> = {}) => {
  const res = handleMessage({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } });
  return { text: res.result?.content?.[0]?.text ?? "", isError: res.result?.isError, error: res.error };
};

// --- protocol ------------------------------------------------------------------
const init = handleMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
check(init.result?.protocolVersion === "2025-06-18", "initialize should echo a supported protocol version");
check(init.result?.capabilities?.tools, "initialize should declare tools");
check(/verbatim/i.test(init.result?.instructions ?? ""), "server instructions should ask for verbatim quotes");

const odd = handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } });
check(odd.result?.protocolVersion !== "1999-01-01", "an unknown protocol version should get our own latest back");

check(handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }) === null, "notifications get no response");
check(handleMessage({ jsonrpc: "2.0", id: 2, method: "nope" }).error?.code === -32601, "unknown method is -32601");

const listed = handleMessage({ jsonrpc: "2.0", id: 3, method: "tools/list" }).result?.tools ?? [];
check(listed.length === TOOLS.length, "tools/list should list every tool");
check(listed.every((t: Record<string, unknown>) => !("run" in t) && t.inputSchema), "tools/list must not leak implementations, and needs schemas");

// --- honesty contract -------------------------------------------------------------
const tcop = call("search_guidance", { question: "spend control process", source_id: "tcop" });
check(!tcop.isError, "search restricted to tcop should succeed");
check(/WARNING \(SUPERSEDED/.test(tcop.text), "a tcop result must carry the curated supersession warning in the same result");
check(/Cite inline as: \(\[[^\]]+\]\(https:\/\/www\.gov\.uk\/[^)]+\)\)/.test(tcop.text), "every result needs an inline-ready GOV.UK citation");
check(/Do not add a sources or references list/.test(tcop.text), "results should repeat the inline citation rule");
check(/Cite inline, never at the end/.test(init.result?.instructions ?? ""), "server instructions should ask for inline citations");
check(/page last updated|page date unknown/.test(tcop.text), "every result must be dated, even fresh ones");

const empty = call("search_guidance", { question: "zzqxv flibbertigibbet" });
check(/No match in the corpus/.test(empty.text) && /gap/.test(empty.text), "an empty search must say it is a gap, not an answer");
check(/no matches in corpus/.test(empty.text), "absent words should be declared");

const pilot = call("search_guidance", { question: "light touch governance for a pilot" });
check(/Also searched for/.test(pilot.text), "concept expansion must be declared, as it is on screen");

// Every MANDATORY line must be word for word a sentence the corpus holds.
const obligations = Object.values(JSON.parse(readFileSync(new URL("../assets/data/obligations.json", import.meta.url), "utf8"))).flat() as { sentence: string }[];
const held = new Set(obligations.map((o) => o.sentence));
let quoted = 0;
for (const q of ["must", "business case approval", "assurance review", "service standard", "risk management"]) {
  for (const m of call("search_guidance", { question: q, limit: 10 }).text.matchAll(/^- \[MANDATORY\] "(.*)"(?: \(informal.*\))?$/gm)) {
    quoted++;
    check(held.has(m[1]), `mandatory quote not verbatim from corpus: "${m[1].slice(0, 80)}"`);
  }
}
check(quoted > 0, "expected at least one MANDATORY quote across the sample questions");

// --- other tools -------------------------------------------------------------------
const src = call("get_source", { source_id: "tcop" });
check(/Canonical URL: https:\/\/www\.gov\.uk/.test(src.text) && /supersedes/.test(src.text), "get_source should give the URL and curated relations");
check(call("get_source", { source_id: "no-such-source" }).isError === true, "an unknown source is a tool error the model can read");
const lonely = call("get_source", { source_id: "nao-reports" });
check(/not under the Open Government Licence/.test(lonely.text), "NAO should be explained as link-only");

const cov = call("coverage");
check(/NOT INDEXED/.test(cov.text) && /No curated relationships/.test(cov.text), "coverage must state what is missing, not only what is there");
check(/## Out of scope \(by design\)[\s\S]*NHS-specific[\s\S]*## No curated relationships/.test(cov.text),
  "coverage must state what is out of scope, between the spines and the relationship gaps");
// The README carries the same list for people who never call coverage.
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
check((OUT_OF_SCOPE as string[]).every((x) => readme.includes(x)), "README must carry the same out-of-scope list as coverage");

const changes = call("recent_changes", { days: 730 });
check(/publisher's own words/.test(changes.text) && /\*\*\d{4}-\d{2}-\d{2}\*\*/.test(changes.text), "recent_changes should list dated notes");

// --- HTTP ---------------------------------------------------------------------------
// Capture every line the handler writes, so the logs can be checked as well as quieted.
const logged: string[] = [];
const quiet = console.log;
console.log = (...a: unknown[]) => { logged.push(a.join(" ")); };
const lastLog = () => JSON.parse(logged.at(-1) ?? "{}");

const post = (body: unknown, url = "https://x/mcp?key=test-key", headers: Record<string, string> = {}) =>
  http(new Request(url, { method: "POST", headers: { "content-type": "application/json", "user-agent": "Claude-User", ...headers }, body: JSON.stringify(body) }));
const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-ai", version: "0.1.0" } } };

const viaQuery = await post(initialize);
check(viaQuery.status === 200, "query key should work");
const initLog = lastLog();
check(initLog.event === "mcp" && initLog.key === "tester" && initLog.auth === "query" && initLog.status === 200, "the log line should record the key's label and how it arrived");
check(initLog.client?.name === "claude-ai" && initLog.client?.version === "0.1.0", "an initialize should log the client's name and version");
check(initLog.ua === "Claude-User" && typeof initLog.ms === "number", "the log line should carry the user agent and the time taken");

check((await post(initialize, "https://x/mcp", { authorization: "Bearer test-key" })).status === 200, "bearer key should work");
check(lastLog().auth === "header", "a bearer key should log as arriving by header");
check((await post(initialize, "https://x/mcp?key=wrong", { authorization: "Bearer test-key" })).status === 200, "the header should win over the query");

const noKey = await post(initialize, "https://x/mcp");
const wrongKey = await post(initialize, "https://x/mcp?key=wrong");
check(noKey.status === 401 && wrongKey.status === 401, "a missing or wrong key should be 401");
const noKeyBody = await noKey.text();
check(noKeyBody === await wrongKey.text(), "a missing key and a wrong key must get the same response");
check(JSON.parse(noKeyBody).error?.code === -32001 && /Authorization: Bearer <key>/.test(noKeyBody), "the 401 should say how to send a key");
check(!noKey.headers.has("www-authenticate"), "no WWW-Authenticate header, which can start an OAuth flow");
check(lastLog().key === null && lastLog().status === 401 && lastLog().auth === "query", "a failed key should still be logged, with no label");

await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "coverage", arguments: { secret: "user-text" } } });
const toolLog = logged.at(-1) ?? "";
check(JSON.parse(toolLog).calls?.[0]?.tool === "coverage", "a tools/call should log the tool's name");
check(!toolLog.includes("user-text"), "the request log line must not carry tool arguments");

await post([{ jsonrpc: "2.0", id: 3, method: "ping" }, { jsonrpc: "2.0", id: 4, method: "tools/list" }]);
check(JSON.stringify(lastLog().calls) === JSON.stringify([{ method: "ping", tool: null }, { method: "tools/list", tool: null }]), "a batch should log one call per message");

const garbled = await http(new Request("https://x/mcp?key=test-key", { method: "POST", body: "{not json" }));
check(garbled.status === 400 && (await garbled.json()).error?.code === -32700, "a body that is not JSON should get the usual parse error");
check(JSON.stringify(lastLog().calls) === "[]", "a body that is not JSON should log no calls");

check((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status === 202, "a notification should be 202");
check((await http(new Request("https://x/mcp?key=test-key"))).status === 405, "GET should be 405 (no event stream)");
check((await http(new Request("https://x/mcp?key=test-key", { headers: { accept: "text/event-stream" } }))).status === 405, "an MCP client probing GET should still get 405");
const page = await http(new Request("https://x/mcp", { headers: { accept: "text/html,application/xhtml+xml" } }));
const pageText = await page.text();
check(page.status === 200 && /text\/html/.test(page.headers.get("content-type") ?? "") && /MCP server/.test(pageText), "a browser should get the help page, without a key");
check(!/<script|<style|style=/.test(pageText), "the help page must not need inline script or style (the CSP forbids both)");

// Without the override, only the key whose hash is committed opens it. Nothing falls open.
delete process.env.MCP_KEY;
// @ts-expect-error - as above
const { default: bare } = await import("../netlify/functions/mcp/mcp.mjs?bare");
check((await bare(new Request("https://x/mcp?key=test-key", { method: "POST", body: JSON.stringify(initialize) }))).status === 401, "with no MCP_KEY set, the test key must not work");

// MCP_KEYS replaces the built-in keys, and its labels reach the log.
process.env.MCP_KEYS = JSON.stringify({ "key-one": "group-a", "key-two": "group-b" });
// @ts-expect-error - as above
const { default: keyed } = await import("../netlify/functions/mcp/mcp.mjs?keyed");
const keyedPost = (key: string) => keyed(new Request("https://x/mcp", { method: "POST", headers: { authorization: `Bearer ${key}` }, body: JSON.stringify(initialize) }));
check((await keyedPost("key-two")).status === 200 && lastLog().key === "group-b", "an MCP_KEYS key should work and log its own label");
check((await keyedPost("test-key")).status === 401, "with MCP_KEYS set, keys outside it must not work");
delete process.env.MCP_KEYS;

// Nothing secret in any line written so far: no key, no query string.
const allLogs = logged.join("\n");
check(!/test-key|key-one|key-two|key=|\?key|Bearer/.test(allLogs), "log output must never contain a key, a query string or the Authorization header");

// --- the public trial -----------------------------------------------------------------
// The trial key and end date are read when the module loads, so each case loads its own
// copy (a query string makes it a separate module instance).
const toolCall = { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "coverage", arguments: {} } };

process.env.TRIAL_KEY = "trial-test";
process.env.TRIAL_ENDS = "2999-01-01T00:00:00Z";
// @ts-expect-error - as above
const { default: during } = await import("../netlify/functions/mcp/mcp.mjs?during");
const live = await (await during(new Request("https://x/mcp?key=trial-test", { method: "POST", body: JSON.stringify(toolCall) }))).json();
check(/What the Gov Delivery Library covers/.test(live.result?.content?.[0]?.text ?? ""), "the trial key should answer tool calls during the trial");
check(lastLog().key === "trial", "the trial key should log as trial");

process.env.TRIAL_ENDS = "2000-01-01T00:00:00Z";
// @ts-expect-error - as above
const { default: after } = await import("../netlify/functions/mcp/mcp.mjs?after");
const callAfter = (body: unknown) => after(new Request("https://x/mcp?key=trial-test", { method: "POST", body: JSON.stringify(body) }));
const over = await (await callAfter(toolCall)).json();
check(/trial .* ended/.test(over.result?.content?.[0]?.text ?? "") && over.result?.isError === true, "after the trial, tool calls should say the trial has ended");
check((await callAfter({ jsonrpc: "2.0", id: 1, method: "ping" })).status === 200, "after the trial, the client should stay connected to read that message");
check((await after(new Request("https://x/mcp?key=wrong", { method: "POST", body: JSON.stringify(toolCall) }))).status === 401, "a wrong key is still refused after the trial");
console.log = quiet;

if (failures.length) {
  console.error(`MCP: ${failures.length} failure(s)\n`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`MCP: protocol, honesty contract and HTTP checks passed (${quoted} mandatory quotes verified verbatim).`);
