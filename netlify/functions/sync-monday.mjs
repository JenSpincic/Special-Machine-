// Core sync logic for the "Golden Rolodex" board, plus an admin-gated HTTP
// endpoint (used by the "Sync Now" button in Admin) that runs it on demand.
//
// Automatic scheduling now lives in sync-monday-am.mjs and sync-monday-pm.mjs
// instead of here — see those files for the cron times. This file itself is
// no longer on a schedule; it only runs when explicitly triggered (by an
// admin clicking "Sync Now," or by those two scheduled wrapper functions
// calling runMondaySync() directly).
//
// IMPORTANT: I could not test this function against the live monday.com API
// from within this environment (no network access to monday.com here). The
// column IDs below are the ones confirmed against your board during our
// Claude session, and the parsing approach (using monday's own `text` field,
// which is already human-formatted per column type) is the simplest path to
// avoid re-implementing type-specific parsing for every column type. Please
// do a test run and compare the output against the live board before fully
// trusting it — some column IDs or the pagination shape may need small
// adjustments if monday.com's API has changed since.

import { getStore } from "@netlify/blobs";
import { getAuthedUser } from "./_clerk-auth.mjs";

const BOARD_ID = "7936095861";

// column id -> field name in our cleaned data shape
const COLUMN_MAP = {
  color_mm3a1zj4: "company",
  color_mkxx2shh: "companyLegacy",
  color_mkt4pgp4: "currentProject",
  timerange_mktc2m0c: "bookedDates",
  color_mm0end1f: "allocation",
  timerange_mktc6t5m: "bookedDates2",
  color_mkt4x1ed: "currentHold",
  timerange_mktc4jw3: "holdDates",
  text_mkqzvk0e: "duoPartner",
  job_title8__1: "role",
  link_mkqacb68: "portfolio",
  link7: "linkedin",
  link__1: "resume",
  dropdown_mkqazxjw: "creativeSkills",
  dropdown_mkqak0kh: "accountSkills",
  dropdown_mkqa47aj: "strategySkills",
  dropdown_mkqa58an: "productionSkills",
  text_mkqacwdx: "rate",
  color_mkqa57jq: "ratePer",
  email: "email",
  text_mkqb5gh8: "location",
  long_text_mktm2462: "foundBy",
  dropdown_mksqvzsb: "industries",
  text_mktmgenr: "work",
  text_mktm9t9n: "aiSummary",
  long_text__1: "notes",
  long_text_mkqyp74a: "availability",
  text_mm5s5241: "unionName",
};

const LINK_FIELDS = new Set(["portfolio", "linkedin", "resume"]);
const TRUSTED_COLUMN_ID = "tag_mm523d3a";
const DIRECTOR_ROSTER_COLUMN_ID = "tag_mm5sk2c5";

const ALL_COLUMN_IDS = [...Object.keys(COLUMN_MAP), TRUSTED_COLUMN_ID, DIRECTOR_ROSTER_COLUMN_ID];

async function mondayQuery(token, query, variables) {
  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": token,
      "API-Version": "2024-10",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error("monday.com API error: " + JSON.stringify(json.errors));
  }
  return json.data;
}

function sanitizeText(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  return trimmed.length ? trimmed : null;
}

function parseLinkUrl(rawValue) {
  if (!rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue);
    return parsed && parsed.url ? parsed.url : null;
  } catch (e) {
    return null;
  }
}

function cleanItem(item) {
  const rec = { id: item.id, name: item.name };
  const byId = {};
  for (const cv of item.column_values) byId[cv.id] = cv;

  for (const [colId, field] of Object.entries(COLUMN_MAP)) {
    const cv = byId[colId];
    if (!cv) { rec[field] = null; continue; }
    if (LINK_FIELDS.has(field)) {
      rec[field] = parseLinkUrl(cv.value);
    } else {
      rec[field] = sanitizeText(cv.text);
    }
  }

  // color_mm3a1zj4 is the column actually in use going forward; companyLegacy
  // (color_mkxx2shh) only has values on older records from before the two
  // Company columns were consolidated. Prefer the current one, fall back to
  // the legacy one so nothing looks unassigned.
  rec.company = rec.company || rec.companyLegacy || null;
  delete rec.companyLegacy;

  const trustedCv = byId[TRUSTED_COLUMN_ID];
  rec.trusted = !!(trustedCv && sanitizeText(trustedCv.text));

  const rosterCv = byId[DIRECTOR_ROSTER_COLUMN_ID];
  rec.directorRoster = !!(rosterCv && sanitizeText(rosterCv.text));

  return rec;
}

async function fetchAllItems(token) {
  const firstPageQuery = `
    query($boardId: ID!, $columnIds: [String!]) {
      boards(ids: [$boardId]) {
        items_page(limit: 500) {
          cursor
          items {
            id
            name
            column_values(ids: $columnIds) { id text value }
          }
        }
      }
    }
  `;
  const nextPageQuery = `
    query($cursor: String!, $columnIds: [String!]) {
      next_items_page(cursor: $cursor, limit: 500) {
        cursor
        items {
          id
          name
          column_values(ids: $columnIds) { id text value }
        }
      }
    }
  `;

  let items = [];
  let data = await mondayQuery(token, firstPageQuery, {
    boardId: BOARD_ID,
    columnIds: ALL_COLUMN_IDS,
  });
  let page = data.boards[0].items_page;
  items = items.concat(page.items);
  let cursor = page.cursor;

  while (cursor) {
    data = await mondayQuery(token, nextPageQuery, { cursor, columnIds: ALL_COLUMN_IDS });
    page = data.next_items_page;
    items = items.concat(page.items);
    cursor = page.cursor;
  }

  return items;
}

export async function runMondaySync() {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    throw new Error("Missing MONDAY_API_TOKEN environment variable");
  }

  const rawItems = await fetchAllItems(token);
  const cleaned = rawItems.map(cleanItem);

  const store = getStore("freelancer-data");
  const updatedAt = new Date().toISOString();
  await store.setJSON("latest", {
    updatedAt,
    count: cleaned.length,
    items: cleaned,
  });

  return { synced: cleaned.length, updatedAt };
}

// Admin-only manual trigger — this is what the "Sync Now" button in Admin
// calls. Requires a signed-in admin's Clerk token in the Authorization
// header, same as the other admin-only endpoints.
export default async (req) => {
  const user = await getAuthedUser(req);
  if (!user || !user.isAdmin) {
    return new Response(JSON.stringify({ error: "Admin access required" }), { status: 403 });
  }

  try {
    const result = await runMondaySync();
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
};
