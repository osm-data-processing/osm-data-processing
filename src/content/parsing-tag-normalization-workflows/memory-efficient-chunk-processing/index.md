---
title: "Memory-Efficient Chunk Processing"
description: "Stream multi-gigabyte OSM PBF extracts through bounded buffers, spill validated chunks to Parquet, and hold resident memory flat with deterministic windowing."
pageDescription: "Memory-efficient OSM chunk processing: bounded pyosmium buffers, ZSTD Parquet spill, atomic chunk writes, checkpoint manifests, and lazy merge for large extracts."
slug: memory-efficient-chunk-processing
type: guide
breadcrumb: "Memory-Efficient Chunk Processing"
datePublished: 2025-09-12
dateModified: 2026-06-26
date: 2026-06-26
---
# Memory-Efficient Chunk Processing

Regional OpenStreetMap extracts routinely exceed 10–50 GB once decompressed from PBF, and the naive approach — read every node, way, and relation into a single DataFrame or in-memory graph before transforming anything — turns a routine ingest into an out-of-memory (OOM) crash. The failure is rarely graceful: a dense urban extract inflates from a few gigabytes on disk to tens of gigabytes of Python objects, the garbage collector starts thrashing over tens of millions of tiny tag dictionaries, the kernel OOM-killer reaps the worker mid-write, and you are left with a half-written output file and no checkpoint to resume from. This page shows how to make memory a fixed budget rather than a function of dataset size: stream the extract through a bounded buffer, normalize each window in place, and flush validated records to columnar storage before the next window is read, so resident memory stays flat whether you are processing a city or a continent.

<svg viewBox="0 0 760 230" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Bounded streaming pipeline: a PBF stream feeds a SimpleHandler whose node() and way() callbacks append rows to an in-memory buffer capped at chunk_size; while the buffer is not full, control loops back to read more features; when the buffer is full it is flushed to a ZSTD-compressed Parquet file written into the ./chunks directory as osm_chunk_NNNN.parquet, then cleared" style="width:100%;max-width:760px;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>Bounded-Buffer Streaming to Parquet Chunks</title>
  <desc>Left-to-right data flow. A PBF stream is read by a SimpleHandler whose node() and way() callbacks append flat rows to an in-memory buffer limited to chunk_size rows. While the buffer is not yet full, a feedback loop returns to the handler to read the next feature. Once the buffer reaches chunk_size it is flushed to a ZSTD-compressed Parquet file in the ./chunks directory named osm_chunk_NNNN.parquet, and the buffer is cleared so resident memory stays flat regardless of extract size.</desc>
  <defs>
    <marker id="chunkArr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <!-- 1. PBF stream -->
  <rect x="16" y="72" width="96" height="66" rx="4" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="64" y="102" text-anchor="middle" font-size="13" fill="currentColor">PBF</text>
  <text x="64" y="119" text-anchor="middle" font-size="13" fill="currentColor">stream</text>
  <line x1="112" y1="105" x2="140" y2="105" stroke="currentColor" stroke-width="1.5" marker-end="url(#chunkArr)"/>
  <!-- 2. SimpleHandler -->
  <rect x="142" y="72" width="130" height="66" rx="4" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="207" y="100" text-anchor="middle" font-size="13" fill="currentColor">SimpleHandler</text>
  <text x="207" y="120" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.75">node() · way()</text>
  <line x1="272" y1="105" x2="300" y2="105" stroke="currentColor" stroke-width="1.5" marker-end="url(#chunkArr)"/>
  <!-- 3. In-memory buffer (cylinder) -->
  <ellipse cx="367" cy="80" rx="65" ry="8" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.5"/>
  <path d="M302,80 L302,130 A65,8 0 0 0 432,130 L432,80" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.5"/>
  <text x="367" y="103" text-anchor="middle" font-size="12" fill="currentColor">in-memory buffer</text>
  <text x="367" y="121" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.75">&#8804; chunk_size rows</text>
  <!-- buffer full -> flush -->
  <line x1="432" y1="105" x2="464" y2="105" stroke="currentColor" stroke-width="1.5" marker-end="url(#chunkArr)"/>
  <text x="448" y="96" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">full</text>
  <!-- 4. Flush -->
  <rect x="466" y="72" width="118" height="66" rx="4" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="525" y="100" text-anchor="middle" font-size="13" fill="currentColor">flush &#8594;</text>
  <text x="525" y="120" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.75">Parquet (ZSTD)</text>
  <line x1="584" y1="105" x2="612" y2="105" stroke="currentColor" stroke-width="1.5" marker-end="url(#chunkArr)"/>
  <!-- 5. chunks dir (cylinder) -->
  <ellipse cx="679" cy="80" rx="62" ry="8" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.5"/>
  <path d="M617,80 L617,130 A62,8 0 0 0 741,130 L741,80" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.5"/>
  <text x="679" y="103" text-anchor="middle" font-size="12" fill="currentColor">./chunks/</text>
  <text x="679" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">osm_chunk_NNNN</text>
  <!-- feedback loop: buffer not full -> handler -->
  <path d="M367,138 L367,185 L207,185 L207,138" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3" marker-end="url(#chunkArr)"/>
  <text x="287" y="201" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">not full &#8212; read next feature</text>
</svg>

Memory-efficient chunk processing relies on a strict decoupling of I/O ingestion from transformation logic. Rather than loading complete node, way, and relation collections into RAM, the pipeline iterates over fixed-size feature windows, applies vectorized operations, and flushes validated records before advancing. The foundational pattern is a generator-style handler that maintains a bounded in-memory buffer, triggers normalization at a predefined threshold, and serializes outputs to a columnar format such as [Apache Parquet](https://parquet.apache.org/) so downstream stages can scan only the columns and row groups they need.

## Prerequisite concepts

This workflow is the memory-budget stage of the [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/) pipeline, and it assumes two foundations are already understood. First, because the buffer fills with one primitive at a time, the structural rules in the [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) determine what each buffered row must carry — a node holds a coordinate, a way holds only the integer IDs of its member nodes, so geometry is a deferred join you must plan the chunk schema around. Second, the streaming unit is dictated by the file format: the [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) explains that a `Blob` fileblock is the smallest independently decodable span, which is why libosmium can hand you features incrementally instead of forcing a whole-file read. When throughput rather than memory is your binding constraint, the process-level concurrency in [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/) is the complementary pattern — this page keeps a single worker's footprint flat; that page fans bounded work across cores.

## Specification & format reference

The chunk schema and the buffer ceiling are the two design knobs that decide whether memory stays bounded. The table below lists the format-level facts that constrain both.

| Surface | Value / rule | Why it bounds memory |
|---|---|---|
| PBF `Blob` (uncompressed) | 32 MiB spec ceiling, 16 MiB recommended | libosmium decodes one block at a time, so the reader never holds the whole file resident. |
| `PrimitiveBlock` `granularity` | 100 nanodegrees (default) | Coordinates arrive as `int64`, not float — store them as integers in the chunk to halve column width. |
| `DenseNodes` encoding | delta-encoded `int64` arrays | Decoded inside libosmium; your buffer receives resolved values, so accumulator state never leaks into Python. |
| Tag dictionary | free-form `string → string` | The dominant memory cost; serialize to one JSON UTF-8 column, not a per-chunk Arrow `Struct`, to avoid schema divergence across windows. |
| Parquet row group | 128 MiB typical target | Sets the natural lower bound on `chunk_size`; smaller chunks waste row-group overhead, larger ones defeat the memory cap. |
| ZSTD compression | level 1–9 | Trades flush CPU for disk footprint; level 3 is the usual streaming sweet spot. |

The decisive schema choice is how tags are stored. OSM tags are an unbounded, contributor-defined key space, so inferring an Arrow `Struct` per chunk produces a schema that drifts between windows and breaks any later `pl.concat`/`pl.scan_parquet` merge. Serializing each tag dictionary to a single JSON string column keeps every chunk schema identical and defers the expensive structural decode to the consumer that actually needs it. Applying the controlled vocabularies from [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) before the JSON is written keeps that deferred decode cheap and predictable.

## Step-by-step implementation

The handler caps the buffer at `chunk_size` records; when the cap is hit it materializes a Polars DataFrame, writes it compressed, and clears for the next window. The bound on the buffer — not the size of the extract — is what fixes peak memory.

1. **Subclass the streaming handler.** Extend `osmium.SimpleHandler` so `node()` and `way()` callbacks append a flat row to a bounded list rather than a growing global collection.
2. **Flatten tags at append time.** Serialize each tag dict to JSON immediately so the buffer holds compact strings, not nested Python objects the GC must walk.
3. **Flush at the threshold.** When the buffer length reaches `chunk_size`, write a Polars DataFrame to a `.parquet.tmp` file with ZSTD, then atomically rename it to its final name.
4. **Drain the tail.** After `apply_file` returns, call `finalize()` once to flush the final partial buffer.
5. **Record a manifest.** Log each chunk's index and row count so an interrupted run can resume from the last committed chunk instead of restarting.

```python
from __future__ import annotations

import json
import logging
from pathlib import Path

import osmium
import polars as pl

logger = logging.getLogger(__name__)


class ChunkedOSMHandler(osmium.SimpleHandler):
    """Stream an OSM extract into bounded Parquet chunks.

    Tags are serialised to JSON strings so Polars writes them as a flat
    UTF-8 column instead of inferring a (potentially divergent) Struct
    schema across chunks. Way node refs are reduced to their integer IDs.

    Usage:
        handler = ChunkedOSMHandler(chunk_size=250_000)
        handler.apply_file("extract.osm.pbf", locations=True, idx="flex_mem")
        handler.finalize()
    """

    def __init__(self, chunk_size: int = 250_000, output_dir: Path = Path("./chunks")):
        super().__init__()  # required by the pyosmium C++ binding
        self.chunk_size = chunk_size
        self.output_dir = output_dir
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self._buffer: list[dict] = []
        self._chunk_idx = 0

    def _flush_buffer(self) -> None:
        if not self._buffer:
            return
        df = pl.DataFrame(self._buffer)
        tmp_path = self.output_dir / f"osm_chunk_{self._chunk_idx:04d}.parquet.tmp"
        final_path = self.output_dir / f"osm_chunk_{self._chunk_idx:04d}.parquet"
        df.write_parquet(str(tmp_path), compression="zstd")
        tmp_path.rename(final_path)  # atomic move on POSIX file systems
        logger.info("flushed chunk %04d (%d rows)", self._chunk_idx, df.height)
        self._buffer.clear()
        self._chunk_idx += 1

    def _maybe_flush(self) -> None:
        if len(self._buffer) >= self.chunk_size:
            self._flush_buffer()

    def node(self, n: osmium.osm.Node) -> None:
        self._buffer.append({
            "type": "node",
            "id": n.id,
            "lat": n.location.lat if n.location.valid() else None,
            "lon": n.location.lon if n.location.valid() else None,
            "node_refs": None,
            "tags": json.dumps({t.k: t.v for t in n.tags}),
        })
        self._maybe_flush()

    def way(self, w: osmium.osm.Way) -> None:
        self._buffer.append({
            "type": "way",
            "id": w.id,
            "lat": None,
            "lon": None,
            "node_refs": [nr.ref for nr in w.nodes],
            "tags": json.dumps({t.k: t.v for t in w.tags}),
        })
        self._maybe_flush()

    def finalize(self) -> None:
        """Call once after ``apply_file`` returns to drain the final chunk."""
        self._flush_buffer()
        logger.info("finished: %d chunks written", self._chunk_idx)
```

The atomic `.tmp` → final rename is not cosmetic: it guarantees that a downstream `pl.scan_parquet` glob never observes a partially written file, so a crash mid-flush leaves the chunk directory in a consistent state where every visible `osm_chunk_NNNN.parquet` is complete. This idempotent-write discipline is what makes the whole stage resumable, and it is the same contract the broader [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) workflow depends on when it triages defective records.

### Tag normalization at the chunk boundary

Raw OSM tags are heterogeneous across contributor communities and regional conventions — `highway=primary`, `highway=Primary`, and a stray `highway=trunk_link` can all coexist in one extract. Normalize each chunk *in place*, while it is still a small bounded DataFrame, rather than over the whole extract. Precompiled regexes and static lookup dictionaries keep the per-row cost flat, and because the operation is vectorized in Polars it runs once per column instead of once per feature:

```python
import polars as pl

_HIGHWAY_CANON = {
    "primary": "arterial", "primary_link": "arterial",
    "secondary": "arterial", "tertiary": "collector",
    "residential": "local", "unclassified": "local",
    "trunk": "trunk", "trunk_link": "trunk", "motorway": "motorway",
}


def normalize_chunk(df: pl.DataFrame) -> pl.DataFrame:
    """Canonicalise the highway class inside a single bounded chunk."""
    return df.with_columns(
        pl.col("tags")
        .str.json_path_match("$.highway")
        .str.to_lowercase()
        .replace(_HIGHWAY_CANON, default=None)
        .alias("highway_class")
    )
```

Normalization routines should be stateless and driven by explicit configuration rather than runtime inference, so identical inputs yield identical outputs across execution environments. The full controlled-vocabulary registries live in [Batch Attribute Mapping Strategies](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/); applying them per chunk means the regex cleaning pass operates on a bounded memory slice and never materializes the whole extract to harmonize a single key.

## Validation & error-handling matrix

<svg viewBox="0 0 720 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Sawtooth resident-memory profile of bounded chunk processing. Resident memory rises linearly from a floor as the buffer fills, peaks just below a dashed hard memory ceiling when chunk_size is reached, then drops vertically back to the floor as the chunk is flushed to Parquet and the buffer is cleared. The pattern repeats for each chunk; a smaller final rise represents the partial buffer drained by finalize(). The sawtooth never crosses the ceiling because peak memory is fixed at roughly two times chunk_size times row width." style="width:100%;max-width:720px;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>Bounded Sawtooth Memory Profile</title>
  <desc>A time series of resident memory under chunk processing. Memory climbs from a resident floor (the libosmium location cache and base process) as the buffer fills, reaches a peak just under a dashed horizontal hard memory ceiling when the buffer hits chunk_size, then falls vertically back to the floor when the chunk is flushed to ZSTD Parquet and the buffer is cleared. Four full teeth repeat, followed by a smaller final rise representing the partial buffer drained by finalize(). Peak height is fixed at approximately 2 times chunk_size times average row width, so the sawtooth never crosses the ceiling no matter how large the extract.</desc>
  <defs>
    <marker id="memArr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L7,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <!-- axes -->
  <line x1="72" y1="40" x2="72" y2="252" stroke="currentColor" stroke-width="1.5"/>
  <line x1="72" y1="252" x2="700" y2="252" stroke="currentColor" stroke-width="1.5" marker-end="url(#memArr)"/>
  <!-- y axis title -->
  <text x="22" y="150" text-anchor="middle" font-size="12" fill="currentColor" transform="rotate(-90 22 150)">resident memory (RSS)</text>
  <!-- x axis title -->
  <text x="386" y="288" text-anchor="middle" font-size="12" fill="currentColor">rows processed (time) &#8594;</text>
  <!-- hard memory ceiling -->
  <line x1="72" y1="64" x2="690" y2="64" stroke="currentColor" stroke-width="1.5" stroke-dasharray="6 4" opacity="0.85"/>
  <text x="688" y="56" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">hard memory ceiling &#8212; never crossed</text>
  <!-- resident floor guide -->
  <line x1="72" y1="230" x2="690" y2="230" stroke="currentColor" stroke-width="1" stroke-dasharray="2 3" opacity="0.5"/>
  <text x="76" y="245" font-size="10" fill="currentColor" opacity="0.7">resident floor (location cache + base)</text>
  <!-- sawtooth profile -->
  <polyline points="72,230 180,92 180,230 300,92 300,230 420,92 420,230 540,92 540,230 660,150 660,230"
            fill="none" stroke="currentColor" stroke-width="2.5"/>
  <!-- flush drop annotations -->
  <text x="180" y="84" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">flush</text>
  <text x="300" y="84" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">flush</text>
  <text x="420" y="84" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">flush</text>
  <text x="540" y="84" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">flush</text>
  <!-- peak = chunk_size reached -->
  <text x="246" y="112" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">chunk_size reached</text>
  <!-- finalize() partial buffer -->
  <text x="660" y="142" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">finalize()</text>
  <text x="660" y="171" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.7">partial</text>
  <!-- peak-height bracket -->
  <line x1="118" y1="92" x2="118" y2="230" stroke="currentColor" stroke-width="1" opacity="0.6"/>
  <line x1="114" y1="92" x2="122" y2="92" stroke="currentColor" stroke-width="1" opacity="0.6"/>
  <line x1="114" y1="230" x2="122" y2="230" stroke="currentColor" stroke-width="1" opacity="0.6"/>
  <text x="128" y="158" font-size="10" fill="currentColor" opacity="0.8">&#8776; 2 &#215; chunk_size &#215; row width</text>
</svg>

| Error condition | Root cause | Detection | Remediation |
|---|---|---|---|
| `MemoryError` during buffer growth | `chunk_size` too large for available RAM × row width | RSS climbs to the ceiling before first flush | Lower `chunk_size`; estimate `chunk_size × bytes_per_row` against the budget |
| GC thrashing / stalled throughput | Tags held as nested dicts, not JSON strings | CPU high, rows/sec falling, frequent gen-2 collections | Serialize tags at append time; keep the buffer flat |
| Partial / corrupt Parquet read downstream | Consumer read a file mid-write | `scan_parquet` raises on a truncated footer | Use the atomic `.tmp` → rename pattern; never write to the final path directly |
| Schema mismatch on merge | Per-chunk Arrow `Struct` inferred from divergent tags | `pl.concat` raises on column-type mismatch | Store tags as one JSON UTF-8 column so every chunk schema is identical |
| Run aborts, no resume point | No manifest of committed chunks | Re-run reprocesses from chunk 0 | Persist a checkpoint manifest of `(chunk_idx, row_count, source_seq)` |
| Disk fills mid-flush | ZSTD level too low / no spill headroom | `OSError: No space left on device` | Raise ZSTD level, route spill to a dedicated NVMe volume, monitor free space |
| `KeyError` on unresolved node ref | Way clipped at extract boundary | Node ID absent from location store | Pass `locations=True, idx="flex_mem"`; quarantine boundary ways |

## Performance & scale considerations

Peak resident memory in this design is dominated by exactly one quantity — the in-flight buffer — and is therefore predictable in advance. With a buffer admitting up to `chunk_size` rows of average serialized width $\bar{w}_{\text{row}}$, plus a transient copy held while Polars materializes the DataFrame for the flush, the working set is bounded by:

$$ M_{\text{peak}} \approx 2 \times \text{chunk\_size} \times \bar{w}_{\text{row}} $$

The factor of two accounts for the buffer and its DataFrame copy coexisting briefly during `_flush_buffer`. This is why `chunk_size` is the primary memory dial: it is linear and knowable, so you size it from your budget rather than discovering the ceiling by crashing. For typical OSM rows (an `int64` id, two coordinate columns, and a JSON tag string averaging a few hundred bytes), a `chunk_size` of 250,000 keeps the working set well under a gigabyte, leaving headroom for the libosmium location cache.

The location cache itself is the other scaling constraint. Resolving way geometry requires every node reference to map to a coordinate, and a planet-scale node index will not fit in RAM — pass `idx="flex_mem"` to let libosmium spill the location store, or use a disk-backed `idx="dense_file_array,locations.cache"` for planet extracts. When even a single bounded stream is too slow, scale horizontally rather than vertically: split the source with `osmium extract` by administrative boundary using the tiling strategies in [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/), run one `ChunkedOSMHandler` per tile, and merge the chunk directories with a lazy `pl.scan_parquet("**/osm_chunk_*.parquet")` so no stage ever materializes all tiles at once.

## Failure modes & gotchas

- **Inferring an Arrow `Struct` for tags is the silent killer.** It works on a single chunk and breaks only at merge time when a later chunk introduces a key the first did not. Always store tags as one JSON UTF-8 column; decode structure downstream where the consumer controls the schema.
- **Writing straight to the final Parquet path invites torn reads.** A consumer globbing the directory can pick up a file with no footer. The `.tmp` → rename is atomic on POSIX and is the cheapest possible safety guarantee — never skip it.
- **`finalize()` is mandatory.** The last buffer is almost never exactly `chunk_size` rows, so without the explicit final flush you silently drop the tail of the extract.
- **`super().__init__()` is not optional.** The pyosmium C++ binding requires it; omitting it produces a confusing segfault rather than a Python error.
- **Forgetting `locations=True` turns way callbacks into `KeyError`s.** Without the location cache, `w.nodes` references resolve to nothing; set it (and an appropriate `idx`) at `apply_file` time.
- **`chunk_size` measured in rows, not bytes, drifts with tag density.** A buffer tuned on sparse rural data will overshoot on a dense city where tag strings are long; size against the *widest* expected row, not the average.
- **Spill-to-disk on a slow volume becomes the new bottleneck.** If flushes back up, your disk — not your CPU — is the limit; route the chunk directory to NVMe before widening any parallelism.

## Integration points

The chunk directory this stage produces is a lazy, columnar staging area that the next pipeline stage scans without re-reading the source extract. Network topology construction is the most common consumer: [OSMnx Graph Conversion Techniques](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/) rebuild routable graphs from these chunks, resolving way `node_refs` against node coordinates only for the rows a query touches. The wiring below merges the chunks lazily, filters to ways with a resolved class, and hands the result to the graph stage:

```python
import logging

import polars as pl

logger = logging.getLogger(__name__)


def stage_for_graph(chunk_dir: str = "./chunks") -> pl.DataFrame:
    """Lazily merge chunk Parquet files and select normalized ways."""
    lf = pl.scan_parquet(f"{chunk_dir}/osm_chunk_*.parquet")
    ways = (
        lf.filter(pl.col("type") == "way")
        .filter(pl.col("tags").str.json_path_match("$.highway").is_not_null())
        .select(["id", "node_refs", "tags"])
    )
    df = ways.collect(streaming=True)  # streaming engine keeps the merge bounded
    logger.info("staged %d ways for graph conversion", df.height)
    return df
```

Because `collect(streaming=True)` runs Polars' out-of-core engine, even the merge step honours the memory budget rather than materializing every chunk. Before geometry is rebuilt and weighted for routing, coordinates promoted from the stored nanodegree integers should be reprojected following [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) so distance and area measurements are correct in the analytical CRS.

## Frequently Asked Questions

<details>
<summary>How do I choose the right chunk_size?</summary>

Size it from your memory budget, not by trial and error. Peak memory is roughly `2 × chunk_size × average_row_bytes`, where the factor of two covers the buffer and its DataFrame copy during a flush. For typical OSM rows with a few-hundred-byte JSON tag string, 250,000 rows stays under a gigabyte. Tune against the widest expected row (dense urban tags), not the average, so a city extract does not overshoot a limit calibrated on rural data.
</details>

<details>
<summary>Why serialize tags to JSON instead of keeping them as a nested column?</summary>

OSM tags are an unbounded, contributor-defined key space. If you let Polars or Arrow infer a `Struct` per chunk, the schema drifts between windows and any later `concat` or `scan_parquet` merge fails on a type mismatch. A single JSON UTF-8 column keeps every chunk schema identical and defers structural decoding to the consumer that actually needs it — which is also cheaper for the garbage collector during buffering.
</details>

<details>
<summary>What makes the chunk writes safe to resume after a crash?</summary>

Two things: atomic writes and a manifest. Each chunk is written to a `.parquet.tmp` file and only renamed to its final name once complete, so a downstream glob never sees a torn file. Logging each committed `(chunk_idx, row_count)` lets an interrupted run skip already-written chunks and resume from the last good one instead of restarting from zero.
</details>

<details>
<summary>When should I switch from a single stream to parallel tiles?</summary>

When a single bounded stream is throughput-limited rather than memory-limited. Split the source with `osmium extract` by administrative boundary, run one `ChunkedOSMHandler` per tile into its own directory, and merge with a lazy `pl.scan_parquet`. If memory is still the binding constraint within each worker, keep tiles small; if you simply need to overlap I/O and CPU, the process-pool approach in Async PBF Parsing with Pyrosm is the better fit.
</details>

<details>
<summary>Why do my way rows raise KeyError on node references?</summary>

You parsed without a location cache. Way callbacks resolve `w.nodes` against libosmium's node-location store, so call `apply_file(path, locations=True, idx="flex_mem")` (or a disk-backed index for planet extracts). Ways clipped at the extract boundary will still reference nodes outside the file — quarantine those rather than letting the `KeyError` abort the stream.
</details>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Process large OSM extracts in bounded memory with streaming chunks",
  "description": "Stream an OSM PBF extract through a bounded pyosmium buffer, normalize each window in place, and flush validated records to ZSTD Parquet with atomic writes and a resume manifest.",
  "step": [
    { "@type": "HowToStep", "name": "Subclass the streaming handler", "text": "Extend osmium.SimpleHandler so node() and way() callbacks append flat rows to a bounded list rather than a growing global collection." },
    { "@type": "HowToStep", "name": "Flatten tags at append time", "text": "Serialize each tag dictionary to a JSON string immediately so the buffer holds compact strings instead of nested objects the garbage collector must walk." },
    { "@type": "HowToStep", "name": "Flush at the threshold", "text": "When the buffer reaches chunk_size, write a Polars DataFrame to a .parquet.tmp file with ZSTD compression, then atomically rename it to its final name." },
    { "@type": "HowToStep", "name": "Drain the tail", "text": "After apply_file returns, call finalize() once to flush the final partial buffer so the tail of the extract is not dropped." },
    { "@type": "HowToStep", "name": "Merge lazily for the next stage", "text": "Read the chunk directory with pl.scan_parquet and collect with streaming=True so topology construction never materializes all chunks at once." }
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
      "name": "How do I choose the right chunk_size?",
      "acceptedAnswer": { "@type": "Answer", "text": "Size it from your memory budget. Peak memory is roughly 2 times chunk_size times the average row bytes, covering the buffer and its DataFrame copy during a flush. For typical OSM rows with a few-hundred-byte JSON tag string, 250000 rows stays under a gigabyte. Tune against the widest expected row, not the average." }
    },
    {
      "@type": "Question",
      "name": "Why serialize tags to JSON instead of keeping them as a nested column?",
      "acceptedAnswer": { "@type": "Answer", "text": "OSM tags are an unbounded contributor-defined key space. Inferring an Arrow Struct per chunk makes the schema drift between windows so a later concat or scan_parquet merge fails on a type mismatch. A single JSON UTF-8 column keeps every chunk schema identical and defers structural decoding to the consumer." }
    },
    {
      "@type": "Question",
      "name": "What makes the chunk writes safe to resume after a crash?",
      "acceptedAnswer": { "@type": "Answer", "text": "Atomic writes and a manifest. Each chunk is written to a .parquet.tmp file and renamed only when complete, so a downstream glob never sees a torn file. Logging each committed chunk index and row count lets an interrupted run skip already-written chunks and resume from the last good one." }
    },
    {
      "@type": "Question",
      "name": "When should I switch from a single stream to parallel tiles?",
      "acceptedAnswer": { "@type": "Answer", "text": "When a single stream is throughput-limited rather than memory-limited. Split the source with osmium extract by administrative boundary, run one ChunkedOSMHandler per tile, and merge with a lazy pl.scan_parquet. If memory is still the binding constraint per worker, keep tiles small." }
    },
    {
      "@type": "Question",
      "name": "Why do my way rows raise KeyError on node references?",
      "acceptedAnswer": { "@type": "Answer", "text": "You parsed without a location cache. Call apply_file with locations=True and idx=flex_mem (or a disk-backed index for planet extracts) so way callbacks resolve node references. Ways clipped at the extract boundary still reference outside nodes, so quarantine those rather than letting the KeyError abort the stream." }
    }
  ]
}
</script>

## In this section

The focused guides below drill into the two levers that keep a stream inside its budget:

- [A Bounded LRU Node Cache for OSM Streaming](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/bounded-lru-node-cache-for-osm-streaming/) — capping the node-location store so way reconstruction stays within a fixed memory ceiling.
- [Sizing PBF Chunk Batches to a Memory Budget](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/sizing-pbf-chunk-batches-to-a-memory-budget/) — deriving a safe batch size from element width and the RAM you can spend.

## Related

- [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/) — process-pool concurrency for when throughput, not memory, is the binding constraint.
- [Batch Attribute Mapping Strategies](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/) — the controlled vocabularies each chunk normalizes against.
- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — triaging the boundary and malformed records this stage quarantines.
- [OSMnx Graph Conversion Techniques](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/) — turning the staged chunk directory into routing-ready graphs.
- [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) — why a block, not a byte offset, is the unit libosmium streams.
- [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/) — boundary tiling that lets you scale a single stream horizontally.

This guide is part of [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/); return to that overview to follow the data through async ingestion, attribute mapping, error triage, and routing-graph conversion.
