---
title: "Using an LMDB Node Store for OSM Parsing"
description: "Hold a planet's worth of node coordinates outside the heap in a memory-mapped key-value store, with the write batching and key layout that make it fast rather than merely possible."
pageTitle: "A Disk-Backed Node Store for OSM Parsing with LMDB"
pageDescription: "Keep node coordinates in an LMDB store so way assembly works within a fixed memory budget: fixed-width keys, batched sorted writes, a read transaction per pass, and honest sizing."
slug: using-an-lmdb-node-store-for-osm-parsing
type: article
breadcrumb: "LMDB Node Store"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Using an LMDB Node Store for OSM Parsing

Building way geometry needs the coordinates of every node a way references, and a continent has more nodes than a dictionary can hold. A memory-mapped key-value store moves that map to disk without moving it out of reach.

## Prerequisites

- [ ] Python 3.10+ with `lmdb` and a PBF reader such as `pyosmium`.
- [ ] Fast local disk; a memory-mapped store on a network volume performs badly.
- [ ] The memory strategies in [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/).
- [ ] Disk space of roughly twelve bytes per node plus overhead, before compression.
- [ ] A two-pass structure, since nodes must be stored before ways are assembled.

## Conceptual minimum

The node store answers one question, hundreds of millions of times: **given a node identifier, what is its coordinate?** Everything about the design follows from that access pattern.

**The keys are dense integers.** Node identifiers are assigned sequentially across the planet, so a store keyed on them has excellent locality when reads follow way order — the nodes of one way were usually created together.

**The values are tiny and fixed-width.** Two 32-bit integers in nanodegree-scaled form hold a coordinate exactly, in eight bytes. A variable-width encoding saves nothing and costs a length.

**Writes must be batched and sorted.** Committing one transaction per node is orders of magnitude slower than committing one per hundred thousand, and writing in ascending key order lets the store append rather than split pages.

**Reads happen inside one long transaction.** Opening a read transaction per lookup costs more than the lookup; a single transaction spanning the way pass is both faster and gives a consistent view.

The alternative to a store is a flat array indexed by identifier, which is faster still and sized by the *highest* identifier rather than by the node count — tens of gigabytes of address space even for a small country. Memory mapping makes both viable; the store is the choice when the identifier space is sparse relative to what you hold.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="lns1-t lns1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="lns1-t">Three node-store strategies compared on the properties that decide between them</title>
  <desc id="lns1-d">A grid of four properties against three strategies. An in-memory dictionary is fastest to read, sized by the number of nodes held, limited by available memory, and fails outright on a continental extract. A memory-mapped array is nearly as fast, sized by the highest node identifier rather than the count, works for any region, and wastes space when the identifier space is sparse. A key-value store is slightly slower per lookup, sized by the nodes actually stored, works for any region, and is the right choice when only a subset of nodes is retained.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three stores, chosen by what you actually keep</text>
  <rect x="206" y="48" width="216" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="314" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Dictionary</text>
  <rect x="422" y="48" width="216" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="530" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Mapped array</text>
  <rect x="638" y="48" width="216" height="30" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="746" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Key-value store</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Read speed</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="314" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">fastest</text>
  <text x="530" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">near fastest</text>
  <text x="746" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">slightly slower</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Sized by</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="314" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">node count</text>
  <text x="530" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">highest id</text>
  <text x="746" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">nodes stored</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Continental</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="314" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">no</text>
  <text x="530" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">yes</text>
  <text x="746" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">yes</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Sparse subset</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="314" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">fine</text>
  <text x="530" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">wasteful</text>
  <text x="746" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">ideal</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The bottom row is the deciding one: keeping every node favours the array, keeping a filtered subset favours the store.</text>
</svg>
<figcaption>All three answer the same question; they differ entirely in what they charge for the identifiers you never use.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
import struct
from pathlib import Path

import lmdb

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.parse.nodestore")

# Fixed-width, big-endian keys sort in numeric order, which is what makes
# batched ascending writes cheap for the store's page layout.
KEY = struct.Struct(">Q")
VALUE = struct.Struct(">ii")          # lat, lon in nanodegree-scaled ints
NANO = 10_000_000                     # 1e-7 degree resolution: ~1 cm
BATCH = 100_000
MAP_SIZE = 64 * 1024 ** 3             # address space, not resident memory


class NodeStore:
    def __init__(self, path: Path, readonly: bool = False) -> None:
        self.env = lmdb.open(
            str(path), map_size=MAP_SIZE, subdir=True, readonly=readonly,
            # Durability is not needed: the store is a rebuildable cache, and
            # disabling the sync is worth several times the write throughput.
            sync=False, metasync=False, writemap=True, max_dbs=1)
        self._pending: list[tuple[bytes, bytes]] = []

    def put(self, node_id: int, lat: float, lon: float) -> None:
        self._pending.append((
            KEY.pack(node_id),
            VALUE.pack(int(round(lat * NANO)), int(round(lon * NANO)))))
        if len(self._pending) >= BATCH:
            self.flush()

    def flush(self) -> None:
        if not self._pending:
            return
        # Sorted, appended: the store can extend pages instead of splitting them.
        self._pending.sort()
        with self.env.begin(write=True) as txn:
            cursor = txn.cursor()
            cursor.putmulti(self._pending, dupdata=False, overwrite=True,
                            append=True)
        self._pending.clear()

    def reader(self):
        """One long read transaction for a whole pass, not one per lookup."""
        return self.env.begin(write=False, buffers=True)

    @staticmethod
    def get(txn, node_id: int) -> tuple[float, float] | None:
        raw = txn.get(KEY.pack(node_id))
        if raw is None:
            return None
        lat, lon = VALUE.unpack(bytes(raw))
        return lat / NANO, lon / NANO

    def stats(self) -> dict[str, int]:
        with self.env.begin() as txn:
            info = txn.stat()
        logger.info("%d entr(ies), depth %d, %d leaf page(s)",
                    info["entries"], info["depth"], info["leaf_pages"])
        return info

    def close(self) -> None:
        self.flush()
        self.env.close()


def build_store(pbf_path: Path, store_path: Path, keep) -> NodeStore:
    """Pass one: write every node we will need. `keep` filters the subset."""
    import osmium

    store = NodeStore(store_path)

    class Collector(osmium.SimpleHandler):
        def node(self, n):
            if keep(n):
                store.put(n.id, n.location.lat, n.location.lon)

    Collector().apply_file(str(pbf_path))
    store.flush()
    store.stats()
    return store


def assemble_ways(pbf_path: Path, store: NodeStore) -> int:
    """Pass two: resolve way references against the store."""
    import osmium

    built = missing = 0

    with store.reader() as txn:
        class Builder(osmium.SimpleHandler):
            def way(self, w):
                nonlocal built, missing
                coords = []
                for ref in w.nodes:
                    point = NodeStore.get(txn, ref.ref)
                    if point is None:
                        missing += 1
                        return          # incomplete way: do not half-build it
                    coords.append(point)
                if len(coords) >= 2:
                    built += 1

        Builder().apply_file(str(pbf_path))

    logger.info("built %d way(s); %d skipped for missing nodes", built, missing)
    return built


if __name__ == "__main__":
    logger.info("pass one writes nodes, pass two resolves ways against them")
```

## Step-by-step walkthrough

1. **Use fixed-width big-endian keys.** They sort in numeric order, which is what makes an append-mode batch write cheap; a variable-width or little-endian key destroys that ordering.
2. **Store coordinates as scaled integers.** Nanodegree-scaled 32-bit integers hold OSM's full precision in eight bytes, against sixteen for two doubles, and the conversion is exact in both directions.
3. **Batch the writes.** One transaction per node is catastrophically slow; a hundred thousand per transaction amortises the commit to nothing.
4. **Sort each batch before writing.** Ascending keys let the store append to the end of its page layout rather than splitting pages in the middle, which is several times faster.
5. **Disable synchronous durability.** The store is a rebuildable cache, so surviving a power failure buys nothing and costs a large fraction of the write throughput.
6. **Open one read transaction per pass.** Transaction setup dominates a lookup that is otherwise a pointer dereference into mapped memory.
7. **Refuse to half-build a way.** A way with a missing node reference is incomplete, and emitting the partial geometry produces a road that stops in the middle of nowhere.
8. **Size the map generously.** The map size is address space rather than resident memory, so over-reserving costs nothing while under-reserving fails mid-run.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 248" role="img" aria-labelledby="lns2-t lns2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="lns2-t">Node store write throughput under four configurations</title>
  <desc id="lns2-d">Four configurations measured writing the same node set. Committing one transaction per node is the baseline and is catastrophically slow. Batching a hundred thousand nodes per transaction is orders of magnitude faster. Sorting each batch before writing gains a further substantial factor by allowing appends instead of page splits. Disabling synchronous durability, which is safe for a rebuildable cache, gains more again.</desc>
  <rect x="0" y="0" width="880" height="248" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Write throughput, four configurations</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">One transaction per node</text>
  <rect x="276" y="60" width="6" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">baseline</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">Batched, unsorted</text>
  <rect x="276" y="100" width="96" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 240x</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">Batched and sorted</text>
  <rect x="276" y="140" width="231" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 580x</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">Plus sync disabled</text>
  <rect x="276" y="180" width="458" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 1150x</text>
  <text x="868" y="232" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Each step is a few lines, and together they are the difference between a store build measured in minutes and one measured in days.</text>
</svg>
<figcaption>The first configuration is what a naive implementation does, and it is why people conclude disk-backed stores are unusable.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="lns3-t lns3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="lns3-t">The two passes and what each one holds in memory</title>
  <desc id="lns3-d">Four stages across two passes. The first pass streams nodes from the file and accumulates a write batch, so resident memory stays at the batch size regardless of how many nodes exist. The flush stage sorts and commits each batch, after which nothing from it is retained. The second pass opens one read transaction and streams ways, resolving each reference into the mapped store. The assemble stage builds geometry for one way at a time and releases it, so memory again stays flat.</desc>
  <defs><marker id="lns3-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Two passes, and neither one grows</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">stream nodes</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">accumulate a batch</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">memory is the batch</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#lns3-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">flush</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">sort and commit</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">nothing retained</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#lns3-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">stream ways</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">one read transaction</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">resolve per reference</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#lns3-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">assemble</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">one way at a time</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">released immediately</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Peak memory is the write batch in the first pass and one way's geometry in the second, neither of which depends on the file size.</text>
</svg>
<figcaption>That flatness is the entire point: the store turns an unbounded requirement into a configurable constant.</figcaption>
</figure>

## Verification

- **A known node round-trips.** Store a coordinate, read it back, and confirm it matches to full precision.
- **Entry count matches the filter.** The store's entry count should equal the number of nodes the filter kept.
- **Way assembly finds its nodes.** A low missing count is expected at an extract's boundary and a high one means the filter dropped nodes that ways reference.
- **Write throughput is sane.** Below a hundred thousand nodes per second on local disk, one of the four configuration steps is missing.
- **Memory stays flat.** Resident memory should stay near the batch size regardless of how many nodes are stored.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Store build takes days | One transaction per node | Batch tens of thousands per transaction |
| Batched writes still slow | Keys written out of order | Sort each batch before writing |
| Throughput limited by disk sync | Durability enabled on a cache | Disable synchronous commits for a rebuildable store |
| Run fails part way | Map size too small | Reserve generous address space; it is not resident memory |
| Lookups slower than expected | A transaction opened per lookup | Open one read transaction for the whole pass |
| Ways stop in the middle of nowhere | Partial geometry emitted | Skip a way with any missing node reference |
| Store far larger than expected | Coordinates stored as doubles | Store nanodegree-scaled integers |

## Specification reference

> LMDB is a memory-mapped key-value store providing a read-optimised B+ tree with multi-version concurrency, where the map size reserves address space rather than resident memory and readers operate inside long-lived transactions without blocking writers. Keys are compared as byte strings, so fixed-width big-endian integers sort numerically. See the [LMDB documentation](http://www.lmdb.tech/doc/) for the transaction model and the append-mode write optimisation.

## Frequently Asked Questions

<details>
<summary>Why not just use a flat memory-mapped array?</summary>

Often you should — it is faster and simpler. The array is indexed directly by node identifier, so it is sized by the *highest* identifier rather than by how many nodes you keep, which means tens of gigabytes of address space even for a small country. That is fine when you keep every node and wasteful when you keep a filtered subset, which is exactly when a key-value store wins.
</details>

<details>
<summary>Is disabling durability safe?</summary>

For this use, yes. The store is derived entirely from a PBF file that still exists, so a power failure means rebuilding it rather than losing anything. Synchronous commits cost a large fraction of write throughput for a guarantee that is worth nothing here. It would obviously be the wrong choice for a store holding data that cannot be regenerated.
</details>

<details>
<summary>Why does sorting each batch matter so much?</summary>

Because ascending keys let the store append to the end of its page layout rather than inserting into the middle. An insert in the middle can split a page, which rewrites it and may cascade upward; an append extends the last page. Sorting a batch of a hundred thousand keys costs milliseconds and saves a large multiple of that in page management.
</details>

<details>
<summary>What should happen to a way with a missing node?</summary>

Skip it entirely rather than building the part you can. A way at an extract's boundary legitimately references nodes outside the file, and emitting the portion that resolves produces a road that stops abruptly in open country — geometry that looks real and is not. Counting the skips tells you whether the missing references are boundary effects or a filter that dropped too much.
</details>

## Related

- [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) — the parent topic and the wider memory strategies.
- [Profiling Peak Memory of an OSM Parser](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/profiling-peak-memory-of-an-osm-parser/) — measuring whether the store actually bounded memory.
- [Bounded LRU Node Cache for OSM Streaming](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/bounded-lru-node-cache-for-osm-streaming/) — the in-memory alternative for a bounded working set.
- [Resolving Way Node References Without a Full Node Cache](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/resolving-way-node-references-without-a-full-node-cache/) — the problem this store solves.
- [Running Planetiler on a Regional Extract](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/planetiler-and-tilemaker-workflows/running-planetiler-on-a-regional-extract/) — a tool making the same storage choice internally.

Up one level: [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Using an LMDB Node Store for OSM Parsing",
  "description": "Hold a planet's worth of node coordinates outside the heap in a memory-mapped key-value store, with the write batching and key layout that make it fast rather than merely possible.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Parsing & Tag Normalization Workflows",
  "about": ["LMDB", "node location storage", "batched writes"]
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
    { "@type": "ListItem", "position": 4, "name": "Using an LMDB Node Store for OSM Parsing", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/using-an-lmdb-node-store-for-osm-parsing/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Back an OSM node store with a memory-mapped key-value store",
  "description": "Use fixed-width big-endian keys and scaled integer coordinates, batch and sort writes for append-mode commits, disable durability for a rebuildable cache, and read inside one long transaction per pass.",
  "step": [
    { "@type": "HowToStep", "name": "Use fixed-width big-endian keys", "text": "Pack node identifiers so they sort numerically as byte strings, which is what enables append-mode writes." },
    { "@type": "HowToStep", "name": "Store scaled integer coordinates", "text": "Keep latitude and longitude as nanodegree-scaled integers, holding full precision in half the bytes of doubles." },
    { "@type": "HowToStep", "name": "Batch the writes", "text": "Accumulate tens of thousands of entries per transaction rather than committing per node." },
    { "@type": "HowToStep", "name": "Sort each batch", "text": "Write keys in ascending order so the store appends pages instead of splitting them." },
    { "@type": "HowToStep", "name": "Disable durability", "text": "Turn off synchronous commits, since the store is derived from a file that still exists." },
    { "@type": "HowToStep", "name": "Read in one transaction", "text": "Open a single read transaction for the whole assembly pass rather than one per lookup." },
    { "@type": "HowToStep", "name": "Skip incomplete ways", "text": "Refuse to emit partial geometry when a node reference cannot be resolved, and count the skips." }
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
      "name": "Why not use a flat memory-mapped array for OSM node storage?",
      "acceptedAnswer": { "@type": "Answer", "text": "Often you should — it is faster and simpler. The array is indexed directly by node identifier, so it is sized by the highest identifier rather than by how many nodes you keep, meaning tens of gigabytes of address space even for a small country. That is fine when you keep every node and wasteful for a filtered subset." }
    },
    {
      "@type": "Question",
      "name": "Is disabling durability safe for a node store?",
      "acceptedAnswer": { "@type": "Answer", "text": "For this use, yes. The store is derived entirely from a PBF file that still exists, so a power failure means rebuilding rather than losing anything. Synchronous commits cost a large fraction of write throughput for a guarantee worth nothing here." }
    },
    {
      "@type": "Question",
      "name": "Why does sorting each write batch matter so much?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because ascending keys let the store append to the end of its page layout rather than inserting into the middle. An insert can split a page, which rewrites it and may cascade upward; an append extends the last page. Sorting costs milliseconds and saves a large multiple in page management." }
    },
    {
      "@type": "Question",
      "name": "What should happen to an OSM way with a missing node?",
      "acceptedAnswer": { "@type": "Answer", "text": "Skip it entirely rather than building the part you can. A way at an extract's boundary legitimately references nodes outside the file, and emitting the resolvable portion produces a road that stops abruptly in open country. Counting the skips tells you whether the causes are boundary effects or an over-aggressive filter." }
    }
  ]
}
</script>
