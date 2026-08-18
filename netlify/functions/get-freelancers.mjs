// Serves the cached monday.com data (written by sync-monday.mjs) to the
// front end. This is intentionally read-only and fast — it never calls
// monday.com itself, so page loads aren't slowed down by (or rate-limited by)
// monday's API.
//
// First-time setup note: this returns an empty list until sync-monday has run
// at least once. After deploying, manually visit
// https://YOUR-SITE.netlify.app/.netlify/functions/sync-monday once to seed
// the cache, rather than waiting for the first scheduled run.

import { getStore } from "@netlify/blobs";

export default async () => {
  try {
    const store = getStore("freelancer-data");
    const data = await store.get("latest", { type: "json" });

    if (!data) {
      return new Response(JSON.stringify({ updatedAt: null, count: 0, items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
};
