---
title: "Benchmarking H3 Lookup Against an R-tree Query"
description: "Measure a cell-index lookup against a tree query on the same OSM workload, and make the comparison fair by counting the work each one pushes downstream."
pageTitle: "H3 Lookup vs R-tree Query: A Fair Benchmark"
pageDescription: "Compare an H3 cell lookup with an R-tree range query on identical OSM data, including the refinement each requires, so the measurement reflects total work rather than index time alone."
slug: benchmarking-h3-lookup-against-an-rtree-query
type: article
breadcrumb: "H3 vs R-tree Benchmark"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Benchmarking H3 Lookup Against an R-tree Query

A cell lookup is a dictionary access and a tree query is a traversal, so the benchmark appears settled before it starts. It is not, because the two indexes answer different questions and the work they push downstream differs by more than the lookup times differ.

## Prerequisites

- [ ] Python 3.10+ with `h3`, `rtree` and `shapely`.
- [ ] A representative OSM point or polygon set in a metric projection.
- [ ] The index comparison in [Spatial Index Selection: R-tree vs H3 vs Quadkey](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/).
- [ ] A real query workload rather than uniformly random boxes.
- [ ] A willingness to count candidates, not just seconds.

## Conceptual minimum

The two indexes are not interchangeable, and a benchmark that ignores that measures the wrong thing.

**An R-tree answers "which geometries' bounding boxes intersect this region".** The answer is a candidate set that must then be refined by an exact geometric test, because a bounding box overlap is not containment. The refinement is usually the larger cost.

**An H3 index answers "which features are in these cells".** The answer is exact for the cells, and approximate for the region, because a set of hexagons only approximates any shape that is not made of hexagons. Refinement is needed at the boundary, and how much depends on the resolution chosen.

A fair comparison therefore measures **total time to a correct answer**, including the refinement each approach requires, and reports **candidates examined** alongside, because that number explains the timing rather than merely restating it.

The second fairness issue is the query shape. H3 is at its best when the query is itself a cell or a set of cells — an aggregation, a join on a grid. An R-tree is at its best for an arbitrary polygon or a nearest-neighbour search. Benchmarking only one shape answers only for that shape.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="bhr1-t bhr1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="bhr1-t">What each index actually answers, and what has to happen afterwards</title>
  <desc id="bhr1-d">A grid of four properties against the two indexes. An R-tree returns geometries whose bounding boxes intersect the query region, requires an exact geometric refinement afterwards, handles arbitrary query shapes, and supports nearest-neighbour search directly. A cell index returns features assigned to the queried cells, requires refinement only near the region boundary, handles cell-shaped queries natively and arbitrary shapes only through approximation, and supports nearest-neighbour search poorly.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Two indexes, two different questions answered</text>
  <rect x="216" y="48" width="319" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="376" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">R-tree</text>
  <rect x="535" y="48" width="319" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="694" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Cell index</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Returns</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">box intersections</text>
  <text x="694" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">cell members</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Refinement</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">always needed</text>
  <text x="694" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">boundary only</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Arbitrary shapes</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">native</text>
  <text x="694" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">approximated</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Nearest neighbour</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">direct</text>
  <text x="694" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">poorly</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">A benchmark that runs only cell-shaped queries measures the second column at its best and the first at its worst.</text>
</svg>
<figcaption>Choosing the query shape is choosing the winner, which is why the workload has to come from the real application.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
import time
from collections import defaultdict
from dataclasses import dataclass

import h3
import numpy as np
from rtree import index as rtree_index
from shapely.geometry import Point, Polygon, shape
from shapely.prepared import prep

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.index.benchmark")


@dataclass(frozen=True)
class Timing:
    label: str
    build_seconds: float
    query_seconds: float
    refine_seconds: float
    candidates: int
    results: int

    @property
    def total_seconds(self) -> float:
        return self.query_seconds + self.refine_seconds


def build_rtree(points: np.ndarray) -> tuple[rtree_index.Index, float]:
    started = time.perf_counter()
    def stream():
        for i, (x, y) in enumerate(points):
            yield (i, (x, y, x, y), None)
    tree = rtree_index.Index(stream())
    return tree, time.perf_counter() - started


def build_h3(lonlat: np.ndarray, resolution: int) -> tuple[dict, float]:
    started = time.perf_counter()
    cells: dict[str, list[int]] = defaultdict(list)
    for i, (lon, lat) in enumerate(lonlat):
        cells[h3.latlng_to_cell(lat, lon, resolution)].append(i)
    return dict(cells), time.perf_counter() - started


def query_rtree(tree, points: np.ndarray, polygons: list[Polygon]) -> Timing:
    query_seconds = refine_seconds = 0.0
    candidates = results = 0
    for polygon in polygons:
        started = time.perf_counter()
        hits = list(tree.intersection(polygon.bounds))
        query_seconds += time.perf_counter() - started
        candidates += len(hits)

        # Refinement is NOT optional: a bounding box hit is not containment.
        started = time.perf_counter()
        ready = prep(polygon)
        results += sum(1 for i in hits
                       if ready.contains(Point(points[i][0], points[i][1])))
        refine_seconds += time.perf_counter() - started
    return Timing("r-tree", 0.0, query_seconds, refine_seconds, candidates, results)


def query_h3(cells: dict, lonlat: np.ndarray, polygons: list[Polygon],
             resolution: int) -> Timing:
    query_seconds = refine_seconds = 0.0
    candidates = results = 0
    for polygon in polygons:
        started = time.perf_counter()
        # Cover the polygon with cells; this is the approximation step.
        covering = h3.geo_to_cells(polygon.__geo_interface__, resolution)
        hits: list[int] = []
        for cell in covering:
            hits.extend(cells.get(cell, ()))
        query_seconds += time.perf_counter() - started
        candidates += len(hits)

        # Cells that lie wholly inside need no refinement; boundary cells do.
        started = time.perf_counter()
        ready = prep(polygon)
        results += sum(1 for i in hits
                       if ready.contains(Point(lonlat[i][0], lonlat[i][1])))
        refine_seconds += time.perf_counter() - started
    return Timing(f"h3 r{resolution}", 0.0, query_seconds, refine_seconds,
                  candidates, results)


def report(timings: list[Timing]) -> None:
    for t in timings:
        logger.info("%-10s query %6.3fs + refine %6.3fs = %6.3fs  "
                    "%8d candidate(s) -> %7d result(s)  (%.1fx selectivity)",
                    t.label, t.query_seconds, t.refine_seconds, t.total_seconds,
                    t.candidates, t.results,
                    t.candidates / max(1, t.results))
    # Identical results are the precondition for comparing anything else.
    distinct = {t.results for t in timings}
    if len(distinct) > 1:
        logger.error("indexes returned different result counts %s — the "
                     "comparison is meaningless until they agree", distinct)


if __name__ == "__main__":
    logger.info("run with a real workload; random boxes favour whichever "
                "index the box shape happens to suit")
```

## Step-by-step walkthrough

1. **Time the refinement separately.** An index query that returns quickly and hands back ten times as many candidates has not won; separating the two numbers is what makes that visible.
2. **Use a prepared geometry for the refinement.** Preparing the polygon once per query rather than per candidate removes a cost that would otherwise dominate and distort the comparison.
3. **Count candidates alongside time.** The candidate count is the structural measurement and it explains the timing; without it, a result is a number with no mechanism behind it.
4. **Report selectivity.** Candidates divided by results says how much work each index wasted, which is the number that transfers to a different machine.
5. **Assert the results agree.** Two indexes returning different counts are answering different questions, and every other comparison is meaningless until that is resolved.
6. **Cover the polygon at query time for the cell index.** The covering step is part of the query cost and omitting it from the timing flatters the cell index substantially.
7. **Use a real workload.** Randomly generated query boxes favour whichever index the box shape suits, which is a property of the benchmark rather than of the application.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 248" role="img" aria-labelledby="bhr2-t bhr2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="bhr2-t">Where the time goes for each index on a polygon containment workload</title>
  <desc id="bhr2-d">Four measurements over the same set of polygon containment queries against a million OSM points. The R-tree's index query is fast but returns many candidates because bounding boxes overlap the polygon generously. Its refinement dominates its total. The cell index's query is slower because covering the polygon with cells is real work, but it returns far fewer candidates for a compact polygon. Its refinement is correspondingly smaller, and the totals end up close.</desc>
  <rect x="0" y="0" width="880" height="248" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Query and refinement, for a polygon containment workload</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">R-tree: index query</text>
  <rect x="256" y="60" width="99" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">fast</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">R-tree: refinement</text>
  <rect x="256" y="100" width="478" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">dominates</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">Cell index: covering</text>
  <rect x="256" y="140" width="255" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">real work</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">Cell index: refinement</text>
  <rect x="256" y="180" width="214" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">fewer candidates</text>
  <text x="868" y="232" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Totals are close here and diverge sharply with query shape: a long thin polygon reverses the candidate advantage entirely.</text>
</svg>
<figcaption>Comparing only the first and third bars — the index query alone — would report a result the totals contradict.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="bhr3-t bhr3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="bhr3-t">Three ways a spatial index benchmark reaches a conclusion that does not transfer</title>
  <desc id="bhr3-d">Three panels. Omitting the refinement measures only the index lookup, which flatters whichever index returns candidates fastest regardless of how many it returns. Using randomly generated query boxes measures a workload nobody has, and the box shape decides the winner before any code runs. Testing one data distribution hides that a clustered dataset and a dispersed one favour different structures, so the conclusion reverses on the next region.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three benchmark flaws, three wrong conclusions</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Refinement omitted</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Only the lookup timed</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Candidate count ignored</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Fastest lookup wins</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Total time disagrees</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Random query boxes</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">A workload nobody has</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Shape decides the winner</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Before any code runs</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Does not transfer</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">One distribution</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Clustered or dispersed</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Not both</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Conclusion reverses</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">On the next region</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">All three produce a confident number, which is why a benchmark result should always be reported with the workload it used.</text>
</svg>
<figcaption>The fix for all three is the same: measure the application's real queries on the application's real data.</figcaption>
</figure>

## Verification

- **Result counts match exactly.** Any difference means the two are not answering the same question.
- **Selectivity is reported.** A ratio near one means the index is doing nearly all the work; a large ratio means the refinement is.
- **Query shape is varied.** Run compact and elongated polygons; the candidate advantage should move between the indexes.
- **The cell resolution is swept.** Too coarse and the covering is inaccurate; too fine and the covering itself becomes expensive.
- **Build time is reported but separated.** It matters for a one-shot job and not at all for a long-lived index.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Cell index looks unbeatable | Covering excluded from the query timing | Time the covering as part of the query |
| R-tree looks unbeatable | Refinement excluded from the timing | Time the exact test as part of the answer |
| Results differ between indexes | Different predicates applied | Assert equal result counts before comparing |
| Refinement dominates everything | Polygon prepared per candidate | Prepare the geometry once per query |
| Benchmark does not transfer | Random query boxes used | Benchmark the application's real query shapes |
| Cell index slow at fine resolution | Covering cost grows with cell count | Sweep resolutions and report the curve |
| Conclusions reverse on other data | Single distribution tested | Test both clustered and dispersed data |

## Specification reference

> H3 assigns each location to a hexagonal cell at a chosen resolution, so a containment query is a set membership test over the cells covering the query region, with approximation error at the boundary. An R-tree returns entries whose bounding rectangles intersect the query rectangle, which is a necessary but not sufficient condition for geometric containment, so an exact test must follow. See the [H3 documentation](https://h3geo.org/) for the covering operations and [Spatial Index Selection: R-tree vs H3 vs Quadkey](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/) for the wider comparison.

## Frequently Asked Questions

<details>
<summary>Why is comparing index lookup times alone misleading?</summary>

Because neither index returns a final answer. An R-tree returns bounding-box candidates that must be tested exactly, and a cell index returns cell members that must be tested near the region boundary. The refinement is frequently the larger cost, so a benchmark that stops at the index lookup can report a winner that the total time contradicts. Measuring time to a correct answer is the only comparison that transfers.
</details>

<details>
<summary>Does the query shape really change the outcome?</summary>

Substantially. A compact polygon is covered efficiently by hexagons and matches an R-tree's bounding box loosely, favouring the cell index. A long thin diagonal polygon is covered by many hexagons of which most are nearly empty, and its bounding box is enormous relative to its area, which hurts both — but differently. Benchmarking one shape and generalising is the most common way these comparisons mislead.
</details>

<details>
<summary>What cell resolution should the benchmark use?</summary>

Several, reported as a curve. Too coarse and the covering approximates the query region badly, inflating candidates. Too fine and the covering itself becomes expensive, because the number of cells grows quickly with resolution. The best resolution depends on the size of the query regions relative to the cells, so a single value answers only for the region size it was chosen against.
</details>

<details>
<summary>Should build time be included in the comparison?</summary>

Reported separately, and weighted by how the index is used. For a long-lived index queried millions of times, build cost is irrelevant and query cost is everything. For a one-shot join where the index is built and discarded, build cost can dominate and a cell assignment — a single arithmetic operation per feature — is hard to beat. Stating which regime applies is part of the result.
</details>

## Related

- [Spatial Index Selection: R-tree vs H3 vs Quadkey](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/) — the parent topic and the qualitative comparison.
- [Bulk Loading an R-tree Versus Inserting One by One](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/bulk-loading-an-rtree-versus-inserting-one-by-one/) — making the tree side as fast as it can be before comparing.
- [Choosing H3 Resolution for OSM Point Aggregation](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/choosing-h3-resolution-for-osm-point-aggregation/) — picking the resolution this benchmark sweeps.
- [Accelerating Point-in-Polygon Joins on OSM Data](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/accelerating-point-in-polygon-joins-on-osm-data/) — the workload this measures.
- [Choosing a Grid Cell Size for OSM Spatial Hashing](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/choosing-a-grid-cell-size-for-osm-spatial-hashing/) — a third structure worth including in the sweep.

Up one level: [Spatial Index Selection: R-tree vs H3 vs Quadkey](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Benchmarking H3 Lookup Against an R-tree Query",
  "description": "Measure a cell-index lookup against a tree query on the same OSM workload, and make the comparison fair by counting the work each one pushes downstream.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Data Fundamentals & Architecture",
  "about": ["index benchmarking", "H3 covering", "candidate refinement"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Fundamentals & Architecture", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/" },
    { "@type": "ListItem", "position": 3, "name": "Spatial Index Selection: R-tree vs H3 vs Quadkey", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/" },
    { "@type": "ListItem", "position": 4, "name": "Benchmarking H3 Lookup Against an R-tree Query", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/benchmarking-h3-lookup-against-an-rtree-query/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Benchmark a cell index against a tree index fairly",
  "description": "Time index query and geometric refinement separately, prepare geometry once per query, count candidates and selectivity, assert both indexes return identical results, and use the application's real query shapes.",
  "step": [
    { "@type": "HowToStep", "name": "Separate query from refinement", "text": "Time the index lookup and the exact geometric test independently, since the refinement is often the larger cost." },
    { "@type": "HowToStep", "name": "Prepare geometry once", "text": "Build a prepared geometry per query rather than per candidate so the refinement measures the index, not the setup." },
    { "@type": "HowToStep", "name": "Include the covering step", "text": "Count the cost of covering the query region with cells as part of the cell index's query time." },
    { "@type": "HowToStep", "name": "Count candidates and selectivity", "text": "Record how many candidates each index returned per result, which explains the timing and transfers across machines." },
    { "@type": "HowToStep", "name": "Assert results agree", "text": "Confirm both indexes return the same result count before comparing anything else." },
    { "@type": "HowToStep", "name": "Vary query shape and resolution", "text": "Run compact and elongated regions and sweep cell resolutions, reporting curves rather than a single number." }
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
      "name": "Why is comparing spatial index lookup times alone misleading?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because neither index returns a final answer. An R-tree returns bounding-box candidates that must be tested exactly, and a cell index returns cell members that must be tested near the boundary. The refinement is frequently the larger cost, so a benchmark stopping at the lookup can report a winner the total time contradicts." }
    },
    {
      "@type": "Question",
      "name": "Does query shape really change which spatial index wins?",
      "acceptedAnswer": { "@type": "Answer", "text": "Substantially. A compact polygon is covered efficiently by hexagons and matches an R-tree's bounding box loosely, favouring the cell index. A long thin diagonal polygon is covered by many nearly empty hexagons and has an enormous bounding box relative to its area. Benchmarking one shape and generalising is the most common way these comparisons mislead." }
    },
    {
      "@type": "Question",
      "name": "What cell resolution should an index benchmark use?",
      "acceptedAnswer": { "@type": "Answer", "text": "Several, reported as a curve. Too coarse and the covering approximates the query region badly, inflating candidates. Too fine and the covering itself becomes expensive. The best resolution depends on query region size relative to the cells, so a single value answers only for the size it was chosen against." }
    },
    {
      "@type": "Question",
      "name": "Should index build time be included in the comparison?",
      "acceptedAnswer": { "@type": "Answer", "text": "Reported separately and weighted by usage. For a long-lived index queried millions of times, build cost is irrelevant. For a one-shot join where the index is built and discarded, build cost can dominate and a cell assignment is hard to beat. Stating which regime applies is part of the result." }
    }
  ]
}
</script>
