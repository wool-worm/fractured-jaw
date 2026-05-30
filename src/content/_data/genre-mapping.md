---
# Genre to subgenre mapping for the radio music stations.
#
# This file is the source of truth for the genre/subgenre dropdowns that
# meta-bind populates in radio-music.md. Replace the placeholder examples
# below with your actual genre tree; the shape is what matters.
#
# Shape:
#   genres:
#     <genre-key>:
#       - <subgenre>
#       - <subgenre>
#     <another-genre>:
#       - <subgenre>
#
# The build pipeline does NOT validate radio-music entries against this file:
# the radio-music emitter passes through whatever the author selected, on the
# assumption that meta-bind itself constrains the choices at edit time. So the
# only consumer of this file is meta-bind. Add, rename, or remove freely.
genres:
  rock:
    - classic rock
    - hard rock
    - alternative rock
    - indie rock
    - progressive rock
    - psychedelic rock
    - garage rock
    - grunge
    - post-rock
    - math rock
    - noise rock
    - shoegaze
    - dream pop
    - krautrock
    - punk
    - hardcore punk
    - pop punk
    - post-punk
    - emo
  metal:
    - heavy metal
    - thrash metal
    - death metal
    - technical death metal
    - melodic death metal
    - brutal death metal
    - black metal
    - atmospheric black metal
    - symphonic black metal
    - post-black metal
    - raw black metal
    - depressive black metal
    - doom metal
    - funeral doom
    - stoner metal
    - sludge metal
    - power metal
    - progressive metal
    - nu metal
    - metalcore
    - deathcore
    - grindcore
    - post-metal
    - folk metal
    - symphonic metal
    - gothic metal
    - industrial metal
    - drone metal
  pop:
    - synth-pop
    - dance-pop
    - indie pop
    - art pop
    - bedroom pop
    - hyperpop
    - electropop
    - chamber pop
    - baroque pop
    - k-pop
    - j-pop
  hip-hop:
    - boom bap
    - trap
    - drill
    - gangsta rap
    - conscious hip-hop
    - cloud rap
    - lo-fi hip-hop
    - g-funk
    - jazz rap
    - alternative hip-hop
    - dirty south
    - east coast hip-hop
    - west coast hip-hop
    - mumble rap
    - phonk
  electronic:
    - house
    - deep house
    - tech house
    - acid house
    - progressive house
    - french house
    - lo-fi house
    - techno
    - detroit techno
    - minimal techno
    - dub techno
    - industrial techno
    - acid techno
    - trance
    - psytrance
    - progressive trance
    - goa trance
    - drum and bass
    - liquid dnb
    - neurofunk
    - jump-up
    - dubstep
    - uk garage
    - 2-step
    - ambient
    - dark ambient
    - ambient techno
    - drone ambient
    - dungeon synth
    - idm
    - darkwave
    - synthwave
    - vaporwave
    - breakbeat
    - breakcore
    - hardstyle
    - jungle
    - trip-hop
    - downtempo
    - future bass
    - electro
    - ebm
    - jersey club
    - witch house
    - glitch
    - phonk
  r-and-b:
    - classic soul
    - motown
    - funk
    - neo-soul
    - contemporary r-and-b
    - alternative r-and-b
  jazz:
    - new orleans jazz
    - ragtime
    - swing
    - big band
    - bebop
    - cool jazz
    - hard bop
    - post-bop
    - modal jazz
    - free jazz
    - avant-garde jazz
    - spiritual jazz
    - jazz fusion
    - jazz funk
    - soul jazz
    - smooth jazz
    - acid jazz
    - latin jazz
    - gypsy jazz
    - vocal jazz
  blues:
    - delta blues
    - chicago blues
    - electric blues
    - country blues
    - blues rock
  country:
    - classic country
    - outlaw country
    - bluegrass
    - country rock
    - pop country
    - americana
    - alt-country
    - neotraditional country
  folk:
    - traditional folk
    - folk rock
    - contemporary folk
    - indie folk
    - singer-songwriter
    - celtic
  classical:
    - baroque
    - classical period
    - romantic
    - modern classical
    - contemporary classical
    - opera
    - minimalism
    - choral
    - neoclassical
  reggae:
    - roots reggae
    - dub
    - dancehall
    - ska
    - rocksteady
  latin:
    - salsa
    - reggaeton
    - bachata
    - merengue
    - cumbia
    - bossa nova
    - latin pop
    - tango
    - mariachi
  world:
    - afrobeat
    - afropop
    - highlife
    - flamenco
    - indian classical
    - bhangra
    - arabic pop
    - klezmer
  gospel-and-religious:
    - traditional gospel
    - contemporary christian
    - spirituals
    - ccm
  experimental:
    - noise
    - avant-garde
    - drone
    - musique concrète
    - free improvisation
    - other
    - sound design
---

# Genre Mapping

Reference tree for the `genre` / `subgenre` text fields in `[[radio-music]]`.
Edit the `genres:` frontmatter above to add or rearrange entries; the live
view below re-renders automatically. Not consumed by the build pipeline,
purely an editor-side reference.

```dataviewjs
const genres = dv.current().genres;
if (!genres) {
  dv.paragraph("No `genres` field in this file's frontmatter.");
} else {
  for (const [genre, subs] of Object.entries(genres)) {
    dv.header(4, genre);
    dv.list(subs);
  }
}
```
