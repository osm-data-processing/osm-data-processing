---
title: "R-tree vs H3 vs Quadkey: Spatial Index Selection"
description: "Decide between R-tree, H3, Quadkey grids, and S2 for OSM workloads — a decision matrix keyed to query type, area uniformity, neighbour traversal, and tiling, with code sketches and a combine-them pattern."
pageTitle: "R-tree vs H3 vs Quadkey: Choosing an OSM Spatial Index"
pageDescription: "A decision matrix for OSM spatial indexing: match R-tree, H3, Quadkey, or S2 to your query type, density gradient, and uniform-area needs, and learn when to run two indexes side by side."
slug: spatial-index-selection-rtree-h3-quadkey
type: guide
breadcrumb: "Spatial Index Selection"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# R-tree vs H3 vs Quadkey: Spatial Index Selection

The spatial index you pick for an OpenStreetMap workload is a decision made once and paid on every query for the life of the pipeline, and the wrong choice fails quietly rather than loudly. A team indexing a national point-of-interest layer into H3 resolution 8 to answer "which shops fall inside this administrative boundary" ships a plausible-looking service that is subtly wrong at every border: hexagons approximate the polygon, straddle its edge, and count cafés on the far side of a river as inside the district. Another team reaches for an R-tree to drive a country-wide density heatmap and discovers the tree gives them fast candidate lookups but no natural cell to aggregate into, so they bolt on an ad-hoc grid and re-derive it inconsistently across reports. Neither failure is a bug in the library — both are a mismatch between the index's geometry and the question being asked. This page is the selection guide for that decision, sitting inside the broader [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/) layer, and it is the companion to the how-to-build reference: where [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/) shows how to construct a disk-backed R-tree, this page is the decision matrix it points to for *which* index to construct in the first place.

<svg viewBox="0 0 1000 470" role="img" aria-label="Decision tree for selecting an OSM spatial index. Starting from the question of what the dominant query must do, four branches lead to recommendations: when the query needs true geometry for an exact join or point-in-polygon prefilter, choose an R-tree; when results must align to slippy-map tiles, choose a Quadkey or grid; when cells must have equal area for aggregation, choose H3; and when the workload covers whole-globe regions, choose S2." xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:1000px;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>Decision tree mapping an OSM workload to a recommended spatial index</title>
  <desc>A start box asks what the dominant query must do. Four fanning branches lead to four recommendation cards. The branch labelled "need true geometry?" leads to an R-tree card, best for spatial joins, point-in-polygon prefilters, and varying-density data. The branch labelled "aligned to map tiles?" leads to a Quadkey or grid card, best for map tiling on z/x/y and coarse prefiltering. The branch labelled "equal-area cells?" leads to an H3 card, best for point-of-interest aggregation, ring-neighbour traversal, and equal-area statistics. The branch labelled "whole-globe regions?" leads to an S2 card, best for region covering with spherical cells.</desc>
  <defs>
    <marker id="sis-arr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker>
  </defs>
  <text x="500" y="20" text-anchor="middle" font-size="15" fill="currentColor" font-weight="700">Match the index to the dominant query</text>
  <!-- start -->
  <rect x="380" y="30" width="240" height="54" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="500" y="52" text-anchor="middle" font-size="13.5" fill="currentColor" font-weight="700">What must the query do?</text>
  <text x="500" y="70" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">pick by workload, not habit</text>
  <!-- edges -->
  <line x1="500" y1="84" x2="140" y2="306" stroke="currentColor" stroke-width="1.5" marker-end="url(#sis-arr)"/>
  <line x1="500" y1="84" x2="380" y2="306" stroke="currentColor" stroke-width="1.5" marker-end="url(#sis-arr)"/>
  <line x1="500" y1="84" x2="620" y2="306" stroke="currentColor" stroke-width="1.5" marker-end="url(#sis-arr)"/>
  <line x1="500" y1="84" x2="860" y2="306" stroke="currentColor" stroke-width="1.5" marker-end="url(#sis-arr)"/>
  <!-- edge condition labels -->
  <rect x="238" y="184" width="148" height="24" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1"/>
  <text x="312" y="200" text-anchor="middle" font-size="11" fill="currentColor" font-weight="600">need true geometry?</text>
  <rect x="360" y="222" width="148" height="24" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1"/>
  <text x="434" y="238" text-anchor="middle" font-size="11" fill="currentColor" font-weight="600">aligned to map tiles?</text>
  <rect x="500" y="222" width="140" height="24" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1"/>
  <text x="570" y="238" text-anchor="middle" font-size="11" fill="currentColor" font-weight="600">equal-area cells?</text>
  <rect x="628" y="184" width="152" height="24" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1"/>
  <text x="704" y="200" text-anchor="middle" font-size="11" fill="currentColor" font-weight="600">whole-globe regions?</text>
  <!-- Card 1: R-tree -->
  <rect x="18" y="308" width="210" height="150" rx="8" fill="none" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <rect x="18" y="308" width="210" height="30" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="123" y="329" text-anchor="middle" font-size="14" fill="currentColor" font-weight="700">R-tree</text>
  <text x="123" y="364" text-anchor="middle" font-size="11.5" fill="currentColor">Spatial joins</text>
  <text x="123" y="386" text-anchor="middle" font-size="11.5" fill="currentColor">Point-in-polygon prefilter</text>
  <text x="123" y="408" text-anchor="middle" font-size="11.5" fill="currentColor">Varying density</text>
  <text x="123" y="438" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">rtree · libspatialindex</text>
  <!-- Card 2: Quadkey / Grid -->
  <rect x="268" y="308" width="210" height="150" rx="8" fill="none" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <rect x="268" y="308" width="210" height="30" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="373" y="329" text-anchor="middle" font-size="14" fill="currentColor" font-weight="700">Quadkey / Grid</text>
  <text x="373" y="364" text-anchor="middle" font-size="11.5" fill="currentColor">Map tiling z/x/y</text>
  <text x="373" y="386" text-anchor="middle" font-size="11.5" fill="currentColor">Coarse prefilter</text>
  <text x="373" y="408" text-anchor="middle" font-size="11.5" fill="currentColor">Cheap to compute</text>
  <text x="373" y="438" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">mercantile</text>
  <!-- Card 3: H3 -->
  <rect x="518" y="308" width="210" height="150" rx="8" fill="none" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <rect x="518" y="308" width="210" height="30" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="623" y="329" text-anchor="middle" font-size="14" fill="currentColor" font-weight="700">H3</text>
  <text x="623" y="364" text-anchor="middle" font-size="11.5" fill="currentColor">POI aggregation</text>
  <text x="623" y="386" text-anchor="middle" font-size="11.5" fill="currentColor">Ring-neighbour traversal</text>
  <text x="623" y="408" text-anchor="middle" font-size="11.5" fill="currentColor">Equal-area stats</text>
  <text x="623" y="438" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">h3-py</text>
  <!-- Card 4: S2 -->
  <rect x="768" y="308" width="214" height="150" rx="8" fill="none" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <rect x="768" y="308" width="214" height="30" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="875" y="329" text-anchor="middle" font-size="14" fill="currentColor" font-weight="700">S2</text>
  <text x="875" y="364" text-anchor="middle" font-size="11.5" fill="currentColor">Region covering</text>
  <text x="875" y="386" text-anchor="middle" font-size="11.5" fill="currentColor">Spherical cells</text>
  <text x="875" y="408" text-anchor="middle" font-size="11.5" fill="currentColor">Ordered ranges</text>
  <text x="875" y="438" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">s2 / s2sphere</text>
</svg>

## Start here: the three questions that decide it

Before comparing families, resolve three questions about the workload, because they eliminate options faster than any benchmark. First, **is the query exact or approximate?** A topology join, a nearest-road snap, or a point-in-polygon test that must be correct at the boundary needs the true geometry — only an R-tree gives you a candidate set you can refine to an exact answer. A "roughly how many features per area" question tolerates cell approximation and opens the door to grids. Second, **does the output have to align to something external?** If results feed a slippy-map renderer, a tile server, or a Web Mercator pyramid, the cell scheme is already chosen for you — it is the quadkey. Third, **must every cell cover comparable ground area?** Density statistics, choropleths, and machine-learning features over a wide latitude span want near-uniform cells, which is exactly what planar grids fail to give and hexagonal H3 is built to provide.

These questions map onto three families that are complementary rather than rival: bounding-box hierarchies (R-tree), planar tile grids (Quadkey), and global discrete grids (H3 and S2). Most mature OSM stacks end up running two of them for different questions, so the goal is not to crown a winner but to route each query to the structure whose geometry matches it.

## Prerequisites

This guide assumes you already understand what you are indexing. Read the [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) first, because whether a primitive is a point, a line, or a polygon changes which index even applies — you can drop a node straight into an H3 cell, but a way is only indexable once its node references resolve into a geometry. Second, the [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) reference matters here more than anywhere: OSM stores unprojected WGS 84, quadkeys live in Web Mercator, and H3 works on the sphere, so every family answers the latitude-distortion question differently. Third, keep the [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) conventions in view, since the smart move is often per-feature-class indexing — a separate structure for `highway=*` versus `amenity=*` rather than one monolithic index.

## The decision matrix

The table below is the fast path. Read down the column for your dominant query and the winning family is usually obvious; the sections after it explain the trade-offs when two columns tie.

| Criterion | R-tree | Quadkey / Grid | H3 | S2 |
|---|---|---|---|---|
| Query type it wins | Exact spatial join, PIP, nearest | Tile-aligned lookup, coarse bucketing | Area aggregation, density | Region covering, ordered scans |
| Cell geometry | Data-shaped MBRs | Square, power-of-two split | Hexagon (+12 pentagons) | Spherical quadrilateral |
| Area uniformity | N/A (bounds, not cells) | Poor — shrinks toward poles | Near-uniform per resolution | Near-uniform per level |
| Neighbour traversal | None built in | Bit-twiddle on x/y | `grid_disk` ring, one hop | Face-based, edge adjacency |
| Tiling / slippy-map fit | Poor | Native (z/x/y) | Poor (hex ≠ tile) | Poor |
| Point-in-polygon prefilter | Excellent | Good (cheap prefilter) | Approximate only | Approximate only |
| Memory / storage | Tree, memory-mapped | One integer key per feature | One 64-bit id per feature | One 64-bit id per feature |
| Handles varying density | Excellent (adapts) | Fixed cells over-/under-shoot | Fixed cells per resolution | Fixed cells per level |
| Best for | Correct geometric answers | Rendering & tile pipelines | Analytics, ML features | Global datasets, range queries |

Two rows deserve emphasis. **Area uniformity** is the single reason to leave a quadkey grid behind: because a Web Mercator cell's ground area scales with $\cos(\varphi)$, a fixed-zoom grid over a country spanning many degrees of latitude gives Oslo cells a fraction of the ground area of Naples cells, silently biasing any per-cell statistic. **Point-in-polygon prefilter** is the reason to keep an R-tree even in a grid-heavy stack: only bounding-box candidate resolution followed by an exact predicate returns geometrically correct membership at a boundary.

## R-tree: when exact geometry wins

Choose an R-tree whenever the answer must be geometrically correct — spatial joins between two OSM layers, snapping GPS traces to roads, clipping features to an administrative polygon, or nearest-feature search. The tree stores minimum bounding rectangles and adapts its node shapes to the data, so it handles the wild density gradient between a dense city core and empty countryside without the wasted cells a fixed grid would spend on the empty half. The catch is that it returns *candidates*, never final answers, and it offers no free notion of a neighbour cell to aggregate into — so it is a poor fit for "count features per area" questions.

```python
import rtree
from shapely.geometry import shape

idx = rtree.index.Index()
geoms: dict[int, object] = {}
for fid, feature in enumerate(features):
    geom = shape(feature["geometry"])
    geoms[fid] = geom
    idx.insert(fid, geom.bounds)  # bounds == (minx, miny, maxx, maxy)

# Coarse candidates by MBR overlap, then refine to an exact answer.
window = (13.30, 52.45, 13.50, 52.55)  # (min_lon, min_lat, max_lon, max_lat)
candidates = [geoms[i] for i in idx.intersection(window)]
```

The construction details — streaming a PBF into a disk-backed index, the `flex_mem` versus `sparse_file_array` location store, and STR-packing for read-heavy trees — belong to the build guide and are not repeated here.

## Quadkey and grids: when tiles rule

Choose a quadkey or an equivalent fixed grid when the output must line up with map tiles, or when you need a dirt-cheap, embarrassingly parallel bucketing key and can tolerate area distortion. A quadkey is a pure function of longitude, latitude, and zoom — no tree to build, no state to persist, and the key is a short string you can group by in any database. It is the right prefilter in front of an exact test: bucket features by tile, and a spatial query only has to open the handful of tiles its window touches. The weaknesses are the $\cos(\varphi)$ area skew and boundary fragmentation — a feature straddling a tile edge belongs to every tile it touches and must be de-duplicated on read.

```python
import mercantile

def quadkey_at(lon: float, lat: float, zoom: int = 14) -> str:
    """Map a coordinate to its slippy-map tile and quadkey string."""
    tile = mercantile.tile(lng=lon, lat=lat, zoom=zoom)
    return mercantile.quadkey(tile)  # e.g. '12020210233' — z digits long

# Bucket POIs into tiles for a coarse, tile-aligned prefilter.
from collections import defaultdict
buckets: dict[str, list[int]] = defaultdict(list)
for fid, (lon, lat) in enumerate(points):
    buckets[quadkey_at(lon, lat)].append(fid)
```

Because the quadkey shares the exact tiling scheme of the slippy-map pyramid, this is also the family that hands off cleanly to a tile renderer without a reprojection step.

## H3 and S2: when uniform area matters

Choose H3 when the question is aggregation — counts, densities, rates, or gridded ML features — and every cell should cover comparable ground so the numbers are comparable across latitudes. H3's hexagons have a single neighbour distance in all six directions (no diagonal-versus-orthogonal ambiguity), so ring traversal with `grid_disk` is clean, and the fixed set of resolutions gives you a hierarchy to roll up or drill down. Choose S2 instead when the workload is planet-scale and you want cells whose 64-bit ids fall on a space-filling curve, so a geographic region maps to a small set of contiguous integer *ranges* — ideal for range scans in an ordered key-value store. Both approximate polygon boundaries, so neither is a substitute for an R-tree when membership must be exact.

```python
import h3
from collections import Counter

def aggregate_h3(points: list[tuple[float, float]], res: int = 8) -> Counter:
    """Count POIs per H3 cell at a chosen resolution."""
    counts: Counter = Counter()
    for lon, lat in points:
        cell = h3.latlng_to_cell(lat, lon, res)  # note: (lat, lon) order
        counts[cell] += 1
    return counts

cell = h3.latlng_to_cell(52.520, 13.404, 8)
ring = h3.grid_disk(cell, 1)  # the cell plus its six neighbours
```

Picking the resolution number is its own decision — too coarse blurs the signal, too fine leaves most cells empty — and that trade-off is worked through in [Choosing an H3 Resolution for OSM Point Aggregation](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/choosing-h3-resolution-for-osm-point-aggregation/).

## Combine them: an R-tree join plus an H3 column

The most common production answer is not one index but two, because exact joins and coarse rollups are genuinely different questions. Carry an R-tree for geometry-correct spatial joins and, on the very same feature rows, materialize an H3 cell id as an ordinary column so aggregation is a plain `GROUP BY`. The R-tree lives in memory or on disk as a tree; the H3 id is just a 64-bit integer that travels with the row into Parquet, PostGIS, or a warehouse, where it costs nothing to filter or roll up.

```python
import h3
import rtree

idx = rtree.index.Index()
rows: list[dict] = []
for fid, feat in enumerate(features):
    lon, lat = feat["lon"], feat["lat"]
    idx.insert(fid, (lon, lat, lon, lat))          # exact spatial join path
    rows.append({
        "fid": fid,
        "h3_r8": h3.latlng_to_cell(lat, lon, 8),    # GROUP BY aggregation path
        "tags": feat["tags"],
    })
# idx answers "which features intersect this polygon?"
# rows answer "how many features per hexagon?" — no re-derivation, one pass.
```

The single-pass build keeps the two indexes consistent by construction: every feature that enters the tree also gets its hex id, so the join layer and the analytics layer can never drift out of agreement about which features exist.

## Failure modes and gotchas

- **Approximate membership sold as exact.** Snapping a boundary polygon to H3 or S2 cells and treating cell membership as polygon membership double-counts and mis-counts along every edge. Use a discrete grid to *bucket*, then refine with an exact predicate when correctness at the boundary matters.
- **Latitude area skew in grids.** A fixed-zoom quadkey grid gives high-latitude cells a small fraction of the equatorial ground area, biasing any per-cell density. Reach for H3 the moment you compute a statistic per cell across a wide latitude span.
- **Coordinate order flips.** R-tree bounds are `(minx, miny, maxx, maxy)` — that is `(lon, lat)` — but `h3.latlng_to_cell` takes `(lat, lon)`. Mixing the conventions is the classic silent relocation bug; pin the order per call site.
- **Resolution or zoom chosen by taste.** Both H3 resolution and quadkey zoom trade cell count against statistical stability; choose them from cell area versus expected feature count, not from a round number.
- **Pentagon and antimeridian edge cases.** H3 has twelve pentagon cells and S2 wraps the antimeridian; distance and neighbour logic must tolerate both rather than assuming a perfect hex or a flat plane.
- **One monolithic index for every feature class.** Indexing `highway=*` and `amenity=*` into the same structure forces every query to wade through irrelevant features. Filter by feature class at insertion and index each class separately.

## Choosing a resolution, in depth

This section has one child guide, which turns the "which H3 resolution?" question into a runnable, reproducible procedure rather than a guess:

- [Choosing an H3 Resolution for OSM Point Aggregation](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/choosing-h3-resolution-for-osm-point-aggregation/) — how to pick a resolution 0–15 for aggregating OSM points, trading cell area against cell count and statistical stability, with the H3 area formula and a per-cell counting script.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Select a spatial index for an OSM workload",
  "description": "Decide between an R-tree, a Quadkey grid, H3, and S2 for an OpenStreetMap workload by matching the index geometry to the dominant query.",
  "step": [
    { "@type": "HowToStep", "name": "Classify the query as exact or approximate", "text": "If the answer must be geometrically correct at boundaries — spatial joins, point-in-polygon, nearest-feature — choose an R-tree that returns candidates you refine with an exact predicate." },
    { "@type": "HowToStep", "name": "Check for external tile alignment", "text": "If output must align to slippy-map tiles or a Web Mercator pyramid, choose a Quadkey or grid because the cell scheme is fixed by the renderer." },
    { "@type": "HowToStep", "name": "Check whether cells need equal area", "text": "If you compute a statistic per cell across a wide latitude span, choose H3 for near-uniform hexagons, or S2 for planet-scale ordered range scans, since planar grids skew toward the poles." },
    { "@type": "HowToStep", "name": "Pick the resolution or zoom deliberately", "text": "Choose H3 resolution or quadkey zoom from cell area versus expected feature count so cells are neither too coarse to resolve signal nor so fine that most are empty." },
    { "@type": "HowToStep", "name": "Combine indexes when questions differ", "text": "Carry an R-tree for exact joins and materialize an H3 cell id as a column on the same rows so aggregation is a plain GROUP BY, built in one pass to keep them consistent." }
  ]
}
</script>

## Frequently Asked Questions

<details>
<summary>Is H3 a replacement for an R-tree?</summary>

No — they answer different questions. An R-tree returns geometry-correct candidates for exact spatial joins and point-in-polygon tests, while H3 buckets features into equal-area hexagons for aggregation and density. H3 membership only approximates a polygon boundary, so using it for exact containment mis-counts along every edge. Many stacks run both: an R-tree for joins and an H3 id column for rollups.
</details>

<details>
<summary>When should I use a Quadkey instead of H3?</summary>

Use a Quadkey when the output must align to slippy-map tiles or a Web Mercator pyramid, or when you need an extremely cheap, stateless bucketing key computed as a pure function of coordinate and zoom. Prefer H3 when you compute per-cell statistics across a wide latitude span, because a fixed-zoom quadkey grid shrinks toward the poles and biases density, whereas H3 cells stay near-uniform in area.
</details>

<details>
<summary>What is the difference between H3 and S2 for OSM data?</summary>

Both are global discrete grids with near-uniform cells and a 64-bit id per cell. H3 uses hexagons, which give a single neighbour distance in all directions and clean ring traversal, making it strong for aggregation and analytics. S2 uses spherical quadrilaterals ordered along a space-filling curve, so a region maps to a few contiguous id ranges, which suits range scans in an ordered key-value store over planet-scale data.
</details>

<details>
<summary>Can I run more than one spatial index at once?</summary>

Yes, and it is the common production pattern. Build an R-tree for exact spatial joins and, on the same feature rows, materialize an H3 cell id as an ordinary column so aggregation becomes a GROUP BY. Building both in a single pass keeps them consistent by construction, since every feature that enters the tree also receives its hex id.
</details>

<details>
<summary>Why does query correctness matter more than index speed?</summary>

A fast index that returns geometrically wrong answers is worse than a slower correct one, because the errors are silent and compound downstream. Grid-based membership approximates polygon edges, so counts drift at every boundary. Decide correctness first — exact geometry needs an R-tree with an exact refine — then optimize speed within the family that gives correct answers for your query.
</details>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Is H3 a replacement for an R-tree?",
      "acceptedAnswer": { "@type": "Answer", "text": "No, they answer different questions. An R-tree returns geometry-correct candidates for exact spatial joins and point-in-polygon tests, while H3 buckets features into equal-area hexagons for aggregation and density. H3 membership only approximates a polygon boundary, so using it for exact containment mis-counts along every edge. Many stacks run both: an R-tree for joins and an H3 id column for rollups." }
    },
    {
      "@type": "Question",
      "name": "When should I use a Quadkey instead of H3?",
      "acceptedAnswer": { "@type": "Answer", "text": "Use a Quadkey when the output must align to slippy-map tiles or a Web Mercator pyramid, or when you need an extremely cheap, stateless bucketing key computed as a pure function of coordinate and zoom. Prefer H3 when you compute per-cell statistics across a wide latitude span, because a fixed-zoom quadkey grid shrinks toward the poles and biases density, whereas H3 cells stay near-uniform in area." }
    },
    {
      "@type": "Question",
      "name": "What is the difference between H3 and S2 for OSM data?",
      "acceptedAnswer": { "@type": "Answer", "text": "Both are global discrete grids with near-uniform cells and a 64-bit id per cell. H3 uses hexagons, which give a single neighbour distance in all directions and clean ring traversal, making it strong for aggregation and analytics. S2 uses spherical quadrilaterals ordered along a space-filling curve, so a region maps to a few contiguous id ranges, which suits range scans in an ordered key-value store over planet-scale data." }
    },
    {
      "@type": "Question",
      "name": "Can I run more than one spatial index at once?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes, and it is the common production pattern. Build an R-tree for exact spatial joins and, on the same feature rows, materialize an H3 cell id as an ordinary column so aggregation becomes a GROUP BY. Building both in a single pass keeps them consistent by construction, since every feature that enters the tree also receives its hex id." }
    },
    {
      "@type": "Question",
      "name": "Why does query correctness matter more than index speed?",
      "acceptedAnswer": { "@type": "Answer", "text": "A fast index that returns geometrically wrong answers is worse than a slower correct one, because the errors are silent and compound downstream. Grid-based membership approximates polygon edges, so counts drift at every boundary. Decide correctness first, since exact geometry needs an R-tree with an exact refine, then optimize speed within the family that gives correct answers for your query." }
    }
  ]
}
</script>

## Related

- [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/) — the how-to-build companion that constructs the disk-backed R-tree this page tells you when to reach for.
- [Choosing an H3 Resolution for OSM Point Aggregation](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/choosing-h3-resolution-for-osm-point-aggregation/) — the resolution decision once you have chosen H3.
- [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) — why WGS 84, Web Mercator, and the sphere make each family answer latitude distortion differently.
- [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — the primitives that decide whether a feature is point-, line-, or polygon-indexable.
- [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) — filtering feature classes so each class gets its own index rather than one monolith.

This guide is part of the [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/) section — return there for the full map of the OSM data model, serialization formats, and indexing foundations.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "R-tree vs H3 vs Quadkey: Spatial Index Selection",
  "description": "Decide between R-tree, H3, Quadkey grids, and S2 for OSM workloads with a decision matrix keyed to query type, area uniformity, neighbour traversal, and tiling, plus a combine-them pattern.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "OSM Data Fundamentals & Architecture",
  "about": ["spatial index selection", "R-tree vs H3 vs Quadkey", "OSM spatial querying"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Fundamentals & Architecture", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/" },
    { "@type": "ListItem", "position": 3, "name": "Spatial Index Selection", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/" }
  ]
}
</script>
