// Convert any string to a URL-safe slug.
//
// Rules (deterministic so a writer can predict the URL from a filename):
//   - Lowercase
//   - Strip diacritics (Café → cafe)
//   - Drop everything that isn't a letter, digit, space, underscore, or hyphen
//   - Spaces collapse to single hyphens
//   - Underscores are preserved as-is so writers can opt into snake_case
//     filenames (e.g. `network_nodes.md` → /network_nodes/) for cyberpunk
//     aesthetic. URL-safe per RFC 3986.
//   - No leading or trailing hyphens
//
// Examples:
//   "My Great Post"            → "my-great-post"
//   "network_nodes"            → "network_nodes"
//   "My Friend's \"Wild\" Trip!" → "my-friends-wild-trip"
//   "Café — au lait"           → "cafe-au-lait"
function slugify(input) {
  return String(input)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
}

module.exports = slugify;
