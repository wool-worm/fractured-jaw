---
stations:
  # ── ALPHA ──────────────────────────────────────────────────────────────
  - band: ALPHA
    frequency: 6
    album: "[[_data/media/music/skee-mask/compro/album]]"
    tts_readout: Incoming organic signal detected... sender... Ski Mask... subject... Com pro... click below to decrypt...
  - band: ALPHA
    frequency: 18
    album: "[[_data/media/music/boards-of-canada/inferno/album]]"
    tts_readout: Incoming organic signal detected... sender... boards of canada... subject... inferno... click below to decrypt...
  - band: ALPHA
    frequency: 28
    album: "[[_data/media/music/blood-incantation/absolute-elsewhere/album]]"
    tts_readout: Incoming organic signal detected... sender... blood incantation... subject... absolute elsewhere... click below to decrypt...
  - band: ALPHA
    frequency: 35
    album: "[[_data/media/music/oklou/choke-enough/album]]"
    tts_readout: Incoming organic signal detected... sender... ok lou... subject... choke enough... click below to decrypt...
  - band: ALPHA
    frequency: 61
    album: "[[_data/media/music/otto-taimela/uncommon-fragile/album]]"
    tts_readout: Incoming organic signal detected... sender... otto tiemeala... subject... uncommon and fragile... click below to decrypt...

  # ── BETA ───────────────────────────────────────────────────────────────
  - band: BETA
    frequency: 1
    album: "[[_data/media/music/body-boys/growth-window/album]]"
    tts_readout: Incoming organic signal detected... sender... body boys... subject... growth window... click below to decrypt...
  - band: BETA
    frequency: 17
    album: "[[_data/media/music/giant-claw/decadent-stress-chamber/album]]"
    tts_readout: Incoming organic signal detected... sender... giant claw... subject... decadent stress chamber... click below to decrypt...
  - band: BETA
    frequency: 30
    album: "[[_data/media/music/jan-jelinek/loop-finding-jazz-records/album]]"
    tts_readout: Incoming organic signal detected... sender... yawn yellinick... subject... loop finding jazz records... click below to decrypt...
  - band: BETA
    frequency: 55
    album: "[[_data/media/music/celine-dessberg/selenge-chintamani/album]]"
    tts_readout: Incoming organic signal detected... sender... celine dessberg... click below to decrypt...
  - band: BETA
    frequency: 62
    album: "[[_data/media/music/commodo/uninvited-chokehold/album]]"
    tts_readout: Incoming organic signal detected... sender... komodo... subject... uninvited chokehold... click below to decrypt...

  # ── GAMMA ──────────────────────────────────────────────────────────────
  - band: GAMMA
    frequency: 6
    album: "[[_data/media/music/skee-mask/itlp09-pool/album]]"
    tts_readout: Incoming organic signal detected... sender... Skee Mask... subject... ITLP09 - Pool... click below to decrypt...
  - band: GAMMA
    frequency: 14
    album: "[[_data/media/music/joel-lyssarides/late-on-earth/album]]"
    tts_readout: Incoming organic signal detected... sender... Joel Liss saridees... subject... Late on Earth... click below to decrypt...
  - band: GAMMA
    frequency: 29
    album: "[[_data/media/music/giant-swan/giant-swan/album]]"
    tts_readout: Incoming organic signal detected... sender... Giant Swan... subject... Unknown... click below to decrypt...
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

Pointer table mapping the 20 pre-assigned radio dial coordinates to album
notes under `_data/media/music/`. Each populated slot overrides its
`carrier_wave` channel with a real Bandcamp embed on the dial; unpopulated
slots stay as `carrier_wave` noise.

## Currently assigned

```dataviewjs
const stations = dv.current().stations || [];
const bandOrder = { ALPHA: 0, BETA: 1, GAMMA: 2, DELTA: 3 };
const rows = [];

for (const s of stations) {
  if (!s.album) continue;
  const coord = `${s.band} 0x${s.frequency.toString(16).toUpperCase().padStart(2, "0")}`;
  const albumPath = typeof s.album === "object" && s.album.path
    ? s.album.path
    : String(s.album).replace(/^\[\[|\]\]$/g, "");
  const page = dv.page(albumPath);
  if (!page) {
    rows.push([coord, "(broken link)", albumPath, "—"]);
    continue;
  }
  const artists = Array.isArray(page.artists) && page.artists.length
    ? page.artists.join(", ")
    : "?";
  rows.push([coord, artists, page.file.link, page.source || "?"]);
}

rows.sort((a, b) => {
  const [aBand, aFreq] = a[0].split(" ");
  const [bBand, bFreq] = b[0].split(" ");
  if (bandOrder[aBand] !== bandOrder[bBand]) return bandOrder[aBand] - bandOrder[bBand];
  return parseInt(aFreq, 16) - parseInt(bFreq, 16);
});

dv.table(["Coord", "Artist(s)", "Album", "Source"], rows);
```

## Adding / removing stations

Use the **Music Embed Wizard** plugin (command: `Insert music embed`). Its
"Add to radio station" toggle picks a band + frequency from the dropdown
(which shows current occupancy), writes the album wikilink and
`tts_readout` into the matching pointer entry above, and handles the rest.
See [[music-embed-wizard]] for the full workflow.

To remove a station, delete the `album:` and `tts_readout:` lines from
its entry above. The slot reverts to `carrier_wave`. The album note stays
in place — it's still a valid `{% bandcamp %}` shortcode target in
reviews.

## Don't touch the coordinates

The 20 `(band, frequency)` pairs are baked into the design (even visual
spacing on the dial). Adding a 21st station requires re-tuning the whole
geometry. See [[radio-widget#Bandcamp music stations]] for the math.
