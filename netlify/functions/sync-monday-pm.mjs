// Scheduled trigger only — runs the Golden Rolodex sync at 4:00 PM Pacific
// Standard Time, Monday through Friday.
//
// 4:00 PM PST = 00:00 UTC the *next* calendar day (adding 8 hours crosses
// midnight), so to land on Mon–Fri afternoons in Pacific time, this actually
// needs to fire at 00:00 UTC on Tue–Sat — that's the "2-6" below, not "1-5".
// (Same DST caveat as sync-monday-am.mjs applies here too.)

import { runMondaySync } from "./sync-monday.mjs";

export default async () => {
  try {
    const result = await runMondaySync();
    return new Response(JSON.stringify(result), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
};

export const config = { schedule: "0 0 * * 2-6" };
