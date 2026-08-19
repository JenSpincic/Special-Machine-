// Scheduled trigger only — runs the Golden Rolodex sync at 8:00 AM Pacific
// Standard Time, Monday through Friday.
//
// Netlify's scheduled functions run on UTC, and 8:00 AM PST = 16:00 UTC same
// calendar day, so the weekday range lines up directly (Mon-Fri in UTC here
// really is Mon-Fri in Pacific time for this particular time of day).
//
// Heads up: this is pinned to standard time (PST, UTC-8). During Daylight
// Saving Time (PDT, UTC-7, roughly March–November) this will actually fire
// at 9:00 AM Pacific instead of 8:00 AM, since cron schedules don't
// auto-adjust for DST. If that hour of drift matters to you, tell Claude and
// the schedule can be nudged for the DST months.

import { runMondaySync } from "./sync-monday.mjs";

export default async () => {
  try {
    const result = await runMondaySync();
    return new Response(JSON.stringify(result), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
};

export const config = { schedule: "0 16 * * 1-5" };
