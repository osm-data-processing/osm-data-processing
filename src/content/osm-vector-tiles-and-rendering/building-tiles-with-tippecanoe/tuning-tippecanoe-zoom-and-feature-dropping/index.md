---
title: "Tuning Tippecanoe Zoom and Feature Dropping"
description: "Replace Tippecanoe's automatic dropping heuristic with rank-driven per-feature zoom ranges computed from OSM tags, so what disappears at each zoom is a decision rather than an accident."
pageTitle: "Rank-Driven Zoom Ranges Instead of Tippecanoe Dropping"
pageDescription: "Compute an importance rank from OSM tags, map it to per-feature minimum zooms, and verify that automatic feature dropping no longer fires — so the map reduces the way you chose."
slug: tuning-tippecanoe-zoom-and-feature-dropping
type: article
breadcrumb: "Zoom & Dropping"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Tuning Tippecanoe Zoom and Feature Dropping

Stop the generator choosing which features survive a crowded tile, by making sure the tile was never crowded — with minimum zooms computed from what each OSM feature actually is.

## Prerequisites

- [ ] `tippecanoe` installed, and OSM features exported to line-delimited GeoJSON.
- [ ] The model from [Building OSM Tiles with Tippecanoe](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/building-tiles-with-tippecanoe/), particularly the reserved zoom properties.
- [ ] Python 3.10+ to compute ranks; nothing beyond the standard library is needed.
- [ ] The OSM tags still attached to each feature at export time — the rank cannot be computed once they are gone.
- [ ] A dense sample area, because dropping only fires where tiles are crowded.

## Conceptual minimum

Tippecanoe reduces a tile in two entirely different ways, and only one of them is yours.

**Declared zoom ranges** are a property of each feature. A feature with a minimum zoom of 9 simply does not exist in tiles below zoom 9. This is a decision you make, it is recorded in the data, and it is reviewable.

**Automatic dropping** is a property of the tile. When a tile exceeds the size budget, features are removed until it fits, chosen by a spatially uniform heuristic that knows nothing about a motorway outranking a driveway. This is a decision the generator makes on your behalf, it is recorded only in build output, and it produces the complaint that features vanish unpredictably.

The strategy is therefore not to disable dropping — it is a useful safety net — but to make it rarely fire, by ensuring each zoom's tiles contain roughly the number of features that zoom can afford.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="tzd1-t tzd1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="tzd1-t">From OSM tags to a per-feature minimum zoom</title>
  <desc id="tzd1-d">Four steps. The classify step maps raw OSM tags onto a small closed vocabulary such as motorway, trunk, primary and residential. The rank step assigns each class a numeric importance, optionally adjusted by a size or population attribute. The zoom step maps rank onto a minimum zoom using a table that is reviewed rather than tuned by trial and error. The attach step writes the reserved minimum and maximum zoom properties onto the feature so the generator honours the decision.</desc>
  <defs><marker id="tzd1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four steps, all of them before the generator runs</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">classify</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">tags to a vocabulary</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">a dozen classes, not 400</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#tzd1-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">rank</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">class plus magnitude</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">area, length, population</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#tzd1-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">map to zoom</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">a reviewed table</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">not trial and error</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#tzd1-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">attach</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">reserved properties</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">the decision is data</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Writing the zoom onto the feature makes the decision auditable: anybody can query which features appear at which zoom.</text>
</svg>
<figcaption>Because the rank lives in the data, a cartographic change becomes a table edit rather than a pipeline change.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import json
import logging
import math
import sys
from typing import Any, Iterator

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.tiles.rank")

# Road classes ordered by importance, with the zoom each first appears at.
ROAD_MINZOOM: dict[str, int] = {
    "motorway": 4, "trunk": 5, "primary": 7, "secondary": 9,
    "tertiary": 11, "unclassified": 12, "residential": 13,
    "service": 14, "track": 14, "path": 14,
}
# Area thresholds in square metres -> minimum zoom for polygon features.
AREA_BANDS: list[tuple[float, int]] = [
    (1e9, 3), (1e8, 5), (1e7, 7), (1e6, 9),
    (1e5, 11), (1e4, 12), (1e3, 13),
]
DEFAULT_MINZOOM = 14
MAXZOOM = 14


def road_minzoom(tags: dict[str, Any]) -> int | None:
    value = tags.get("highway")
    if value is None:
        return None
    base = ROAD_MINZOOM.get(value, DEFAULT_MINZOOM)
    # A named road with a reference number is usually more important than its
    # class alone suggests; promote it by one level, never past motorway.
    if tags.get("ref"):
        base = max(3, base - 1)
    return base


def area_minzoom(area_m2: float) -> int:
    for threshold, zoom in AREA_BANDS:
        if area_m2 >= threshold:
            return zoom
    return DEFAULT_MINZOOM


def place_minzoom(tags: dict[str, Any]) -> int | None:
    if "place" not in tags:
        return None
    population = tags.get("population")
    try:
        people = float(population) if population else 0.0
    except ValueError:
        people = 0.0
    if people <= 0:
        return {"city": 6, "town": 9, "village": 11}.get(tags["place"], 13)
    # Population spans six orders of magnitude; a log scale keeps the mapping sane.
    return max(3, min(13, int(14 - 1.6 * math.log10(max(people, 10.0)))))


def assign(feature: dict[str, Any]) -> dict[str, Any]:
    props = feature.get("properties", {})
    minzoom = (road_minzoom(props)
               or place_minzoom(props)
               or (area_minzoom(float(props["area_m2"]))
                   if props.get("area_m2") else None)
               or DEFAULT_MINZOOM)
    props["tippecanoe:minzoom"] = int(minzoom)
    props["tippecanoe:maxzoom"] = MAXZOOM
    # Keep the rank as a real attribute too: the style may want it for widths.
    props.setdefault("rank", int(minzoom))
    feature["properties"] = props
    return feature


def stream(lines: Iterator[str]) -> Iterator[str]:
    histogram: dict[int, int] = {}
    for line in lines:
        line = line.strip()
        if not line:
            continue
        feature = assign(json.loads(line))
        z = feature["properties"]["tippecanoe:minzoom"]
        histogram[z] = histogram.get(z, 0) + 1
        yield json.dumps(feature, separators=(",", ":"))
    for z in sorted(histogram):
        logger.info("minzoom %2d: %d feature(s)", z, histogram[z])


if __name__ == "__main__":
    for out in stream(sys.stdin):
        print(out)
```

Then run the generator with dropping left as a safety net rather than a control:

```bash
#!/usr/bin/env bash
set -euo pipefail

python3 assign_zoom.py < roads.geojsonseq > roads.ranked.geojsonseq

tippecanoe \
  --output=osm.mbtiles --force \
  --maximum-zoom=14 --minimum-zoom=0 \
  --named-layer=transportation:roads.ranked.geojsonseq \
  --named-layer=landuse:landuse.ranked.geojsonseq \
  --coalesce --reorder \
  --maximum-tile-bytes=500000 \
  2>&1 | tee build.log

# Dropping should be rare. If it is not, the zoom table is too generous.
grep -ci "dropping" build.log || echo "no dropping reported"
```

## Step-by-step walkthrough

1. **Classify before ranking.** The road table maps a closed vocabulary rather than every possible `highway` value, with an explicit default so an unknown value gets the deepest zoom rather than an exception.
2. **Let a secondary signal adjust the rank.** A road carrying a reference number is usually more significant than its class alone implies, so it is promoted one level — with a floor so nothing outranks a motorway.
3. **Use a log scale for population.** Settlement populations span six orders of magnitude, and a linear mapping puts every village in one bucket and every city in another.
4. **Band areas rather than computing a formula.** A table of thresholds is reviewable by a cartographer; a continuous function is not.
5. **Fall through in priority order.** Roads, then places, then area, then a default. Each feature matches exactly one rule, and the default guarantees no feature is left without a zoom.
6. **Keep the rank as a real attribute.** The style often wants it for line widths, and exposing it avoids the style re-deriving the same classification from raw tags.
7. **Log the histogram.** The count of features per minimum zoom is the single most useful review artefact: a zoom holding ten times more features than the one below it is where crowding will appear.
8. **Check the build log for dropping.** If dropping is still frequent, the zoom table is too generous at that level — the histogram tells you which one.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 328" role="img" aria-labelledby="tzd2-t tzd2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="tzd2-t">Feature counts by assigned minimum zoom for a country road network</title>
  <desc id="tzd2-d">Six minimum zoom bands with the number of road features assigned to each. Zoom four holds a few thousand motorways. Zoom seven holds tens of thousands of primary roads. Zoom nine holds around a hundred thousand secondary roads. Zoom eleven holds several hundred thousand tertiary roads. Zoom thirteen holds a few million residential streets. Zoom fourteen holds the remainder, dominated by service roads and tracks. A note observes that each band should be roughly four times the one above it, matching the tile count growth.</desc>
  <rect x="0" y="0" width="880" height="328" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Each band should be about four times the one above</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">minzoom 4</text>
  <rect x="216" y="60" width="6" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 3,000</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">minzoom 7</text>
  <rect x="216" y="100" width="6" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 30,000</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">minzoom 9</text>
  <rect x="216" y="140" width="22" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 110,000</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">minzoom 11</text>
  <rect x="216" y="180" width="84" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 420,000</text>
  <text x="26" y="234" font-size="11.5" font-weight="600" fill="currentColor">minzoom 13</text>
  <rect x="216" y="220" width="359" height="18" rx="4" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="854" y="234" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 1.8 million</text>
  <text x="26" y="274" font-size="11.5" font-weight="600" fill="currentColor">minzoom 14</text>
  <rect x="216" y="260" width="518" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="274" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 2.6 million</text>
  <text x="868" y="312" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">A band far larger than four times its predecessor is where tiles will crowd and the dropping heuristic will start choosing for you.</text>
</svg>
<figcaption>Reading this histogram after every change is faster than inspecting tiles, and it predicts exactly where crowding appears.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 239" role="img" aria-labelledby="tzd3-t tzd3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="tzd3-t">Three sources of a feature's rank and when each is the right basis</title>
  <desc id="tzd3-d">Three panels. Class-based ranking maps a tag value such as a road classification directly to a zoom and is right whenever the tagging already encodes importance. Magnitude-based ranking derives the zoom from a measured quantity such as polygon area or route length and is right when features of one class vary enormously in size. Attribute-based ranking uses a separate tag such as population or a reference number and is right when the class alone under-describes significance, though it must handle missing and unparseable values.</desc>
  <rect x="0" y="0" width="880" height="239" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three bases for a rank, each with its own failure</text>
  <rect x="26" y="52" width="259" height="153" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Class</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Tag value to zoom directly</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Roads, railways, boundaries</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Tagging already ranks them</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Fails on unknown values</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Always set a default</text>
  <rect x="311" y="52" width="259" height="153" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Magnitude</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Area, length or extent</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Lakes, forests, built-up areas</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">One class, huge size range</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Fails on missing geometry</text>
  <text x="325" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Band it, do not compute it</text>
  <rect x="595" y="52" width="259" height="153" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Attribute</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Population, reference number</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Settlements, numbered routes</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Class alone under-describes</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Fails on unparseable values</text>
  <text x="609" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Coerce defensively</text>
  <text x="868" y="223" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Most real layers use two of these: a class baseline adjusted by a magnitude or an attribute, with clamps at both ends.</text>
</svg>
<figcaption>Naming which basis a layer uses is what makes the zoom table reviewable by somebody who did not write it.</figcaption>
</figure>

## Verification

- **The histogram roughly quadruples per level.** A band much larger than four times the one above it predicts crowding at that zoom.
- **The build log reports little or no dropping.** Occasional dropping in the densest city tiles is acceptable; systematic dropping means the table is too generous.
- **A known feature appears where intended.** Pick a specific secondary road and confirm it is present at its declared zoom and absent below it.
- **No feature lacks a zoom.** Count features whose reserved minimum zoom property is missing; it must be zero.
- **Rank survives into the tiles.** Decode a tile and confirm the rank attribute is present for the style to use.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Dropping still frequent | Zoom table too generous at one level | Read the histogram; push the oversized band deeper |
| Every village at one zoom | Population mapped linearly | Use a logarithmic mapping for population |
| Unknown road class crashes | Table lookup without a default | Default unknown values to the deepest zoom |
| Motorway missing at low zoom | Promotion applied without a floor | Clamp the promoted value so nothing outranks the top class |
| Style re-derives classification | Rank not exposed as an attribute | Keep the rank as a real property alongside the reserved ones |
| Reserved properties in the output | Wrong property names used | They must be the exact reserved names to be consumed |
| Features present below their zoom | Properties written as strings | Write the zoom values as integers, not strings |

## Specification reference

> Tippecanoe reads per-feature `tippecanoe:minzoom` and `tippecanoe:maxzoom` properties from the input GeoJSON and uses them to limit the zoom levels at which each feature is included, in preference to the automatic feature-dropping applied to keep tiles within the configured maximum size. These reserved properties are consumed and do not appear in the output tiles. See the [Tippecanoe documentation](https://github.com/felt/tippecanoe) for the full list of reserved properties and the dropping options.

## Frequently Asked Questions

<details>
<summary>Should I disable automatic dropping entirely?</summary>

No. It is a useful safety net for the genuinely exceptional tile — a dense city centre where even a well-ranked layer occasionally exceeds the budget. What you should avoid is relying on it as the primary reduction mechanism, because it chooses victims without any notion of importance. Aim for a zoom table generous enough that dropping fires rarely, and treat a build log full of dropping as a signal to revisit the histogram.
</details>

<details>
<summary>How do I choose the minimum zoom for each class?</summary>

Start from the tile count arithmetic. Each zoom level has four times as many tiles as the one above, so a band roughly four times larger than its predecessor keeps per-tile feature counts stable. Assign the classes in importance order, check the resulting histogram, and move any band that breaks the pattern. That converges in two or three iterations and is far more reliable than adjusting numbers until the map looks right in one place.
</details>

<details>
<summary>Why use a logarithmic scale for population?</summary>

Because settlement populations span six orders of magnitude, from a hamlet of forty people to a city of twenty million. A linear mapping puts almost every settlement in the bottom bucket and a handful in the top, which produces a map where nothing appears until you zoom well in and then everything appears at once. A logarithmic mapping spreads settlements evenly across zoom levels, which is what a reader expects.
</details>

<details>
<summary>Can the rank be used for styling as well as dropping?</summary>

Yes, and it should be. Keeping the computed rank as an ordinary attribute lets the style scale line widths and label sizes from it directly, instead of re-deriving the same classification from raw tag values in the style sheet. That keeps one definition of importance in one place, so a cartographic change is a table edit rather than a change in two systems that must be kept in step.
</details>

## Related

- [Building OSM Tiles with Tippecanoe](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/building-tiles-with-tippecanoe/) — the parent topic and the reduction mechanisms this tuning replaces.
- [Generating MBTiles from OSM GeoJSON](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/building-tiles-with-tippecanoe/generating-mbtiles-from-osm-geojson/) — the end-to-end run this ranking feeds.
- [Simplifying OSM Geometry per Zoom Level](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/simplifying-osm-geometry-per-zoom-level/) — the other half of making a low-zoom tile fit.
- [Mapping OSM Tags to a Fixed Schema with YAML](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/mapping-osm-tags-to-a-fixed-schema-with-yaml/) — the classification step expressed as configuration.
- [Cartographic Generalization of OSM Data](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/) — where rank fits among the other generalization tools.

Up one level: [Building OSM Tiles with Tippecanoe](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/building-tiles-with-tippecanoe/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Tuning Tippecanoe Zoom and Feature Dropping",
  "description": "Replace Tippecanoe's automatic dropping heuristic with rank-driven per-feature zoom ranges computed from OSM tags, so what disappears at each zoom is a decision rather than an accident.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Vector Tiles & Rendering Pipelines",
  "about": ["feature ranking", "minimum zoom assignment", "tile size budget"]
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
    { "@type": "ListItem", "position": 4, "name": "Tuning Tippecanoe Zoom and Feature Dropping", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/building-tiles-with-tippecanoe/tuning-tippecanoe-zoom-and-feature-dropping/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Assign rank-driven zoom ranges for a Tippecanoe build",
  "description": "Classify OSM tags into a closed vocabulary, rank each feature, map rank to a minimum zoom through a reviewed table, attach the reserved properties, and confirm dropping is rare.",
  "step": [
    { "@type": "HowToStep", "name": "Classify into a vocabulary", "text": "Map raw OSM tag values onto a small closed set of classes with an explicit default for unknown values." },
    { "@type": "HowToStep", "name": "Rank with a secondary signal", "text": "Adjust the class rank using a magnitude such as area, length or population, clamping so nothing outranks the top class." },
    { "@type": "HowToStep", "name": "Use a log scale for magnitudes", "text": "Map quantities spanning several orders of magnitude logarithmically so features spread evenly across zoom levels." },
    { "@type": "HowToStep", "name": "Attach the reserved properties", "text": "Write integer minimum and maximum zoom values onto each feature using the exact reserved property names." },
    { "@type": "HowToStep", "name": "Review the histogram", "text": "Count features per assigned minimum zoom and expect each band to be roughly four times the one above it." },
    { "@type": "HowToStep", "name": "Confirm dropping is rare", "text": "Read the build log for feature dropping and push any oversized band deeper until dropping is exceptional." }
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
      "name": "Should I disable Tippecanoe's automatic dropping entirely?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. It is a useful safety net for the genuinely exceptional tile. What you should avoid is relying on it as the primary reduction mechanism, because it chooses victims without any notion of importance. Aim for a zoom table generous enough that dropping fires rarely, and treat a build log full of dropping as a signal to revisit the histogram." }
    },
    {
      "@type": "Question",
      "name": "How do I choose the minimum zoom for each feature class?",
      "acceptedAnswer": { "@type": "Answer", "text": "Start from the tile count arithmetic. Each zoom level has four times as many tiles as the one above, so a band roughly four times larger than its predecessor keeps per-tile feature counts stable. Assign classes in importance order, check the resulting histogram, and move any band that breaks the pattern." }
    },
    {
      "@type": "Question",
      "name": "Why use a logarithmic scale for settlement population?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because settlement populations span six orders of magnitude. A linear mapping puts almost every settlement in the bottom bucket and a handful in the top, which produces a map where nothing appears until you zoom well in and then everything appears at once. A logarithmic mapping spreads settlements evenly across zoom levels." }
    },
    {
      "@type": "Question",
      "name": "Can a feature rank be used for styling as well as dropping?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes, and it should be. Keeping the computed rank as an ordinary attribute lets the style scale line widths and label sizes from it directly, instead of re-deriving the same classification from raw tag values. That keeps one definition of importance in one place, so a cartographic change is a table edit rather than a change in two systems." }
    }
  ]
}
</script>
