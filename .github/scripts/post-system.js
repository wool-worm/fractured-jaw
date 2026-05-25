#!/usr/bin/env node
// Post a single plain-text deploy status message to the system webhook.
//
// Driven entirely by env vars set in the workflow:
//
//   DISCORD_WEBHOOK_SYSTEM  required — system webhook URL
//   DEPLOY_STATUS           required — "ok" | "failed" | "build_failed"
//   COMMIT_SHA              required — full 40-char SHA
//   COMMIT_MSG              optional — first line shown on success
//   DEPLOY_URL              optional — Pages URL (success only)
//   RUN_URL                 optional — workflow run page (failure only)
//
// The webhook itself carries the "system" display name + avatar (set in
// Discord's webhook UI), so we don't override either per-message.

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_SYSTEM;

function fail(msg) {
  console.error(`[post-system] ${msg}`);
  process.exit(1);
}

function utcStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}

function shortSha(sha) {
  return String(sha || "").slice(0, 7) || "unknown";
}

function firstLine(text) {
  return String(text || "").split(/\r?\n/)[0].trim();
}

function buildMessage() {
  const status = process.env.DEPLOY_STATUS || "";
  const stamp = utcStamp();
  const sha = shortSha(process.env.COMMIT_SHA);

  if (status === "ok") {
    const msg = firstLine(process.env.COMMIT_MSG);
    const preview = process.env.DEPLOY_URL || "https://fractured-jaw.com";
    const lines = [
      `\\> deploy :: ${stamp} :: ok`,
      msg ? `commit: ${sha} "${msg}"` : `commit: ${sha}`,
      `preview: ${preview}`,
    ];
    return lines.join("\n");
  }

  if (status === "failed" || status === "build_failed") {
    const stageLabel = status === "build_failed" ? "BUILD FAILED" : "FAILED";
    const runUrl = process.env.RUN_URL || "";
    const lines = [
      `\\> deploy :: ${stamp} :: ${stageLabel}`,
      `commit: ${sha}`,
    ];
    if (runUrl) lines.push(`log: ${runUrl}`);
    return lines.join("\n");
  }

  fail(`unknown DEPLOY_STATUS: "${status}" (expected ok|failed|build_failed)`);
}

async function postContent(content) {
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
}

async function main() {
  if (!WEBHOOK_URL) fail("DISCORD_WEBHOOK_SYSTEM env var not set");

  const content = buildMessage();
  try {
    await postContent(content);
    console.log(`[post-system] ok`);
  } catch (err) {
    fail(`failed to post: ${err.message}`);
  }
}

main();
