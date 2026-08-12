const { head, put } = require("@vercel/blob");

// Small JSON-document store on top of Vercel Blob — one blob per concern
// (lineup, match stats, kratflap scores/sessions), read-modify-write on each
// request. `addRandomSuffix: false` keeps the pathname (and therefore the
// blob's URL) stable across overwrites so we can always look it up by name.

async function readBlob(pathname, fallback) {
  try {
    const meta = await head(pathname);
    const res = await fetch(meta.url, { cache: "no-store" });
    if (!res.ok) return fallback;
    return await res.json();
  } catch {
    return fallback;
  }
}

async function writeBlob(pathname, data) {
  await put(pathname, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
    allowOverwrite: true,
    // These blobs are small read-modify-write state documents (session
    // tokens, lineup, scores) — the default CDN cache TTL (~1 month) means a
    // read right after a write can come back stale. Disable caching so
    // read-your-writes actually works.
    cacheControlMaxAge: 0,
  });
}

module.exports = { readBlob, writeBlob };
