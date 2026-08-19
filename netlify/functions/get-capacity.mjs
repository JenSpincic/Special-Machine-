// Serves the cached Team Capacity data (written by sync-capacity.mjs) to the
// front end. Read-only and fast, same pattern as get-freelancers.mjs.
//
// First-time setup note: this returns an empty list until sync-capacity has
// run at least once. After deploying, manually visit
// https://YOUR-SITE.netlify.app/.netlify/functions/sync-capacity once to seed
// the cache.

import { getStore } from "@netlify/blobs";
import { getAuthedUser } from "./_clerk-auth.mjs";

export default async (req) => {
  // Team Capacity is an admin-only page — enforce that here too, not just in
  // the front end, since the front end can always be bypassed by anyone
  // opening dev tools.
  const user = await getAuthedUser(req);
  if (!user || !user.isAdmin) {
    return new Response(JSON.stringify({ error: "Admin access required" }), { status: 403 });
  }

  try {
    const store = getStore("capacity-data");
    const data = await store.get("latest", { type: "json" });

    if (!data) {
      return new Response(JSON.stringify({ updatedAt: null, count: 0, items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=60" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
};
