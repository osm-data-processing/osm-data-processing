---
title: "Building OSM Tiles with Tippecanoe"
description: "Tippecanoe's model for OSM data: GeoJSON in, MBTiles out, with zoom ranges, feature dropping, coalescing and the tile size budget under explicit control rather than heuristic."
pageTitle: "Building OSM Vector Tiles with Tippecanoe"
pageDescription: "Drive Tippecanoe deliberately on OSM data: prepare GeoJSON with rank attributes, set per-layer zoom ranges, control feature dropping, and keep tiles inside a size budget you chose."
slug: building-tiles-with-tippecanoe
type: guide
breadcrumb: "Tippecanoe"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Building OSM Tiles with Tippecanoe

Tippecanoe will produce a usable tile set from OSM-derived GeoJSON with almost no configuration, and that is precisely the problem: the defaults make sensible choices on your behalf, and the first time a feature you cared about disappears at zoom 9 you will have no idea which choice did it.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 290" role="img" aria-labelledby="btt1-t btt1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="btt1-t">What Tippecanoe does between GeoJSON input and an MBTiles archive</title>
  <desc id="btt1-d">GeoJSON features enter and are assigned to layers, either from a single input or one layer per input file. For each zoom level the features are filtered by their declared zoom range, simplified, and packed into tiles. When a tile exceeds the size budget, a dropping strategy removes features until it fits. The surviving features are encoded and written into an MBTiles archive alongside metadata describing the layers and zoom range.</desc>
  <defs><marker id="btt1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="290" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four stages, and one of them silently removes data</text>
  <rect x="26" y="122" width="240" height="56" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="146" y="146" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">GeoJSON</text>
  <text x="146" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">one file per layer</text>
  <rect x="320" y="50" width="240" height="56" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="74" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">assign zooms</text>
  <text x="440" y="92" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">per feature range</text>
  <rect x="320" y="122" width="240" height="56" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="146" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">simplify</text>
  <text x="440" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">per zoom tolerance</text>
  <rect x="320" y="194" width="240" height="56" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="218" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">drop to fit</text>
  <text x="440" y="236" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">budget enforcement</text>
  <rect x="614" y="122" width="240" height="56" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="734" y="146" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">MBTiles</text>
  <text x="734" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">tiles plus metadata</text>
  <line x1="266" y1="150" x2="293" y2="150" stroke="currentColor" stroke-width="1.4"/>
  <line x1="293" y1="78" x2="293" y2="222" stroke="currentColor" stroke-width="1.4"/>
  <line x1="293" y1="78" x2="317" y2="78" stroke="currentColor" stroke-width="1.4" marker-end="url(#btt1-a)"/>
  <line x1="293" y1="150" x2="317" y2="150" stroke="currentColor" stroke-width="1.4" marker-end="url(#btt1-a)"/>
  <line x1="293" y1="222" x2="317" y2="222" stroke="currentColor" stroke-width="1.4" marker-end="url(#btt1-a)"/>
  <line x1="560" y1="78" x2="587" y2="78" stroke="currentColor" stroke-width="1.4"/>
  <line x1="560" y1="150" x2="587" y2="150" stroke="currentColor" stroke-width="1.4"/>
  <line x1="560" y1="222" x2="587" y2="222" stroke="currentColor" stroke-width="1.4"/>
  <line x1="587" y1="78" x2="587" y2="222" stroke="currentColor" stroke-width="1.4"/>
  <line x1="587" y1="150" x2="611" y2="150" stroke="currentColor" stroke-width="1.4" marker-end="url(#btt1-a)"/>
  <text x="868" y="274" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The third stage is the one that makes features vanish, and by default it chooses which ones without consulting you.</text>
</svg>
<figcaption>Every complaint about Tippecanoe hiding data traces back to leaving the dropping stage on its defaults.</figcaption>
</figure>

## The Problem This Topic Solves

You have OSM features exported to GeoJSON and you need a tile set covering a range of zooms, with the right things visible at each. Tippecanoe is the shortest path from one to the other, and it is genuinely excellent at the hard part — making each tile fit a size budget while keeping the map legible.

The failure scenario is a map where things disappear unpredictably. A reviewer reports that a particular park is missing at zoom 11 but present at 12 and 10. Nothing in the pipeline logs an error. What happened is that the zoom-11 tile covering that area exceeded the size budget and the dropping stage removed features until it fit, choosing by its own heuristic — which is spatially uniform rather than importance-aware. In a dense tile, that means whichever features were unlucky.

## Prerequisites

Have OSM features exported to GeoJSON, which is the job of [Exporting OSM to GeoParquet & PostGIS](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/) or a direct `osmium export`. Understand the tile model from [OSM Vector Tiles & Rendering Pipelines](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/), and the geometry constraints from [The Mapbox Vector Tile Spec & Tile Geometry](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/).

## The Model: Features Carry Their Own Zoom Range

The single most important idea is that **every feature has a minimum and maximum zoom**, and you can set it per feature rather than per layer. Tippecanoe reads this from reserved properties in the GeoJSON — `tippecanoe:minzoom` and `tippecanoe:maxzoom` — which means the decision about what appears when belongs in your export step, where you have the OSM tags, rather than in a command-line flag applied uniformly.

That is the mechanism that turns "features disappear unpredictably" into "features disappear exactly as I specified". Compute a rank during layer assignment — road classification, water body area, settlement population, building footprint size — map that rank to a minimum zoom, and write it onto the feature. The dropping stage then has far less to do, because the tile is already the right size.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="btt2-t btt2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="btt2-t">Four ways Tippecanoe can reduce a tile, and what each one costs</title>
  <desc id="btt2-d">A grid of four reduction mechanisms against what they remove and when each is appropriate. Explicit per-feature zoom ranges remove features you chose, at the zoom you chose, and are the preferred mechanism. Simplification removes vertices rather than features and is nearly always appropriate. Coalescing merges adjacent features with identical attributes, which is ideal for tiled polygon coverage. Automatic dropping to fit the size budget removes whichever features it must and should be a last resort rather than the primary control.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four reductions, in the order you should reach for them</text>
  <rect x="216" y="48" width="319" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="376" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Removes</text>
  <rect x="535" y="48" width="319" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="694" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Use it</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Per-feature zoom range</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">features you chose</text>
  <text x="694" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">always, first</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Simplification</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">vertices, not features</text>
  <text x="694" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">always</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Coalescing</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">duplicate boundaries</text>
  <text x="694" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">polygon coverage</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Automatic dropping</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">whatever it must</text>
  <text x="694" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">as a safety net</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The bottom row is the default behaviour, which is why an unconfigured run produces a map that reduces itself in ways nobody chose.</text>
</svg>
<figcaption>Each row above the last is a decision you make; the last row is a decision made for you when the others were not enough.</figcaption>
</figure>

## Preparing the GeoJSON Tippecanoe Wants

The generator's input requirements are modest but specific, and the difference between input it handles gracefully and input it struggles with is worth getting right before a long build.

**Line-delimited, not a feature collection.** A single JSON document containing a million features has to be parsed as one object; the line-delimited form streams, can be split across files, and can be inspected with ordinary text tools. Every export path on this site can emit it, and there is no reason to prefer the alternative.

**One file per layer.** Naming layers explicitly on each input is what gives the archive a metadata record a style can be written against. Mixing several layers into one file and relying on an attribute to distinguish them works, but it means the layer separation happens at style time rather than at build time, which loses the per-layer zoom ranges entirely.

**Consistent property types.** A property that is an integer on some features and a string on others encodes unpredictably, because the per-layer value table has to accommodate both. This most often happens with numeric OSM tag values that are clean on most features and carry a unit or a range on a few — exactly the case the normalisation work in [Normalizing OSM Speed Limits and Units](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/normalizing-osm-speed-limits-and-units/) exists to resolve. Coerce every property to one type during export.

**Nothing you will not render.** Features filtered out after the generator has read them have still been parsed, stored and sorted. A tag filter over the extract before export is the cheapest reduction available and routinely removes most of the input.

**Geometry already valid.** The generator does not repair geometry, and an invalid polygon produces unpredictable output rather than an error. Running the detection from [Detecting Self-Intersecting OSM Polygons with Shapely](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/detecting-self-intersecting-osm-polygons-with-shapely/) over the export and quarantining what it flags costs one pass and removes a whole class of mysterious rendering artefacts.

## Simplification, Coalescing and the Size Budget

**Simplification** reduces vertex counts per zoom. Tippecanoe's default tolerance is reasonable, and the important thing is to remember it operates in tile grid units — simplifying further in your export step is usually wasted work, and simplifying *less* than the grid can represent is impossible to see.

**Coalescing** merges adjacent features that share identical attributes. For a polygon coverage — land use, administrative areas, building blocks — this is transformative at low zoom, because a thousand adjacent parcels with the same class become one polygon with one boundary instead of a thousand shared edges drawn twice each.

**The size budget** is the backstop. Tippecanoe targets a maximum tile size and will drop features to reach it. Leaving it at the default is fine; leaving *dropping* as your only reduction mechanism is not, because its choice of victim is not importance-aware. Configure the budget deliberately, then arrange your zoom ranges so the budget is rarely reached.

## Validation and Error-Handling Matrix

| Condition | Root cause | Detection | Remediation |
| --- | --- | --- | --- |
| Features vanish at some zooms only | Automatic dropping to fit the budget | Missing features cluster in dense tiles | Set per-feature zoom ranges from a computed rank |
| Layer name unexpected | Layer derived from the input file name | Layer named after the file, not the data | Name each layer explicitly on its input |
| Attributes missing from tiles | Attribute limit reached, or types inconsistent | Some features carry a property, others do not | Normalise property types before export |
| Tiles enormous at high zoom | No maximum zoom set, detail retained fully | Archive size grows sharply per level | Cap the maximum zoom and rely on overzoom |
| Polygon coverage has visible seams | Adjacent polygons not coalesced | Hairlines between same-class parcels | Enable coalescing for the coverage layer |
| Build takes many hours | Single-threaded input parsing | One core busy, others idle | Split input by layer and parallelise the reads |
| Points overlap illegibly at low zoom | No point reduction configured | Dense clusters of markers | Drop points by rank, or cluster them explicitly |

## Performance and Scale

Tippecanoe reads its input once into an internal store, then renders each zoom from that store. Two consequences follow.

First, **input size dominates the early phase**. GeoJSON is verbose; a line-delimited variant streams far better than a single enormous feature collection, and filtering out features you will never render before Tippecanoe sees them is the cheapest optimisation available.

Second, **the number of zoom levels dominates the later phase**. Each additional maximum zoom level roughly quadruples the tile count. Capping the maximum zoom and letting clients overzoom is almost always the right trade for a base map, and it is a one-flag change that can turn a six-hour build into a ninety-minute one. [Tuning Tippecanoe Zoom and Feature Dropping](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/building-tiles-with-tippecanoe/tuning-tippecanoe-zoom-and-feature-dropping/) works through both.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 288" role="img" aria-labelledby="btt3-t btt3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="btt3-t">How tile count grows with each additional maximum zoom level</title>
  <desc id="btt3-d">Five maximum zoom settings with their relative cumulative tile counts for the same area. Building to zoom ten is the baseline. Building to zoom twelve is roughly sixteen times as many tiles. Building to zoom fourteen is roughly two hundred and fifty times. Building to zoom sixteen is roughly four thousand times. Building to zoom eighteen is roughly sixty-five thousand times the baseline, which is why no production base map builds that deep.</desc>
  <rect x="0" y="0" width="880" height="288" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Each extra zoom level quadruples the work</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">max zoom 10</text>
  <rect x="226" y="60" width="6" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">baseline</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">max zoom 12</text>
  <rect x="226" y="100" width="6" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 16x</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">max zoom 14</text>
  <rect x="226" y="140" width="6" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 256x</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">max zoom 16</text>
  <rect x="226" y="180" width="32" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 4000x</text>
  <text x="26" y="234" font-size="11.5" font-weight="600" fill="currentColor">max zoom 18</text>
  <rect x="226" y="220" width="508" height="18" rx="4" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="854" y="234" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 65000x</text>
  <text x="868" y="272" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Clients scale the deepest available tile, so most of the detail readers think they are getting above zoom 14 is overzoom anyway.</text>
</svg>
<figcaption>This is the single largest cost decision in a tile build, and it is one flag.</figcaption>
</figure>

## Failure Modes and Gotchas

- **Layer names come from file names by default.** A file called `export.geojson` produces a layer called `export`, and a style written against `transportation` then matches nothing.
- **Property types must be consistent.** A property that is a number in some features and a string in others produces unpredictable encoding.
- **Dropping is silent.** It is reported in the build output, not as an error, so it goes unnoticed in an automated pipeline unless you check.
- **Maximum zoom is not detail.** Capping it does not reduce the detail visible when zoomed in beyond it; the client scales the highest tile.
- **Coalescing needs identical attributes.** Two adjacent parcels differing only by an unused identifier will not merge.
- **Reserved properties are removed.** The `tippecanoe:` properties control behaviour and do not appear in the output tiles, which is correct but surprising the first time.

## Integration Points

Upstream, the export step should compute and attach the rank and zoom-range properties, because that is where the OSM tags are still available — the mapping logic is the same as in [Mapping OSM Tags to a Fixed Schema with YAML](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/mapping-osm-tags-to-a-fixed-schema-with-yaml/), with a cartographic target. Downstream, the MBTiles archive is packaged or converted for serving as described in [Serving & Invalidating OSM Tiles](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/serving-and-invalidating-osm-tiles/), and [Generating MBTiles from OSM GeoJSON](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/building-tiles-with-tippecanoe/generating-mbtiles-from-osm-geojson/) covers the end-to-end run.

## Guides in This Topic

- [Tuning Tippecanoe Zoom and Feature Dropping](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/building-tiles-with-tippecanoe/tuning-tippecanoe-zoom-and-feature-dropping/) — replacing the automatic dropping heuristic with explicit rank-driven zoom ranges.
- [Generating MBTiles from OSM GeoJSON](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/building-tiles-with-tippecanoe/generating-mbtiles-from-osm-geojson/) — a complete run from an extract to an archive, with the checks that make it reproducible.

## Frequently Asked Questions

<details>
<summary>Why do features disappear at some zoom levels?</summary>

Because a tile exceeded the size budget and the dropping stage removed features until it fit. The stage chooses spatially rather than by importance, so in a dense tile the victims are effectively arbitrary. The fix is not to raise the budget but to make the dropping unnecessary: compute a rank per feature during export, map it to a minimum zoom, and write that onto the feature so the tile is the right size before the budget is ever consulted.
</details>

<details>
<summary>Should I set zoom ranges per feature or per layer?</summary>

Per feature, wherever you have the information to do so. A layer-wide minimum zoom treats a motorway and a residential cul-de-sac identically, which is exactly the distinction a base map needs. Since the export step still has the OSM tags, that is where the rank should be computed and the zoom range attached; by the time Tippecanoe sees the data the tags may already have been collapsed into a small vocabulary.
</details>

<details>
<summary>What maximum zoom should I build to?</summary>

Usually lower than instinct suggests. Each additional level roughly quadruples the tile count, and clients scale the deepest available tile to render beyond it, so the detail loss from capping at a moderate zoom is far smaller than the storage and build-time saving. Build to the zoom at which your data genuinely stops adding detail, and let overzoom handle everything above.
</details>

<details>
<summary>When is coalescing worth enabling?</summary>

Whenever a layer is a coverage — land use, administrative areas, blocks of same-class buildings — where adjacent features share attributes and their shared boundaries are drawn twice for no benefit. Merging them removes both the duplicate edges and the hairline seams between them. It is not useful for layers where features are genuinely distinct objects, such as roads or points of interest, and it will not merge features whose attributes differ in any way.
</details>

<details>
<summary>Does Tippecanoe need the input in a particular projection?</summary>

It expects geographic coordinates in WGS 84, which is what OSM data already is, and handles the projection into tile space itself. Reprojecting the input first is both unnecessary and harmful, since the tile pyramid is defined in Web Mercator and a pre-projected input will be treated as degrees and land somewhere near the origin of the map.
</details>

## Related

- [OSM Vector Tiles & Rendering Pipelines](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/) — the parent section and the schema decisions that precede this step.
- [Planetiler & Tilemaker Workflows](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/planetiler-and-tilemaker-workflows/) — the alternative when reading PBF directly is preferable.
- [Cartographic Generalization of OSM Data](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/) — the rank and aggregation decisions that feed zoom ranges.
- [Exporting OSM to GeoParquet & PostGIS](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/) — producing the GeoJSON this stage consumes.
- [Serving & Invalidating OSM Tiles](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/serving-and-invalidating-osm-tiles/) — what happens to the archive afterwards.
- [The Mapbox Vector Tile Spec & Tile Geometry](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/) — the encoding this tool performs on your behalf.

Up one level: [OSM Vector Tiles & Rendering Pipelines](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Building OSM Tiles with Tippecanoe",
  "description": "Tippecanoe's model for OSM data: GeoJSON in, MBTiles out, with zoom ranges, feature dropping, coalescing and the tile size budget under explicit control rather than heuristic.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Vector Tiles & Rendering Pipelines",
  "about": ["Tippecanoe", "MBTiles generation", "zoom-dependent dropping"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Vector Tiles & Rendering Pipelines", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/" },
    { "@type": "ListItem", "position": 3, "name": "Building OSM Tiles with Tippecanoe", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/building-tiles-with-tippecanoe/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Drive Tippecanoe deliberately on OSM data",
  "description": "Attach rank-derived zoom ranges during export, name layers explicitly, enable coalescing for coverages, cap the maximum zoom, and treat automatic dropping as a safety net rather than a control.",
  "step": [
    { "@type": "HowToStep", "name": "Compute a rank during export", "text": "Derive an importance rank from OSM tags while they are still available and attach it to each feature." },
    { "@type": "HowToStep", "name": "Attach per-feature zoom ranges", "text": "Map the rank to a minimum and maximum zoom and write them as the reserved properties Tippecanoe reads." },
    { "@type": "HowToStep", "name": "Name layers explicitly", "text": "Set each layer's name on its input rather than letting it be derived from the file name." },
    { "@type": "HowToStep", "name": "Enable coalescing for coverages", "text": "Merge adjacent features with identical attributes in land use and administrative layers to remove duplicate boundaries." },
    { "@type": "HowToStep", "name": "Cap the maximum zoom", "text": "Build to the zoom where the data stops adding detail and let clients overzoom above it." },
    { "@type": "HowToStep", "name": "Check the dropping report", "text": "Read the build output for features removed to meet the size budget and tighten zoom ranges until it is rare." }
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
      "name": "Why do features disappear at some zoom levels in Tippecanoe output?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because a tile exceeded the size budget and the dropping stage removed features until it fit. The stage chooses spatially rather than by importance, so in a dense tile the victims are effectively arbitrary. The fix is to make the dropping unnecessary: compute a rank per feature during export, map it to a minimum zoom, and write that onto the feature." }
    },
    {
      "@type": "Question",
      "name": "Should I set Tippecanoe zoom ranges per feature or per layer?",
      "acceptedAnswer": { "@type": "Answer", "text": "Per feature, wherever you have the information to do so. A layer-wide minimum zoom treats a motorway and a residential cul-de-sac identically, which is exactly the distinction a base map needs. Since the export step still has the OSM tags, that is where the rank should be computed and the zoom range attached." }
    },
    {
      "@type": "Question",
      "name": "What maximum zoom should I build tiles to?",
      "acceptedAnswer": { "@type": "Answer", "text": "Usually lower than instinct suggests. Each additional level roughly quadruples the tile count, and clients scale the deepest available tile to render beyond it, so the detail loss from capping at a moderate zoom is far smaller than the storage and build-time saving." }
    },
    {
      "@type": "Question",
      "name": "When is Tippecanoe coalescing worth enabling?",
      "acceptedAnswer": { "@type": "Answer", "text": "Whenever a layer is a coverage — land use, administrative areas, blocks of same-class buildings — where adjacent features share attributes and their shared boundaries are drawn twice for no benefit. It is not useful for layers where features are genuinely distinct objects, and it will not merge features whose attributes differ in any way." }
    },
    {
      "@type": "Question",
      "name": "Does Tippecanoe need input in a particular projection?",
      "acceptedAnswer": { "@type": "Answer", "text": "It expects geographic coordinates in WGS 84, which is what OSM data already is, and handles the projection into tile space itself. Reprojecting the input first is both unnecessary and harmful, since a pre-projected input will be treated as degrees and land somewhere near the origin of the map." }
    }
  ]
}
</script>
