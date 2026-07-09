// Single source of truth for the site's fingerprinted static assets.
//
// Why this exists: site.css and the /assets/js/*.js files are served with a
// 1-year immutable browser cache (Cloudflare Browser Cache TTL). That is great
// for performance but deadly for correctness when the URL never changes: a
// returning visitor's browser holds the old bytes for up to a year and never
// re-requests them, so a deploy ships new HTML against stale CSS/JS (the
// "garbled mess"). Cloudflare's edge purge cannot fix this, because it only
// clears Cloudflare's own copy, not a max-age already sitting in someone's
// browser.
//
// The fix is content-hashed (fingerprinted) filenames. When a file's bytes
// change, its public URL changes (site.<hash>.css), so the browser fetches the
// new one immediately while still caching each unique URL forever. This module
// computes those hashes once and hands the name -> URL map to:
//   - src/_data/assets.js    (templates reference {{ assets["site.css"] }})
//   - src/site-css.11ty.js   (emits the CSS bundle at its hashed permalink)
//   - src/assets-js.11ty.js  (emits each JS file at its hashed permalink)
// Routing all consumers through one memoized manifest guarantees they agree.
//
// No new dependency and no separate build step: this runs inside the normal
// Eleventy build using Node built-ins (crypto, fs, path), same as the existing
// .11ty.js emitters. It does NOT introduce a bundler.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CSS_DIR = path.join(__dirname, "..", "_css");
const JS_DIR = path.join(__dirname, "..", "assets", "js");

// CSS cascade order. This is the authoritative list; site-css.11ty.js imports
// buildCss() rather than keeping its own copy. To add a module, add it here in
// the right position. zen.css stays last so its html.zen rules win cascade ties
// over cult.css (see the zen-mode docs).
const CSS_MODULES = [
  "variables.css",
  "fonts.css",
  "base.css",
  "layout.css",
  "components.css",
  "decoration.css",
  "effects.css",
  "graph.css",
  "radio.css",
  "systems.css",
  "cult.css",
  "zen.css",
];

// 8 hex chars of SHA-256 is ample for cache-busting and keeps filenames short.
// The hash only needs to change when bytes change, which it does.
function hash8(str) {
  return crypto.createHash("sha256").update(str).digest("hex").slice(0, 8);
}

// Concatenate the CSS modules into the single bundled stylesheet. This is the
// exact string site-css.11ty.js serves, so hashing it fingerprints what ships.
// Relative url(...) references inside the modules (e.g. fonts.css -> 'fonts/..')
// resolve against the bundle's directory (/assets/css/), which is unchanged by
// the filename hash, so fonts keep resolving.
//
// The bundle is lightly minified: comments stripped, per-line indentation
// trimmed, blank lines dropped. Deliberately conservative and dependency-
// free — no token-level rewriting, so string values (the ticker's content:
// text, font names) can't be mangled. The authoring modules in src/_css/
// keep their comments; only the shipped bundle loses them (~40% smaller).
// CSS strings cannot span lines unescaped, so per-line trimming is safe.
function buildCss() {
  const bundle = CSS_MODULES.map((name) =>
    fs.readFileSync(path.join(CSS_DIR, name), "utf8")
  ).join("\n");
  return bundle
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length)
    .join("\n");
}

// Memoized so the data file, the CSS template, and the JS template all see the
// same hashes within a build. In `eleventy --serve` this also means an edited
// file keeps its first-computed URL for the session: the served bytes are still
// fresh (the emitters re-read the file on each rebuild, triggered by the
// existing src/assets/ and src/_css/ watch targets), the URL hash is just
// stable, so nothing 404s. A production build is a fresh process, so its hashes
// are always accurate to the bytes shipped.
let _manifest = null;
function getManifest() {
  if (_manifest) return _manifest;
  const manifest = {
    "site.css": `/assets/css/site.${hash8(buildCss())}.css`,
  };
  for (const file of fs.readdirSync(JS_DIR)) {
    if (!file.endsWith(".js")) continue;
    const contents = fs.readFileSync(path.join(JS_DIR, file), "utf8");
    const base = file.slice(0, -".js".length);
    manifest[file] = `/assets/js/${base}.${hash8(contents)}.js`;
  }
  _manifest = manifest;
  return manifest;
}

module.exports = { CSS_MODULES, buildCss, hash8, getManifest, JS_DIR };
