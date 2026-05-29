#!/usr/bin/env node
// Post one Discord embed per new announcement to the announcements webhook.
//
// Input: a JSON file (produced by detect-new-announcements.js) containing an
// array of announcement records, each with { id, author, body, iso }. The
// webhook itself carries the display name and avatar (set in Discord's
// webhook UI); we don't override either per-message.
//
// Distinct from post-dispatches.js (content posts): announcements have no
// title/url/tags/cover image, just a short body + author + timestamp. The
// embed uses an ichor-purple sidebar to match the in-widget "incoming
// message" accent, so the two channels read as visually different streams.
//
// Rate limit defense: Discord webhooks cap at 30 messages per 60 seconds. A
// 2-second sleep between posts keeps us well under that.
//
// Exits 0 when the payload is empty (nothing new). Exits 1 if a post fails
// so the workflow surfaces the problem.

const fs = require("fs");

// #9b3ab8 (--ichor-bright) as a Discord integer color.
const COLOR_ICHOR = 0x9b3ab8;

const RATE_LIMIT_DELAY_MS = 2000;

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_ANNOUNCEMENTS;

function fail(msg) {
  console.error(`[post-announcements] ${msg}`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildEmbed(ann) {
  const embed = {
    title: "incoming message",
    description: ann.body || "(no content)",
    color: COLOR_ICHOR,
  };
  if (ann.iso) embed.timestamp = ann.iso;
  if (ann.author) embed.author = { name: "by " + ann.author };
  return embed;
}

async function postEmbed(embed) {
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
}

async function main() {
  const payloadPath = process.argv[2];
  if (!payloadPath) fail("usage: post-announcements.js <new-announcements.json>");
  if (!WEBHOOK_URL) fail("DISCORD_WEBHOOK_ANNOUNCEMENTS env var not set");

  let items;
  try {
    items = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
  } catch (err) {
    fail(`cannot read or parse ${payloadPath}: ${err.message}`);
  }

  if (!Array.isArray(items) || items.length === 0) {
    console.log("[post-announcements] nothing to announce");
    return;
  }

  console.log(`[post-announcements] posting ${items.length} announcement(s)`);

  for (let i = 0; i < items.length; i++) {
    const ann = items[i];
    try {
      await postEmbed(buildEmbed(ann));
      console.log(`[post-announcements] ok: ${ann.id}`);
    } catch (err) {
      fail(`failed posting ${ann.id}: ${err.message}`);
    }
    if (i < items.length - 1) await sleep(RATE_LIMIT_DELAY_MS);
  }
}

main();
