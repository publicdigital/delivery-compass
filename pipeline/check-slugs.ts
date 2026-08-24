// Probe candidate GOV.UK slugs so the registry is grounded in real paths.
// Reports: OK (with document_type + public_updated_at), REDIRECT (with target), or the HTTP error.
const CANDIDATES: string[] = process.argv.slice(2);

type Probe = { slug: string; status: string; docType?: string; updated?: string; target?: string; title?: string };

async function probe(slug: string): Promise<Probe> {
  const url = `https://www.gov.uk/api/content${slug}`;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return { slug, status: `HTTP ${res.status}` };
    const j: any = await res.json();
    if (j.document_type === "redirect" || j.schema_name === "redirect") {
      const target = j.details?.redirects?.[0]?.destination ?? j.redirects?.[0]?.destination ?? "?";
      return { slug, status: "REDIRECT", target, docType: j.document_type };
    }
    return { slug, status: "OK", docType: j.document_type, updated: j.public_updated_at, title: j.title };
  } catch (e) {
    return { slug, status: `ERR ${(e as Error).message}` };
  }
}

const results: Probe[] = [];
for (const slug of CANDIDATES) {
  results.push(await probe(slug));
  await new Promise((r) => setTimeout(r, 120)); // be polite
}
for (const r of results) {
  const tag = r.status === "OK" ? "OK      " : r.status === "REDIRECT" ? "REDIRECT" : "FAIL    ";
  console.log(`${tag} ${r.slug}`);
  if (r.status === "OK") console.log(`         ${r.docType} | ${r.updated} | ${r.title}`);
  if (r.status === "REDIRECT") console.log(`         -> ${r.target}`);
  if (tag === "FAIL    ") console.log(`         ${r.status}`);
}
