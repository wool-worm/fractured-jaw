---
stations:
  # ── ALPHA ──────────────────────────────────────────────────────────────
  - band: ALPHA
    frequency: 6
    album: "[[_data/media/music/skee-mask/compro/album]]"
  - band: ALPHA
    frequency: 18
    album: "[[_data/media/music/boards-of-canada/inferno/album]]"
  - band: ALPHA
    frequency: 28
    album: "[[_data/media/music/blood-incantation/absolute-elsewhere/album]]"
  - band: ALPHA
    frequency: 35
    album: "[[_data/media/music/oklou/choke-enough/album]]"
  - band: ALPHA
    frequency: 61
    album: "[[_data/media/music/otto-taimela/uncommon-fragile/album]]"

  # ── BETA ───────────────────────────────────────────────────────────────
  - band: BETA
    frequency: 1
    album: "[[_data/media/music/body-boys/growth-window/album]]"
  - band: BETA
    frequency: 17
    album: "[[_data/media/music/giant-claw/decadent-stress-chamber/album]]"
  - band: BETA
    frequency: 30
    album: "[[_data/media/music/jan-jelinek/loop-finding-jazz-records/album]]"
  - band: BETA
    frequency: 55
    album: "[[_data/media/music/celine-dessberg/selenge-chintamani/album]]"
  - band: BETA
    frequency: 62
    album: "[[_data/media/music/commodo/uninvited-chokehold/album]]"

  # ── GAMMA ──────────────────────────────────────────────────────────────
  - band: GAMMA
    frequency: 6
  - band: GAMMA
    frequency: 14
  - band: GAMMA
    frequency: 29
  - band: GAMMA
    frequency: 41
  - band: GAMMA
    frequency: 55

  # ── DELTA ──────────────────────────────────────────────────────────────
  - band: DELTA
    frequency: 1
  - band: DELTA
    frequency: 17
  - band: DELTA
    frequency: 36
  - band: DELTA
    frequency: 53
  - band: DELTA
    frequency: 59
---

# Radio music stations

This file is the pointer table mapping radio dial coordinates to album notes.
There are 20 pre-assigned `(band, frequency)` slots; each populated slot
overrides its `carrier_wave` channel with a real Bandcamp embed on the dial.

## To add a station

1. Create an album note at `_data/media/music/<artist-slug>/<album-slug>/album.md`
   (or use the Bandcamp Wizard plugin once it's built). Frontmatter schema:

   ```yaml
   artists: [<primary>, <featured>, ...]   # artists[0] owns the folder
   album_name: <title>
   bandcamp_album_id: <numeric id>
   bandcamp_track_id:                       # optional, flips to single-track embed
   label: <label>
   date_released: <YYYY-MM-DD>
   genre: <string or array>
   subgenre: [<s1>, <s2>, ...]
   tts_readout: "Incoming organic signal... sender... <phonetic artist>... subject... <phonetic album>... click below to decrypt..."
   ```

2. Pick an unpopulated slot above and add an `album:` wikilink to its entry:

   ```yaml
     - band: GAMMA
       frequency: 6
       album: "[[_data/media/music/<artist-slug>/<album-slug>/album]]"
   ```

3. Optionally add a `review_link:` to the station entry if you want a
   per-station override for the in-widget "> read review" link (otherwise
   the widget shows no review link for this station):

   ```yaml
       review_link: "[[media/<your-review-slug>]]"
   ```

## To remove a station

Delete the `album:` wikilink from the entry. The slot becomes unpopulated and
falls back to `carrier_wave` on the dial. (You can leave the album note in
place; it stays a valid record for `{% bandcamp %}` shortcode use in reviews.)

## Coordinates are fixed

The 20 slots above are baked into the design. Don't change `band` /
`frequency` values — they're chosen for even visual spacing on the dial.
Adding a 21st station means picking a new coordinate, which requires
re-tuning the spacing. See [[radio-widget#Bandcamp music stations]] for the
geometry rationale.

## Phonetic TTS readouts

The `tts_readout` is what the synthesized voice reads on the dial when the
station is tuned. Write phonetically if the TTS engine mispronounces names
(e.g. "Boards of Canada" can be `boords of canada`, "Oklou" → `ok lou`).

Reference for genre / subgenre values lives in [[genre-mapping]].
