// Global data `assets`: maps each fingerprinted asset's logical name to its
// content-hashed public URL. Templates reference it instead of a hardcoded
// path:
//   <link rel="stylesheet" href="{{ assets['site.css'] }}">
//   <script src="{{ assets['radio-widget.js'] }}" defer></script>
//
// Why: assets are served with a 1-year immutable browser cache, so the URL
// must change when the bytes change or returning visitors keep the stale copy
// (Cloudflare's edge purge can't reach a max-age already in a browser). The
// hashed filename makes each version a distinct URL. See
// src/utils/asset-manifest.js for the hashing, src/site-css.11ty.js and
// src/assets-js.11ty.js for the matching emitters.
const { getManifest } = require("../utils/asset-manifest");

module.exports = () => getManifest();
