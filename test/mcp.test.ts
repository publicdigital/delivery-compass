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
const { handleMessage, TOOLS } = await import("../netlify/functions/mcp/core.mjs");
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
check(/Cite: https:\/\/www\.gov\.uk\//.test(tcop.text), "every result needs a GOV.UK citation");
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

const changes = call("recent_changes", { days: 730 });
check(/publisher's own words/.test(changes.text) && /\*\*\d{4}-\d{2}-\d{2}\*\*/.test(changes.text), "recent_changes should list dated notes");

// --- HTTP ---------------------------------------------------------------------------
const post = (body: unknown, url = "https://x/mcp?key=test-key", headers: Record<string, string> = {}) =>
  http(new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

check((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, "https://x/mcp")).status === 401, "no key should be 401");
check((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, "https://x/mcp?key=wrong")).status === 401, "wrong key should be 401");
check((await post({ jsonrpc: "2.0", id: 1, method: "ping" })).status === 200, "query key should work");
check((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, "https://x/mcp", { authorization: "Bearer test-key" })).status === 200, "bearer key should work");
check((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status === 202, "a notification should be 202");
check((await http(new Request("https://x/mcp?key=test-key"))).status === 405, "GET should be 405 (no event stream)");

// Without the override, only the key whose hash is committed opens it. Nothing falls open.
delete process.env.MCP_KEY;
check((await post({ jsonrpc: "2.0", id: 1, method: "ping" })).status === 401, "with no MCP_KEY set, the test key must not work");

if (failures.length) {
  console.error(`MCP: ${failures.length} failure(s)\n`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`MCP: protocol, honesty contract and HTTP checks passed (${quoted} mandatory quotes verified verbatim).`);
