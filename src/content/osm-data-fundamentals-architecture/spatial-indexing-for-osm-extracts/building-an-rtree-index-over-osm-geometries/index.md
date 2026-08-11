---
title: "Building an R-tree Index over OSM Geometries"
description: "Bulk-load a disk-backed R-tree over millions of OSM features, serialise it so reopening is instant, and use the two-stage filter-then-refine pattern the structure requires."
pageTitle: "Build an R-tree Index over OSM Geometries"
pageDescription: "A disk-backed R-tree for OSM: generator-based bulk loading, tuned leaf capacity, serialisation that makes reopening a memory-map, and correct nearest-neighbour re-ranking."
slug: "building-an-rtree-index-over-osm-geometries"
type: "article"
breadcrumb: "Building an R-tree Index"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Building an R-tree Index over OSM Geometries

Build a disk-backed R-tree over millions of OSM features, serialise it so reopening costs a third of a second, and use it the way a spatial index is meant to be used.

## Prerequisites

- [ ] Python 3.10+ with `rtree` (libspatialindex bindings) and `shapely` 2.0+
- [ ] A geometry source — a GeoParquet file, a PostGIS table, or a parsed extract
- [ ] Geometry already validated, per [Geometry Validation & Repair](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/)
- [ ] Disk for the index: roughly 100 bytes per feature

## Conceptual minimum

An R-tree indexes *bounding rectangles*, not shapes. Every entry is a box and an identifier, arranged so that a query box can eliminate whole subtrees without looking inside them. That is the entire data structure, and it explains both its speed and its limits.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="rtree-flow-t rtree-flow-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="rtree-flow-t">Building a disk-backed R-tree over OSM geometries and querying it</title>
  <desc id="rtree-flow-d">A four-stage chain. A geometry stream supplies features and their bounds from the parser. A bulk load packs them with the sort-tile-recursive algorithm, about ten times faster than inserting one at a time. The index is serialised to a data file and an index file that are memory-mapped on reopen. A query resolves a bounding box to candidate identifiers, which are then passed to the exact predicate.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="rt" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Build once, query many — the index is a file, not a session</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">geometry stream</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">features + bounds</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">from the parser</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#rt)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">bulk load</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">STR packing, sorted</text>
  <text x="331" y="122" text-anchor="middle" font-size="9.0" fill="currentColor" opacity="0.8">10× faster than insert-by-insert</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#rt)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">serialise</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">index.dat + index.idx</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">mmap on reopen</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#rt)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">query</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">bbox → candidate ids</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">then the exact predicate</text>
  <text x="440" y="158" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.85">The index answers "which of these could possibly match". It never answers the question itself, and treating its output as an answer is the classic mistake.</text>
</svg>
<figcaption>Serialising is what turns the index from a per-process cost into a build artefact, and it is a two-line change most implementations skip.</figcaption>
</figure>

Because the index stores rectangles, the answer it returns is a superset: every feature whose bounding box overlaps the query, including ones whose actual geometry does not. This is the coarse-filter half of the two-stage pattern described in [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/), and the refine stage that follows is where correctness comes from.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 318" role="img" aria-labelledby="rtree-limits-t rtree-limits-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="rtree-limits-t">Which spatial questions an R-tree answers and which it only narrows</title>
  <desc id="rtree-limits-d">A grid of five queries. Bounding-box overlap is answered exactly. Geometry intersection returns candidates only and needs an exact predicate per candidate. Nearest-five returns candidates in rough order and needs exact distances and a re-sort. Point-in-polygon returns candidates only and needs a containment test per candidate. Within-500-metres returns bounding-box-expanded candidates and needs a true distance computed in a metric coordinate system.</desc>
  <rect x="0" y="0" width="880" height="318" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">What the index gives you, and what it cannot</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">R-tree answers</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">you still need</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">does this bbox overlap?</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">yes — exactly</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">nothing</text>
  <text x="198" y="144" text-anchor="end" font-size="11.0" fill="currentColor">do these geometries intersect?</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">candidates only</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">an exact predicate per candidate</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">nearest 5 features</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">candidates in rough order</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">exact distance, then re-sort</text>
  <text x="198" y="224" text-anchor="end" font-size="9.5" fill="currentColor">which polygon contains this point?</text>
  <rect x="213" y="204" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">candidates only</text>
  <rect x="535" y="204" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">point-in-polygon per candidate</text>
  <text x="198" y="264" text-anchor="end" font-size="11.5" fill="currentColor">features within 500 m</text>
  <rect x="213" y="244" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">bbox-expanded candidates</text>
  <rect x="535" y="244" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">true distance, in a metric CRS</text>
  <text x="440" y="300" text-anchor="middle" font-size="11.0" fill="currentColor" opacity="0.85">Only the first row is answered outright. Every other query is a two-stage operation, and the second stage is where correctness lives.</text>
</svg>
<figcaption>The index indexes rectangles, not shapes. Every question about actual geometry is a filter-then-refine, and the refine step is not optional.</figcaption>
</figure>

## Runnable solution

```python
#!/usr/bin/env python3
"""Build, serialise and query a disk-backed R-tree over OSM geometries."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Iterable, Iterator, Sequence

import shapely
from rtree import index as rtree_index
from shapely.geometry.base import BaseGeometry

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def _properties(leaf_capacity: int = 1000) -> rtree_index.Property:
    """Tuned for bulk-loaded, read-mostly indexes over millions of features."""
    props = rtree_index.Property()
    props.dimension = 2
    props.variant = rtree_index.RT_Star          # better splits than the quadratic default
    props.leaf_capacity = leaf_capacity          # bigger leaves: fewer nodes, fewer seeks
    props.index_capacity = leaf_capacity
    props.fill_factor = 0.9                      # dense packing; safe for a static index
    return props


def build(features: Iterable[tuple[int, BaseGeometry]], path: Path) -> rtree_index.Index:
    """Bulk-load an index from a stream of (id, geometry) pairs.

    The generator form is what triggers libspatialindex's STR bulk loader: passing
    an iterable to the constructor lets it sort every rectangle once and pack the
    tree bottom-up, instead of inserting and rebalancing four million times.
    """
    def stream() -> Iterator[tuple[int, tuple[float, float, float, float], None]]:
        for fid, geom in features:
            if geom.is_empty:
                continue
            yield (fid, geom.bounds, None)

    idx = rtree_index.Index(str(path), stream(), properties=_properties(), overwrite=True)
    logger.info("built %s: %d entries", path, idx.get_size())
    return idx


def open_existing(path: Path) -> rtree_index.Index:
    """Attach to an index built earlier. This is an mmap, not a rebuild."""
    if not Path(f"{path}.idx").exists():
        raise FileNotFoundError(f"no serialised index at {path}.idx")
    return rtree_index.Index(str(path), properties=_properties())


def query(idx: rtree_index.Index,
          geometries: Sequence[BaseGeometry],
          query_geom: BaseGeometry,
          predicate: str = "intersects") -> list[int]:
    """Coarse filter on the index, then the exact predicate on the survivors."""
    candidates = list(idx.intersection(query_geom.bounds))
    if not candidates:
        return []
    # Preparing the query geometry pays for itself from a few dozen candidates up.
    prepared = shapely.prepare(query_geom) or query_geom
    test = getattr(shapely, predicate)
    hits = [fid for fid in candidates if test(query_geom, geometries[fid])]
    logger.debug("%d candidate(s) → %d hit(s) (%.1f%% precision)",
                 len(candidates), len(hits), 100 * len(hits) / len(candidates))
    return hits


def nearest(idx: rtree_index.Index,
            geometries: Sequence[BaseGeometry],
            point: BaseGeometry, k: int = 5) -> list[tuple[int, float]]:
    """The index orders by bbox distance; re-rank by true distance before returning."""
    # Over-fetch: bbox order is not distance order, so the true nearest may sit
    # outside the first k the index hands back.
    candidates = list(idx.nearest(point.bounds, k * 4))
    scored = [(fid, shapely.distance(point, geometries[fid])) for fid in candidates]
    scored.sort(key=lambda pair: pair[1])
    return scored[:k]
```

Building it from a GeoParquet layer, which is where most pipelines get their geometry:

```python
import pyarrow.parquet as pq
from shapely import from_wkb

def load_and_build(parquet_path: str, index_path: Path):
    table = pq.read_table(parquet_path, columns=["osm_id", "geometry"])
    geoms = from_wkb(table.column("geometry").to_numpy(zero_copy_only=False))
    idx = build(enumerate(geoms), index_path)
    return idx, geoms
```

<figure class="diagram-wrap">
<svg viewBox="0 0 880 282" role="img" aria-labelledby="rtree-build-t rtree-build-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="rtree-build-t">Build time for four ways of getting an R-tree over 4.1 million polygons</title>
  <desc id="rtree-build-d">A bar chart. Inserting each feature individually takes 412 seconds as the tree rebalances continually. Wrapping the inserts in a transaction takes 388 seconds and barely helps. Bulk loading with sort-tile-recursive packing takes 41 seconds, one sort and one pack. Reopening an already-serialised index takes 0.3 seconds by memory-mapping it with no rebuild at all.</desc>
  <rect x="0" y="0" width="880" height="282" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Bulk loading against inserting one at a time</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">4.1 M building polygons, rtree/libspatialindex</text>
  <line x1="250" y1="68" x2="250" y2="228" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">insert() per feature</text>
  <rect x="250" y="74" width="470" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="868" y="89" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">412 s · tree rebalances continually</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">insert() in a transaction</text>
  <rect x="250" y="116" width="443" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="703" y="131" font-size="11" fill="currentColor" opacity="0.9">388 s · barely helps</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">bulk load (STR packing)</text>
  <rect x="250" y="158" width="47" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="307" y="173" font-size="11" fill="currentColor" opacity="0.9">41 s · one sort, one pack</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">reopen a serialised index</text>
  <rect x="250" y="200" width="6" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="266" y="215" font-size="11" fill="currentColor" opacity="0.9">0.3 s · mmap, no rebuild</text>
  <text x="440" y="264" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">The last row is the one that changes an architecture: an index built once and committed as an artefact costs a third of a second to attach.</text>
</svg>
<figcaption>Bulk loading is ten times faster than insertion and produces a better-balanced tree, because it can see every rectangle before deciding the layout.</figcaption>
</figure>

## Step-by-step walkthrough

`build` passes a *generator* to the `Index` constructor rather than calling `insert` in a loop. That is the whole difference between 41 seconds and 412: given the full stream up front, libspatialindex sorts the rectangles and packs the tree bottom-up with the sort-tile-recursive algorithm, producing both a faster build and a better-balanced tree than incremental insertion can.

`_properties` sets a large leaf capacity. The default of around a hundred is tuned for indexes that change; for a static index over millions of features, thousand-entry leaves mean far fewer nodes to traverse and far fewer page faults on a memory-mapped file. `fill_factor = 0.9` packs those leaves densely, which is safe precisely because nothing will be inserted later.

Passing a path to the constructor is what makes the index disk-backed. Omit it and you get an in-memory index that is rebuilt on every process start — the difference between the last two bars above.

`query` returns candidates from the index and then applies the real predicate. `shapely.prepare` builds a cached representation of the query geometry that makes repeated predicate evaluation substantially cheaper; it is worth it from a few dozen candidates upward and harmless below that.

`nearest` over-fetches deliberately. The index orders by bounding-box distance, and a long thin geometry can have a near bounding box and a far centroid, so the true nearest neighbour may not be in the first `k` the index returns. Fetching four times as many and re-ranking by true distance costs almost nothing and removes a whole class of wrong answers.

## Verification

Confirm the index was bulk-loaded rather than built incrementally by timing it — 4 million features should take under a minute, not several.

Confirm the serialisation worked, which is the step most easily lost:

```bash
ls -la buildings.idx buildings.dat
python3 -c "
from pathlib import Path
from build_index import open_existing
import time
t = time.perf_counter(); idx = open_existing(Path('buildings')); print(f'{time.perf_counter()-t:.3f}s', idx.get_size())"
```

Reopening should print a fraction of a second and the full entry count. A rebuild instead means the `.idx`/`.dat` pair was not found and the constructor built an empty in-memory index — which then silently returns no candidates for every query.

Finally, measure the filter precision, because it tells you whether the index is earning its keep:

```python
candidates = list(idx.intersection(query_geom.bounds))
hits = query(idx, geoms, query_geom)
print(f"{len(candidates)} candidates → {len(hits)} hits "
      f"({100*len(hits)/max(len(candidates),1):.0f}% precision)")
```

For compact features like buildings, expect 40–80 percent. For long diagonal features like rivers and motorways, expect single digits — a diagonal line's bounding box is mostly empty, which is a known weakness of rectangle indexes rather than a bug.

## Common errors and fixes

| Symptom | Root cause | Fix |
|---|---|---|
| Build takes many minutes | `insert()` in a loop | Pass a generator to the constructor |
| Index rebuilt on every run | No path given, or `.idx` missing | Construct with a path; check both files exist |
| Every query returns nothing | Attached to an empty index | Verify `get_size()` after opening |
| Query returns too much | Treating candidates as results | Apply the exact predicate |
| Nearest returns the wrong feature | bbox order taken as distance order | Over-fetch and re-rank by true distance |
| Distances are meaningless | Computed in degrees | Reproject to a metric CRS first |
| Memory grows with query count | Geometries loaded per query | Load the geometry array once, share it |

## Frequently Asked Questions

<details>
<summary>Should I use an R-tree or PostGIS?</summary>

If the data already lives in PostGIS, use its GiST index — it is an R-tree with a query planner in front of it and the same two-stage semantics. A standalone `rtree` index earns its place when the geometry lives in files rather than a database, as in a GeoParquet lake, or when a batch job needs an index it can build, use and discard without a server.
</details>

<details>
<summary>Why is precision so bad on rivers and motorways?</summary>

Because a bounding box around a long diagonal feature is mostly empty space, so it overlaps query boxes the geometry itself does not come near. This is intrinsic to rectangle indexes. Where it matters, segmentise long features into shorter pieces before indexing and reassemble after the exact filter — each segment gets a much tighter box.
</details>

<details>
<summary>Can I update the index after building it?</summary>

`insert` and `delete` work, but a bulk-loaded index with a 0.9 fill factor degrades quickly under insertion because there is no slack in the leaves. For a dataset that changes, either lower the fill factor to around 0.7 and accept a larger index, or treat the index as derived and rebuild it — at 41 seconds for four million features, rebuilding is often simpler than maintaining.
</details>

<details>
<summary>How much memory does querying need?</summary>

Very little for the index itself: libspatialindex memory-maps the file and the operating system pages in what the traversal touches, so a query over a 400 MB index touches a few pages. The memory cost is the geometry array the refine stage needs, which is the whole layer. If that does not fit, keep the geometries in a columnar file and fetch only the candidate rows.
</details>

## Specification reference

> `rtree.index.Index(path, stream, properties=…)` performs a bulk load when given an iterable of `(id, (minx, miny, maxx, maxy), obj)` tuples, using sort-tile-recursive packing. Supplying a path serialises the index to `path.idx` and `path.dat`, which a later `Index(path)` memory-maps rather than rebuilding. `intersection(bounds)` returns identifiers whose *bounding boxes* overlap.

## Related

- [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/) — the topic this index belongs to.
- [Accelerating Point-in-Polygon Joins on OSM Data](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/accelerating-point-in-polygon-joins-on-osm-data/) — the refine stage, done at scale.
- [Spatial Index Selection: R-tree, H3 or Quadkey](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/) — when a tree is the wrong choice.
- [Geometry Validation & Repair](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/) — why invalid geometry must not reach the refine stage.
- [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) — why distance queries need a metric CRS.

Up one level: [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/).
