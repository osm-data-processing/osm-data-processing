---
title: "Choosing an H3 Resolution for OSM Point Aggregation"
description: "Pick the right H3 resolution (0–15) for aggregating OSM points into hexagons — the trade-off between cell area, cell count, and statistical stability, with runnable h3-py code and the area formula."
pageTitle: "Choosing an H3 Resolution for OSM Point Aggregation"
pageDescription: "How to choose an H3 resolution for aggregating OSM POIs into hexagons: balance cell area, cell count, and per-cell counts using h3-py v4 and the average hexagon area formula."
slug: choosing-h3-resolution-for-osm-point-aggregation
type: article
breadcrumb: "Choosing an H3 Resolution"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# Choosing an H3 Resolution for OSM Point Aggregation

You have a list of OpenStreetMap points — say every `amenity=cafe` node in a metro area — and you need to bin them into H3 hexagons, but a resolution that is one step too coarse smears two neighbourhoods into one cell and one step too fine leaves most cells holding a single point or none at all.

## Prerequisites

Confirm each item before running the code; a wrong resolution or an out-of-date `h3` build is the usual reason a "density" map ends up either a solid blob or a field of ones.

- [ ] `h3` ≥ 4.0 installed (`pip install "h3>=4.0"`) — the function names below (`latlng_to_cell`, `cell_to_boundary`, `average_hexagon_area`, `grid_disk`) are the v4 API and differ from the v3 `geo_to_h3` naming.
- [ ] Python 3.10+ for the `list[tuple[float, float]]` and `dict` typing used here.
- [ ] A list of `(lon, lat)` POI coordinates already extracted from a PBF — see the parent [Spatial Index Selection](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/) guide for why H3 is the right family for this aggregation in the first place.
- [ ] Optional: `geopandas` ≥ 0.14 and `shapely` ≥ 2.0 if you want to write hexagon polygons out for mapping.
- [ ] The WGS 84 assumption from [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) — H3 consumes latitude and longitude in degrees, so no reprojection is needed.

## Conceptual minimum

H3 is a hierarchy of sixteen resolutions, 0 (coarsest) through 15 (finest), and each step subdivides every parent cell into roughly seven children. That factor of seven is the whole decision: moving one resolution finer divides the average cell area by about seven and multiplies the number of occupied cells accordingly. Choosing a resolution is therefore a balance between three quantities that move together — cell **area** (how much ground each hexagon covers), cell **count** (how many hexagons your points spread across), and **statistical stability** (how many points land in a typical cell). Aggregate at too coarse a resolution and every cell is stable but spatially meaningless; aggregate too fine and each cell is spatially precise but statistically noisy because its count is zero, one, or two. The parent [Spatial Index Selection](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/) guide explains why hexagons beat a planar grid for this — their near-uniform area keeps counts comparable across latitudes — but it leaves open which of the sixteen resolutions to actually use.

The average area shrinks geometrically with resolution, and the average edge length shrinks with its square root:

$$
\bar{A}(r) = \frac{A_0}{7^{\,r}}, \qquad \bar{e}(r) \approx \frac{e_0}{\sqrt{7}^{\,r}}
$$

where $A_0 \approx 4.36 \times 10^{6}\ \text{km}^2$ is the average hexagon area at resolution 0 and $e_0 \approx 1108\ \text{km}$ its average edge length. In practical terms this puts resolution 6 near $36\ \text{km}^2$ per cell (neighbourhood-scale), resolution 8 near $0.74\ \text{km}^2$ (a few city blocks), and resolution 10 near $15{,}000\ \text{m}^2$ (a single block). A useful rule of thumb is to target a resolution where the typical occupied cell holds enough points to be stable — often a dozen or more — while cells still resolve the spatial variation you care about.

<svg viewBox="0 0 1000 360" role="img" aria-label="The H3 resolution trade-off for aggregating OSM points. On the left, a single coarse hexagon at resolution 6 contains all the scattered points and reports one large, statistically stable count of 412, but blurs local variation. On the right, the same points fall into a flower of seven finer hexagons at resolution 9, resolving spatial detail but leaving several cells with sparse counts including zeros." xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:1000px;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>Coarse versus fine H3 resolution when aggregating OSM points</title>
  <desc>Left panel: one large hexagon at resolution 6 holding many scattered points, labelled as one cell with a stable count of 412 but blurring local detail. Right panel: the same points aggregated at resolution 9 into a flower of seven small hexagons carrying small, sparse counts including a zero, resolving detail at the cost of statistical stability. A central arrow marks increasing resolution.</desc>
  <defs>
    <marker id="h3res-arr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker>
  </defs>
  <text x="500" y="24" text-anchor="middle" font-size="15" fill="currentColor" font-weight="700">One resolution step = ~7× the cells, ~1/7 the count</text>
  <!-- Left: coarse -->
  <text x="230" y="58" text-anchor="middle" font-size="13" fill="currentColor" font-weight="700">Coarse — resolution 6</text>
  <polygon points="290.62,215 230,250 169.38,215 169.38,145 230,110 290.62,145" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.6"/>
  <g fill="currentColor" opacity="0.75">
    <circle cx="210" cy="160" r="2.6"/><circle cx="235" cy="150" r="2.6"/><circle cx="250" cy="172" r="2.6"/>
    <circle cx="220" cy="185" r="2.6"/><circle cx="245" cy="195" r="2.6"/><circle cx="203" cy="178" r="2.6"/>
    <circle cx="228" cy="205" r="2.6"/><circle cx="255" cy="158" r="2.6"/><circle cx="215" cy="200" r="2.6"/><circle cx="240" cy="213" r="2.6"/>
  </g>
  <text x="230" y="184" text-anchor="middle" font-size="20" fill="currentColor" font-weight="700">412</text>
  <text x="230" y="286" text-anchor="middle" font-size="11.5" fill="currentColor">1 cell · stable, but blurred</text>
  <!-- center arrow -->
  <line x1="320" y1="180" x2="650" y2="180" stroke="currentColor" stroke-width="1.6" marker-end="url(#h3res-arr)"/>
  <text x="485" y="170" text-anchor="middle" font-size="11.5" fill="currentColor" opacity="0.9">finer resolution</text>
  <!-- Right: fine flower of 7 -->
  <text x="760" y="58" text-anchor="middle" font-size="13" fill="currentColor" font-weight="700">Fine — resolution 9</text>
  <g fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.4">
    <polygon points="789.44,197 760,214 730.56,197 730.56,163 760,146 789.44,163"/>
    <polygon points="760,146 730.56,163 701.12,146 701.12,112 730.56,95 760,112"/>
    <polygon points="818.88,146 789.44,163 760,146 760,112 789.44,95 818.88,112"/>
    <polygon points="760,248 730.56,265 701.12,248 701.12,214 730.56,197 760,214"/>
    <polygon points="818.88,248 789.44,265 760,248 760,214 789.44,197 818.88,214"/>
    <polygon points="730.56,197 701.12,214 671.68,197 671.68,163 701.12,146 730.56,163"/>
    <polygon points="848.32,197 818.88,214 789.44,197 789.44,163 818.88,146 848.32,163"/>
  </g>
  <g fill="currentColor" text-anchor="middle" font-size="11" font-weight="700">
    <text x="760" y="184">88</text>
    <text x="730.56" y="133">61</text>
    <text x="789.44" y="133">74</text>
    <text x="730.56" y="235">52</text>
    <text x="789.44" y="235">0</text>
    <text x="701.12" y="184">49</text>
    <text x="818.88" y="184">88</text>
  </g>
  <text x="760" y="300" text-anchor="middle" font-size="11.5" fill="currentColor">7 cells · detailed, some sparse</text>
  <text x="500" y="340" text-anchor="middle" font-size="11.5" fill="currentColor" opacity="0.9">Pick the resolution where a typical occupied cell is stable yet still resolves the pattern you need.</text>
</svg>

## Runnable solution

This module aggregates a list of `(lon, lat)` POIs into per-cell counts at a chosen resolution, and, to make the choice evidence-based, sweeps a range of resolutions and reports the cell count, occupied-cell count, and the median points-per-occupied-cell so you can see the trade-off before committing. It targets `h3>=4.0` and Python 3.10+.

```python
from __future__ import annotations

import logging
from collections import Counter
from statistics import median

import h3

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.h3_aggregation")


def aggregate_points(points: list[tuple[float, float]], resolution: int) -> Counter[str]:
    """Bin (lon, lat) POIs into H3 cells and count per cell.

    h3.latlng_to_cell takes (lat, lng) in that order — OSM coordinates are
    stored (lon, lat), so we swap on the way in.
    """
    if not 0 <= resolution <= 15:
        raise ValueError(f"H3 resolution must be 0..15, got {resolution}")
    counts: Counter[str] = Counter()
    for lon, lat in points:
        cell = h3.latlng_to_cell(lat, lon, resolution)
        counts[cell] += 1
    return counts


def sweep_resolutions(
    points: list[tuple[float, float]], candidates: range = range(5, 11)
) -> list[dict[str, float]]:
    """Report the density trade-off across candidate resolutions."""
    report: list[dict[str, float]] = []
    for res in candidates:
        counts = aggregate_points(points, res)
        occupied = len(counts)
        per_cell = median(counts.values()) if counts else 0
        area_km2 = h3.average_hexagon_area(res, unit="km^2")
        report.append(
            {
                "resolution": res,
                "occupied_cells": occupied,
                "median_per_cell": per_cell,
                "avg_cell_area_km2": round(area_km2, 4),
            }
        )
        logger.info(
            "res %2d | cells=%5d | median/cell=%5.1f | avg area=%.4f km^2",
            res, occupied, per_cell, area_km2,
        )
    return report


def cell_ring_counts(counts: Counter[str], cell: str) -> int:
    """Sum a cell and its six neighbours to smooth a sparse fine grid."""
    return sum(counts.get(c, 0) for c in h3.grid_disk(cell, 1))


def cell_polygon(cell: str) -> list[tuple[float, float]]:
    """Return the hexagon boundary as (lat, lng) vertices for mapping."""
    return h3.cell_to_boundary(cell)


if __name__ == "__main__":
    # Example: café POIs as (lon, lat). In practice load these from a PBF.
    pois: list[tuple[float, float]] = [
        (13.404, 52.520), (13.405, 52.519), (13.388, 52.517),
        (13.412, 52.523), (13.401, 52.521), (13.377, 52.516),
    ]
    table = sweep_resolutions(pois, range(6, 11))
    best = max(t for t in table if t["median_per_cell"] >= 10) \
        if any(t["median_per_cell"] >= 10 for t in table) else table[0]
    logger.info("suggested resolution: %d", int(best["resolution"]))
```

## Step-by-step walkthrough

1. **Guard the resolution.** `aggregate_points` rejects anything outside 0–15 up front, because H3 silently accepts only that band and an out-of-range value is a programming error, not data noise.
2. **Swap coordinate order.** OSM stores `(lon, lat)`, but `h3.latlng_to_cell` expects `(lat, lng)`; the function swaps on the way in so callers keep the OSM convention everywhere else. Getting this backwards places every café in the wrong hemisphere.
3. **Count into a `Counter`.** Each point contributes one to its cell's tally, giving a `{cell_id: count}` map — the core aggregation and the input to any density map.
4. **Sweep candidate resolutions.** `sweep_resolutions` runs the aggregation at each candidate and records occupied-cell count and the median points per occupied cell, which is the honest signal of statistical stability — the mean is skewed by a few dense cells.
5. **Read the average area.** `h3.average_hexagon_area(res, unit="km^2")` reports the ground area per cell at each resolution, letting you connect the abstract number to the real footprint you want to resolve.
6. **Smooth a sparse grid when needed.** `cell_ring_counts` sums a cell with its six `grid_disk` neighbours, a cheap way to stabilize counts at a fine resolution without dropping to a coarser one.
7. **Emit polygons for mapping.** `cell_to_boundary` turns a cell id into hexagon vertices you can hand to GeoPandas or a web map to render the aggregation.
8. **Pick from evidence.** The `__main__` block chooses the finest resolution whose median occupied cell still holds at least ten points, encoding the "stable yet detailed" rule as code rather than a guess.

## Verification

Confirm the aggregation is sound before trusting a density map built on it:

- **Counts conserve.** `sum(counts.values())` must equal `len(points)` — every POI lands in exactly one cell, so a mismatch means points were dropped or double-counted.
- **The sweep is monotonic.** In the log, occupied-cell count must rise and median-per-cell must fall as resolution increases; if it does not, the input coordinates are likely swapped or clustered on one point.
- **Area matches expectation.** `h3.average_hexagon_area(8, unit="km^2")` should print roughly `0.7373`; a wildly different number means a stale `h3` v3 install or the wrong unit string.
- **Cells round-trip.** For any cell, `h3.cell_to_boundary` returns six vertices (twelve global cells are pentagons and return five), and `h3.get_resolution(cell)` returns the resolution you aggregated at.
- **Neighbours resolve.** `len(h3.grid_disk(cell, 1))` is 7 for a hexagon, confirming the ring smoothing operates on the expected neighbourhood.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Every point in one far-off cell | Passed `(lon, lat)` to `latlng_to_cell` | Call `h3.latlng_to_cell(lat, lon, res)` — latitude first. |
| `AttributeError: module 'h3' has no attribute 'latlng_to_cell'` | h3-py v3 installed | Upgrade with `pip install "h3>=4.0"`; v3 uses `geo_to_h3`. |
| Most cells hold 0 or 1 point | Resolution too fine for the point density | Step to a coarser resolution, or smooth with `grid_disk`. |
| One giant blob, no spatial detail | Resolution too coarse | Step finer until median-per-cell approaches your stability target. |
| `average_hexagon_area` returns a huge number | Wrong unit or v3 signature | Pass `unit="km^2"` (or `"m^2"`) to the v4 function. |
| `ValueError` on aggregation | Resolution outside 0–15 | Clamp or validate the resolution before calling. |
| Median skewed high vs. reality | Used mean instead of median per cell | Judge stability by the median occupied-cell count, not the mean. |

## Specification reference

> H3 defines sixteen resolutions (0–15); each finer resolution subdivides a parent cell into approximately seven children, so average cell area decreases by roughly a factor of seven per step. Cell-to-area, cell-to-boundary, and indexing semantics — including the twelve pentagon cells and the `latlng_to_cell` argument order — are specified in the official H3 documentation at [h3geo.org](https://h3geo.org/docs/). Consult the [Python `statistics` documentation](https://docs.python.org/3/library/statistics.html) for the `median` used to summarize per-cell counts.

## Frequently Asked Questions

<details>
<summary>What H3 resolution should I use for city-scale POI aggregation?</summary>

There is no single answer, but resolutions 8 to 9 are the common city sweet spot: resolution 8 cells cover about 0.74 square kilometres (a few blocks) and resolution 9 about 0.1 square kilometres (roughly a block). Sweep the candidate range on your own data and pick the finest resolution where a typical occupied cell still holds enough points — often a dozen or more — to be statistically stable.
</details>

<details>
<summary>Why do so many of my hexagons end up empty?</summary>

Empty cells mean the resolution is too fine for your point density: each step finer multiplies the number of cells by about seven while the points stay fixed, so counts thin out toward zero and one. Either step to a coarser resolution, or keep the fine grid and smooth it by summing each cell with its six ring neighbours using grid_disk before you map the result.
</details>

<details>
<summary>Does the order of latitude and longitude matter in h3-py?</summary>

Yes, and it is the most common bug. In h3-py v4, latlng_to_cell takes latitude first, then longitude — (lat, lng). OpenStreetMap stores coordinates as (lon, lat), so you must swap them on the way in. Passing them in OSM order silently relocates every point, usually into a completely different region, and the aggregation looks plausible but is wrong.
</details>

<details>
<summary>How much does area really change between resolutions?</summary>

Average cell area falls by about a factor of seven per resolution step, so it changes fast. Resolution 6 averages near 36 square kilometres, resolution 8 near 0.74, and resolution 10 near 0.015. Because the change is geometric, moving even two steps alters the footprint roughly fiftyfold, which is why choosing the resolution deliberately from the area formula matters more than it first appears.
</details>

## Related

- [Spatial Index Selection: R-tree vs H3 vs Quadkey](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/) — the parent guide on why and when to choose H3 over an R-tree or a quadkey grid.
- [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/) — building the R-tree you would pair with an H3 aggregation column.
- [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) — why H3 consumes WGS 84 degrees directly with no reprojection.
- [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — where the POI node coordinates you aggregate come from.
- [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) — selecting which tagged features (for example `amenity=cafe`) to aggregate.

Up one level: [Spatial Index Selection: R-tree vs H3 vs Quadkey](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Choosing an H3 Resolution for OSM Point Aggregation",
  "description": "Pick the right H3 resolution (0–15) for aggregating OSM points into hexagons — the trade-off between cell area, cell count, and statistical stability, with runnable h3-py code and the area formula.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "OSM Data Fundamentals & Architecture",
  "about": ["H3 resolution selection", "OSM point aggregation", "hexagonal spatial binning"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Fundamentals & Architecture", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/" },
    { "@type": "ListItem", "position": 3, "name": "Spatial Index Selection", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/" },
    { "@type": "ListItem", "position": 4, "name": "Choosing an H3 Resolution", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/choosing-h3-resolution-for-osm-point-aggregation/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Choose an H3 resolution for aggregating OSM points",
  "description": "Select an H3 resolution for binning OpenStreetMap points into hexagons by balancing cell area, cell count, and per-cell statistical stability.",
  "step": [
    { "@type": "HowToStep", "name": "Extract POI coordinates", "text": "Collect the (lon, lat) coordinates of the tagged OSM points you want to aggregate, for example every amenity=cafe node in the area of interest." },
    { "@type": "HowToStep", "name": "Aggregate at candidate resolutions", "text": "Bin the points with h3.latlng_to_cell at each candidate resolution, remembering to pass latitude before longitude, and count points per cell." },
    { "@type": "HowToStep", "name": "Measure the trade-off", "text": "For each resolution record the occupied-cell count and the median points per occupied cell, and read the average cell area with h3.average_hexagon_area." },
    { "@type": "HowToStep", "name": "Pick the resolution", "text": "Choose the finest resolution whose typical occupied cell still holds enough points to be statistically stable while resolving the spatial pattern you need." },
    { "@type": "HowToStep", "name": "Smooth if sparse", "text": "If a fine grid leaves many cells empty, sum each cell with its six grid_disk neighbours to stabilize counts without dropping to a coarser resolution." }
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
      "name": "What H3 resolution should I use for city-scale POI aggregation?",
      "acceptedAnswer": { "@type": "Answer", "text": "There is no single answer, but resolutions 8 to 9 are the common city sweet spot: resolution 8 cells cover about 0.74 square kilometres and resolution 9 about 0.1 square kilometres. Sweep the candidate range on your own data and pick the finest resolution where a typical occupied cell still holds enough points, often a dozen or more, to be statistically stable." }
    },
    {
      "@type": "Question",
      "name": "Why do so many of my hexagons end up empty?",
      "acceptedAnswer": { "@type": "Answer", "text": "Empty cells mean the resolution is too fine for your point density: each step finer multiplies the number of cells by about seven while the points stay fixed, so counts thin out toward zero and one. Either step to a coarser resolution, or keep the fine grid and smooth it by summing each cell with its six ring neighbours using grid_disk before you map the result." }
    },
    {
      "@type": "Question",
      "name": "Does the order of latitude and longitude matter in h3-py?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes, and it is the most common bug. In h3-py v4, latlng_to_cell takes latitude first, then longitude. OpenStreetMap stores coordinates as lon then lat, so you must swap them on the way in. Passing them in OSM order silently relocates every point, usually into a completely different region, and the aggregation looks plausible but is wrong." }
    },
    {
      "@type": "Question",
      "name": "How much does area really change between resolutions?",
      "acceptedAnswer": { "@type": "Answer", "text": "Average cell area falls by about a factor of seven per resolution step, so it changes fast. Resolution 6 averages near 36 square kilometres, resolution 8 near 0.74, and resolution 10 near 0.015. Because the change is geometric, moving even two steps alters the footprint roughly fiftyfold, which is why choosing the resolution deliberately from the area formula matters." }
    }
  ]
}
</script>
