// Scheduled trigger only — runs the Team Capacity sync at 4:00 PM Pacific
// Standard Time, Monday through Friday. See sync-monday-pm.mjs for why the
// weekday range is "2-6" rather than "1-5" — same reasoning applies here.

import { runCapacitySync } from "./sync-capacity.mjs";

export default async () => {
  try {
    const result = await runCapacitySync();
    return new Response(JSON.stringify(result), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
};

export const config = { schedule: "0 0 * * 2-6" };
