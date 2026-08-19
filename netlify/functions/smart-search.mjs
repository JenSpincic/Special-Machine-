// Two-stage AI talent search.
//
// Stage 1: sends the person's plain-English query plus a compact summary of
// every freelancer (role, notes, AI summary, past work) to Claude, and asks
// for the best-matching shortlist with a one-line reason each.
//
// Stage 2: for that shortlist only, fetches each person's portfolio URL,
// pulls out the visible text, and asks Claude to weigh in again — this time
// with actual portfolio content in front of it — before returning the final
// ranked list.
//
// Requires an ANTHROPIC_API_KEY environment variable in Netlify. If it's not
// set, this returns a clear error so the front end can fall back to basic
// keyword search instead of just breaking.

import { getAuthedUser } from "./_clerk-auth.mjs";
import { getStore } from "@netlify/blobs";

const MODEL = "claude-sonnet-4-6";
const SHORTLIST_SIZE = 12;
const PORTFOLIO_FETCH_TIMEOUT_MS = 6000;
const PORTFOLIO_TEXT_LIMIT = 3000;

function truncate(str, len) {
  if (!str) return "";
  str = String(str);
  return str.length > len ? str.slice(0, len) + "…" : str;
}

async function callClaude(apiKey, messages, maxTokens) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API error ${res.status}: ${text}`);
  }
  const data = await res.json();
  const textBlock = (data.content || []).find((b) => b.type === "text");
  return textBlock ? textBlock.text : "";
}

function extractJson(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  return JSON.parse(match ? match[0] : cleaned);
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPortfolioText(url) {
  if (!url) return "";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PORTFOLIO_FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; GoldenRolodexBot/1.0)" } });
    clearTimeout(timeout);
    if (!res.ok) return "";
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return "";
    const html = await res.text();
    return truncate(stripHtml(html), PORTFOLIO_TEXT_LIMIT);
  } catch (err) {
    return "";
  }
}

export default async (req) => {
  const user = await getAuthedUser(req);
  if (!user) {
    return new Response(JSON.stringify({ error: "Not signed in" }), { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY not set — AI search isn't configured yet." }),
      { status: 200 }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const query = (body.query || "").trim();
  if (!query) {
    return new Response(JSON.stringify({ error: "No query provided" }), { status: 400 });
  }

  try {
    const store = getStore("freelancer-data");
    const cached = await store.get("latest", { type: "json" });
    const roster = (cached && cached.items) || [];

    if (!roster.length) {
      return new Response(JSON.stringify({ error: "No roster data cached yet — run sync-monday first." }), { status: 200 });
    }

    // ---- Stage 1: search the Rolodex data itself ----
    const compactRoster = roster
      .filter((r) => r.name)
      .map((r) => {
        return `ID:${r.id} | ${r.name} | Role: ${truncate(r.role, 80)} | Past work: ${truncate(r.work, 150)} | Summary: ${truncate(r.aiSummary, 150)} | Notes: ${truncate(r.notes, 100)}`;
      })
      .join("\n");

    const stage1Prompt = `You are helping a resourcing manager at a production/advertising company search a freelancer database.

Person's request: "${query}"

Below is the freelancer roster (one line per person: ID, name, role, past client work, AI-written summary, and internal notes). Based on this data, pick the ${SHORTLIST_SIZE} people who best match the request. Judge actual fit — role relevance, relevant past clients/work, skills implied by the summary/notes — not just keyword overlap.

Roster:
${compactRoster}

Respond with ONLY a JSON array, no other text, in this exact format:
[{"id": "12345", "reason": "one short sentence on why this person fits"}]`;

    const stage1Text = await callClaude(apiKey, [{ role: "user", content: stage1Prompt }], 2000);
    let shortlist;
    try {
      shortlist = extractJson(stage1Text);
    } catch (e) {
      return new Response(JSON.stringify({ error: "Could not parse stage 1 results", raw: stage1Text }), { status: 200 });
    }

    const shortlistIds = new Set(shortlist.map((s) => String(s.id)));
    const shortlistPeople = roster.filter((r) => shortlistIds.has(String(r.id)));

    // ---- Stage 2: check actual portfolios for the shortlist ----
    const portfolioTexts = await Promise.all(
      shortlistPeople.map(async (r) => ({
        id: r.id,
        name: r.name,
        portfolioText: await fetchPortfolioText(r.portfolio),
      }))
    );

    const portfolioBlock = portfolioTexts
      .map((p) => `ID:${p.id} | ${p.name} | Portfolio text: ${p.portfolioText || "(portfolio not reachable or not text-based — judge on roster data alone)"}`)
      .join("\n\n");

    const stage2Prompt = `You are helping a resourcing manager finalize a shortlist of freelancers for this request: "${query}"

Here is the shortlist from an initial database search, along with text pulled from each person's actual portfolio site:

${portfolioBlock}

Rank these people best-to-worst fit for the request, using the portfolio content to confirm or downgrade the initial match. Some portfolios are visual-only (reels, images) and won't have much text — that's fine, just note that in the reason and rely on the roster data for those.

Respond with ONLY a JSON array, no other text, in this exact format:
[{"id": "12345", "reason": "one short sentence on why this person fits, referencing the portfolio if useful"}]`;

    const stage2Text = await callClaude(apiKey, [{ role: "user", content: stage2Prompt }], 2000);
    let finalRanking;
    try {
      finalRanking = extractJson(stage2Text);
    } catch (e) {
      // Fall back to stage 1 ranking if stage 2 parsing fails for any reason.
      finalRanking = shortlist;
    }

    return new Response(JSON.stringify({ results: finalRanking, stage: "full" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
};
