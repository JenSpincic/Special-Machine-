// Scheduled trigger only — runs the Team Capacity sync at 8:00 AM Pacific
// Standard Time, Monday through Friday. See sync-monday-am.mjs for the UTC
// math and DST caveat, which apply identically here.

import { runCapacitySync } from "./sync-capacity.mjs";

export default async () => {
  try {
    const result = await runCapacitySync();
    return new Response(JSON.stringify(result), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
};

export const config = { schedule: "0 16 * * 1-5" };
