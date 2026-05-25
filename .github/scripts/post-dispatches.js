#!/usr/bin/env node
// Post one Discord embed per new post to the dispatches webhook.
//
// Input: a JSON file (produced by detect-new-posts.js) containing an
// array of post records, each with { title, url, description, authors,
// tags, published, image }. The webhook itself carries the display name
// ("dispatch") and avatar (set in Discord's webhook UI); we don't
// override either per-message.
//
// Rate limit defense: Discord webhooks cap at 30 messages per 60 seconds.
// A 2-second sleep between posts keeps us comfortably under that even in
// the unlikely scenario of many posts landing in one push.
//
// Exits 0 when the payload is empty (nothing to announce). Exits 1 if a
// post fails to send so the workflow surfaces the problem.

const fs = require("fs");

// #ffaa33 (sodium) as a Discord integer color.
const COLOR_SODIUM = 0xffaa33;

const RATE_LIMIT_DELAY_MS = 2000;

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_DISPATCHES;

function fail(msg) {
  console.error(`[post-dispatches] ${msg}`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildEmbed(post) {
  const embed = {
    title: post.title || "(untitled)",
    url: post.url,
    color: COLOR_SODIUM,
  };

  if (post.published) embed.timestamp = post.published;

  if (post.description) {
    embed.description = post.description;
  }

  if (Array.isArray(post.authors) && post.authors.length) {
    embed.author = { name: "by " + post.authors.join(", ") };
  }

  if (post.image) {
    embed.image = { url: post.image };
  }

  if (Array.isArray(post.tags) && post.tags.length) {
    embed.fields = [
      {
        name: "tags",
        value: post.tags.join(" · "),
        inline: false,
      },
    ];
  }

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
  if (!payloadPath) fail("usage: post-dispatches.js <new-posts.json>");
  if (!WEBHOOK_URL) fail("DISCORD_WEBHOOK_DISPATCHES env var not set");

  let posts;
  try {
    posts = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
  } catch (err) {
    fail(`cannot read or parse ${payloadPath}: ${err.message}`);
  }

  if (!Array.isArray(posts) || posts.length === 0) {
    console.log("[post-dispatches] nothing to announce");
    return;
  }

  console.log(`[post-dispatches] posting ${posts.length} dispatch(es)`);

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    try {
      await postEmbed(buildEmbed(post));
      console.log(`[post-dispatches] ok: ${post.url}`);
    } catch (err) {
      fail(`failed posting ${post.url}: ${err.message}`);
    }
    if (i < posts.length - 1) await sleep(RATE_LIMIT_DELAY_MS);
  }
}

main();
