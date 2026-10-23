/**
 * Guards the one rule that has now been broken twice.
 *
 * netlify.toml sends `style-src 'self'; script-src 'self'` with no nonce and no
 * unsafe-inline. A CSP nonce cannot whitelist a style ATTRIBUTE in any case, so an
 * inline `style="..."` is silently dropped by the browser. It renders perfectly
 * against the local dev server, which sends no CSP at all, and then renders wrong in
 * production - the legend swatches on the map went out grey this way.
 *
 * Nothing about that failure is visible without opening the console on the deployed
 * site, so it gets a test instead.
 *
 * Run: node --experimental-strip-types test/csp.test.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** Files the browser loads, and which the CSP therefore applies to. */
const SHIPPED = [
  "index.html",
  ...readdirSync(join(ROOT, "assets")).filter((f) => f.endsWith(".js")).map((f) => `assets/${f}`),
  // The public trial page, under the same CSP. vendor/ is third-party and minified.
  "trial/index.html",
  "trial/thanks/index.html",
  ...readdirSync(join(ROOT, "trial")).filter((f) => f.endsWith(".js")).map((f) => `trial/${f}`),
];

const failures: string[] = [];

for (const rel of SHIPPED) {
  const src = readFileSync(join(ROOT, rel), "utf8");

  src.split("\n").forEach((line, i) => {
    // Ignore prose: these rules are discussed at length in comments.
    const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");

    if (/\sstyle\s*=\s*["'`]/.test(code)) {
      failures.push(`${rel}:${i + 1}  inline style attribute — use a class\n    ${line.trim().slice(0, 100)}`);
    }
    if (/<script(?![^>]*\bsrc=)/i.test(code)) {
      failures.push(`${rel}:${i + 1}  inline <script> — move it to a file under assets/\n    ${line.trim().slice(0, 100)}`);
    }
    if (/<style[\s>]/i.test(code)) {
      failures.push(`${rel}:${i + 1}  inline <style> — move it to assets/styles.css\n    ${line.trim().slice(0, 100)}`);
    }
  });
}

if (failures.length) {
  console.log(`\nCSP check: ${failures.length} problem(s)\n`);
  for (const f of failures) console.log(`  ${f}`);
  console.log("\nThese render correctly against the local dev server and are dropped in production.");
} else {
  console.log(`\nCSP check: ${SHIPPED.length} shipped files, no inline styles or scripts.`);
}

process.exitCode = failures.length > 0 ? 1 : 0;
