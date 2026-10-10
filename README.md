# Shivam Dwivedi — portfolio

**Live:** https://shivamdwivedi06.github.io/portfolio/

A single-page portfolio with an interactive 3D world, **The Flight**, written in plain WebGL with no libraries.

- One self-contained HTML file; the only network dependencies are Google Fonts and the files in `assets/`, which load when a visitor takes the flight.
- The background is a live contour-field shader; the name in the hero is drawn inside it and tracks scroll.
- The Flight: five acts over open ground, a pickup by an air taxi, a city of real building models with procedurally lit facades, and a climb up a tower whose floors are the sections of the page. Every project has a station you can open; the lift stops at each floor.

## Run it

Any static server works (the assets are fetched relatively, so `file://` is fine in most browsers too):

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```

## Edit it

The page is built from two sources:

| File | What it holds |
|---|---|
| `src/base.html` | design tokens and CSS, the background shader, the content arrays (`PROJECTS`, `EXPERIENCE`, `DOMAINS`, `SKILL_LINKS`), the page rendering and chrome, the flight HUD and panel markup |
| `src/survey.js` | The Flight: terrain, city, stations, floors, the craft, the camera, lighting, input, the panel logic |

After changing either, rebuild:

```sh
./build.sh          # cat src/base.html src/survey.js > index.html
```

**Adding a project** — append an entry to `PROJECTS` in `src/base.html`. The card, index row, filters, skill cross-links, flight station and its signage board all follow from the data.
**Adding a section** — add it to `FL` in `src/survey.js` (and `SECTION_ID` / `FLOOR_SUB` / `floorHTML`), plus the rail in `src/base.html`.
**Timings** — `STATION_HOLD`, `AUTO_LEAVE` and `STATION_LEAD` at the top of `src/survey.js`.

## Assets and tooling

`assets/` holds the runtime files (plus `og.jpg`, the share image, and `favicon.svg`). `tools/` holds the Python used to produce them (needs `numpy` and `opencv-python`):

- `gltf2.py` — loads a glTF scene as a world-space triangle soup with UVs, material and node ids.
- `pack_meshes.py [gridRes]` — bakes textures to vertex colours, decimates by vertex clustering, and packs the building prototypes into `assets/bldg.js` (20-byte interleaved vertices: `pos i16×3 | nrm i8×3 | metal | col u8×3 sRGB | rough | emi u8×3`).
- `pack_craft.py 260` — the same for the air taxi → `assets/craft.js`.
- `preview.py` — a small software rasteriser for checking a packed mesh.

The source models and textures are not in the repository (see `.gitignore`); download them from the links in `CREDITS.md` and unpack into `tools/in/`.

## Deploy on GitHub Pages

Settings → Pages → *Deploy from a branch* → `main` / `/ (root)`. `index.html` and `assets/` are everything the site needs; `.nojekyll` keeps Pages from touching them.

The share-image tags in the head point at the live address above; change them if the site moves to another domain.

## Licence

Code and copy: MIT (see `LICENSE`). Third-party assets keep their own licences — see `CREDITS.md`.
