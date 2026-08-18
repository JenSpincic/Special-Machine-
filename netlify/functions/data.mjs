// Generic get/set endpoint the front end uses in place of Claude's
// window.storage. Two scopes:
//   - "personal": private to the signed-in user (favorites, saved profile info)
//   - "shared": visible/editable across everyone (booking requests, the
//     internal employee roster, manual project assignments)
//
// GET  /.netlify/functions/data?key=favorites&scope=personal
// POST /.netlify/functions/data   body: { key, scope, value }
//
// KNOWN LIMITATION (worth hardening before wide rollout): write access for
// "shared" data currently only checks "is this person an admin for ANY
// company", not "is this the company they admin." A Studio PPS admin could
// technically edit SpecialGuest's roster through this endpoint even though
// the UI wouldn't normally let them get there. Tightening this to validate
// each record's company against the caller's adminCompanies is a reasonable
// next step, not done here to keep the first version shippable.

import { getStore } from "@netlify/blobs";
import { getAuthedUser } from "./_clerk-auth.mjs";

const SHARED_KEYS = new Set(["requests", "internal_employees", "manual_assignments"]);
const PERSONAL_KEYS = new Set(["favorites", "profile"]);
const ADMIN_WRITE_KEYS = new Set(["internal_employees", "manual_assignments"]);

function storeKeyFor(key, scope, userId) {
  if (PERSONAL_KEYS.has(key)) return `personal:${userId}:${key}`;
  if (SHARED_KEYS.has(key)) return `shared:${key}`;
  return null;
}

export default async (req) => {
  const user = await getAuthedUser(req);
  if (!user) {
    return new Response(JSON.stringify({ error: "Not signed in" }), { status: 401 });
  }

  const url = new URL(req.url);
  const store = getStore("app-data");

  if (req.method === "GET") {
    const key = url.searchParams.get("key");
    const storeKey = storeKeyFor(key, null, user.userId);
    if (!storeKey) {
      return new Response(JSON.stringify({ error: "Unknown key" }), { status: 400 });
    }
    const value = await store.get(storeKey, { type: "json" });
    return new Response(JSON.stringify({ key, value: value ?? null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
    }
    const { key, value } = body;
    const storeKey = storeKeyFor(key, null, user.userId);
    if (!storeKey) {
      return new Response(JSON.stringify({ error: "Unknown key" }), { status: 400 });
    }
    if (ADMIN_WRITE_KEYS.has(key) && !user.isAdmin) {
      return new Response(JSON.stringify({ error: "Admin access required" }), { status: 403 });
    }
    await store.setJSON(storeKey, value);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
};
