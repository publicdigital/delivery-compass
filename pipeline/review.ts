import { appendFileSync } from "node:fs";

/**
 * Record something a curator has to decide, for the scheduled refresh to report.
 *
 * Ingest and watch can follow a moved slug or survive a withdrawn page, but they
 * cannot update the registry or judge whether a relation still holds. On a laptop
 * those findings are read off the console. On the scheduled runner nobody reads the
 * console, so when COMPASS_REVIEW names a file each finding is appended to it as a
 * markdown bullet, and scripts/refresh-report.ts turns the file into an issue.
 * Without the variable this does nothing.
 */
export function flagForReview(line: string): void {
  const path = process.env.COMPASS_REVIEW;
  if (path) appendFileSync(path, `- ${line.replace(/\s+/g, " ").trim()}\n`);
}
