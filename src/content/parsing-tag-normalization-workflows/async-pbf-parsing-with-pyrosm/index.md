---
title: "Async PBF Parsing with Pyrosm"
description: "Wrap synchronous Pyrosm PBF reads in an asyncio producer-consumer with ProcessPoolExecutor to overlap disk I/O and tag normalization at bounded memory."
pageDescription: "Async PBF parsing with Pyrosm: ProcessPoolExecutor workers, bounded asyncio queues, Arrow tag normalization, and back-pressure for large OSM extracts."
slug: async-pbf-parsing-with-pyrosm
type: guide
breadcrumb: "Async PBF Parsing"
datePublished: 2025-09-12
dateModified: 2026-06-26
date: 2026-06-26
---
# Async PBF Parsing with Pyrosm

OpenStreetMap PBF extracts routinely exceed multi-gigabyte thresholds, which turns a single synchronous parse into the longest pole in any production spatial ETL pipeline. When one thread reads a 4 GB country extract end to end before a single feature is normalized, the CPU sits idle during disk reads and the disk sits idle during tag validation — the two costliest stages never overlap, and a planet-scale ingest that should finish overnight runs for days. This page shows how to keep both resources saturated by wrapping Pyrosm's blocking reader in a `ProcessPoolExecutor` and streaming results through a bounded `asyncio` queue, so parsing and downstream transformation proceed concurrently without exhausting memory.

<svg viewBox="0 0 740 410" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Sequence diagram of the async PBF parsing handoff: the producer task submits a tile to a ProcessPool worker and receives a Future, pushes that Future onto a bounded asyncio queue (blocking if the queue is full), the async consumer awaits the queue to get the Future, resolves it off the event loop with asyncio.to_thread, receives a pyarrow Table from the worker, and yields it downstream" style="width:100%;max-width:740px;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>Async PBF Producer-Consumer Sequence</title>
  <desc>The producer task calls executor.submit(parse_tile) on a ProcessPool worker and gets back a concurrent.futures.Future. It then calls put(future) on a bounded asyncio.Queue, which awaits if the queue is full (back-pressure). The async consumer awaits queue.get() to receive the future, resolves it with await asyncio.to_thread(future.result), receives a pyarrow.Table from the worker process, and yields the Table downstream.</desc>
  <defs>
    <marker id="arrSeq" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <!-- lifeline headers -->
  <g font-size="12" fill="currentColor" text-anchor="middle">
    <rect x="25"  y="14" width="150" height="46" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="100" y="33">Producer</text><text x="100" y="49" opacity="0.8">task</text>
    <rect x="215" y="14" width="150" height="46" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="290" y="33">Bounded</text><text x="290" y="49" opacity="0.8">asyncio.Queue</text>
    <rect x="400" y="14" width="150" height="46" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="475" y="33">ProcessPool</text><text x="475" y="49" opacity="0.8">worker</text>
    <rect x="580" y="14" width="150" height="46" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="655" y="33">Async</text><text x="655" y="49" opacity="0.8">consumer</text>
  </g>
  <!-- lifelines -->
  <g stroke="currentColor" stroke-width="1" stroke-dasharray="3 3" opacity="0.4">
    <line x1="100" y1="60" x2="100" y2="380"/>
    <line x1="290" y1="60" x2="290" y2="380"/>
    <line x1="475" y1="60" x2="475" y2="380"/>
    <line x1="655" y1="60" x2="655" y2="380"/>
  </g>
  <!-- messages -->
  <g fill="currentColor" font-size="11" text-anchor="middle">
    <!-- 1: submit -->
    <text x="287" y="86">1 · executor.submit(parse_tile)</text>
    <line x1="100" y1="92" x2="475" y2="92" stroke="currentColor" stroke-width="1.5" marker-end="url(#arrSeq)"/>
    <!-- 2: future returned -->
    <text x="287" y="118">2 · concurrent.futures.Future</text>
    <line x1="475" y1="124" x2="100" y2="124" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 3" marker-end="url(#arrSeq)"/>
    <!-- 3: put -->
    <text x="195" y="154">3 · put(future) — awaits if full</text>
    <line x1="100" y1="160" x2="290" y2="160" stroke="currentColor" stroke-width="1.5" marker-end="url(#arrSeq)"/>
    <!-- 4: get -->
    <text x="472" y="190">4 · await get() → future</text>
    <line x1="290" y1="196" x2="655" y2="196" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 3" marker-end="url(#arrSeq)"/>
    <!-- 5: self to_thread -->
    <text x="650" y="221" text-anchor="end">5 · to_thread(future.result)</text>
    <path d="M655,227 L693,227 L693,243 L659,243" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#arrSeq)"/>
    <!-- 6: table back -->
    <text x="565" y="271">6 · pyarrow.Table</text>
    <line x1="475" y1="277" x2="655" y2="277" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 3" marker-end="url(#arrSeq)"/>
    <!-- 7: self yield -->
    <text x="650" y="303" text-anchor="end">7 · yield Table downstream</text>
    <path d="M655,309 L693,309 L693,325 L659,325" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#arrSeq)"/>
  </g>
</svg>

Pyrosm is a Cython-backed library that wraps libosmium to read PBF files into GeoDataFrames. Its native API is synchronous and reads the full file in a single pass — it does not support seeking to arbitrary byte offsets mid-stream, so you cannot naively shard one file across threads. The pattern below instead achieves concurrency at the *file* granularity: each worker process owns one regional tile, and `asyncio` orchestrates the handoff so that parsing, normalization, and writing overlap with strict back-pressure.

## Prerequisite concepts

This workflow sits in the ingestion stage of the [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/) pipeline, and it assumes three foundations are already in place. First, you should understand how PBF lays bytes on disk — the [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) explains why a `Blob` boundary, not a byte offset, is the only safe place to split a file, which is precisely why tile-level (not offset-level) parallelism is the workable model here. Second, because Pyrosm hands you ways with geometry already reconstructed, the reference-resolution rules in the [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) determine which tiling strategy keeps way members intact at tile boundaries. Third, the canonicalization targets you apply in [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/) define the schema each worker must emit, so the normalization step in this page stays consistent with the rest of the pipeline.

## Specification & API reference

Pyrosm exposes a small, mostly synchronous surface. The fields and limits that matter for a concurrent design are summarized below.

| Surface | Signature / value | Concurrency relevance |
|---|---|---|
| `OSM(filepath, bounding_box=None)` | constructor | Bounding box clips at read time; cheaper than a separate `osmium extract` only for small clips. |
| `OSM.get_network(network_type=...)` | returns `GeoDataFrame` | Blocking, single-pass, releases the GIL inside libosmium but materializes the full result before returning. |
| `OSM.get_pois`, `get_buildings`, `get_landuse` | returns `GeoDataFrame` | One full pass per call — call once per worker, not once per feature class, to avoid re-reading the file. |
| `OSM(..., nodes=True)` | flag | Required if you must re-attach point geometry downstream; roughly doubles peak worker memory. |
| PBF `Blob` max size | 32 MiB uncompressed (spec ceiling) | Sets the lower bound on how finely libosmium can stream; you cannot split below a block. |

The decisive constraint is that Pyrosm materializes one GeoDataFrame per feature type. Serializing those frames back across the `ProcessPoolExecutor` IPC boundary is expensive (pickle + copy), so each worker should convert its result to a compact `pyarrow.Table` and drop heavyweight geometry before returning. This keeps the inter-process payload small while preserving the tag columns the next stage needs.

## Step-by-step implementation

The architecture orchestrates a bounded queue of futures: a producer submits one tile per worker and the consumer drains results as they complete. The bound on the queue — not the worker count alone — is what caps peak memory.

1. **Tile the extract.** Split the source by bounding box with `osmium extract --strategy=smart` so every tile carries the way members needed for geometry reconstruction at its edges. Avoid `complete_ways` only if you do not need boundary-spanning ways.
2. **Define an isolated worker.** Each process opens its own `OSM` instance — no shared state, no lock contention — parses one tile, and returns an Arrow table with geometry dropped.
3. **Run a producer task.** Submit tiles to the pool and push the returned `Future` objects onto a bounded `asyncio.Queue`; `await queue.put(...)` blocks once the queue is full, applying back-pressure on submission.
4. **Drain in the consumer.** `await queue.get()`, resolve each future off the event loop with `asyncio.to_thread(future.result)`, and yield non-empty tables downstream.
5. **Terminate cleanly.** A `None` sentinel signals end-of-stream so the consumer's `while` loop exits and the pool context manager joins all workers.

```python
import asyncio
import logging
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import AsyncIterator
import pyarrow as pa
from pyrosm import OSM

MAX_WORKERS = 4
QUEUE_MAXSIZE = 8

logger = logging.getLogger(__name__)


def _parse_tile_worker(tile_path: str) -> pa.Table:
    """Isolated worker: parse one PBF tile and return an Arrow Table.

    Each worker process owns its own OSM instance and GeoDataFrame, so
    there is no shared-memory contention. Tags are preserved as columns.
    """
    try:
        reader = OSM(tile_path)
        gdf = reader.get_network(network_type="driving")
        if gdf is None or gdf.empty:
            return pa.table({})
        # Drop geometry: Arrow has no native geometry type; callers can
        # reconstruct from WKB if needed.
        df = gdf.drop(columns="geometry")
        return pa.Table.from_pandas(df, preserve_index=False)
    except Exception as e:
        logger.error("Worker failed for tile %s: %s", tile_path, e)
        return pa.table({})


async def async_tile_stream(
    tile_paths: list[Path],
) -> AsyncIterator[pa.Table]:
    """Yield normalised Arrow tables for each PBF tile, max QUEUE_MAXSIZE in flight."""
    queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_MAXSIZE)

    async def producer() -> None:
        with ProcessPoolExecutor(max_workers=MAX_WORKERS) as executor:
            for path in tile_paths:
                future = executor.submit(_parse_tile_worker, str(path))
                await queue.put(future)
        await queue.put(None)  # sentinel

    asyncio.create_task(producer())

    while True:
        future = await queue.get()
        if future is None:
            break
        try:
            result = await asyncio.to_thread(future.result)
            if result.num_rows:
                yield result
        except Exception as e:
            logger.warning("Tile processing failed: %s", e)
        finally:
            queue.task_done()
```

### Tag normalization on the Arrow table

Raw OSM tags exhibit inconsistent casing, localized abbreviations, and deprecated keys. Normalize on the Arrow table *before* yielding it downstream — this is the cheapest point because the table is already in columnar memory and has not yet been re-serialized. The mapping here is a minimal example of the controlled vocabularies defined in full by [Batch Attribute Mapping Strategies](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/).

```python
import pyarrow as pa
import pyarrow.compute as pc  # noqa: F401  # used for further column ops


def normalize_highway_column(table: pa.Table) -> pa.Table:
    """Map raw highway values to canonical routing classes."""
    HIGHWAY_MAP = {
        "motorway": "motorway", "trunk": "trunk",
        "primary": "arterial", "secondary": "arterial",
        "tertiary": "collector", "residential": "local",
        "unclassified": "local", "service": "access",
    }
    if "highway" not in table.schema.names:
        return table
    col = table.column("highway")
    # Arrow has no built-in dictionary remap; round-trip through pandas .map.
    import pandas as pd  # noqa: F401
    s = col.to_pandas().map(HIGHWAY_MAP)
    new_col = pa.array(s.tolist(), type=pa.string())
    idx = table.schema.get_field_index("highway")
    return table.set_column(idx, "highway", new_col)
```

When a worker encounters malformed geometries or missing mandatory attributes, it should log the failure, quarantine the record to a dead-letter Parquet partition, and continue — never raise into the event loop. That contract is shared with [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/), which triages the quarantined records this stage produces and decouples schema enforcement from raw ingestion.

## Validation & error-handling matrix

<svg viewBox="0 0 720 320" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Back-pressure diagram: the producer submits and calls put() into a bounded queue of eight slots; with six of eight slots occupied the producer is close to the cap, and put() awaits once the queue is full, throttling submission. The async consumer calls get() and to_thread() to drain at a steady rate. A band notes that peak memory is approximately the worker count plus the queue depth times the average table size, where workers are the throughput dial and queue depth is the latency-smoothing dial" style="width:100%;max-width:720px;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>Bounded-Queue Back-Pressure and Peak-Memory Bound</title>
  <desc>The producer task submits tiles and pushes futures with put() into a bounded asyncio queue of eight slots. The queue is shown with six of eight slots occupied; once all slots are full, put() awaits, applying back-pressure that prevents the producer from outrunning the consumer. The async consumer calls get() then asyncio.to_thread() and drains at a steady rate. A lower band states the bound: peak memory is approximately (worker count w + queue depth q) multiplied by the average table size, where w is the throughput dial up to the core count and q is the latency-smoothing dial at linear memory cost.</desc>
  <defs>
    <marker id="arrBp" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <!-- feedback / back-pressure loop -->
  <path d="M344,117 L344,80 L99,80 L99,114" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 3" marker-end="url(#arrBp)"/>
  <text x="300" y="72" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">put() awaits while full — back-pressure</text>
  <!-- producer -->
  <rect x="24" y="114" width="150" height="56" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="99" y="138" text-anchor="middle" font-size="12" fill="currentColor">Producer task</text>
  <text x="99" y="156" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.75">submit() &#8594; put()</text>
  <!-- occupancy captions -->
  <text x="311" y="110" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">occupied (6)</text>
  <text x="443" y="110" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">free</text>
  <!-- queue cells (8 slots, first 6 occupied) -->
  <g>
    <rect x="212" y="118" width="33" height="48" fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-width="1.3"/>
    <rect x="245" y="118" width="33" height="48" fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-width="1.3"/>
    <rect x="278" y="118" width="33" height="48" fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-width="1.3"/>
    <rect x="311" y="118" width="33" height="48" fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-width="1.3"/>
    <rect x="344" y="118" width="33" height="48" fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-width="1.3"/>
    <rect x="377" y="118" width="33" height="48" fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-width="1.3"/>
    <rect x="410" y="118" width="33" height="48" fill="none" stroke="currentColor" stroke-width="1.3"/>
    <rect x="443" y="118" width="33" height="48" fill="none" stroke="currentColor" stroke-width="1.3"/>
  </g>
  <!-- cap bracket -->
  <path d="M212,176 L212,182 L476,182 L476,176" fill="none" stroke="currentColor" stroke-width="1" opacity="0.7"/>
  <text x="344" y="198" text-anchor="middle" font-size="11" fill="currentColor">QUEUE_MAXSIZE = 8 slots</text>
  <!-- consumer -->
  <rect x="536" y="114" width="160" height="56" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="616" y="138" text-anchor="middle" font-size="12" fill="currentColor">Async consumer</text>
  <text x="616" y="156" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.75">get() &#8594; to_thread()</text>
  <!-- flow arrows -->
  <line x1="174" y1="142" x2="206" y2="142" stroke="currentColor" stroke-width="1.5" marker-end="url(#arrBp)"/>
  <text x="190" y="134" text-anchor="middle" font-size="10" fill="currentColor">put()</text>
  <line x1="476" y1="142" x2="530" y2="142" stroke="currentColor" stroke-width="1.5" marker-end="url(#arrBp)"/>
  <text x="503" y="134" text-anchor="middle" font-size="10" fill="currentColor">get()</text>
  <text x="503" y="158" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.7">drains steadily</text>
  <!-- memory band -->
  <rect x="40" y="226" width="640" height="70" rx="8" fill="none" stroke="currentColor" stroke-width="1.3"/>
  <text x="360" y="254" text-anchor="middle" font-size="12.5" fill="currentColor">Peak memory &#8776; (w workers + q queue slots) &#215; average table size</text>
  <text x="360" y="278" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.8">w = throughput dial (up to core count) &#183; q = latency-smoothing dial (linear memory cost)</text>
</svg>

| Error condition | Root cause | Detection | Remediation |
|---|---|---|---|
| `BrokenProcessPool` | Worker segfaulted in libosmium on a corrupt blob | `future.result()` raises in consumer | Recreate the pool, isolate and re-tile the offending file, skip on second failure |
| Silent empty result | Tile has no features of the requested `network_type` | `result.num_rows == 0` guard | Drop quietly; log only if every tile in a batch is empty (mis-set filter) |
| `MemoryError` in worker | `nodes=True` on a dense urban tile | OOM-killed worker → `BrokenProcessPool` | Reduce tile size (raise H3 resolution), lower `MAX_WORKERS` |
| Schema drift between tiles | Optional tag columns absent in sparse tiles | `pa.concat_tables` raises on schema mismatch | `promote_options="permissive"` or unify schema before concat |
| Event loop stalls | `future.result()` called directly (blocking) | Consumer throughput drops to one tile at a time | Wrap with `asyncio.to_thread(future.result)` |
| Producer outruns consumer | `QUEUE_MAXSIZE` too large; memory climbs | RSS grows linearly with tiles read | Lower `QUEUE_MAXSIZE`; the bounded `put` then throttles submission |

## Performance & scale considerations

Peak resident memory is dominated not by the number of CPU cores but by how many parsed tables can exist at once. With `w` worker processes each holding one in-flight GeoDataFrame and a queue admitting up to `q` completed Arrow tables, the working set is bounded by:

$$ M_{\text{peak}} \approx (w + q) \times \bar{s}_{\text{table}} $$

where $\bar{s}_{\text{table}}$ is the average serialized table size. This is why the queue bound (`QUEUE_MAXSIZE`) is the primary memory dial: doubling `MAX_WORKERS` buys throughput up to your core count, but doubling the queue depth only buys latency smoothing at a linear memory cost. For a typical European country extract tiled at H3 resolution 5, tables average tens of megabytes, so `MAX_WORKERS = 4`, `QUEUE_MAXSIZE = 8` keeps the working set comfortably under a few gigabytes.

Tile granularity controls the parallelism-to-overhead ratio. H3 resolution 5 (average cell area ~252 km²) is a reasonable default for European country-scale extracts; drop to resolution 4 for continental processing where per-tile fixed costs would otherwise dominate. Tiles that are too small spend more time in process spin-up and IPC than in parsing; tiles that are too large defeat the back-pressure budget and risk OOM. When memory rather than throughput is the binding constraint, prefer the streaming generators in [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) over widening the pool.

## Failure modes & gotchas

- **`asyncio.create_task` without a reference can be garbage-collected.** Hold the producer task (`task = asyncio.create_task(producer())`) so it is not silently dropped mid-stream; otherwise the queue never receives its sentinel and the consumer hangs.
- **Calling `future.result()` directly blocks the event loop.** It looks harmless because the future is "probably done," but a slow tile freezes every other coroutine. Always offload with `asyncio.to_thread`.
- **`ProcessPoolExecutor` re-imports the module in each worker.** Heavy module-level side effects (opening files, configuring logging handlers) run once per process; keep worker imports lazy and idempotent.
- **Geometry dropped at the worker is gone.** If a downstream stage needs coordinates, serialize a WKB column inside the worker rather than re-running the parse — re-parsing a tile is far costlier than carrying bytes.
- **Schema-permissive concat hides real drift.** `promote_options="permissive"` will paper over a tile that is genuinely missing a mandatory column; assert the expected schema explicitly when correctness matters more than completion.
- **Bounding-box clipping at read time is not free.** `OSM(..., bounding_box=...)` still scans the whole file; for repeated runs, pre-tile once with `osmium extract` and cache the tiles.

## Integration points

Once normalized, the streaming Arrow tables flow into network analysis. Feeding [OSMnx Graph Conversion Techniques](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/) requires reconstructing GeoDataFrames from the Arrow tables — re-attaching geometry from a WKB column, or re-running the parse with `nodes=True` — before passing them to `ox.graph_from_gdfs`. The wiring below consumes the async stream and hands each normalized table to the next stage:

```python
import logging
import pyarrow as pa

logger = logging.getLogger(__name__)


async def run_ingest(tile_paths: list[Path]) -> pa.Table:
    """Drive the async stream, normalize, and accumulate for graph conversion."""
    batches: list[pa.Table] = []
    async for table in async_tile_stream(tile_paths):
        normalized = normalize_highway_column(table)
        batches.append(normalized)
        logger.info("ingested tile: %d rows", normalized.num_rows)
    if not batches:
        return pa.table({})
    # Permissive promotion tolerates sparse tiles missing optional columns.
    return pa.concat_tables(batches, promote_options="permissive")
```

The combined table is then ready for projection to a working CRS following [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) before geometry is rebuilt and weighted for routing.

## Frequently Asked Questions

<details>
<summary>Why not just use threads instead of processes for parsing?</summary>

Pyrosm releases the GIL inside libosmium, so threads help during the raw read, but the pandas/GeoDataFrame construction afterward is largely GIL-bound. Processes give you true parallel CPU for both the parse and the per-tile DataFrame build, at the cost of IPC serialization — which is why each worker returns a compact Arrow table with geometry dropped.
</details>

<details>
<summary>Can Pyrosm read a single huge file in parallel without tiling?</summary>

No. The native API reads a file in one synchronous pass and cannot seek to an arbitrary byte offset mid-stream, and the smallest safe split point is a PBF `Blob` boundary, not a byte. Parallelism is therefore achieved at the file granularity — pre-tile the extract with `osmium extract` and assign one tile per worker.
</details>

<details>
<summary>How do I stop the producer from exhausting memory?</summary>

Bound the queue. `await queue.put(future)` blocks once `QUEUE_MAXSIZE` futures are pending, so the producer cannot submit faster than the consumer drains. Peak memory scales with `(MAX_WORKERS + QUEUE_MAXSIZE) × average table size`, so tune the queue depth first when RSS climbs.
</details>

<details>
<summary>My consumer processes tiles one at a time — what went wrong?</summary>

You almost certainly called `future.result()` directly, which blocks the event loop until that tile finishes and serializes the whole stream. Resolve futures off the loop with `await asyncio.to_thread(future.result)` so other coroutines keep running.
</details>

<details>
<summary>Why does concatenating tile tables raise a schema mismatch?</summary>

Sparse tiles omit optional tag columns that dense tiles include, so the Arrow schemas differ. Use `pa.concat_tables(..., promote_options="permissive")` to unify them, but assert the mandatory columns explicitly first — permissive promotion will otherwise mask a genuinely missing required field.
</details>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Parse large OSM PBF extracts asynchronously with Pyrosm",
  "description": "Producer-consumer procedure that overlaps Pyrosm parsing and tag normalization across processes with a bounded asyncio queue and strict back-pressure.",
  "step": [
    { "@type": "HowToStep", "name": "Tile the extract", "text": "Split the source PBF by bounding box with osmium extract --strategy=smart so each tile carries the way members needed for boundary geometry reconstruction." },
    { "@type": "HowToStep", "name": "Define an isolated worker", "text": "Each process opens its own OSM instance, parses one tile, drops geometry, and returns a compact pyarrow.Table to minimize IPC payload." },
    { "@type": "HowToStep", "name": "Run a bounded producer", "text": "Submit tiles to a ProcessPoolExecutor and push the returned futures onto a bounded asyncio.Queue so put() blocks and applies back-pressure when full." },
    { "@type": "HowToStep", "name": "Drain in the consumer", "text": "Resolve each future with asyncio.to_thread(future.result) to avoid blocking the event loop, then yield non-empty Arrow tables downstream." },
    { "@type": "HowToStep", "name": "Normalize and integrate", "text": "Map raw tags to canonical values on the Arrow table, quarantine defective records to a dead-letter Parquet partition, and concat permissively for graph conversion." }
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
      "name": "Why not just use threads instead of processes for parsing?",
      "acceptedAnswer": { "@type": "Answer", "text": "Pyrosm releases the GIL inside libosmium so threads help during the raw read, but the GeoDataFrame construction afterward is largely GIL-bound. Processes give true parallel CPU for both the parse and the DataFrame build, at the cost of IPC serialization, which is why each worker returns a compact Arrow table with geometry dropped." }
    },
    {
      "@type": "Question",
      "name": "Can Pyrosm read a single huge file in parallel without tiling?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. The native API reads a file in one synchronous pass and cannot seek to an arbitrary byte offset, and the smallest safe split point is a PBF Blob boundary, not a byte. Parallelism is achieved at file granularity: pre-tile the extract with osmium extract and assign one tile per worker." }
    },
    {
      "@type": "Question",
      "name": "How do I stop the producer from exhausting memory?",
      "acceptedAnswer": { "@type": "Answer", "text": "Bound the queue. await queue.put(future) blocks once QUEUE_MAXSIZE futures are pending, so the producer cannot outrun the consumer. Peak memory scales with (MAX_WORKERS + QUEUE_MAXSIZE) times the average table size, so tune queue depth first when memory climbs." }
    },
    {
      "@type": "Question",
      "name": "My consumer processes tiles one at a time — what went wrong?",
      "acceptedAnswer": { "@type": "Answer", "text": "You likely called future.result() directly, which blocks the event loop until that tile finishes and serializes the whole stream. Resolve futures off the loop with await asyncio.to_thread(future.result) so other coroutines keep running." }
    },
    {
      "@type": "Question",
      "name": "Why does concatenating tile tables raise a schema mismatch?",
      "acceptedAnswer": { "@type": "Answer", "text": "Sparse tiles omit optional tag columns that dense tiles include, so the Arrow schemas differ. Use pa.concat_tables with promote_options=permissive to unify them, but assert the mandatory columns explicitly first so permissive promotion does not mask a missing required field." }
    }
  ]
}
</script>

## In this section

The focused guides below extend this concurrent-parsing pattern:

- [Streaming PBF Blocks Through an Asyncio Queue](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/streaming-pbf-blocks-through-an-asyncio-queue/) — a bounded producer-consumer queue that decouples block decoding from downstream processing.
- [Tuning Pyrosm Worker Count for PBF Parsing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/tuning-pyrosm-worker-count-for-pbf-parsing/) — sizing the process pool to cores, memory, and I/O so throughput scales without thrashing.
- [Speed Up OSM Parsing with Multiprocessing in Python](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/speed-up-osm-parsing-with-multiprocessing-in-python/) — fanning independent fileblocks across a process pool with a final reduce.

## Related

- [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) — streaming generators and spill-to-disk when memory, not throughput, is the binding constraint.
- [Batch Attribute Mapping Strategies](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/) — the schema registries and controlled vocabularies each worker emits against.
- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — triaging the records this stage quarantines.
- [OSMnx Graph Conversion Techniques](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/) — turning normalized tables into routing-ready NetworkX graphs.
- [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) — why blocks, not byte offsets, bound how finely a file can be split.
- [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/) — H3 and R-tree tiling strategies that drive the parallelism granularity.

This guide is part of [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/); return to that overview to follow the data through normalization, error triage, and routing-graph conversion.
