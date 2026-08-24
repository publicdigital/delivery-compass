// Find candidate GOV.UK slugs by title search. Registry curation aid, not a runtime dependency.
const q = process.argv.slice(2).join(" ");
const url = `https://www.gov.uk/api/search.json?q=${encodeURIComponent(q)}&count=8&fields=title,link,public_timestamp,content_store_document_type,organisations`;
const res = await fetch(url, { headers: { accept: "application/json" } });
const j: any = await res.json();
console.log(`\n### "${q}"  (${j.total} total)`);
for (const r of j.results ?? []) {
  const orgs = (r.organisations ?? []).map((o: any) => o.acronym || o.title).join(", ");
  console.log(`  ${r.link}`);
  console.log(`     ${r.title}  [${r.content_store_document_type}] ${r.public_timestamp?.slice(0,10) ?? ""} ${orgs ? "| " + orgs : ""}`);
}
