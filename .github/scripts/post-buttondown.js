#!/usr/bin/env node
// Draft ONE Buttondown email containing a stacked digest of every new,
// newsletter-eligible post from this deploy.
//
// Inputs:
//   argv[2]: new-posts.json   (produced by detect-new-posts.js: an array of
//             { title, url, description, authors, tags, published, image })
//   argv[3]: newsletter.json  (produced by src/newsletter-feed.11ty.js: an
//             array of post URLs NOT opted out via `newsletter_enabled:false`)
//
// Behavior:
//   - Intersect new posts with the allowlist (fail-closed: a post must be in
//     newsletter.json to be emailed, so `newsletter_enabled: false` suppresses
//     it). If nothing qualifies, exit 0.
//   - Build a single HTML email body: one teaser/digest card per post (cover
//     image + title + meta + excerpt + a "read the transmission" button + the
//     tags), stacked in publication order. Ten posts in one deploy => one
//     email with ten cards, not ten emails.
//   - POST it to Buttondown's API as a DRAFT (status: "draft"). Nothing sends
//     automatically; the draft lands in the dashboard for manual review +
//     send. (As of the 2026 "safer defaults" change the API already defaults
//     to draft; we set it explicitly so intent is obvious and future-proof.)
//
// Env:
//   BUTTONDOWN_API_KEY: required (unless BUTTONDOWN_DRY_RUN). Auth token.
//   BUTTONDOWN_API_BASE: optional. Default https://api.buttondown.com/v1
//   BUTTONDOWN_DRY_RUN: optional. "true" => print the draft, don't POST.
//                          Lets you verify the body locally with no account.
//
// Idempotency mirrors the Discord dispatch: "new" is computed by the feed
// diff against the live site, and once deployed a post is in the live feed, so
// the next deploy won't re-detect it. No npm dependency (Node 20 global fetch).

const fs = require("fs");

const API_BASE = (process.env.BUTTONDOWN_API_BASE || "https://api.buttondown.com/v1")
  .replace(/\/+$/, "");
const API_KEY = process.env.BUTTONDOWN_API_KEY || "";
const DRY_RUN = String(process.env.BUTTONDOWN_DRY_RUN || "").toLowerCase() === "true";
const SITE_URL = (process.env.SITE_URL || "https://fractured-jaw.com").replace(/\/+$/, "");

// Normalize a URL to its pathname so the two payloads compare cleanly: the
// feed (new-posts.json) carries ABSOLUTE urls (https://.../essays/x/) while
// the allowlist (newsletter.json) carries ROOT-RELATIVE ones (/essays/x/).
// A second base arg makes new URL() tolerate both absolute and relative input.
function pathOf(u) {
  try {
    return new URL(String(u || ""), SITE_URL).pathname;
  } catch (e) {
    return String(u || "");
  }
}

// Palette (mirrors src/_css/variables.css). Email clients can't load the
// site's self-hosted fonts, so we fall back to a monospace stack to keep the
// brutalist read. Colours are inlined because clients strip <style>.
const C = {
  void: "#0a0a0a",
  voidSoft: "#141414",
  bone: "#d8d4cc",
  boneDim: "#8a857c",
  boneFaint: "#4a463f",
  brass: "#c9a961",
  brassDeep: "#8a7340",
  sodium: "#ffaa33",
};
const MONO = "'Courier New', Courier, monospace";

function fail(msg) {
  console.error(`[post-buttondown] ${msg}`);
  process.exit(1);
}

function readJson(path) {
  let raw;
  try {
    raw = fs.readFileSync(path, "utf8");
  } catch (err) {
    fail(`cannot read ${path}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(`cannot parse ${path}: ${err.message}`);
  }
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// One digest card for a single post. Self-contained dark card (its own
// background + border) so it reads correctly even if the Buttondown account
// template isn't dark-themed.
function buildCard(post) {
  const title = esc(post.title || "(untitled)");
  const url = esc(post.url || "");
  const desc = post.description ? esc(post.description) : "";
  const author = (Array.isArray(post.authors) && post.authors.length)
    ? "by " + esc(post.authors.join(", "))
    : "";
  const date = post.published ? esc(String(post.published).slice(0, 10)) : "";
  const meta = [author, date].filter(Boolean).join("  &middot;  ");
  const tags = (Array.isArray(post.tags) && post.tags.length)
    ? esc(post.tags.join("  ·  "))
    : "";

  const cover = post.image
    ? `<a href="${url}" style="text-decoration:none;">` +
      `<img src="${esc(post.image)}" alt="${title}" width="600" ` +
      `style="display:block;width:100%;max-width:600px;height:auto;border:0;border-bottom:1px solid ${C.brassDeep};" />` +
      `</a>`
    : "";

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="max-width:600px;margin:0 auto 20px auto;background:${C.voidSoft};border:1px solid ${C.brassDeep};">
    <tr><td style="padding:0;">${cover}</td></tr>
    <tr><td style="padding:20px 22px;font-family:${MONO};">
      <a href="${url}" style="color:${C.brass};text-decoration:none;font-size:18px;font-weight:bold;line-height:1.3;">${title}</a>
      ${meta ? `<div style="color:${C.boneDim};font-size:12px;margin-top:8px;">${meta}</div>` : ""}
      ${desc ? `<div style="color:${C.bone};font-size:14px;line-height:1.65;margin-top:14px;">${desc}</div>` : ""}
      <div style="margin-top:18px;">
        <a href="${url}" style="display:inline-block;background:${C.sodium};color:${C.void};text-decoration:none;font-family:${MONO};font-size:13px;font-weight:bold;padding:9px 16px;border:1px solid ${C.sodium};">read the transmission &#9656;</a>
      </div>
      ${tags ? `<div style="color:${C.boneFaint};font-size:11px;margin-top:16px;letter-spacing:0.04em;">${tags}</div>` : ""}
    </td></tr>
  </table>`;
}

// The whole email body: a thin label line over the stacked cards.
function buildBody(posts) {
  const label = posts.length === 1
    ? "// new transmission"
    : `// ${posts.length} new transmissions`;
  const header =
    `<div style="font-family:${MONO};color:${C.brassDeep};font-size:12px;` +
    `letter-spacing:0.12em;text-transform:uppercase;max-width:600px;` +
    `margin:0 auto 14px auto;">${label}</div>`;
  return header + posts.map(buildCard).join("\n");
}

function buildSubject(posts) {
  if (posts.length === 1) return posts[0].title || "(untitled)";
  return `${posts.length} new transmissions`;
}

async function createDraft(subject, body) {
  const res = await fetch(`${API_BASE}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Token ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ subject, body, status: "draft" }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
}

async function main() {
  const [, , newPostsPath, allowlistPath] = process.argv;
  if (!newPostsPath || !allowlistPath) {
    fail("usage: post-buttondown.js <new-posts.json> <newsletter.json>");
  }
  if (!API_KEY && !DRY_RUN) {
    fail("BUTTONDOWN_API_KEY env var not set (or set BUTTONDOWN_DRY_RUN=true)");
  }

  const newPosts = readJson(newPostsPath);
  const allowlist = readJson(allowlistPath);

  if (!Array.isArray(newPosts) || newPosts.length === 0) {
    console.log("[post-buttondown] no new posts; nothing to draft");
    return;
  }
  // Fail-closed: only email posts present in the allowlist. Compare by
  // pathname since the feed urls are absolute and the allowlist is relative.
  const eligiblePaths = new Set(
    (Array.isArray(allowlist) ? allowlist : []).map(pathOf)
  );
  const posts = newPosts.filter((p) => p && p.url && eligiblePaths.has(pathOf(p.url)));

  if (posts.length === 0) {
    console.log("[post-buttondown] no newsletter-eligible new posts; nothing to draft");
    return;
  }

  const subject = buildSubject(posts);
  const body = buildBody(posts);

  if (DRY_RUN) {
    console.log(`[post-buttondown] DRY RUN: would draft 1 email`);
    console.log(`  subject: ${subject}`);
    console.log(`  posts:   ${posts.map((p) => p.url).join(", ")}`);
    console.log(`  body bytes: ${Buffer.byteLength(body, "utf8")}`);
    console.log("----- body -----");
    console.log(body);
    return;
  }

  console.log(`[post-buttondown] drafting 1 email with ${posts.length} digest(s)`);
  try {
    await createDraft(subject, body);
    console.log(`[post-buttondown] ok: draft created (${posts.length} post(s))`);
  } catch (err) {
    fail(`failed creating draft: ${err.message}`);
  }
}

main();
