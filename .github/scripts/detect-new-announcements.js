#!/usr/bin/env node
// Compare the previously-live /announcements.json against the freshly-built
// one and emit a JSON payload of newly-published announcements for the
// Discord announcements webhook.
//
// Inputs:
//   argv[2]: path to the previous (live) announcements.json snapshot
//   argv[3]: path to the new announcements.json (_site/announcements.json)
//   argv[4]: path to write the new-announcements payload to
//
// Behavior:
//   - "New" = an entry whose `id` is in the new file but absent from the
//     previous one. Edits keep the same id (the UTC publish instant), so
//     editing an announcement's body does not re-announce it.
//   - BASELINE-SAFE FIRST RUN: if the previous snapshot is missing or not
//     valid JSON (e.g. the very first deploy after this feature ships, when
//     /announcements.json does not exist on the live site yet, so the curl
//     404s), we treat it as "establish a baseline" and announce NOTHING.
//     This is the deliberate inverse of detect-new-posts.js's loud fail:
//     for announcements we must never spam the existing backlog on first run.
//     A valid-but-empty previous (`[]`, the endpoint exists and is genuinely
//     empty) IS a real state and diffs normally, so the first announcement
//     added after launch announces correctly.

const fs = require("fs");

function readJsonArrayOrNull(path) {
  let raw;
  try {
    raw = fs.readFileSync(path, "utf8");
  } catch (e) {
    return null; // file absent (curl failed / first run)
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null; // 404 HTML page or other non-JSON body
  }
}

function main() {
  const [, , previousPath, newPath, outputPath] = process.argv;
  if (!previousPath || !newPath || !outputPath) {
    console.error(
      "usage: detect-new-announcements.js <previous.json> <new.json> <output.json>"
    );
    process.exit(1);
  }

  const current = readJsonArrayOrNull(newPath) || [];
  const previous = readJsonArrayOrNull(previousPath);

  let toAnnounce = [];

  if (previous === null) {
    // First run / unreachable endpoint: baseline only, announce nothing.
    console.log(
      "[detect-new-announcements] no valid previous snapshot; establishing " +
      "baseline, announcing nothing"
    );
  } else {
    const previousIds = new Set(
      previous.map((a) => a && a.id).filter(Boolean)
    );
    toAnnounce = current.filter((a) => a && a.id && !previousIds.has(a.id));
    // Oldest-first so the channel reads top-to-bottom in publish order.
    toAnnounce.sort((a, b) => String(a.iso).localeCompare(String(b.iso)));
  }

  fs.writeFileSync(outputPath, JSON.stringify(toAnnounce, null, 2));
  console.log(
    `[detect-new-announcements] previous=${previous === null ? "none" : previous.length} ` +
    `current=${current.length} to-announce=${toAnnounce.length}`
  );
}

main();
