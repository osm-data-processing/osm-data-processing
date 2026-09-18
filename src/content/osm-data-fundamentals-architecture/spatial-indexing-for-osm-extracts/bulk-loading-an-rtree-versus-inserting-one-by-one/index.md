---
title: "Bulk Loading an R-tree Versus Inserting One by One"
description: "Why a bulk-loaded R-tree is both faster to build and faster to query than one grown by insertion, and when incremental insertion is nevertheless the right choice."
pageTitle: "Bulk Load or Insert: Building an R-tree over OSM Data"
pageDescription: "Compare bulk loading and incremental insertion for an R-tree over OSM geometry on build time, query performance and node overlap, and choose deliberately rather than by default."
slug: bulk-loading-an-rtree-versus-inserting-one-by-one
type: article
breadcrumb: "Bulk Load vs Insert"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Bulk Loading an R-tree Versus Inserting One by One

Two trees over the same data can differ in query cost by a factor of several, purely because of the order the data went in. The difference is one constructor argument, and almost nobody chooses it deliberately.

## Prerequisites

- [ ] Python 3.10+ with `rtree`, or `shapely` 2.x whose STRtree is bulk-loaded by construction.
- [ ] Geometry in a metric projection and its bounding boxes precomputed.
- [ ] The index comparison from [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/).
- [ ] A representative query workload, since build strategy affects query cost more than build cost.
- [ ] A view on whether the index must accept later insertions.

## Conceptual minimum

An R-tree groups nearby bounding boxes into parent nodes, recursively. Query cost depends almost entirely on **how much the sibling nodes overlap**: a query descending into a node must also descend into every sibling whose box it intersects, so overlapping nodes multiply the work.

**Incremental insertion** places each item into whichever existing node grows least, splitting when a node overflows. It cannot see what is coming, so early items dictate a structure that later items must fit into, and the result accumulates overlap. It has one real advantage: the tree accepts further insertions cheaply.

**Bulk loading** sees everything at once. The standard algorithm sorts items spatially — typically by a space-filling curve or by alternating coordinate sorts — and packs them into full nodes bottom-up. The result has minimal overlap and near-perfect fill, and it is built in roughly the time of a sort rather than of a million insertions.

The trade-off is therefore not about speed on one axis: bulk loading is faster to build *and* faster to query. What it gives up is mutability.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="blr1-t blr1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="blr1-t">Bulk loading and incremental insertion compared on the properties that matter</title>
  <desc id="blr1-d">A grid of four properties against the two strategies. Build time is roughly that of a sort for bulk loading and substantially longer for insertion, because each insertion descends the tree. Node overlap is minimal for bulk loading and accumulates for insertion, which is what drives query cost. Node fill is near complete for bulk loading and typically around seventy percent for insertion. Mutability is the one advantage of insertion: the tree accepts further items cheaply, while a bulk-loaded tree must be rebuilt.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Bulk loading wins on three of four properties</text>
  <rect x="196" y="48" width="329" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="360" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Bulk load</text>
  <rect x="525" y="48" width="329" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="690" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Insert one by one</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Build time</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="360" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">about a sort</text>
  <text x="690" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">substantially longer</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Node overlap</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="360" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">minimal</text>
  <text x="690" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">accumulates</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Node fill</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="360" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">near complete</text>
  <text x="690" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">around 70%</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Accepts inserts</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="360" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">no, rebuild</text>
  <text x="690" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">yes, cheaply</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The last row is the only reason to choose insertion, and it matters only when the index genuinely changes after construction.</text>
</svg>
<figcaption>Because bulk loading wins on both build and query, the decision reduces entirely to whether the index must be mutable.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
import time
from dataclasses import dataclass

import numpy as np
from rtree import index as rtree_index

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.index.rtree")


@dataclass(frozen=True)
class Measurement:
    strategy: str
    build_seconds: float
    query_seconds: float
    candidates_per_query: float


def build_inserted(boxes: np.ndarray) -> rtree_index.Index:
    """One insertion at a time: the tree cannot see what is coming."""
    tree = rtree_index.Index()
    for i, (minx, miny, maxx, maxy) in enumerate(boxes):
        tree.insert(i, (minx, miny, maxx, maxy))
    return tree


def build_bulk(boxes: np.ndarray) -> rtree_index.Index:
    """Bulk load from a generator: the library packs nodes bottom-up.

    The generator form is what triggers bulk loading; passing the same data
    through repeated insert() calls does NOT, however it is batched.
    """
    def stream():
        for i, (minx, miny, maxx, maxy) in enumerate(boxes):
            yield (i, (minx, miny, maxx, maxy), None)
    return rtree_index.Index(stream())


def measure(boxes: np.ndarray, queries: np.ndarray,
            builder, label: str) -> Measurement:
    started = time.perf_counter()
    tree = builder(boxes)
    build_seconds = time.perf_counter() - started

    started = time.perf_counter()
    total_candidates = 0
    for minx, miny, maxx, maxy in queries:
        hits = list(tree.intersection((minx, miny, maxx, maxy)))
        total_candidates += len(hits)
    query_seconds = time.perf_counter() - started

    result = Measurement(label, build_seconds, query_seconds,
                         total_candidates / max(1, len(queries)))
    logger.info("%-12s build %6.2fs  query %6.2fs  %6.1f candidate(s)/query",
                label, build_seconds, query_seconds, result.candidates_per_query)
    return result


def random_boxes(n: int, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    # Clustered, like real OSM data: a dense core plus a sparse surround.
    centres = np.vstack([rng.normal(0, 500, size=(int(n * 0.8), 2)),
                         rng.uniform(-20_000, 20_000, size=(n - int(n * 0.8), 2))])
    sizes = np.abs(rng.normal(20, 10, size=(n, 2))) + 1
    return np.hstack([centres - sizes / 2, centres + sizes / 2])


if __name__ == "__main__":
    boxes = random_boxes(200_000)
    queries = random_boxes(2_000, seed=1)
    inserted = measure(boxes, queries, build_inserted, "inserted")
    bulk = measure(boxes, queries, build_bulk, "bulk-loaded")
    logger.info("bulk loading: %.1fx faster to build, %.1fx faster to query",
                inserted.build_seconds / bulk.build_seconds,
                inserted.query_seconds / bulk.query_seconds)
```

## Step-by-step walkthrough

1. **Use the generator form to bulk load.** Passing an iterable of items to the index constructor is what triggers the packing algorithm; calling insert in a loop never does, however the loop is batched.
2. **Precompute the bounding boxes.** Computing them inside the build loop measures geometry work rather than index construction, which makes the comparison meaningless.
3. **Measure queries, not just build time.** The build difference is the headline and the query difference is the one that matters, because a build happens once and queries happen forever.
4. **Count candidates as well as time.** The candidate count is the structural measurement: a tree returning more candidates for identical queries has more node overlap, which is the mechanism behind the timing difference.
5. **Test on clustered data.** Uniformly distributed boxes understate the difference substantially, because overlap accumulates fastest exactly where density varies — which is what OSM looks like.
6. **Keep the query set fixed.** The two trees must answer identical queries, or the comparison measures the queries rather than the trees.
7. **Decide on mutability, not on speed.** Since bulk loading wins both timings, the only question is whether the index must accept later insertions.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 248" role="img" aria-labelledby="blr2-t blr2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="blr2-t">Typical build and query times for two hundred thousand clustered boxes</title>
  <desc id="blr2-d">Four measurements comparing the two strategies on the same clustered dataset. Incremental insertion takes substantially longer to build because each item descends the tree and may trigger a split. Bulk loading builds in roughly the time of a sort. Querying the incrementally built tree is noticeably slower because sibling node overlap forces the search into more branches. Querying the bulk-loaded tree is faster for the same queries and returns fewer candidates for identical search boxes.</desc>
  <rect x="0" y="0" width="880" height="248" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Same data, same queries, two build strategies</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">Insert: build</text>
  <rect x="256" y="60" width="478" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">baseline</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">Bulk load: build</text>
  <rect x="256" y="100" width="105" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 4.5x faster</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">Insert: 2000 queries</text>
  <rect x="256" y="140" width="277" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">query baseline</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">Bulk load: 2000 queries</text>
  <rect x="256" y="180" width="115" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 2.4x faster</text>
  <text x="868" y="232" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">On uniformly distributed data the query gap narrows considerably, which is why benchmarks on synthetic uniform boxes are misleading.</text>
</svg>
<figcaption>Exact ratios vary with clustering and library, but the direction does not: bulk loading wins both measurements.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 239" role="img" aria-labelledby="blr3-t blr3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="blr3-t">Why insertion order changes the tree, and what that costs a query</title>
  <desc id="blr3-d">Three panels. Under insertion, each item joins whichever existing node grows least, so the structure is fixed by whatever arrived first and later items are squeezed into it, leaving sibling boxes overlapping. Under bulk loading, the whole dataset is sorted spatially and packed bottom-up into full nodes, so siblings are compact and rarely overlap. The query consequence is that an overlapping tree forces a search into several branches at every level, multiplying the nodes visited.</desc>
  <rect x="0" y="0" width="880" height="239" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Same items, different structure, different query cost</text>
  <rect x="26" y="52" width="259" height="153" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Grown by insertion</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Each item joins the best fit</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Early arrivals fix the shape</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Later ones squeeze in</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Siblings overlap</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Fill around 70 percent</text>
  <rect x="311" y="52" width="259" height="153" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Packed in bulk</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Whole dataset sorted first</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Nodes filled bottom-up</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Siblings compact</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Overlap minimal</text>
  <text x="325" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Fill near complete</text>
  <rect x="595" y="52" width="259" height="153" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Query effect</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Overlap splits the descent</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Several branches per level</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Compounds with depth</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">More candidates returned</text>
  <text x="609" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Same results, more work</text>
  <text x="868" y="223" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The third panel is why the candidate count, not the wall-clock time, is the measurement that proves the mechanism.</text>
</svg>
<figcaption>Nothing reorganises an incrementally built tree afterwards, so the overlap it accumulates is permanent.</figcaption>
</figure>

## Verification

- **Both trees return identical results.** For each query, the sorted result sets must match; a difference means a bug, not a strategy effect.
- **The candidate count differs.** If both trees return the same number of candidates, the bulk load did not happen — check that the generator form was used.
- **Clustered data shows a larger gap.** Re-run on uniform boxes and confirm the difference narrows, which validates that overlap is the mechanism.
- **Build time scales as expected.** Doubling the data should roughly double the bulk build and more than double the insertion build.
- **The bulk tree rejects insertion.** Confirm your library's behaviour, since some silently degrade to insertion afterwards.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| No difference between strategies | Insert loop used for both | Pass a generator to the constructor to bulk load |
| Build times dominated by geometry | Bounding boxes computed in the loop | Precompute boxes before timing |
| Difference smaller than expected | Uniform synthetic data | Benchmark on clustered data resembling real extracts |
| Bulk tree slow after updates | Insertions made into a packed tree | Rebuild rather than inserting into a bulk-loaded index |
| Results differ between trees | Different item identifiers or boxes | Assert identical inputs before comparing |
| Memory spikes during bulk load | Whole dataset materialised | Stream the generator rather than building a list |
| Index rebuilt on every query batch | Rebuild placed inside the query loop | Build once and reuse across the workload |

## Specification reference

> Bulk loading algorithms for R-trees, such as sort-tile-recursive packing, sort the input spatially and fill nodes to capacity bottom-up, producing a tree with minimal node overlap and near-complete fill. Incremental insertion instead chooses the subtree requiring least enlargement and splits on overflow, which yields lower fill and accumulating overlap. See the [libspatialindex documentation](https://libspatialindex.org/) for the packing implementation used by the Python bindings.

## Frequently Asked Questions

<details>
<summary>Is bulk loading always faster to query?</summary>

For a static dataset, effectively always, because it produces a tree with less sibling overlap and better node fill. The margin depends on how clustered the data is: on uniformly distributed boxes the two are close, and on the heavily clustered distributions real OSM extracts produce the gap is substantial. Since it is also faster to build, there is no speed argument for insertion at all.
</details>

<details>
<summary>When should I insert one at a time?</summary>

When the index genuinely has to accept items after construction and rebuilding is impractical — a long-running service maintaining an index over a changing dataset, for instance. That is a real requirement and the only one that justifies the cost. If the data changes in batches, rebuilding the whole index per batch is usually still faster than inserting into an existing one, and it keeps the query performance.
</details>

<details>
<summary>Why does node overlap matter so much?</summary>

Because a query must descend into every node whose bounding box it intersects. Where siblings overlap, one query descends into several branches instead of one, and that multiplication compounds at every level of the tree. A tree built by insertion accumulates overlap because early items fix a structure that later items must be squeezed into, and nothing ever reorganises it.
</details>

<details>
<summary>Does the same reasoning apply to other spatial indexes?</summary>

The principle does: an index built with knowledge of the whole dataset can be organised better than one grown incrementally. The magnitude varies. A uniform grid, as in [Choosing a Grid Cell Size for OSM Spatial Hashing](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/choosing-a-grid-cell-size-for-osm-spatial-hashing/), is insensitive to insertion order by construction, so the question does not arise there.
</details>

## Related

- [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/) — the parent topic and the index comparison.
- [Building an R-tree Index over OSM Geometries](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/building-an-rtree-index-over-osm-geometries/) — constructing the index this compares strategies for.
- [Choosing a Grid Cell Size for OSM Spatial Hashing](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/choosing-a-grid-cell-size-for-osm-spatial-hashing/) — the alternative structure, insensitive to insertion order.
- [Benchmarking H3 Lookup Against an R-tree Query](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/benchmarking-h3-lookup-against-an-rtree-query/) — comparing across index families rather than build strategies.
- [Accelerating Point-in-Polygon Joins on OSM Data](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/accelerating-point-in-polygon-joins-on-osm-data/) — the workload this index usually serves.

Up one level: [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Bulk Loading an R-tree Versus Inserting One by One",
  "description": "Why a bulk-loaded R-tree is both faster to build and faster to query than one grown by insertion, and when incremental insertion is nevertheless the right choice.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Data Fundamentals & Architecture",
  "about": ["R-tree bulk loading", "node overlap", "index construction"]
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
    { "@type": "ListItem", "position": 4, "name": "Bulk Loading an R-tree Versus Inserting One by One", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/bulk-loading-an-rtree-versus-inserting-one-by-one/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Compare R-tree bulk loading against incremental insertion",
  "description": "Precompute bounding boxes, build one tree by streaming a generator and one by repeated insertion, time both build and query phases on clustered data, and compare candidate counts as well as durations.",
  "step": [
    { "@type": "HowToStep", "name": "Precompute the boxes", "text": "Prepare bounding boxes before timing so the measurement covers index construction rather than geometry work." },
    { "@type": "HowToStep", "name": "Bulk load via a generator", "text": "Pass an iterable of items to the index constructor, which is what triggers the packing algorithm." },
    { "@type": "HowToStep", "name": "Build the comparison tree by insertion", "text": "Insert the identical items one at a time into a separate index." },
    { "@type": "HowToStep", "name": "Time both phases", "text": "Measure build and query durations separately, since the query difference is the one that compounds." },
    { "@type": "HowToStep", "name": "Count candidates", "text": "Record how many candidates each tree returns for identical queries, which measures node overlap directly." },
    { "@type": "HowToStep", "name": "Use clustered data", "text": "Benchmark on a distribution resembling real extracts, since uniform synthetic data understates the difference." },
    { "@type": "HowToStep", "name": "Decide on mutability", "text": "Choose insertion only when the index must accept later items, since bulk loading wins both timings." }
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
      "name": "Is a bulk-loaded R-tree always faster to query?",
      "acceptedAnswer": { "@type": "Answer", "text": "For a static dataset, effectively always, because it produces a tree with less sibling overlap and better node fill. The margin depends on clustering: on uniform boxes the two are close, and on the heavily clustered distributions real OSM extracts produce the gap is substantial. Since it is also faster to build, there is no speed argument for insertion." }
    },
    {
      "@type": "Question",
      "name": "When should I insert into an R-tree one item at a time?",
      "acceptedAnswer": { "@type": "Answer", "text": "When the index genuinely has to accept items after construction and rebuilding is impractical, such as a long-running service over changing data. If the data changes in batches, rebuilding the whole index per batch is usually still faster than inserting, and it keeps the query performance." }
    },
    {
      "@type": "Question",
      "name": "Why does R-tree node overlap matter so much?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because a query must descend into every node whose bounding box it intersects. Where siblings overlap, one query descends into several branches instead of one, and that multiplication compounds at every level. A tree built by insertion accumulates overlap because early items fix a structure later items must be squeezed into." }
    },
    {
      "@type": "Question",
      "name": "Does bulk-loading reasoning apply to other spatial indexes?",
      "acceptedAnswer": { "@type": "Answer", "text": "The principle does: an index built with knowledge of the whole dataset can be organised better than one grown incrementally. The magnitude varies. A uniform grid is insensitive to insertion order by construction, so the question does not arise there." }
    }
  ]
}
</script>
