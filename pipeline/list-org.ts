// List publications for an organisation slug — reliable corpus discovery (unlike free-text search).
const org = process.argv[2];
const count = process.argv[3] ?? "40";
const url = `https://www.gov.uk/api/search.json?filter_organisations=${org}&count=${count}&order=-public_timestamp&fields=title,link,public_timestamp,content_store_document_type`;
const res = await fetch(url, { headers: { accept: "application/json" } });
const j: any = await res.json();
console.log(`### ${org} — ${j.total} total\n`);
for (const r of j.results ?? []) {
  console.log(`${r.public_timestamp?.slice(0,10)}  [${r.content_store_document_type}]  ${r.title}`);
  console.log(`            ${r.link}`);
}
