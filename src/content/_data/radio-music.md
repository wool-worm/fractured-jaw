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
    album: "[[_data/media/music/desecresy/the-secret-of-death/album]]"
    tts_readout: Incoming organic signal detected... sender... DEH SAY CRESSIE... subject... The Secret of Death... click below to decrypt...
  - band: BETA
    frequency: 62
    album: "[[_data/media/music/commodo/uninvited-chokehold-commodo-x-rocks-foe/album]]"
    tts_readout: Incoming organic signal detected... sender... komodo ... subject... Uninvited Chokehold... click below to decrypt...

  # ── GAMMA ──────────────────────────────────────────────────────────────
  - band: GAMMA
    frequency: 6
    album: "[[_data/media/music/bladee/sulfur-surfer/album]]"
    tts_readout: Incoming organic signal detected... sender... Blade... subject... Sulfur Surfer... click below to decrypt...
  - band: GAMMA
    frequency: 14
    album: "[[_data/media/music/aho-ssan/the-sun-turned-black/album]]"
    tts_readout: Incoming organic signal detected... sender... Aho San... subject... The Sun Turned Black... click below to decrypt...
  - band: GAMMA
    frequency: 29
    album: "[[_data/media/music/giant-swan/giant-swan/album]]"
    tts_readout: Incoming organic signal detected... sender... Giant Swan... subject... Giant Swan... click below to decrypt...
  - band: GAMMA
    frequency: 41
    album: "[[_data/media/music/lake-haze/vhs-memories-lp/album]]"
    tts_readout: Incoming organic signal detected... sender... Lake Haze... subject... VHS Memories... click below to decrypt...
  - band: GAMMA
    frequency: 55
    album: "[[_data/media/music/steve-hauschildt/aeropsia/album]]"
    tts_readout: Incoming organic signal detected... sender... Steve Hows child... subject... Air rope sia... click below to decrypt...

  # ── DELTA ──────────────────────────────────────────────────────────────
  - band: DELTA
    frequency: 1
    album: "[[_data/media/music/tim-hecker/shards/album]]"
    tts_readout: Incoming organic signal detected... sender... Tim Hecker... subject... Shards... click below to decrypt...
  - band: DELTA
    frequency: 17
    album: "[[_data/media/music/benjamin-fulwood/the-stars-are-very-far-away-from-all-of-this/album]]"
    tts_readout: Incoming organic signal detected... sender... Benjamin Full wood... subject... The Stars Are Very Far Away From All Of This... click below to decrypt...
  - band: DELTA
    frequency: 36
    album: "[[_data/media/music/lyra-pramuk/hymnal-resung/album]]"
    tts_readout: Incoming organic signal detected... sender... Lyra Prah muk... subject... Hymnal... click below to decrypt...
  - band: DELTA
    frequency: 53
    album: "[[_data/media/music/lust-for-youth-croatian-amor/all-worlds/album]]"
    tts_readout: Incoming organic signal detected... sender... Lust For Youth and Croatian Amor... subject... All Worlds... click below to decrypt...
  - band: DELTA
    frequency: 59
    album: "[[_data/media/music/kita-kouhei/neospecies/album]]"
    tts_readout: Incoming organic signal detected... sender... kita koo hey- 北航平... subject... Neo species... click below to decrypt...
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
  // Use album_name from frontmatter as the link display text. Without
  // this override, every link reads "album" (the literal filename).
  const albumLink = dv.fileLink(page.file.path, false, page.album_name || page.file.name);
  rows.push([coord, artists, albumLink, page.source || "?"]);
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
