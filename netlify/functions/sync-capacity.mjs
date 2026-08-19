// Scheduled function that pulls Team Capacity data from the
// "SG Resourcing Allocation + Utilization" monday.com board (a different
// board from the Golden Rolodex) and caches it in Netlify Blobs, same
// pattern as sync-monday.mjs.
//
// This board is structured as one row per person-per-project assignment
// (not one row per person), grouped by project. This function groups those
// rows back into one record per person, with an `allocations` array listing
// every project they're on — which matches the shape the Team Capacity page
// already expects.
//
// IMPORTANT ASSUMPTION TO VERIFY: this board has two numeric columns and I'm
// assuming, based on the board's name, that they are Allocation % first and
// Utilization % second. If the capacity bars on the Team Capacity page look
// swapped once this is live, tell Claude and it's a one-line fix to flip
// which column maps to which field below.
//
// IMPORTANT: I could not test this function against the live monday.com API
// from within this environment. Please do a test run (hit this function's
// URL directly) and compare the output against the live board before fully
// trusting it.

import { getStore } from "@netlify/blobs";

const BOARD_ID = "18424352592";

const COLUMN_MAP = {
  text_mm5qb2hk: "role",
  text_mm5qt90b: "person",
  dropdown_mm5qpk9z: "type", // "Fulltime" or "Freelance"
  timerange_mm5qqvdd: "dates",
  numeric_mm5qd4jk: "allocationPct", // ASSUMPTION: Allocation % — verify against the live board
  numeric_mm5qqjcv: "utilizationPct", // ASSUMPTION: Utilization % — verify against the live board
};

const ALL_COLUMN_IDS = Object.keys(COLUMN_MAP);

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

function parseNumber(text) {
  const cleaned = sanitizeText(text);
  if (cleaned === null) return null;
  const n = parseFloat(cleaned.replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? null : n;
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
            group { title }
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
          group { title }
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

function groupByPerson(rawItems) {
  const byId = {};
  for (const item of rawItems) {
    const byColId = {};
    for (const cv of item.column_values) byColId[cv.id] = cv;

    const row = { project: item.group && item.group.title ? item.group.title : item.name };
    for (const [colId, field] of Object.entries(COLUMN_MAP)) {
      const cv = byColId[colId];
      if (!cv) { row[field] = null; continue; }
      row[field] = field.endsWith("Pct") ? parseNumber(cv.text) : sanitizeText(cv.text);
    }

    const personName = row.person;
    if (!personName) continue;
    delete row.person;

    if (!byId[personName]) {
      byId[personName] = {
        id: "cap_" + personName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        name: personName,
        role: row.role,
        type: row.type,
        company: "SG",
        allocations: [],
      };
    }
    byId[personName].allocations.push({
      project: row.project,
      percentage: row.allocationPct,
      utilization: row.utilizationPct,
      dates: row.dates,
    });
  }
  return Object.values(byId);
}

export default async (req) => {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    return new Response(JSON.stringify({ error: "Missing MONDAY_API_TOKEN environment variable" }), { status: 500 });
  }

  try {
    const rawItems = await fetchAllItems(token);
    const people = groupByPerson(rawItems);

    const store = getStore("capacity-data");
    await store.setJSON("latest", {
      updatedAt: new Date().toISOString(),
      count: people.length,
      items: people,
    });

    return new Response(JSON.stringify({ synced: people.length, updatedAt: new Date().toISOString() }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
};
