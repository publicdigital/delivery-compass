import { extractObligations } from "../pipeline/classify.ts";

const sample = [
  "The board shall ensure that risk management is embedded across the organisation.",
  "Organisations should consider the use of a risk appetite statement.",
  "The SRO may delegate day-to-day decisions to the programme manager.",
  "The term shall denotes a requirement: a mandatory element.",
  "Departments must publish business cases in line with clause 4.4.4 of the standard.",
  "This might affect delivery confidence, e.g. where funding is uncertain.",
  "The accounting officer shall not approve spend without a business case.",
].join(" ");

const out = extractObligations(sample);
console.log(`extracted ${out.length} (boilerplate definition line should be skipped)\n`);
for (const o of out) {
  console.log(o.strength.padEnd(12), "|", (o.actor ?? "-").padEnd(26), "|", o.sentence.slice(0, 68));
}
