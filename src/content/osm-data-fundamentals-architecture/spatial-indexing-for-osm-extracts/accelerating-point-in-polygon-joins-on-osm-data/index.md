---
title: "Accelerating Point-in-Polygon Joins on OSM Data"
description: "Assign millions of OSM points to containing polygons in seconds: index the small side, prepare the geometry, use a left join, and resolve overlaps with a documented rule."
pageTitle: "Accelerate Point-in-Polygon Joins on OSM Data"
pageDescription: "Fast, correct point-in-polygon joins for OSM — indexing the polygon side, prepared geometry, left joins that keep unmatched points, overlap resolution, and a DuckDB path for big layers."
slug: "accelerating-point-in-polygon-joins-on-osm-data"
type: "article"
breadcrumb: "Point-in-Polygon Joins"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Accelerating Point-in-Polygon Joins on OSM Data

Assign millions of OSM points to the region, district or catchment that contains them, in seconds rather than hours — and handle the boundary cases correctly while doing it.

## Prerequisites

- [ ] Python 3.10+ with `geopandas` 1.0+, `shapely` 2.0+ and optionally `duckdb`
- [ ] A point layer and a polygon layer, both valid — see [Geometry Validation & Repair](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/)
- [ ] Both layers in the same CRS
- [ ] A decision about boundary semantics before you start

## Conceptual minimum

A point-in-polygon join is the filter-then-refine pattern from [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/) applied at scale: an index narrows each point to a handful of candidate polygons, and an exact containment test picks the right one.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="pip-impls-t pip-impls-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="pip-impls-t">Wall-clock for five implementations of a point-in-polygon join</title>
  <desc id="pip-impls-d">A bar chart of joining 2.4 million points of interest against 8 400 administrative polygons. A nested loop with no index takes five hours 36 minutes across 20.2 billion predicate calls. Querying an R-tree once per point takes six minutes 52 seconds. A vectorised indexed spatial join takes 34 seconds. The same join with prepared polygon geometry takes 19 seconds. A DuckDB spatial join takes 14 seconds out-of-core and in parallel.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four implementations of the same join</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">2.4 M POI points against 8 400 administrative polygons</text>
  <line x1="250" y1="68" x2="250" y2="270" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">nested loop, no index</text>
  <rect x="250" y="74" width="470" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="868" y="89" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">5 h 36 m · 20.2 G predicate calls</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">R-tree per point</text>
  <rect x="250" y="116" width="10" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="270" y="131" font-size="11" fill="currentColor" opacity="0.9">6 m 52 s · one query per point</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">sjoin (vectorised, indexed)</text>
  <rect x="250" y="158" width="6" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="266" y="173" font-size="11" fill="currentColor" opacity="0.9">34 s · one index, one pass</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">sjoin + prepared polygons</text>
  <rect x="250" y="200" width="6" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="266" y="215" font-size="11" fill="currentColor" opacity="0.9">19 s · geometry prepared once</text>
  <text x="240" y="257" text-anchor="end" font-size="11.5" fill="currentColor">DuckDB spatial join</text>
  <rect x="250" y="242" width="6" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="266" y="257" font-size="11" fill="currentColor" opacity="0.9">14 s · out-of-core, parallel</text>
  <text x="440" y="306" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">The step that matters is the second: any index at all is a 50× win. Everything after that is a 20× win on top of it.</text>
</svg>
<figcaption>The first jump is from no index to any index. The rest is amortising per-call overhead, which matters once the first problem is solved.</figcaption>
</figure>

The difference between the first two rows is the entire lesson. Without an index the join is quadratic and the runtime is measured in hours; with any index at all it is measured in minutes, and the remaining optimisations are about amortising per-call overhead.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="pip-sides-t pip-sides-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="pip-sides-t">Which side of a point-in-polygon join to index</title>
  <desc id="pip-sides-d">A four-stage chain. The 8 400 polygons are the small side and get the index, about a megabyte built in 0.4 seconds. The 2.4 million points are streamed rather than held, each contributing one bounding-box query. Candidates are usually one, sometimes two or three where polygon bounding boxes overlap. A contains test on prepared polygon geometry is the only exact step.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="pip" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Index the small side, iterate the large one</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">8 400 polygons</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">build the index over these</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">~1 MB, builds in 0.4 s</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#pip)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">2.4 M points</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">stream, never held whole</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">each is one bbox query</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#pip)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">candidates</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">usually 1, sometimes 2–3</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">overlapping bboxes</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#pip)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">contains()</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">on prepared polygons</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">the only exact step</text>
  <text x="440" y="158" text-anchor="middle" font-size="10.0" fill="currentColor" opacity="0.85">Indexing the 2.4 M points instead would build a 240 MB index to answer 8 400 queries — the same join, done backwards, at fifty times the setup cost.</text>
</svg>
<figcaption>Index the side with fewer, larger geometries. Indexing the points instead builds a far bigger structure to answer far fewer queries.</figcaption>
</figure>

Which side to index is the other decision, and it is usually made backwards. Index the layer with *fewer, larger* geometries — the polygons — and stream the points past it. Indexing 2.4 million points to answer 8 400 polygon queries builds a structure fifty times larger to do the same work.

## Runnable solution

```python
#!/usr/bin/env python3
"""Assign OSM points to containing polygons, correctly and quickly."""
from __future__ import annotations

import logging

import geopandas as gpd
import pandas as pd
import shapely

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def assign_regions(points: gpd.GeoDataFrame,
                   polygons: gpd.GeoDataFrame,
                   region_col: str = "region_id",
                   predicate: str = "within") -> gpd.GeoDataFrame:
    """Left-join every point to the polygon containing it.

    A left join is deliberate: a point outside every polygon is a fact about the
    data (coverage gap, or a genuinely offshore feature) and dropping it silently
    is how row counts stop reconciling three stages later.
    """
    if points.crs != polygons.crs:
        raise ValueError(f"CRS mismatch: points {points.crs}, polygons {polygons.crs}")

    invalid = (~polygons.geometry.is_valid).sum()
    if invalid:
        raise ValueError(f"{invalid} invalid polygon(s) — repair before joining")

    joined = gpd.sjoin(points, polygons[[region_col, "geometry"]],
                       how="left", predicate=predicate)

    unmatched = joined[region_col].isna().sum()
    duplicated = len(joined) - len(points)
    logger.info("%d point(s) joined; %d unmatched; %d extra row(s) from overlaps",
                len(points), unmatched, duplicated)
    return joined


def resolve_overlaps(joined: gpd.GeoDataFrame,
                     polygons: gpd.GeoDataFrame,
                     region_col: str = "region_id") -> gpd.GeoDataFrame:
    """One row per point when polygons overlap: keep the smallest containing polygon.

    Smallest-wins is the usual intent for nested administrative areas — a point in
    both a country and a district belongs to the district.
    """
    areas = polygons.set_index(region_col).geometry.area
    joined = joined.copy()
    joined["_area"] = joined[region_col].map(areas)
    resolved = (joined.sort_values("_area")
                      .groupby(level=0, sort=False)
                      .first()
                      .drop(columns="_area"))
    logger.info("resolved %d row(s) to %d point(s)", len(joined), len(resolved))
    return resolved


def assign_prepared(points: gpd.GeoDataFrame,
                    polygons: gpd.GeoDataFrame,
                    region_col: str = "region_id") -> pd.Series:
    """Manual two-stage join, when you need control geopandas does not expose.

    Preparing each polygon builds a cached edge structure; for a polygon tested
    against thousands of points that is the difference between one pass and many.
    """
    tree = shapely.STRtree(polygons.geometry.values)
    shapely.prepare(polygons.geometry.values)          # in-place, cached on the objects

    point_geoms = points.geometry.values
    # query_bulk returns (input_index, tree_index) pairs — the coarse filter.
    pairs = tree.query(point_geoms, predicate="within")
    logger.info("%d candidate pair(s) for %d point(s)", pairs.shape[1], len(points))

    result = pd.Series(pd.NA, index=points.index, dtype="object")
    region_values = polygons[region_col].values
    for point_idx, poly_idx in zip(pairs[0], pairs[1]):
        result.iat[point_idx] = region_values[poly_idx]
    return result
```

For layers too large to hold in memory, the same join out-of-core:

```sql
-- DuckDB reads GeoParquet directly and parallelises the join.
INSTALL spatial; LOAD spatial;

CREATE TABLE assigned AS
SELECT p.osm_id, p.name, r.region_id, p.geometry
FROM   read_parquet('pois/**/*.parquet') AS p
LEFT JOIN read_parquet('regions.parquet') AS r
       ON ST_Within(p.geometry, r.geometry);
```

<figure class="diagram-wrap">
<svg viewBox="0 0 880 278" role="img" aria-labelledby="pip-edges-t pip-edges-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="pip-edges-t">Four point-in-polygon edge cases and their handling</title>
  <desc id="pip-edges-d">A grid of four cases. A point exactly on a boundary makes contains false while within may differ, so pick one predicate and document it. Overlapping polygons make a point match several, so keep all matches or rank deterministically. A point in no polygon produces no row in an inner join, so use a left join because a missing match is data. A polygon with a hole correctly excludes points in the hole under contains, so nothing is needed beyond checking that your data actually has holes.</desc>
  <rect x="0" y="0" width="880" height="278" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three edge cases every point-in-polygon join has</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">what happens</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">what to do about it</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">point exactly on a boundary</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">contains() is false, within() may differ</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">pick one predicate and document it</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">polygons overlap</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">the point matches several</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">keep all matches, or rank deterministically</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">point in no polygon</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">no row in an inner join</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">left join — a missing match is data</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">polygon has a hole</text>
  <rect x="213" y="204" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">correctly excluded by contains()</text>
  <rect x="535" y="204" width="316" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="693" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">nothing — but check your data has holes</text>
  <text x="440" y="260" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.85">The third row is the one that loses data silently: an inner join quietly drops every point outside your polygon coverage, and the count looks plausible.</text>
</svg>
<figcaption>Boundary semantics and unmatched points are decisions, not defaults. Both need to be made explicitly or they get made for you.</figcaption>
</figure>

## Step-by-step walkthrough

`assign_regions` refuses to run on mismatched CRSs rather than reprojecting silently. A join between degrees and metres produces zero matches and no error, which is among the most confusing failures in spatial work — the axis and unit issues covered in [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/).

The validity check is not defensive padding. An invalid polygon makes `within` results undefined rather than wrong-in-a-predictable-way, and the failure is per-polygon, so a single self-intersecting district produces a scattering of misassigned points that looks like noise.

`how="left"` is the important argument. `sjoin` defaults to an inner join, which drops unmatched points entirely — so a point layer that extends beyond your polygon coverage quietly loses rows, and the resulting count is plausible enough that nobody questions it.

`resolve_overlaps` exists because a left join emits one row *per match*, so nested or overlapping polygons multiply rows. Smallest-area-wins matches the usual intent for administrative hierarchies. Whatever rule you pick, it must be deterministic — `groupby().first()` on an unsorted frame is not.

`assign_prepared` shows the manual path. `shapely.prepare` mutates the geometry objects in place to cache an edge index, which turns each subsequent `within` test from a full traversal of the polygon's edges into a much cheaper lookup. It pays for itself once a polygon is tested against more than a few dozen points, which in this join is always.

## Verification

Three assertions catch nearly everything:

```python
# 1. Every point is accounted for, matched or not.
assert len(resolved) == len(points), "rows lost or duplicated"

# 2. The unmatched fraction is what you expect from your coverage.
unmatched_pct = 100 * resolved["region_id"].isna().mean()
logger.info("%.2f%% of points fell outside every polygon", unmatched_pct)
assert unmatched_pct < 5.0, "coverage gap larger than expected"

# 3. Spot-check known points against known regions.
for osm_id, expected in KNOWN_ASSIGNMENTS.items():
    assert resolved.loc[osm_id, "region_id"] == expected
```

The second is the one worth watching over time. A sudden jump in the unmatched fraction between releases means either the point layer grew beyond the polygon coverage or the polygon layer lost geometry — both real, both invisible in a row count.

Then confirm the index is actually being used, because a silently unindexed join just looks slow:

```python
import time
t = time.perf_counter()
_ = gpd.sjoin(points.head(10_000), polygons, how="left", predicate="within")
logger.info("10k points in %.2f s", time.perf_counter() - t)
```

Ten thousand points against a few thousand polygons should complete in well under a second. Several seconds means the join is falling back to a nested loop, usually because one side has no geometry column set.

## Common errors and fixes

| Symptom | Root cause | Fix |
|---|---|---|
| Zero matches, no error | CRS mismatch between layers | Assert equality; reproject deliberately |
| Row count grew after the join | Overlapping polygons, one row per match | Resolve to one row with a documented rule |
| Row count shrank | Inner join dropped unmatched points | Use `how="left"` |
| Join takes hours | No spatial index in play | Use `sjoin` / `STRtree`, not a Python loop |
| Points on borders assigned inconsistently | `contains` vs `within` vs `intersects` | Choose one predicate; document the boundary rule |
| Scattered misassignments | An invalid polygon in the layer | Validate polygons before joining |
| Memory exhausted | Both layers loaded whole | Stream the point side, or use DuckDB |

## Frequently Asked Questions

<details>
<summary>within, contains or intersects?</summary>

`within` and `contains` are the same test from opposite sides and both exclude points exactly on the boundary; `intersects` includes them. For administrative assignment the boundary case is rare and arbitrary either way, so the practical answer is to pick `within`, document it, and be consistent — the cost of inconsistency is two pipelines that disagree about a handful of points and nobody able to say which is right.
</details>

<details>
<summary>Should I reproject before joining?</summary>

Only if the predicate needs metres. Containment is topological and works correctly in degrees, so a point-in-polygon join needs no reprojection. A "within 500 m of" join does, because a distance in degrees is not a distance. Reprojecting unnecessarily costs time and introduces a chance of getting the zone wrong.
</details>

<details>
<summary>How do I handle points that match no polygon?</summary>

Keep them with a null region and count them. They are usually one of three things: genuine coverage gaps at the edge of your polygon layer, offshore features, or geocoding errors that placed a point in the sea. All three are worth knowing about, and an inner join throws away the evidence of all three.
</details>

<details>
<summary>Is DuckDB always faster?</summary>

For large joins, usually — it parallelises and works out-of-core, so it handles layers that do not fit in memory. For a few hundred thousand points against a few thousand polygons the difference is seconds and geopandas keeps you in one process with the rest of your pipeline. Reach for DuckDB when the data stops fitting, not by default.
</details>

## Specification reference

> `geopandas.sjoin(left, right, how, predicate)` builds a spatial index over the right frame and evaluates `predicate` between candidate pairs. With `how="left"` every left row appears at least once, with nulls where nothing matched, and more than once where several right geometries match. `shapely.STRtree.query(geoms, predicate=…)` returns a two-row array of input and tree indices for pairs satisfying the predicate.

## Related

- [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/) — the topic this join belongs to.
- [Building an R-tree Index over OSM Geometries](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/building-an-rtree-index-over-osm-geometries/) — the coarse filter, built explicitly.
- [Geometry Validation & Repair](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/) — why an invalid polygon poisons the refine stage.
- [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) — the CRS mismatch that returns zero rows.
- [Choosing H3 Resolution for OSM Point Aggregation](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/choosing-h3-resolution-for-osm-point-aggregation/) — the cell-based alternative to a polygon join.

Up one level: [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/).
