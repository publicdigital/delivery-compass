/**
 * Takes personal details out of a search before it is logged or stored.
 *
 * /trial asks people to leave personal details out of their questions, but some will
 * not, and an assistant may copy them from the conversation into the search. So every
 * search is passed through this before it goes anywhere, and nothing logs the raw text.
 * Each pattern errs towards removing too much: a lost postcode-shaped word costs less
 * than a kept National Insurance number.
 */
const RULES = [
  // A URL carrying a query string can hold tokens or personal details; plain URLs stay.
  /\bhttps?:\/\/\S*\?\S*/gi,
  /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, // email
  /\b[A-Z]{2} ?\d{2} ?\d{2} ?\d{2} ?[A-D]\b/gi, // National Insurance number, any prefix (QQ is the usual example)
  /(?:\+44\s?\(?0?\)?\s?|\b0)(?:\d[\s-]?){8,9}\d\b/g, // UK phone number, +44 or 0 then 9 or 10 digits
  /\b[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}\b/gi, // UK postcode
  /\d(?:[\s-]?\d){7,}/g, // any other run of 8 or more digits (account, case or card numbers)
];

export const MAX_QUERY = 300;

export function redact(text) {
  let out = String(text ?? "");
  for (const rule of RULES) out = out.replace(rule, "[redacted]");
  return out.slice(0, MAX_QUERY);
}
