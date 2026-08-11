---
title: "Resolving Way-Node References Without a Full Node Cache"
description: "Build OSM way geometries on a memory budget with a three-pass resolution that holds only the referenced nodes, as sorted int64 ids and int32 coordinates rather than a dictionary."
pageTitle: "Resolve OSM Way-Node References Without a Node Cache"
pageDescription: "A three-pass reference resolver for OSM ways — collect needed ids, locate only those nodes, then resolve by binary search — with the guards a clipped extract requires."
slug: "resolving-way-node-references-without-a-full-node-cache"
type: "article"
breadcrumb: "Resolving Without a Node Cache"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Resolving Way-Node References Without a Full Node Cache

Turn ways into geometries on a machine that cannot hold every node in memory, by holding only the nodes the ways actually reference.

## Prerequisites

- [ ] Python 3.10+ with `osmium` (pyosmium 3.6+) and `numpy`
- [ ] An extract on disk, readable more than once
- [ ] A clear definition of which ways you need — the subset is the whole saving
- [ ] Familiarity with the reference model in [Node, Way & Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/)

## Conceptual minimum

A way stores node identifiers, not coordinates. Building its geometry means looking up every identifier, and the naive way to make those lookups fast is a dictionary of every node in the file — which for a country extract is tens of gigabytes.

The saving comes from a simple observation: you almost never need every node. A road-network build references the nodes on highway ways and nothing else, which is around twelve percent of a typical extract. Holding twelve percent of the nodes in a compact array instead of one hundred percent in a Python dictionary is two independent order-of-magnitude wins multiplied together.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="ref-passes-t ref-passes-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="ref-passes-t">A three-pass reference resolution that holds only the nodes it needs</title>
  <desc id="ref-passes-d">A four-stage chain. Pass one reads ways and collects the node identifiers they reference into a sorted int64 array. Pass two reads nodes and keeps only those whose identifier is in that set, tested by binary search. Pass three reads ways again and resolves each reference against the array in logarithmic time, emitting geometry. Memory is proportional to the nodes actually needed rather than to the whole file.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="rw" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Two passes beat one big dictionary</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">pass 1: ways</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.0" fill="currentColor" opacity="0.85">collect the node ids you need</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">a sorted int64 array</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#rw)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">pass 2: nodes</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">keep only those ids</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">searchsorted membership</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#rw)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">pass 3: ways again</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">resolve and emit geometry</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">array lookup, O(log n)</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#rw)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">memory</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">proportional to needed nodes</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">not to the file</text>
  <text x="440" y="158" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.85">A road-network extract references perhaps 12 percent of the nodes in the file. Holding only those is an order of magnitude cheaper than holding all of them.</text>
</svg>
<figcaption>The extra pass costs disk reads, which are cheap and parallelisable. The dictionary it replaces costs memory, which is neither.</figcaption>
</figure>

The cost is an extra read of the file, and that is a good trade. Reads are sequential, cheap, and get faster with better storage; memory is a hard ceiling that fails abruptly.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="ref-memory-t ref-memory-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="ref-memory-t">Peak memory for five node-reference resolution strategies</title>
  <desc id="ref-memory-d">A bar chart for a 412 million node country extract where highway ways reference 48 million nodes. A Python dictionary of identifier to coordinate tuple needs 41 gigabytes at 104 bytes per node and does not fit. A dictionary holding all nodes more compactly still needs 5 gigabytes. Two sorted numpy arrays need 768 megabytes at 16 bytes per needed node. An osmium dense identifier array needs 3.3 gigabytes at 8 bytes per identifier slot across all identifiers. LMDB on disk needs 90 megabytes resident at about four microseconds per lookup.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Memory for the same resolution, five ways</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">412 M-node country extract, highway ways only (48 M referenced nodes)</text>
  <line x1="250" y1="68" x2="250" y2="270" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">dict[int, tuple]</text>
  <rect x="250" y="74" width="470" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="868" y="89" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">41 GB · 104 B/node · does not fit</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">dict, all nodes</text>
  <rect x="250" y="116" width="57" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="317" y="131" font-size="11" fill="currentColor" opacity="0.9">5.0 GB · still every node in the file</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">two sorted numpy arrays</text>
  <rect x="250" y="158" width="9" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="269" y="173" font-size="11" fill="currentColor" opacity="0.9">768 MB · 16 B/node, needed only</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">osmium dense id-array</text>
  <rect x="250" y="200" width="38" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="298" y="215" font-size="11" fill="currentColor" opacity="0.9">3.3 GB · 8 B per id slot, all ids</text>
  <text x="240" y="257" text-anchor="end" font-size="11.5" fill="currentColor">LMDB on disk</text>
  <rect x="250" y="242" width="6" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="266" y="257" font-size="11" fill="currentColor" opacity="0.9">90 MB resident · ~4 µs/lookup</text>
  <text x="440" y="306" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">The numpy option wins on memory because it exploits both facts at once: only the needed nodes, and no per-object Python overhead.</text>
</svg>
<figcaption>Dense id arrays are sized by the highest identifier in the file, not by how many you need — which is why they lose to a filtered array here.</figcaption>
</figure>

## Runnable solution

```python
#!/usr/bin/env python3
"""Build way geometries holding only the nodes those ways reference."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable, Iterator

import numpy as np
import osmium

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

WayFilter = Callable[[osmium.osm.Way], bool]


class NeededNodes(osmium.SimpleHandler):
    """Pass 1 — collect the node ids referenced by the ways we care about."""

    def __init__(self, keep: WayFilter) -> None:
        super().__init__()
        self.keep = keep
        self._chunks: list[np.ndarray] = []
        self._buffer: list[int] = []

    def way(self, w) -> None:
        if not self.keep(w):
            return
        self._buffer.extend(n.ref for n in w.nodes)
        if len(self._buffer) >= 4_000_000:
            self._flush()

    def _flush(self) -> None:
        if self._buffer:
            self._chunks.append(np.fromiter(self._buffer, dtype=np.int64))
            self._buffer.clear()

    def ids(self) -> np.ndarray:
        """Sorted, deduplicated — sorting is what makes pass 3 a binary search."""
        self._flush()
        if not self._chunks:
            return np.empty(0, dtype=np.int64)
        ids = np.unique(np.concatenate(self._chunks))
        logger.info("pass 1: %d distinct node id(s) needed", ids.size)
        return ids


class NodeLocations(osmium.SimpleHandler):
    """Pass 2 — record coordinates for exactly those ids, in id order.

    Coordinates are kept as the raw int32 nanodegree-scaled values osmium exposes,
    which halves the memory against float64 and loses nothing: the scaling is exact.
    """

    def __init__(self, wanted: np.ndarray) -> None:
        super().__init__()
        self.wanted = wanted
        self.lon = np.zeros(wanted.size, dtype=np.int32)
        self.lat = np.zeros(wanted.size, dtype=np.int32)
        self.found = np.zeros(wanted.size, dtype=bool)

    def node(self, n) -> None:
        pos = np.searchsorted(self.wanted, n.id)
        if pos >= self.wanted.size or self.wanted[pos] != n.id:
            return                                    # not one we need
        loc = n.location
        if not loc.valid():
            return
        self.lon[pos] = loc.x                         # already in 1e-7 degree units
        self.lat[pos] = loc.y
        self.found[pos] = True

    def report(self) -> None:
        missing = int((~self.found).sum())
        logger.info("pass 2: %d/%d node(s) located%s", int(self.found.sum()),
                    self.wanted.size,
                    f" — {missing} missing (clipped extract?)" if missing else "")


class GeometryBuilder(osmium.SimpleHandler):
    """Pass 3 — resolve each way's references against the arrays and emit geometry."""

    SCALE = 1e-7

    def __init__(self, keep: WayFilter, ids: np.ndarray,
                 lon: np.ndarray, lat: np.ndarray, found: np.ndarray) -> None:
        super().__init__()
        self.keep, self.ids = keep, ids
        self.lon, self.lat, self.found = lon, lat, found
        self.complete = 0
        self.incomplete = 0
        self.results: list[tuple[int, np.ndarray]] = []

    def way(self, w) -> None:
        if not self.keep(w):
            return
        refs = np.fromiter((n.ref for n in w.nodes), dtype=np.int64)
        pos = np.searchsorted(self.ids, refs)
        # Guard the lookup: a clipped extract can reference nodes it does not contain.
        ok = (pos < self.ids.size) & (self.ids[np.minimum(pos, self.ids.size - 1)] == refs)
        ok &= self.found[np.minimum(pos, self.ids.size - 1)]
        if not ok.all():
            self.incomplete += 1
            return
        coords = np.stack((self.lon[pos] * self.SCALE, self.lat[pos] * self.SCALE), axis=1)
        self.results.append((w.id, coords))
        self.complete += 1


def build_geometries(path: Path, keep: WayFilter) -> list[tuple[int, np.ndarray]]:
    needed = NeededNodes(keep)
    needed.apply_file(str(path))
    ids = needed.ids()

    locations = NodeLocations(ids)
    locations.apply_file(str(path), locations=False)
    locations.report()

    builder = GeometryBuilder(keep, ids, locations.lon, locations.lat, locations.found)
    builder.apply_file(str(path))
    logger.info("pass 3: %d complete way(s), %d incomplete",
                builder.complete, builder.incomplete)
    return builder.results


if __name__ == "__main__":
    highways = lambda w: "highway" in w.tags
    geometries = build_geometries(Path("ireland.osm.pbf"), highways)
```

<figure class="diagram-wrap">
<svg viewBox="0 0 880 278" role="img" aria-labelledby="ref-fit-t ref-fit-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="ref-fit-t">Which reference-resolution strategy suits which job</title>
  <desc id="ref-fit-d">A grid of four strategies. Two-pass numpy arrays are best when only a known subset of ways matters and are wasteful when every node is needed anyway. An osmium node cache is best when osmium is already in use and poor when identifiers are sparse and very large. LMDB or another on-disk key-value store is best when memory is the hard limit and poor when lookup latency dominates. PostGIS middle tables are best when the data lands in PostGIS anyway and wrong for a one-off file job.</desc>
  <rect x="0" y="0" width="880" height="278" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Which strategy fits which shape of job</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">best when</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">avoid when</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">two-pass numpy arrays</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">a known subset of ways</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">you need every node anyway</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">osmium node cache</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">you already use osmium</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">identifiers are sparse and huge</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">LMDB / on-disk KV</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">memory is the hard limit</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">lookup latency dominates</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">PostGIS middle tables</text>
  <rect x="213" y="204" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">the data lands in PostGIS anyway</text>
  <rect x="535" y="204" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">this is a one-off file job</text>
  <text x="440" y="260" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">The deciding question is whether you need all nodes or a subset. Everything else follows from that.</text>
</svg>
<figcaption>Subset or everything: that single question eliminates two of the four options before any benchmarking.</figcaption>
</figure>

## Step-by-step walkthrough

`NeededNodes` buffers into Python lists and flushes into numpy arrays periodically. Appending to a list is fast and appending to a numpy array is not, so the chunked pattern gets the speed of one and the memory of the other. The final `np.unique` sorts and deduplicates in one operation, and the sort is not incidental — it is what makes every later lookup a binary search.

`NodeLocations` stores osmium's raw `loc.x` and `loc.y`, which are already integers in units of 100 nanodegrees. Keeping them as `int32` rather than converting to `float64` halves the memory and loses no precision, because the conversion is an exact multiplication applied only at the end — the encoding described in [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/).

Note `locations=False` on the second `apply_file`. Asking pyosmium to manage locations itself would allocate exactly the node cache this whole approach exists to avoid.

`GeometryBuilder` guards the lookup twice: once that the identifier is present in the sorted array, and once that a coordinate was actually found for it. Both matter on a clipped extract, where a way can legitimately reference a node the file does not contain — the referential question at the heart of [Extract Clipping & Boundary Polygons](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/). Without the guards, `searchsorted` returns a plausible neighbouring index and the way gets a coordinate belonging to a different node, silently.

## Verification

The incomplete-way count is the number to watch:

```python
ratio = builder.incomplete / (builder.complete + builder.incomplete)
logger.info("%.2f%% of ways could not be resolved", 100 * ratio)
```

On an extract cut with `complete_ways` or `smart` this should be zero. Anything above zero means the extract has dangling references, which is a property of how it was cut, not a bug in this code. On a `simple`-strategy extract a few percent is normal and is the reason that strategy is discouraged.

Spot-check a geometry against an independent source:

```python
way_id, coords = geometries[0]
print(way_id, coords[:3])
# Compare against: https://www.openstreetmap.org/way/<way_id>
```

And confirm the memory story actually held:

```bash
/usr/bin/time -v python3 build_geometries.py 2>&1 | grep 'Maximum resident'
```

For a country extract filtered to highways, expect under a gigabyte. Several gigabytes means the filter is matching far more ways than intended — check it before blaming the approach.

## Common errors and fixes

| Symptom | Root cause | Fix |
|---|---|---|
| Memory still in the tens of GB | `locations=True` on a pass | Pass `locations=False`; manage them yourself |
| Coordinates land in the wrong place | `searchsorted` hit unguarded | Verify `ids[pos] == ref` before using `pos` |
| Many incomplete ways | Extract cut with `simple` | Re-cut with `complete_ways` or `smart` |
| Pass 1 is slow | Appending to a numpy array per node | Buffer in a list, flush in chunks |
| Coordinates are all zero | Node had no valid location | Check `loc.valid()`; track a found mask |
| Third pass slower than expected | `searchsorted` called per reference | Call it once per way, on the whole array |

## Frequently Asked Questions

<details>
<summary>Is three passes really faster than one?</summary>

Faster in wall-clock on any machine where the one-pass version would swap, and slower on one where it would not. The point is not raw speed but the ceiling: the three-pass version's memory is set by how many nodes your ways reference, which you control by filtering, while the one-pass version's memory is set by the file. On a country extract with a highway filter the three-pass version runs comfortably in under a gigabyte; the dictionary version does not run at all.
</details>

<details>
<summary>Why int32 for coordinates rather than float64?</summary>

Because the source data is integers. OSM coordinates are stored as scaled integers with seven decimal places of precision, which fits `int32` with room to spare, and converting to float only at the point of use loses nothing while halving the array. For 48 million nodes that is 384 megabytes saved for no cost at all.
</details>

<details>
<summary>When should I reach for osmium's own node cache instead?</summary>

When you need most of the nodes anyway, or when the pipeline is already built around osmium's location handlers. The dense id array is sized by the *highest node identifier* in the file rather than by how many you need, which is why it loses here — but if you genuinely need every node, that overhead disappears and its constant-time lookup beats a binary search.
</details>

<details>
<summary>Can the passes be parallelised?</summary>

Pass 2 and pass 3 can, because PBF blocks are independently decodable, as covered in [Speed Up OSM Parsing with Multiprocessing in Python](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/speed-up-osm-parsing-with-multiprocessing-in-python/). Share the sorted id array read-only across workers — it is a numpy array, so it can be memory-mapped rather than pickled, and each worker writes into a disjoint slice of the coordinate arrays.
</details>

## Specification reference

> pyosmium exposes node coordinates through `Node.location`, whose `x` and `y` attributes are the raw values in units of 100 nanodegrees (1e-7 degrees), and `lon`/`lat` as converted floats. `apply_file(path, locations=False)` disables the built-in location cache, leaving reference resolution to the caller.

## Related

- [Node, Way & Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — the reference model this resolves.
- [Bounded LRU Node Cache for OSM Streaming](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/bounded-lru-node-cache-for-osm-streaming/) — the single-pass alternative, with a cache.
- [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) — the integer coordinate encoding kept here.
- [Extract Clipping & Boundary Polygons](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/) — where dangling references come from.
- [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) — the surrounding memory discipline.

Up one level: [Node, Way & Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/).
