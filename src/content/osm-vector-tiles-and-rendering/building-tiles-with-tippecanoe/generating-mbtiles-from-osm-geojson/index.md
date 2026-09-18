---
title: "Generating MBTiles from OSM GeoJSON"
description: "A complete, reproducible run from a verified OSM extract to an MBTiles archive: export per layer, rank, build, and verify the archive's metadata and a sample tile before shipping it."
pageTitle: "From an OSM Extract to an MBTiles Archive, Reproducibly"
pageDescription: "Export OSM layers to line-delimited GeoJSON, rank and build with Tippecanoe, then verify the MBTiles metadata, tile counts and a decoded sample tile before the archive is published."
slug: generating-mbtiles-from-osm-geojson
type: article
breadcrumb: "Generating MBTiles"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Generating MBTiles from OSM GeoJSON

Run the whole chain — extract to layers to ranked GeoJSON to an archive — with enough checks at the end that you know the archive is correct without opening a map.

## Prerequisites

- [ ] A verified regional extract, per [Automating Geofabrik Extract Downloads with Checksums](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/automating-geofabrik-extract-downloads-with-checksums/).
- [ ] `osmium-tool` and `tippecanoe` on the path, plus Python 3.10+ with `mapbox-vector-tile` for the verification.
- [ ] The ranking script from [Tuning Tippecanoe Zoom and Feature Dropping](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/building-tiles-with-tippecanoe/tuning-tippecanoe-zoom-and-feature-dropping/).
- [ ] A decided layer list — names, tag filters and zoom ranges — before any command runs.
- [ ] Disk for the intermediate GeoJSON, which is several times the extract size.

## Conceptual minimum

An MBTiles archive is a SQLite database with two things that matter: a `tiles` table keyed on zoom, column and row, and a `metadata` table of key-value pairs describing the tile set. The metadata is not decoration — clients read `minzoom`, `maxzoom`, `bounds` and the `json` field describing layers and their attributes, and a client given an archive with wrong metadata will request tiles that do not exist or fail to find the layers a style names.

The row numbering is the detail that catches people out. MBTiles stores rows in **TMS** order, where row 0 is at the bottom, while the tile addressing used by most web clients and by the tile pyramid model puts row 0 at the top. The conversion is \\(y_{\text{tms}} = 2^{z} - 1 - y\\), and getting it wrong produces a map that is vertically mirrored at the archive level — every tile individually correct, in the wrong place.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 226" role="img" aria-labelledby="gmg1-t gmg1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="gmg1-t">The four stages of a build and the artefact each one produces</title>
  <desc id="gmg1-d">Four consecutive stages. The filter stage runs osmium over the verified extract once per layer, producing a small PBF holding only that layer's features. The export stage converts each layer PBF into line-delimited GeoJSON with stable identifiers. The rank stage adds per-feature minimum and maximum zoom properties derived from the tags. The build stage runs the generator over every ranked layer at once, producing a single MBTiles archive with metadata describing all of them.</desc>
  <rect x="0" y="0" width="880" height="226" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four stages, four artefacts, one archive</text>
  <rect x="26" y="56" width="203" height="54" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="128" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">filter</text>
  <text x="128" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">per-layer PBF</text>
  <text x="128" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">osmium tags-filter</text>
  <text x="128" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">one pass per layer</text>
  <text x="128" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">smallest intermediate</text>
  <rect x="233" y="56" width="203" height="54" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="334" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">export</text>
  <text x="334" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">GeoJSON lines</text>
  <text x="334" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">osmium export</text>
  <text x="334" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">stable type-prefixed ids</text>
  <text x="334" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">largest intermediate</text>
  <rect x="440" y="56" width="203" height="54" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="542" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">rank</text>
  <text x="542" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">ranked GeoJSON</text>
  <text x="542" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">minzoom and maxzoom</text>
  <text x="542" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">from the OSM tags</text>
  <text x="542" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">the cartographic decision</text>
  <rect x="647" y="56" width="203" height="54" rx="6" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="748" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">build</text>
  <text x="748" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">MBTiles</text>
  <text x="748" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">all layers in one run</text>
  <text x="748" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">metadata written once</text>
  <text x="748" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">the shipped artefact</text>
  <text x="868" y="210" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Running the generator once over all layers rather than once per layer is what produces a single coherent metadata record.</text>
</svg>
<figcaption>The export stage produces by far the largest intermediate, which is why filtering happens before it rather than after.</figcaption>
</figure>

## Runnable solution

```bash
#!/usr/bin/env bash
# Build an MBTiles archive from a verified OSM extract.
set -euo pipefail

EXTRACT="${1:?usage: build.sh <extract.osm.pbf>}"
WORK="$(mktemp -d)"
OUT="osm.mbtiles"
MAXZOOM=14
trap 'rm -rf "$WORK"' EXIT

# One filter pass per layer. Each reads the extract once and writes a small file.
filter_layer () {   # name, then osmium tags-filter expressions
  local name="$1"; shift
  osmium tags-filter --output "$WORK/$name.osm.pbf" "$EXTRACT" "$@"
  osmium export --output-format=geojsonseq --add-unique-id=type_id \
    --output "$WORK/$name.geojsonseq" "$WORK/$name.osm.pbf"
  python3 assign_zoom.py < "$WORK/$name.geojsonseq" > "$WORK/$name.ranked.geojsonseq"
  wc -l < "$WORK/$name.ranked.geojsonseq" | xargs echo "$name features:"
}

filter_layer transportation w/highway r/route=road
filter_layer water          nwr/natural=water nwr/waterway w/landuse=reservoir
filter_layer landuse        nwr/landuse nwr/leisure=park nwr/natural=wood
filter_layer place          n/place

tippecanoe \
  --output="$OUT" --force \
  --minimum-zoom=0 --maximum-zoom="$MAXZOOM" \
  --named-layer=transportation:"$WORK/transportation.ranked.geojsonseq" \
  --named-layer=water:"$WORK/water.ranked.geojsonseq" \
  --named-layer=landuse:"$WORK/landuse.ranked.geojsonseq" \
  --named-layer=place:"$WORK/place.ranked.geojsonseq" \
  --coalesce --reorder --maximum-tile-bytes=500000 \
  --name="OSM base map" --attribution="© OpenStreetMap contributors" \
  2>&1 | tee build.log
```

```python
from __future__ import annotations

import json
import logging
import sqlite3
import zlib
from pathlib import Path

import mapbox_vector_tile

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.tiles.verify")

EXPECTED_LAYERS = {"transportation", "water", "landuse", "place"}


def metadata(conn: sqlite3.Connection) -> dict[str, str]:
    return {k: v for k, v in conn.execute("SELECT name, value FROM metadata")}


def sample_tile(conn: sqlite3.Connection, z: int, x: int, y: int) -> bytes | None:
    # MBTiles rows are TMS-ordered: row 0 is at the BOTTOM of the pyramid.
    tms_y = (1 << z) - 1 - y
    row = conn.execute(
        "SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? "
        "AND tile_row=?", (z, x, tms_y)).fetchone()
    return row[0] if row else None


def verify(path: Path, z: int, x: int, y: int) -> bool:
    conn = sqlite3.connect(path)
    ok = True
    meta = metadata(conn)

    for key in ("name", "format", "minzoom", "maxzoom", "bounds", "attribution"):
        if key not in meta:
            logger.error("metadata missing %r", key)
            ok = False
    logger.info("zoom range %s..%s, bounds %s",
                meta.get("minzoom"), meta.get("maxzoom"), meta.get("bounds"))

    # The json field advertises the layers a style will look for.
    declared = {layer["id"] for layer in
                json.loads(meta.get("json", '{"vector_layers":[]}'))["vector_layers"]}
    if declared != EXPECTED_LAYERS:
        logger.error("layers declared %s, expected %s", declared, EXPECTED_LAYERS)
        ok = False

    total, = conn.execute("SELECT COUNT(*) FROM tiles").fetchone()
    logger.info("%d tile(s) in the archive", total)
    if total == 0:
        return False

    blob = sample_tile(conn, z, x, y)
    if blob is None:
        logger.error("no tile at %d/%d/%d — check the TMS row conversion", z, x, y)
        return False
    # Tippecanoe gzips tile payloads; decompress before decoding.
    raw = zlib.decompress(blob, 16 + zlib.MAX_WBITS) if blob[:2] == b"\x1f\x8b" else blob
    decoded = mapbox_vector_tile.decode(raw)
    logger.info("sample tile carries layers %s", sorted(decoded))
    if not set(decoded) & EXPECTED_LAYERS:
        logger.error("sample tile has none of the expected layers")
        ok = False

    conn.close()
    return ok


if __name__ == "__main__":
    logger.info("verification %s",
                "PASSED" if verify(Path("osm.mbtiles"), 14, 9111, 5455) else "FAILED")
```

## Step-by-step walkthrough

1. **Filter before exporting.** Each `tags-filter` pass reads the extract and writes a small per-layer file, so the expensive GeoJSON conversion only ever sees features that will actually be rendered.
2. **Use line-delimited GeoJSON.** A single feature collection has to be parsed as one document; the line-delimited form streams and can be processed with ordinary text tools.
3. **Emit stable identifiers.** Type-prefixed identifiers survive into the verification step and into any later reconciliation against the source.
4. **Rank each layer separately.** The ranking rules differ per layer, and running the script per file keeps each histogram readable.
5. **Build all layers in one run.** A single invocation writes one coherent metadata record; building per layer and merging archives afterwards produces metadata that is wrong in ways clients do not report.
6. **Set name and attribution at build time.** Attribution is a licence obligation, and the archive's metadata is where a client will look for it.
7. **Convert the row when reading.** The verification's sample lookup converts from top-origin to TMS ordering explicitly, which is both correct and a reminder of the convention.
8. **Decompress before decoding.** Tile payloads are gzipped; feeding a compressed blob to a decoder produces a confusing parse error rather than a clear one.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="gmg2-t gmg2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="gmg2-t">What the verification checks and what each failure would have looked like in production</title>
  <desc id="gmg2-d">A grid of four checks against the production symptom each one prevents. Checking the metadata keys prevents a client that cannot determine the zoom range and requests tiles outside it. Checking the declared layer list prevents a style that silently matches nothing and renders a blank map. Checking the tile count prevents shipping an archive whose build failed partway. Checking a decoded sample tile prevents an archive whose tiles exist but are empty or wrongly addressed.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four checks, four production failures avoided</text>
  <rect x="206" y="48" width="648" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="530" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Would have looked like</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Metadata keys present</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="530" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">client requests absent zooms</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Layer list matches</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="530" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">blank map, no errors</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Tile count non-zero</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="530" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">archive ships empty</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Sample tile decodes</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="530" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">tiles exist, render nothing</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Every one of these failures is silent on the client: a blank map produces no console error and no failed request.</text>
</svg>
<figcaption>That silence is why the checks belong in the build rather than in somebody opening the map afterwards.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 288" role="img" aria-labelledby="gmg3-t gmg3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="gmg3-t">Relative size of each intermediate artefact in the build, for one country</title>
  <desc id="gmg3-d">Five artefacts compared on disk size for a country-sized build. The source extract is the baseline. The per-layer filtered files together are a fraction of it, because only rendered features survive. The exported GeoJSON is many times the extract, because the text format is far more verbose than the binary one. The ranked GeoJSON is slightly larger again, having gained two properties per feature. The final archive is smaller than the extract, because tiles hold generalized geometry rather than full precision.</desc>
  <rect x="0" y="0" width="880" height="288" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">The text intermediate dwarfs everything else</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">Source extract</text>
  <rect x="246" y="60" width="86" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">1x baseline</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">Filtered per-layer files</text>
  <rect x="246" y="100" width="34" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 0.4x</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">Exported GeoJSON</text>
  <rect x="246" y="140" width="445" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 5x</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">Ranked GeoJSON</text>
  <rect x="246" y="180" width="488" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 5.7x</text>
  <text x="26" y="234" font-size="11.5" font-weight="600" fill="currentColor">Final MBTiles</text>
  <rect x="246" y="220" width="51" height="18" rx="4" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="854" y="234" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 0.6x</text>
  <text x="868" y="272" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Filtering before exporting keeps the third bar at five times the extract rather than fifteen, which is the reason for the ordering.</text>
</svg>
<figcaption>The archive being smaller than its own source is the point: tiles carry what a reader can see, not what the data knows.</figcaption>
</figure>

## Verification

- **Metadata carries the required keys.** Name, format, zoom range, bounds and attribution must all be present.
- **The declared layer list matches the build.** A style written against a layer name absent from the metadata renders nothing and reports nothing.
- **The tile count is plausible.** Compare against the rough expectation for the area and zoom range; an order-of-magnitude shortfall means the build stopped early.
- **A sample tile decodes and carries layers.** Pick a tile in a dense area, decode it, and confirm the expected layers are present.
- **The row conversion is right.** Request a tile whose contents you can recognise; a mirrored archive returns a tile from the wrong latitude rather than nothing.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Map is vertically mirrored | TMS row ordering not converted | Convert with the zoom-dependent row formula |
| Decoder raises a parse error | Tile payload still gzipped | Decompress before decoding |
| Style renders nothing | Layer names differ from the metadata | Name layers explicitly and verify the declared list |
| Archive far smaller than expected | Build stopped early on an input error | Check the build log; each layer should report a count |
| Attribution missing from the client | Not set at build time | Pass name and attribution to the build |
| Intermediate GeoJSON fills the disk | Export ran before filtering | Filter to a per-layer PBF first |
| Layers have inconsistent zoom ranges | Built per layer and merged | Build every layer in a single invocation |

## Specification reference

> An MBTiles archive is a SQLite database containing a `tiles` table keyed on `zoom_level`, `tile_column` and `tile_row`, and a `metadata` table of name-value pairs including `name`, `format`, `bounds`, `minzoom`, `maxzoom` and, for vector tile sets, a `json` field describing the vector layers and their fields. Tile rows are numbered in TMS order with row zero at the bottom. See the [MBTiles specification](https://github.com/mapbox/mbtiles-spec) for the required metadata keys and the row ordering.

## Frequently Asked Questions

<details>
<summary>Why is my map vertically mirrored?</summary>

Because MBTiles numbers tile rows from the bottom while most client addressing numbers them from the top. Each individual tile is correct; they are simply being placed in the wrong rows. The conversion is a single expression involving the zoom level, and applying it in exactly one place — the archive reader — keeps the rest of the pipeline in one convention.
</details>

<details>
<summary>Should I build each layer separately and merge the archives?</summary>

No. A single build writes one metadata record describing every layer and one consistent zoom range; merging separately built archives leaves metadata that describes only one of them, which clients read and then fail to find the other layers. If the layers genuinely must be built separately for scheduling reasons, regenerate the metadata deliberately rather than accepting whichever archive's record survives the merge.
</details>

<details>
<summary>Why filter to a per-layer PBF instead of exporting once?</summary>

Because GeoJSON is an order of magnitude more verbose than PBF, so every feature you export and then discard costs disk and parsing time. Filtering first means the expensive conversion only touches features that will be rendered. On a country extract the difference is routinely tens of gigabytes of intermediate output and a large fraction of the build time.
</details>

<details>
<summary>Is the attribution field really necessary?</summary>

Yes, and it is the one field with a licence obligation attached rather than a technical one. OpenStreetMap data carries an attribution requirement, and the archive's metadata is where a client looks for the text to display. Setting it at build time means every consumer of the archive inherits it automatically, rather than depending on whoever wires up the map remembering to add it.
</details>

## Related

- [Building OSM Tiles with Tippecanoe](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/building-tiles-with-tippecanoe/) — the parent topic and the generator's model.
- [Tuning Tippecanoe Zoom and Feature Dropping](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/building-tiles-with-tippecanoe/tuning-tippecanoe-zoom-and-feature-dropping/) — the ranking step this build depends on.
- [Serving PMTiles from Object Storage](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/serving-and-invalidating-osm-tiles/serving-pmtiles-from-object-storage/) — converting this archive for serverless delivery.
- [Chaining osmium-tool Commands in a Shell Pipeline](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/chaining-osmium-tool-commands-in-a-shell-pipeline/) — composing the filter and export passes efficiently.
- [Automating ODbL Attribution in Derived Products](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/automating-odbl-attribution-in-derived-products/) — why the attribution field is an obligation.

Up one level: [Building OSM Tiles with Tippecanoe](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/building-tiles-with-tippecanoe/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Generating MBTiles from OSM GeoJSON",
  "description": "A complete, reproducible run from a verified OSM extract to an MBTiles archive: export per layer, rank, build, and verify the archive's metadata and a sample tile before shipping it.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Vector Tiles & Rendering Pipelines",
  "about": ["MBTiles", "tile build pipeline", "archive verification"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Vector Tiles & Rendering Pipelines", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/" },
    { "@type": "ListItem", "position": 3, "name": "Building OSM Tiles with Tippecanoe", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/building-tiles-with-tippecanoe/" },
    { "@type": "ListItem", "position": 4, "name": "Generating MBTiles from OSM GeoJSON", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/building-tiles-with-tippecanoe/generating-mbtiles-from-osm-geojson/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Build and verify an MBTiles archive from an OSM extract",
  "description": "Filter the extract to per-layer files, export line-delimited GeoJSON with stable identifiers, rank each layer, build every layer in one run, and verify metadata and a decoded sample tile.",
  "step": [
    { "@type": "HowToStep", "name": "Filter per layer", "text": "Run a tag filter over the extract once per layer so the expensive export only sees features that will be rendered." },
    { "@type": "HowToStep", "name": "Export line-delimited GeoJSON", "text": "Convert each layer file to streaming GeoJSON with type-prefixed unique identifiers." },
    { "@type": "HowToStep", "name": "Rank each layer", "text": "Attach per-feature minimum and maximum zoom properties derived from the layer's own ranking rules." },
    { "@type": "HowToStep", "name": "Build once, all layers", "text": "Invoke the generator a single time with every named layer so one coherent metadata record is written." },
    { "@type": "HowToStep", "name": "Set name and attribution", "text": "Record the tile set name and the attribution text in the archive metadata at build time." },
    { "@type": "HowToStep", "name": "Verify the archive", "text": "Check required metadata keys, compare the declared layer list against the build, count tiles, and decode a sample tile after converting its row from top-origin to TMS ordering." }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Why is my MBTiles map vertically mirrored?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because MBTiles numbers tile rows from the bottom while most client addressing numbers them from the top. Each individual tile is correct; they are simply being placed in the wrong rows. The conversion is a single expression involving the zoom level, and applying it in exactly one place keeps the rest of the pipeline in one convention." }
    },
    {
      "@type": "Question",
      "name": "Should I build each tile layer separately and merge the archives?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. A single build writes one metadata record describing every layer and one consistent zoom range; merging separately built archives leaves metadata that describes only one of them, which clients read and then fail to find the other layers. If layers must be built separately, regenerate the metadata deliberately." }
    },
    {
      "@type": "Question",
      "name": "Why filter to a per-layer PBF instead of exporting once?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because GeoJSON is an order of magnitude more verbose than PBF, so every feature you export and then discard costs disk and parsing time. Filtering first means the expensive conversion only touches features that will be rendered. On a country extract the difference is routinely tens of gigabytes of intermediate output." }
    },
    {
      "@type": "Question",
      "name": "Is the MBTiles attribution field really necessary?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes, and it is the one field with a licence obligation attached rather than a technical one. OpenStreetMap data carries an attribution requirement, and the archive's metadata is where a client looks for the text to display. Setting it at build time means every consumer inherits it automatically." }
    }
  ]
}
</script>
