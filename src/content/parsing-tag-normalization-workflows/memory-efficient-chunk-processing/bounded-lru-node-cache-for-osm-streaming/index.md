---
title: "A Bounded LRU Node Cache for OSM Streaming"
description: "Cap the node-location cache that resolves OSM way geometry with an OrderedDict-backed LRU, so a planet-scale stream stays under a fixed memory ceiling while evicting the least-recently-used coordinates."
pageTitle: "Bounded LRU Node Cache for OSM Way Resolution"
pageDescription: "Build an OrderedDict LRU cache of OSM node coordinates keyed by node id, with move_to_end and popitem eviction, hit/miss counters, and the PBF id-ordering locality assumption that makes it work."
slug: bounded-lru-node-cache-for-osm-streaming
type: article
breadcrumb: "Bounded LRU Node Cache"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# A Bounded LRU Node Cache for OSM Streaming

Resolve way geometry during a streaming OSM parse while holding at most `N` node coordinates in RAM, evicting the least-recently-used `node_id → (lon, lat)` entry each time the cache is full, so a planet-scale pass never lets the location store grow without limit.

## Prerequisites

Verify each item before running the cache below; a wrong assumption about primitive ordering is the usual reason a small cap produces a catastrophic miss rate.

- [ ] Python 3.10+ for the `dict`/`tuple` type hints and structural syntax used here.
- [ ] `pyosmium` ≥ 3.6 installed (`pip install osmium`) — the handler callbacks and `osm.Node`/`osm.Way` types are assumed.
- [ ] A `.osm.pbf` extract whose primitives are in the canonical **nodes-then-ways** id order (the default for planet and Geofabrik files).
- [ ] Familiarity with the windowing discipline in [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) — this cache is the sibling lever that bounds the *location* store rather than the record buffer.
- [ ] The reference-resolution rule from the [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/): a way carries only integer node ids, so geometry is a deferred join.
- [ ] Optional: `sys` (standard library) for a rough per-entry footprint estimate during tuning.

## Conceptual minimum

A way in OpenStreetMap stores no coordinates of its own — it is an ordered list of node ids, and turning it into a line or polygon means looking each id up in a table of previously seen node positions. The library-managed stores that pyosmium offers (`flex_mem`, `sparse_file_array`, `dense_file_array`) all solve this by keeping *every* node's location addressable; that is exactly what you want for random access, but it also means the store's size is a function of the extract, not of your RAM budget. When you are willing to trade a controlled miss rate for a hard memory ceiling, a **bounded least-recently-used (LRU) cache** inverts that relationship: you fix the number of resident coordinates, and the cache evicts whichever id has gone longest without a lookup.

The technique only pays off because of a locality property of the PBF format. Nodes and ways are serialized in ascending id blocks, and a way's member nodes were typically created together, so their ids cluster — which means that when the parser reaches a way, the coordinates it needs were usually seen a short time ago and are still resident. This is the same block-locality that the [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) describes for decode framing, reused here as a cache-hit assumption. A Python [`collections.OrderedDict`](https://docs.python.org/3/library/collections.html#collections.OrderedDict) makes the eviction O(1): `move_to_end(key)` promotes an entry to the most-recently-used position on every hit, and `popitem(last=False)` drops the least-recently-used entry from the front the moment the cap is exceeded. The cost you accept is the *miss*: a node evicted before its way arrives — common for long ways or interleaved editing history — forces you to either skip that way or fall back to a full store, so the cache is a deliberate trade against pyosmium's own `sparse_file_array`, which never misses but never bounds itself either.

<svg viewBox="0 0 780 330" role="img" aria-label="An ordered node-coordinate cache drawn as five slots from least-recently-used on the left to most-recently-used on the right. A get for node id n7 scores a hit and move_to_end promotes it to the right end. A put of new node n99 arrives at the right while the cache is at its size cap, so popitem with last equals false evicts the least-recently-used entry n42 from the left end." xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:780px;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>OrderedDict LRU node cache: promote on hit, evict oldest on put under a cap</title>
  <desc>Five cache slots in a row ordered least-recently-used on the left to most-recently-used on the right, each holding a node id and its lon/lat. A get(n7) is a hit and move_to_end promotes n7 to the most-recently-used end. A put(n99) at the size cap appends the new entry at the right and popitem(last=False) evicts n42, the least-recently-used entry, off the left end.</desc>
  <defs>
    <marker id="lruArr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker>
  </defs>
  <text x="390" y="24" text-anchor="middle" font-size="14" fill="currentColor" font-weight="700">Bounded LRU cache of node coordinates (cap = 5)</text>
  <!-- direction labels -->
  <text x="112" y="70" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">LRU end</text>
  <text x="112" y="84" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.7">evict next</text>
  <text x="668" y="70" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">MRU end</text>
  <text x="668" y="84" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.7">newest</text>
  <!-- five slots -->
  <g font-size="12" text-anchor="middle" fill="currentColor">
    <rect x="70" y="100" width="84" height="58" rx="4" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-width="1.5"/>
    <text x="112" y="126">n42</text>
    <text x="112" y="144" font-size="9.5" opacity="0.72">13.40, 52.51</text>
    <rect x="162" y="100" width="84" height="58" rx="4" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="204" y="126">n88</text>
    <text x="204" y="144" font-size="9.5" opacity="0.72">13.41, 52.52</text>
    <rect x="254" y="100" width="84" height="58" rx="4" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="296" y="126">n7</text>
    <text x="296" y="144" font-size="9.5" opacity="0.72">13.39, 52.50</text>
    <rect x="346" y="100" width="84" height="58" rx="4" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="388" y="126">n13</text>
    <text x="388" y="144" font-size="9.5" opacity="0.72">13.42, 52.49</text>
    <rect x="438" y="100" width="84" height="58" rx="4" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="480" y="126">n5</text>
    <text x="480" y="144" font-size="9.5" opacity="0.72">13.38, 52.53</text>
    <!-- incoming new entry -->
    <rect x="600" y="100" width="84" height="58" rx="4" fill="currentColor" fill-opacity="0.10" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 3"/>
    <text x="642" y="126">n99</text>
    <text x="642" y="144" font-size="9.5" opacity="0.72">put · new</text>
  </g>
  <!-- get(n7) hit -> move_to_end -->
  <path d="M296,100 C296,58 620,58 640,96" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#lruArr)"/>
  <text x="470" y="52" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">get(n7) HIT &#8594; move_to_end</text>
  <!-- put(n99) enters at MRU -->
  <line x1="600" y1="129" x2="524" y2="129" stroke="currentColor" stroke-width="1.5" marker-end="url(#lruArr)"/>
  <!-- eviction of n42 -->
  <line x1="112" y1="158" x2="112" y2="214" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 3" marker-end="url(#lruArr)"/>
  <text x="112" y="234" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.9">popitem(last=False)</text>
  <text x="112" y="250" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">evicts n42 (LRU)</text>
  <!-- caption -->
  <text x="450" y="238" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">over cap &#8594; drop the front, append at the back</text>
  <text x="450" y="256" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">resident entries never exceed the cap, so memory is fixed</text>
</svg>

## Runnable solution

The `NodeCache` below wraps an `OrderedDict` and exposes just the two operations a resolver needs: `put(node_id, lon, lat)` when a node callback fires, and `get(node_id)` when a way needs a member's coordinate. Every access reorders the entry, and a full cache evicts before it inserts, so the resident set is capped at `maxsize`. Hit and miss counters make the locality assumption measurable rather than a matter of faith.

```python
from __future__ import annotations

import logging
from collections import OrderedDict

import osmium

logger = logging.getLogger(__name__)

Coord = tuple[float, float]


class NodeCache:
    """A fixed-capacity LRU cache mapping node id -> (lon, lat).

    Backed by an OrderedDict: a lookup promotes its key to the most-recently
    used end via move_to_end, and an insertion past ``maxsize`` evicts the
    least-recently used key with popitem(last=False). Peak entries never
    exceed ``maxsize``, so the location store's memory is bounded regardless
    of how many nodes the extract contains.
    """

    def __init__(self, maxsize: int = 2_000_000) -> None:
        if maxsize < 1:
            raise ValueError("maxsize must be >= 1")
        self.maxsize = maxsize
        self._store: OrderedDict[int, Coord] = OrderedDict()
        self.hits = 0
        self.misses = 0

    def put(self, node_id: int, lon: float, lat: float) -> None:
        if node_id in self._store:
            self._store.move_to_end(node_id)  # refresh recency
        self._store[node_id] = (lon, lat)
        if len(self._store) > self.maxsize:
            evicted_id, _ = self._store.popitem(last=False)  # drop the LRU entry
            logger.debug("evicted node %d (cache full)", evicted_id)

    def get(self, node_id: int) -> Coord | None:
        coord = self._store.get(node_id)
        if coord is None:
            self.misses += 1
            return None
        self._store.move_to_end(node_id)  # this access is now most-recent
        self.hits += 1
        return coord

    @property
    def hit_rate(self) -> float:
        total = self.hits + self.misses
        return self.hits / total if total else 0.0

    def __len__(self) -> int:
        return len(self._store)


class WayResolver(osmium.SimpleHandler):
    """Resolve way geometry from a bounded node cache in a single pass.

    Nodes populate the cache as they stream past; each way then reads its
    member ids back out. A way whose nodes were already evicted is counted
    as unresolved rather than crashing the stream.
    """

    def __init__(self, maxsize: int = 2_000_000) -> None:
        super().__init__()  # required by the pyosmium C++ binding
        self.cache = NodeCache(maxsize=maxsize)
        self.resolved_ways = 0
        self.unresolved_ways = 0

    def node(self, n: osmium.osm.Node) -> None:
        if n.location.valid():
            self.cache.put(n.id, n.location.lon, n.location.lat)

    def way(self, w: osmium.osm.Way) -> None:
        coords: list[Coord] = []
        for nr in w.nodes:
            coord = self.cache.get(nr.ref)
            if coord is None:
                self.unresolved_ways += 1
                return  # a member was evicted; skip this way
            coords.append(coord)
        self.resolved_ways += 1
        # coords now holds the way geometry as (lon, lat) pairs.

    def report(self) -> None:
        logger.info(
            "resolved=%d unresolved=%d cache_len=%d hit_rate=%.4f",
            self.resolved_ways, self.unresolved_ways,
            len(self.cache), self.cache.hit_rate,
        )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    resolver = WayResolver(maxsize=2_000_000)
    # No locations=True: the cache IS the location store here.
    resolver.apply_file("extract.osm.pbf")
    resolver.report()
```

## Step-by-step walkthrough

1. **Cap enforced on insert, not on read** — `put` appends first, then checks `len(self._store) > self.maxsize` and evicts. Doing the eviction after the insert keeps the newest entry safe even in the degenerate `maxsize == 1` case.
2. **Recency refresh on both paths** — `move_to_end` runs inside `put` when a key already exists *and* inside every successful `get`, so an id that is looked up repeatedly stays resident even if it is old by insertion order.
3. **`popitem(last=False)` is the LRU eviction** — with `last=False` the *first* (oldest-touched) item is removed; the default `last=True` would pop the most-recent entry and turn the structure into a stack, which is the opposite of what you want.
4. **Misses are data, not errors** — `get` returns `None` and increments a counter rather than raising, so the way handler decides the policy (here: skip). This keeps the stream running across the inevitable boundary and long-way misses.
5. **No `locations=True` on `apply_file`** — the whole point is that this cache replaces pyosmium's internal store, so you parse without the library location index and let the `node()` callback feed the cache directly.
6. **`hit_rate` turns the locality bet into a metric** — read it after the run: a healthy nodes-then-ways extract should land well above 0.9 with a few-million-entry cap. If it does not, the extract's ordering, not your code, is the problem.

## Verification

Confirm the cache behaves and that the trade is paying off before you trust the resolved geometry:

- **Resident set stays capped.** Assert `len(resolver.cache) <= resolver.cache.maxsize` after the run; it can equal the cap but must never exceed it.
- **Hit rate is high on well-ordered input.** `resolver.cache.hit_rate` should print above ~0.90 for a standard Geofabrik extract; a value near 0.5 means the file is not in nodes-then-ways id order.
- **Unresolved count is small and explained.** `unresolved_ways` should be a small fraction — dominated by ways clipped at the extract boundary — not a large share, which would signal an undersized cap.
- **Eviction actually fires.** Run with a deliberately tiny `maxsize` (say 1000) and watch the `evicted node` debug lines appear, proving `popitem` is reached.
- **Determinism.** Two runs over the same file must report identical `resolved`/`unresolved` counts, since the ordering and cap fully determine eviction.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Hit rate collapses to ~0.5 | Extract not in nodes-then-ways id order | Sort with `osmium sort` before parsing, or use a two-pass resolver. |
| Memory still grows unbounded | Forgot the `len > maxsize` check, or set `maxsize` too high | Keep the eviction branch; size `maxsize` from RAM ÷ per-entry bytes. |
| Every way is unresolved | Parsed with `locations=True`, so `nr.ref` coords come from pyosmium, not the cache | Drop `locations=True`; let `node()` populate the cache. |
| `popitem` pops the newest entry | Called with default `last=True` | Use `popitem(last=False)` to evict the LRU end. |
| Stale coordinate returned after a node move | History file re-versions a node id | Cache only current-version extracts, or key on `(id, version)`. |
| `KeyError` on `move_to_end` | Called on a key already evicted between check and use | Guard with the `get`/`in` check as shown; never assume residency. |

## Specification reference

> The eviction order is defined by `collections.OrderedDict`: "The `popitem()` method for ordered dictionaries returns and removes a (key, value) pair. The pairs are returned in LIFO order if `last` is true or FIFO order if false," and "`move_to_end()` moves an existing key to either end of an ordered dictionary." See the [Python `collections.OrderedDict` documentation](https://docs.python.org/3/library/collections.html#collections.OrderedDict). The standard library also ships a ready-made general LRU in [`functools.lru_cache`](https://docs.python.org/3/library/functools.html#functools.lru_cache); it is ideal for pure-function memoization but exposes no manual `put` for a streaming callback and no bounded-store introspection, which is why an explicit `OrderedDict` is the right primitive for resolving OSM way geometry.

## Frequently Asked Questions

<details>
<summary>How large should maxsize be?</summary>

Derive it from RAM, not intuition. Each resident entry is roughly the `int` key plus a two-`float` tuple plus dict/OrderedDict overhead — on CPython 3.10 that lands near 100–150 bytes per entry in practice. A cap of two million entries therefore costs a few hundred megabytes, which comfortably resolves a country-scale extract at a high hit rate. Measure a sample with `sys.getsizeof` on a populated store and divide your budget by the observed per-entry cost.
</details>

<details>
<summary>When is pyosmium's own location store the better choice?</summary>

When you cannot tolerate any miss. A `sparse_file_array` or `dense_file_array` store keeps every node addressable, so no way is ever dropped for want of a coordinate — at the cost of a size that scales with the extract. Prefer the LRU when a fixed memory ceiling matters more than resolving the last few percent of long or boundary-clipped ways; prefer the library store when completeness is non-negotiable.
</details>

<details>
<summary>Why does the cache miss on long ways even with a big cap?</summary>

A way's first member node may have been read millions of primitives ago, and if that many distinct nodes were touched since, the id has been evicted by newer arrivals. Very long ways (coastlines, administrative boundaries) are the classic offenders. Raising `maxsize` shrinks the miss set; sorting the input so members cluster tightly helps more.
</details>

<details>
<summary>Can I reuse functools.lru_cache instead of writing this?</summary>

Only for pure functions. `functools.lru_cache` decorates a callable and keys on its arguments, so it fits memoizing a computed lookup, but it gives you no way to imperatively insert a coordinate from a streaming `node()` callback and no clean handle on the resident set for tuning. For a location store fed by parser events, the explicit `OrderedDict` is the correct tool.
</details>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "A Bounded LRU Node Cache for OSM Streaming",
  "description": "Cap the node-location cache that resolves OSM way geometry with an OrderedDict-backed LRU, so a planet-scale stream stays under a fixed memory ceiling while evicting the least-recently-used coordinates.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "Parsing & Tag Normalization Workflows",
  "about": ["LRU cache", "OSM node location store", "streaming way resolution"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Parsing & Tag Normalization Workflows", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/" },
    { "@type": "ListItem", "position": 3, "name": "Memory-Efficient Chunk Processing", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/" },
    { "@type": "ListItem", "position": 4, "name": "Bounded LRU Node Cache", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/bounded-lru-node-cache-for-osm-streaming/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Build a bounded LRU node cache for OSM way resolution",
  "description": "Cap the node-location store with an OrderedDict LRU, promote entries on access, evict the least-recently-used coordinate when full, and measure the hit rate against the PBF id-ordering locality assumption.",
  "step": [
    { "@type": "HowToStep", "name": "Wrap an OrderedDict", "text": "Back the cache with an OrderedDict keyed by node id mapping to a (lon, lat) tuple, and record hit and miss counters." },
    { "@type": "HowToStep", "name": "Promote on access", "text": "Call move_to_end on every put of an existing key and every successful get so the most recently used coordinate stays resident." },
    { "@type": "HowToStep", "name": "Evict when full", "text": "After inserting, if the length exceeds maxsize call popitem with last equals false to drop the least-recently-used entry from the front." },
    { "@type": "HowToStep", "name": "Feed from the node callback", "text": "Parse without locations=True and let the node() handler populate the cache so it replaces pyosmium's internal location store." },
    { "@type": "HowToStep", "name": "Resolve ways and count misses", "text": "In the way() callback look up each member id, skip and count ways whose members were evicted, and read hit_rate after the run to confirm the locality assumption held." }
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
      "name": "How large should maxsize be?",
      "acceptedAnswer": { "@type": "Answer", "text": "Derive it from RAM. Each resident entry is roughly an int key plus a two-float tuple plus dict overhead, near 100 to 150 bytes per entry on CPython 3.10. A cap of two million entries costs a few hundred megabytes and resolves a country-scale extract at a high hit rate. Measure a populated store with sys.getsizeof and divide your budget by the observed per-entry cost." }
    },
    {
      "@type": "Question",
      "name": "When is pyosmium's own location store the better choice?",
      "acceptedAnswer": { "@type": "Answer", "text": "When you cannot tolerate any miss. A sparse_file_array or dense_file_array store keeps every node addressable so no way is dropped for a missing coordinate, at the cost of a size that scales with the extract. Prefer the LRU when a fixed memory ceiling matters more than resolving the last few percent of long or boundary ways, and the library store when completeness is required." }
    },
    {
      "@type": "Question",
      "name": "Why does the cache miss on long ways even with a big cap?",
      "acceptedAnswer": { "@type": "Answer", "text": "A way's first member may have been read millions of primitives ago, and if that many distinct nodes were touched since, the id has been evicted by newer arrivals. Very long ways such as coastlines and administrative boundaries are the classic offenders. Raising maxsize shrinks the miss set, and sorting the input so members cluster tightly helps more." }
    },
    {
      "@type": "Question",
      "name": "Can I reuse functools.lru_cache instead of writing this?",
      "acceptedAnswer": { "@type": "Answer", "text": "Only for pure functions. functools.lru_cache decorates a callable and keys on its arguments, so it fits memoizing a computed lookup, but it gives no way to imperatively insert a coordinate from a streaming node callback and no clean handle on the resident set for tuning. For a location store fed by parser events, an explicit OrderedDict is the correct tool." }
    }
  ]
}
</script>

## Related

- [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) — the parent stage; this cache bounds the location store while that page bounds the record buffer.
- [Sizing PBF Chunk Batches to a Memory Budget](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/sizing-pbf-chunk-batches-to-a-memory-budget/) — the companion lever for turning a RAM budget into a concrete batch size.
- [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — why way geometry is a deferred join over node ids in the first place.
- [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) — the block and id ordering that makes the cache-hit assumption hold.
- [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/) — where resolved geometries go once the cache has reconstructed them.
- [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/) — parallel ingestion for when throughput, not location memory, is the limit.

Up one level: [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/).
