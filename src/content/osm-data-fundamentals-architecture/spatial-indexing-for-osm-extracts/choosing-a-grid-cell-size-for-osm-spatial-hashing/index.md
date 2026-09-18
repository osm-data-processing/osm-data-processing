---
title: "Choosing a Grid Cell Size for OSM Spatial Hashing"
description: "Derive a grid cell size from feature density and query radius rather than guessing, and measure the two failure modes — too many empty cells and too many features per cell."
pageTitle: "Sizing a Spatial Hash Grid for OSM Feature Density"
pageDescription: "Pick a spatial hash cell size from measured OSM feature density and your query radius, then verify with occupancy statistics that neither empty cells nor overfull ones dominate."
slug: choosing-a-grid-cell-size-for-osm-spatial-hashing
type: article
breadcrumb: "Grid Cell Size"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Choosing a Grid Cell Size for OSM Spatial Hashing

A spatial hash is the simplest index that works, and its entire behaviour is decided by one number nobody measures. Too large and every query scans thousands of irrelevant features; too small and the index is mostly empty cells and pointer chasing.

## Prerequisites

- [ ] Python 3.10+ with `numpy`; `geopandas` if your features arrive as a frame.
- [ ] Features in a metric projection, per [Picking a UTM Zone for an OSM Extract](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/picking-a-utm-zone-for-an-osm-extract/).
- [ ] A typical query radius, since the cell size follows from it.
- [ ] A representative sample covering both dense and sparse areas.
- [ ] The index comparison in [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/), because a hash is not always the right structure.

## Conceptual minimum

A spatial hash maps each feature to one or more integer cell coordinates and stores it in a dictionary keyed on them. A query computes the cells its search area touches and examines only the features in those cells.

Two costs pull in opposite directions. **Cells examined per query** grows as the cell shrinks, because a fixed radius covers more of them. **Features examined per cell** grows as the cell enlarges, because more features fall inside. Total work per query is roughly their product, and it has a minimum.

The useful rule is that the cell should be **comparable to the query radius**. Substantially smaller, and each query touches a large block of cells whose lookup overhead dominates. Substantially larger, and each cell holds far more features than the query needs. A cell of roughly one to two times the radius keeps both terms small.

Density matters because it decides what "far more features" means. A cell size that is ideal for a rural extract puts tens of thousands of features in a single cell in a city centre.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 288" role="img" aria-labelledby="cgs1-t cgs1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cgs1-t">Total work per query as the cell size varies, for a fixed search radius</title>
  <desc id="cgs1-d">Five cell sizes relative to a fixed query radius, with the approximate total work per query. At a tenth of the radius the query touches hundreds of cells and lookup overhead dominates. At half the radius it touches around twenty cells and the work is much lower. At one times the radius the work is near its minimum. At four times the radius each cell holds many more features than needed and work rises again. At sixteen times the radius nearly every query scans a large share of the dataset.</desc>
  <rect x="0" y="0" width="880" height="288" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Work per query against cell size, radius held fixed</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">cell = 0.1x radius</text>
  <rect x="236" y="60" width="263" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">lookup dominates</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">cell = 0.5x radius</text>
  <rect x="236" y="100" width="78" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">much better</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">cell = 1x radius</text>
  <rect x="236" y="140" width="50" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">near the minimum</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">cell = 4x radius</text>
  <rect x="236" y="180" width="135" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">scanning dominates</text>
  <text x="26" y="234" font-size="11.5" font-weight="600" fill="currentColor">cell = 16x radius</text>
  <rect x="236" y="220" width="498" height="18" rx="4" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="854" y="234" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">scans most of it</text>
  <text x="868" y="272" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The curve is flat near its minimum, so any cell between about half and twice the radius performs within a small factor of the best.</text>
</svg>
<figcaption>That flatness is why measuring once is enough: the penalty for being somewhat wrong is small, and for being very wrong is large.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
import math
from collections import defaultdict
from dataclasses import dataclass

import numpy as np

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.index.hashgrid")


@dataclass(frozen=True)
class GridStats:
    cell_size_m: float
    occupied_cells: int
    empty_ratio: float          # of the bounding box's cells, how many are empty
    median_per_cell: float
    p99_per_cell: float
    max_per_cell: int


def build(points: np.ndarray, cell_size_m: float) -> dict[tuple[int, int], list[int]]:
    """Map each point index into an integer cell. Points are (n, 2) metres."""
    cells = np.floor(points / cell_size_m).astype(np.int64)
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for index, (cx, cy) in enumerate(cells):
        grid[(int(cx), int(cy))].append(index)
    return grid


def stats(points: np.ndarray, cell_size_m: float) -> GridStats:
    grid = build(points, cell_size_m)
    counts = np.array([len(v) for v in grid.values()])
    extent = points.max(axis=0) - points.min(axis=0)
    total_cells = max(1.0, math.prod(np.ceil(extent / cell_size_m) + 1))
    result = GridStats(
        cell_size_m=cell_size_m,
        occupied_cells=len(grid),
        empty_ratio=1.0 - len(grid) / total_cells,
        median_per_cell=float(np.median(counts)),
        p99_per_cell=float(np.percentile(counts, 99)),
        max_per_cell=int(counts.max()),
    )
    logger.info("cell %7.0f m: %7d occupied, %4.0f%% empty, median %5.1f, "
                "p99 %7.0f, max %7d", result.cell_size_m, result.occupied_cells,
                result.empty_ratio * 100, result.median_per_cell,
                result.p99_per_cell, result.max_per_cell)
    return result


def recommend(points: np.ndarray, query_radius_m: float,
              target_per_cell: int = 16) -> float:
    """Start from the radius, then adjust for measured density."""
    # Density from the median occupancy at a trial cell equal to the radius.
    trial = stats(points, query_radius_m)
    if trial.median_per_cell <= 0:
        return query_radius_m

    # Scale so a typical cell holds about `target_per_cell` features. Area
    # scales with the square of the size, hence the square root.
    scale = math.sqrt(target_per_cell / trial.median_per_cell)
    # Stay within half to twice the radius: outside that, one term dominates.
    scale = min(max(scale, 0.5), 2.0)
    chosen = query_radius_m * scale
    logger.info("radius %.0f m, median %.1f per cell -> recommending %.0f m",
                query_radius_m, trial.median_per_cell, chosen)
    return chosen


def sweep(points: np.ndarray, query_radius_m: float) -> list[GridStats]:
    return [stats(points, query_radius_m * f)
            for f in (0.25, 0.5, 1.0, 2.0, 4.0)]


if __name__ == "__main__":
    rng = np.random.default_rng(0)
    # A dense core plus a sparse surround: the shape real OSM data has.
    dense = rng.normal(0, 400, size=(40_000, 2))
    sparse = rng.uniform(-20_000, 20_000, size=(10_000, 2))
    sample = np.vstack([dense, sparse])
    sweep(sample, query_radius_m=250.0)
    recommend(sample, query_radius_m=250.0)
```

## Step-by-step walkthrough

1. **Start from the query radius.** It is the only number that relates the index to the work it will actually do, and a cell comparable to it is close to optimal before any measurement.
2. **Measure median occupancy, not mean.** OSM density is extremely skewed; the mean is dragged upward by a handful of city-centre cells and describes no typical cell at all.
3. **Scale by the square root.** Cell area grows with the square of the size, so halving the occupancy means dividing the size by the square root of two rather than by two.
4. **Clamp to half and twice the radius.** Outside that band one of the two cost terms dominates whatever the density says, so the density adjustment is a refinement rather than an override.
5. **Report the high percentile and the maximum.** The median tells you the common case; the ninety-ninth percentile tells you what a city-centre query costs, which is the number that actually shows up in a latency graph.
6. **Watch the empty ratio.** A grid that is ninety-nine percent empty is spending memory on a structure that a tree would represent far more compactly — a signal to reconsider the index choice entirely.
7. **Sweep before committing.** Five trial sizes cost seconds and produce a curve whose flat region tells you how much the choice actually matters for your data.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="cgs2-t cgs2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cgs2-t">The two failure modes and the statistic that reveals each</title>
  <desc id="cgs2-d">Three panels. A cell that is too small produces a grid where almost every cell is empty and each query touches hundreds of them, revealed by a very high empty ratio and a very low median occupancy. A cell that is too large produces a grid where city-centre cells hold tens of thousands of features, revealed by a ninety-ninth percentile occupancy far above the median. A well-sized cell shows a moderate empty ratio and a high percentile within about an order of magnitude of the median.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Two failures, two statistics, one healthy middle</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Too small</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Almost all cells empty</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Median occupancy near one</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Queries touch hundreds</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Lookup overhead dominates</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Too large</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">City cells enormous</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">p99 far above median</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Queries scan thousands</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Filtering dominates</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Well sized</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Moderate empty ratio</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">p99 within ~10x median</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Queries touch a handful</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Both terms small</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The ratio between the median and the high percentile is the single most informative number, because it measures the skew directly.</text>
</svg>
<figcaption>Reporting only the mean occupancy hides both failures, because a skewed distribution's mean sits between them.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="cgs3-t cgs3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cgs3-t">The four measurements that decide a cell size</title>
  <desc id="cgs3-d">Four steps. The trial step builds the grid once at a cell size equal to the query radius, which is already close to optimal. The measure step records the median occupancy, the ninety-ninth percentile and the proportion of empty cells. The adjust step scales the size by the square root of the ratio between the desired and measured occupancy, clamped to stay within half to twice the radius. The confirm step times real queries across several sizes and checks that the cost curve has a minimum near the chosen value.</desc>
  <defs><marker id="cgs3-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Trial, measure, adjust, confirm</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">trial</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">cell equals radius</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">already close</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#cgs3-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">measure</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">median, p99, empty</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">never the mean</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#cgs3-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">adjust</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">square-root scaling</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">clamped to a band</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#cgs3-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">confirm</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">time real queries</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">look for the dip</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The whole procedure takes seconds on a sample and replaces a number that is otherwise chosen by habit and never revisited.</text>
</svg>
<figcaption>Skipping the last step is common and usually fine, because the curve is flat — but it is the only step that measures reality.</figcaption>
</figure>

## Verification

- **The sweep has a visible minimum.** Time real queries at each trial size; the curve should dip rather than being monotonic.
- **The high percentile is bounded.** A ninety-ninth percentile occupancy in the tens of thousands means dense areas will dominate latency.
- **The empty ratio is reasonable.** Above about ninety-five percent empty, a tree structure is probably the better index.
- **Dense and sparse areas both behave.** Time queries in a city centre and in open country; the difference should be a factor, not an order of magnitude.
- **Recomputing on new data agrees.** Run the recommendation on a second extract from the same region; the answer should be close.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Queries slow only in cities | Cell sized from mean occupancy | Size from the median and check the high percentile |
| Index memory far exceeds the data | Cell far smaller than the radius | Enlarge towards the query radius |
| Every query scans thousands | Cell far larger than the radius | Shrink towards the query radius |
| Cell size behaves differently by latitude | Grid built in degrees | Build the grid in a metric projection |
| Recommendation swings between runs | Sample too small or unrepresentative | Sample across dense and sparse areas |
| Tuning has no effect | Query cost dominated by something else | Profile before tuning the index |
| Grid mostly empty | Point distribution very clustered | Consider a tree index instead of a hash |

## Specification reference

> A uniform spatial hash partitions the plane into equal cells and assigns each object to the cell containing it, giving constant-time insertion and a query cost proportional to the number of cells overlapping the search region multiplied by their occupancy. Performance therefore depends on the relationship between cell size, query extent and object density rather than on the structure itself. See [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/) for how this compares with tree-based alternatives.

## Frequently Asked Questions

<details>
<summary>Why size the cell from the query radius rather than the data?</summary>

Because the radius is what determines how many cells a query touches, and that term is one of the two halves of the cost. The data's density determines the other half, and it enters as a refinement — a scaling factor that adjusts the radius-derived size so a typical cell holds a sensible number of features. Starting from the data alone gives no relationship to the work queries actually do.
</details>

<details>
<summary>Should I use the mean or the median occupancy?</summary>

The median, and report the high percentile alongside it. OSM feature density is extremely skewed: a handful of city-centre cells hold orders of magnitude more than everything else, which drags the mean to a value no actual cell resembles. The median describes the typical cell and the ninety-ninth percentile describes the cell that will dominate your latency graph, and you need both.
</details>

<details>
<summary>When is a hash grid the wrong structure?</summary>

When the distribution is very clustered, which OSM's often is. A grid sized for city centres wastes enormous memory on empty cells across open country, and one sized for the average performs badly in both. A tree-based index adapts to density automatically and is usually the better choice for continental extracts; a hash grid shines on bounded areas with reasonably even distribution.
</details>

<details>
<summary>Does the cell size need to be a round number?</summary>

No, and choosing round numbers is mildly harmful because it encourages picking from habit rather than from measurement. The cost curve is flat near its minimum, so any value within about a factor of two of the ideal performs within a small factor of the best. What matters is being in that band, which requires measuring rather than being tidy.
</details>

## Related

- [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/) — the parent topic and when a hash is the right structure.
- [Bulk Loading an R-tree Versus Inserting One by One](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/bulk-loading-an-rtree-versus-inserting-one-by-one/) — the tree alternative when clustering defeats a grid.
- [Spatial Index Selection: R-tree vs H3 vs Quadkey](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/) — the wider comparison this sits inside.
- [Accelerating Point-in-Polygon Joins on OSM Data](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/accelerating-point-in-polygon-joins-on-osm-data/) — a query type whose radius sets this size.
- [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) — why the grid must be built in metres.

Up one level: [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Choosing a Grid Cell Size for OSM Spatial Hashing",
  "description": "Derive a grid cell size from feature density and query radius rather than guessing, and measure the two failure modes — too many empty cells and too many features per cell.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Data Fundamentals & Architecture",
  "about": ["spatial hashing", "grid cell sizing", "occupancy statistics"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Fundamentals & Architecture", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/" },
    { "@type": "ListItem", "position": 3, "name": "Spatial Indexing for OSM Extracts", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/" },
    { "@type": "ListItem", "position": 4, "name": "Choosing a Grid Cell Size for OSM Spatial Hashing", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/choosing-a-grid-cell-size-for-osm-spatial-hashing/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Choose a spatial hash cell size for OSM data",
  "description": "Start from the query radius, measure median occupancy at that trial size, scale by the square root of the desired occupancy ratio, clamp within half to twice the radius, and verify with a sweep.",
  "step": [
    { "@type": "HowToStep", "name": "Work in metres", "text": "Build the grid in a metric projection so a cell means the same distance everywhere in the extract." },
    { "@type": "HowToStep", "name": "Start from the query radius", "text": "Take a trial cell size equal to the typical search radius, which is already close to optimal." },
    { "@type": "HowToStep", "name": "Measure median occupancy", "text": "Use the median rather than the mean, since OSM density is heavily skewed by dense urban cells." },
    { "@type": "HowToStep", "name": "Scale by the square root", "text": "Adjust the size by the square root of the ratio between the target and measured occupancy, because area scales quadratically." },
    { "@type": "HowToStep", "name": "Clamp the adjustment", "text": "Keep the chosen size between half and twice the query radius, outside which one cost term dominates." },
    { "@type": "HowToStep", "name": "Sweep and verify", "text": "Time real queries at several trial sizes and confirm the cost curve has a minimum near the chosen value." }
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
      "name": "Why size a spatial hash cell from the query radius rather than the data?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because the radius determines how many cells a query touches, which is one of the two halves of the cost. The data's density determines the other half and enters as a refinement. Starting from the data alone gives no relationship to the work queries actually do." }
    },
    {
      "@type": "Question",
      "name": "Should I use mean or median cell occupancy when tuning a grid?",
      "acceptedAnswer": { "@type": "Answer", "text": "The median, with the high percentile reported alongside. OSM feature density is extremely skewed, so the mean is dragged to a value no actual cell resembles. The median describes the typical cell and the ninety-ninth percentile describes the cell that will dominate your latency graph." }
    },
    {
      "@type": "Question",
      "name": "When is a hash grid the wrong spatial index for OSM?",
      "acceptedAnswer": { "@type": "Answer", "text": "When the distribution is very clustered, which OSM's often is. A grid sized for city centres wastes memory on empty cells across open country, and one sized for the average performs badly in both. A tree-based index adapts to density automatically and is usually better for continental extracts." }
    },
    {
      "@type": "Question",
      "name": "Does a spatial hash cell size need to be a round number?",
      "acceptedAnswer": { "@type": "Answer", "text": "No, and choosing round numbers encourages picking from habit rather than measurement. The cost curve is flat near its minimum, so any value within about a factor of two of the ideal performs within a small factor of the best. What matters is being in that band." }
    }
  ]
}
</script>
