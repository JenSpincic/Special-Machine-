// Sends a "Rolodex Request" email alert to jen@1stavemachine.com whenever
// someone submits a booking/availability/rate request through the site.
// Called by the front end right after it saves the request via data.mjs —
// this is a separate call so a failed email never blocks the request itself
// from being saved.
//
// Requires a RESEND_API_KEY environment variable (resend.com — free tier
// covers this volume easily). Sign up, verify a sending domain (or use their
// shared onboarding domain for a quick start), and put the API key in
// Netlify's environment variables.

import { getAuthedUser } from "./_clerk-auth.mjs";

const ALERT_TO = "jen@1stavemachine.com";
const FROM_ADDRESS = "Golden Rolodex <rolodex@resend.dev>"; // swap in a verified domain address once you set one up in Resend

export default async (req) => {
  const user = await getAuthedUser(req);
  if (!user) {
    return new Response(JSON.stringify({ error: "Not signed in" }), { status: 401 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Don't fail the whole request flow just because email isn't configured yet —
    // the request itself is still saved by data.mjs regardless of this call's outcome.
    return new Response(JSON.stringify({ sent: false, reason: "RESEND_API_KEY not set" }), { status: 200 });
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const { requestor, requestorEmail, requestTypes, freelancerName, roleNeeded, company, project, dates, notes } = body;

  const lines = [
    `Requested by: ${requestor || "—"}${requestorEmail ? " (" + requestorEmail + ")" : ""}`,
    `Type: ${(requestTypes || []).join(" + ") || "—"}`,
    `Freelancer: ${freelancerName || "—"}`,
    `Role needed: ${roleNeeded || "—"}`,
    `Company: ${company || "—"}`,
    `Project: ${project || "—"}`,
    `Dates: ${dates || "—"}`,
    `Notes: ${notes || "—"}`,
  ];

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [ALERT_TO],
        subject: "Rolodex Request",
        text: lines.join("\n"),
      }),
    });
    const ok = res.ok;
    if (!ok) {
      const errText = await res.text();
      return new Response(JSON.stringify({ sent: false, error: errText }), { status: 200 });
    }
    return new Response(JSON.stringify({ sent: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ sent: false, error: String(err) }), { status: 200 });
  }
};
