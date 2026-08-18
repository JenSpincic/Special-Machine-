// Shared helper: verifies the Clerk session token sent by the front end and
// returns the signed-in user's id/email, plus which companies (if any) they
// administer, based on the ADMIN_EMAILS_* environment variables.
//
// Front end sends the token as: Authorization: Bearer <clerk session token>
// (obtained client-side via `await Clerk.session.getToken()`).

import { verifyToken, createClerkClient } from "@clerk/backend";

const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

const COMPANY_ENV_VARS = {
  "1stAve": "ADMIN_EMAILS_1STAVE",
  "SG": "ADMIN_EMAILS_SG",
  "Studio PPS": "ADMIN_EMAILS_PPS",
  "Mudge": "ADMIN_EMAILS_MUDGE",
};

function parseAllowlist(envVarName) {
  const raw = process.env[envVarName] || "";
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export async function getAuthedUser(req) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  let payload;
  try {
    payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
  } catch (e) {
    return null;
  }

  const userId = payload.sub;
  let email = "";
  try {
    // The default Clerk session token doesn't include email unless you've added
    // a custom claim in the Clerk Dashboard's JWT template — fetching the user
    // object directly is the reliable way to get it without that extra setup.
    const user = await clerkClient.users.getUser(userId);
    const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
    email = (primary ? primary.emailAddress : (user.emailAddresses[0]?.emailAddress || "")).toLowerCase();
  } catch (e) {
    // fall through with empty email; caller will just get isAdmin:false
  }

  const adminCompanies = [];
  for (const [company, envVar] of Object.entries(COMPANY_ENV_VARS)) {
    const allowlist = parseAllowlist(envVar);
    if (email && allowlist.includes(email)) adminCompanies.push(company);
  }

  return {
    userId,
    email,
    isAdmin: adminCompanies.length > 0,
    adminCompanies,
  };
}
