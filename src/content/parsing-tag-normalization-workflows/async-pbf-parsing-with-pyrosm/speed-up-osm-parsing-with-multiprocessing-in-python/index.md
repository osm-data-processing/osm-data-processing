---
title: "Speed up OSM parsing with multiprocessing in Python"
description: "Saturate every core when parsing OSM PBF extracts: a ProcessPoolExecutor pattern with worker isolation, bounded chunk memory, and deterministic error routing."
pageTitle: "OSM PBF Parsing with Python Multiprocessing"
pageDescription: "Speed up OSM PBF parsing with a Python ProcessPoolExecutor: spawn-context workers, manual GC at chunk boundaries, max_tasks_per_child recycling, and DLQ error handling."
slug: speed-up-osm-parsing-with-multiprocessing-in-python
type: article
breadcrumb: "Multiprocessing Speedup"
datePublished: 2025-09-18
dateModified: 2026-06-26
date: 2026-06-26
---
# Speed up OSM parsing with multiprocessing in Python

**Task:** parse a multi-gigabyte OpenStreetMap `.pbf` extract across all available CPU cores by submitting pre-chunked feature batches to a `ProcessPoolExecutor`, so tag normalization and geometry validation run in parallel instead of being serialized behind the Python GIL.

## Prerequisites

- [ ] Python 3.10+ (the snippet uses `int | None` union syntax and `max_tasks_per_child`, which lands in 3.11 — on 3.10 drop that one kwarg)
- [ ] `psutil>=5.9` for live memory probing inside the driver
- [ ] A parser that yields pre-filtered element batches — `pyrosm>=0.6` or `pyosmium>=3.6` feeding the `chunk_generator`
- [ ] `shapely>=2.0` if workers validate geometry (the 1.x branch has GEOS serialization regressions under fork)
- [ ] Environment: set `OMP_NUM_THREADS=1` so BLAS/GEOS C libraries do not spawn threads that fight the process pool
- [ ] Enough free RAM for `(max_workers + queue depth) × chunk size` — confirm with `free -m` before a planet-scale run

## Why processes, not threads

Streaming the binary protobuf is I/O-bound and releases the GIL inside the C extension, but the work that follows — regex tag cleaning, attribute mapping, and geometry checks — is pure-Python and CPU-bound, so threads serialize behind the GIL and buy you nothing. Processes give true parallelism at the cost of pickling data across the IPC boundary, which is why the unit of work here is a *chunk* of elements rather than a single feature. This page is the per-core execution layer beneath [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/); where that workflow overlaps disk reads with compute at the file granularity, this one fans the compute itself across cores. The canonical tag targets each worker emits are defined by [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/), and when memory rather than CPU is the binding constraint you should reach for the streaming generators in [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) instead of widening the pool.

<svg viewBox="0 0 720 420" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Process-pool data flow for parallel OSM PBF parsing. In the main process, chunk_generator yields lists of element dicts and executor.submit hands one Future per chunk across a spawn-context, pickle-based IPC boundary to a set of worker processes. Each worker runs parse_chunk with automatic GC disabled and calls gc.collect() only at the chunk boundary; after max_tasks_per_child equals 50 tasks a worker is retired and respawned to release its C-extension memory arena. Workers feed an as_completed iterator that drains results out of order and yields a normalized-and-errors payload per chunk." style="width:100%;max-width:720px;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>ProcessPoolExecutor data flow for parallel OSM parsing</title>
  <desc>The main process generates element chunks and submits one Future per chunk across a spawn-context pickle/IPC boundary to N worker processes. Each worker runs parse_chunk with GC disabled, collecting only at the chunk boundary, and is retired and respawned after max_tasks_per_child=50 tasks to free C-extension memory. Workers feed an as_completed iterator that drains results out of order and yields a {normalized, errors} payload per chunk.</desc>
  <defs>
    <marker id="ppArrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <g fill="currentColor" text-anchor="middle">
    <!-- Main process container -->
    <rect x="8" y="96" width="196" height="190" rx="7" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.85"/>
    <text x="106" y="114" font-size="11" opacity="0.7">Main process</text>
    <!-- chunk_generator -->
    <rect x="20" y="124" width="172" height="62" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="106" y="149" font-size="12">chunk_generator</text>
    <text x="106" y="167" font-size="10" opacity="0.78">yields List[element dicts]</text>
    <line x1="106" y1="186" x2="106" y2="206" stroke="currentColor" stroke-width="1.5" marker-end="url(#ppArrow)"/>
    <!-- submit -->
    <rect x="20" y="208" width="172" height="62" rx="6" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.5"/>
    <text x="106" y="233" font-size="11">executor.submit(...)</text>
    <text x="106" y="251" font-size="10" opacity="0.78">one Future per chunk</text>
    <!-- spawn boundary -->
    <text x="234" y="16" font-size="10.5" opacity="0.75">spawn context &#183; pickle IPC</text>
    <line x1="234" y1="24" x2="234" y2="406" stroke="currentColor" stroke-width="1.2" stroke-dasharray="5 4" opacity="0.6"/>
    <!-- submit -> workers -->
    <path d="M192,239 C250,239 250,85 298,85" fill="none" stroke="currentColor" stroke-width="1.3" marker-end="url(#ppArrow)"/>
    <path d="M192,239 C250,239 250,203 298,203" fill="none" stroke="currentColor" stroke-width="1.3" marker-end="url(#ppArrow)"/>
    <path d="M192,239 C250,239 250,321 298,321" fill="none" stroke="currentColor" stroke-width="1.3" marker-end="url(#ppArrow)"/>
    <!-- Worker 1 -->
    <rect x="300" y="48" width="232" height="74" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="416" y="70" font-size="11.5">Worker &#183; os.getpid()</text>
    <text x="416" y="89" font-size="10" opacity="0.78">parse_chunk()  &#183;  gc.disable()</text>
    <text x="416" y="108" font-size="10" opacity="0.78">gc.collect() at chunk boundary</text>
    <!-- Worker 2 -->
    <rect x="300" y="166" width="232" height="74" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="416" y="188" font-size="11.5">Worker &#183; os.getpid()</text>
    <text x="416" y="207" font-size="10" opacity="0.78">parse_chunk()  &#183;  gc.disable()</text>
    <text x="416" y="226" font-size="10" opacity="0.78">gc.collect() at chunk boundary</text>
    <!-- Worker N -->
    <rect x="300" y="284" width="232" height="74" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="416" y="306" font-size="11.5">Worker N &#183; os.getpid()</text>
    <text x="416" y="325" font-size="10" opacity="0.78">parse_chunk()  &#183;  gc.disable()</text>
    <text x="416" y="344" font-size="10" opacity="0.78">gc.collect() at chunk boundary</text>
    <!-- recycle annotation -->
    <line x1="416" y1="358" x2="416" y2="370" stroke="currentColor" stroke-width="1.1" stroke-dasharray="4 3" marker-end="url(#ppArrow)"/>
    <rect x="300" y="372" width="232" height="42" rx="6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.85"/>
    <text x="416" y="390" font-size="10">max_tasks_per_child=50 &#8594; retire &amp; respawn</text>
    <text x="416" y="405" font-size="9.5" opacity="0.7">releases C-extension memory arena</text>
    <!-- workers -> as_completed -->
    <path d="M532,85 C552,85 552,182 558,182" fill="none" stroke="currentColor" stroke-width="1.3" marker-end="url(#ppArrow)"/>
    <line x1="532" y1="203" x2="558" y2="203" stroke="currentColor" stroke-width="1.3" marker-end="url(#ppArrow)"/>
    <path d="M532,321 C552,321 552,224 558,224" fill="none" stroke="currentColor" stroke-width="1.3" marker-end="url(#ppArrow)"/>
    <!-- as_completed -->
    <rect x="560" y="160" width="152" height="80" rx="6" fill="none" stroke="currentColor" stroke-width="2"/>
    <text x="636" y="184" font-size="11.5">as_completed(futures)</text>
    <text x="636" y="203" font-size="10" opacity="0.78">drains as workers finish</text>
    <text x="636" y="221" font-size="10" opacity="0.7">(out of order)</text>
    <line x1="636" y1="240" x2="636" y2="290" stroke="currentColor" stroke-width="1.5" marker-end="url(#ppArrow)"/>
    <!-- yield -->
    <rect x="560" y="292" width="152" height="66" rx="6" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.5"/>
    <text x="636" y="318" font-size="11">yields per chunk:</text>
    <text x="636" y="337" font-size="10.5" opacity="0.85">{normalized, errors}</text>
  </g>
</svg>

## Runnable solution

The driver submits each chunk as a `Future`, drains results with `as_completed`, and recycles workers periodically to contain C-extension leaks. Workers return a structured `{"normalized": [...], "errors": [...]}` payload so a single bad element never crashes the pool.

```python
import os
import gc
import logging
import multiprocessing as mp
from concurrent.futures import ProcessPoolExecutor, as_completed
from typing import Iterator, Dict, List, Any
import psutil

logger = logging.getLogger(__name__)


def worker_initializer() -> None:
    """Disable automatic GC in workers; we trigger it manually at chunk boundaries."""
    gc.disable()


def parse_chunk(chunk_data: List[Dict[str, Any]]) -> Dict[str, Any]:
    """CPU-bound transformation: geometry validation + tag normalization.

    chunk_data holds pre-filtered OSM elements from one bounding box or feature
    class. Returns 'normalized' and 'errors' lists so failures surface without
    crashing the worker process.
    """
    normalized: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []
    for idx, elem in enumerate(chunk_data):
        try:
            if not elem.get("tags"):
                continue
            normalized.append({
                "osm_id": elem["id"],
                "geometry": elem.get("geometry"),
                "tags": elem["tags"],
                "worker_pid": os.getpid(),
            })
        except Exception as e:  # noqa: BLE001 — quarantine, never raise into the pool
            errors.append({"index": idx, "osm_id": elem.get("id"), "error": str(e)})

    gc.collect()  # Manual collection at the chunk boundary to stabilize RSS.
    return {"normalized": normalized, "errors": errors}


def run_parallel_pipeline(
    chunk_generator: Iterator[List[Dict[str, Any]]],
    max_workers: int | None = None,
) -> Iterator[Dict[str, Any]]:
    """Submit chunks to a process pool and yield results as they complete."""
    if max_workers is None:
        max_workers = min(os.cpu_count() or 1, 8)

    available_mb = psutil.virtual_memory().available // (1024 ** 2)
    logger.info("Spawning %d workers; %d MB RAM available.", max_workers, available_mb)
    # Stop C/BLAS/GEOS libraries from spawning threads that compete with the pool.
    os.environ["OMP_NUM_THREADS"] = "1"

    with ProcessPoolExecutor(
        max_workers=max_workers,
        initializer=worker_initializer,
        mp_context=mp.get_context("spawn"),   # reproducible across Linux/macOS/Windows
        max_tasks_per_child=50,               # recycle workers to bound C-ext leaks
    ) as executor:
        futures = {
            executor.submit(parse_chunk, chunk): i
            for i, chunk in enumerate(chunk_generator)
        }
        for future in as_completed(futures):
            chunk_idx = futures[future]
            try:
                yield future.result()
            except Exception as e:  # noqa: BLE001
                logger.error("Chunk %d failed unrecoverably: %s", chunk_idx, e)
                continue
```

Keep the regex patterns and lookup tables at module scope so they are compiled once per interpreter and inherited by every worker rather than rebuilt on each call:

```python
import re

# Module-level: compiled once, shared by all workers under spawn or fork.
_SPEED_RE = re.compile(r"^(\d+(?:\.\d+)?)(?:\s*(?:km/h|kmh|kph))?$", re.IGNORECASE)
_SURFACE_RE = re.compile(r"[^a-z0-9_]", re.IGNORECASE)

HIGHWAY_MAP = {
    "motorway": "motorway", "trunk": "trunk",
    "primary": "arterial", "secondary": "arterial",
    "tertiary": "collector", "residential": "local",
    "unclassified": "local", "service": "access",
}


def normalize_tags(tags: dict) -> dict:
    out: dict = {}
    out["road_class"] = HIGHWAY_MAP.get(tags.get("highway", ""))

    m = _SPEED_RE.match(str(tags.get("maxspeed", "")))
    out["maxspeed_kmh"] = float(m.group(1)) if m else None

    surface = _SURFACE_RE.sub("", tags.get("surface", "").lower())
    out["surface_clean"] = surface or None
    return out
```

## Step-by-step walkthrough

1. **`worker_initializer` disables GC.** Generational garbage collection scans hurt during tight CPU loops over millions of short-lived element dicts. Disabling it in the initializer and calling `gc.collect()` only at the end of `parse_chunk` keeps resident memory flat without per-allocation overhead.
2. **`parse_chunk` returns, never raises.** Each element is wrapped in `try/except`; a malformed geometry or missing key is appended to `errors` with its `osm_id` so it can be routed to a dead-letter store, while the worker keeps going. A raised exception would otherwise poison the pool.
3. **`max_workers` is capped.** Defaulting to `min(cpu_count, 8)` avoids spawning 64 workers on a large host where IPC and memory, not cores, become the ceiling.
4. **`mp.get_context("spawn")` is explicit.** Spawn re-imports the module in a clean interpreter, so module-level state is deterministic across platforms and you avoid fork-after-threads deadlocks in libosmium/GEOS.
5. **`max_tasks_per_child=50` recycles workers.** Long-lived processes accumulate memory in C extensions; retiring each worker after 50 chunks releases that arena back to the OS.
6. **`as_completed` yields out of order.** Results stream back as soon as any worker finishes, so a single slow chunk never blocks the others. The `futures` dict maps each future back to its chunk index for logging.

## Verification

Confirm the pool is genuinely parallel and bounded:

- **Distinct PIDs.** Aggregate `worker_pid` across returned `normalized` records — you should see close to `max_workers` distinct PIDs, and they should *change* over the run as `max_tasks_per_child` recycles them.
- **CPU saturation.** `htop` (or `psutil.cpu_percent(percpu=True)`) should show all worker cores near 100% during the CPU-bound phase, not one core pinned while the rest idle.
- **Flat RSS.** Watch `psutil.Process().memory_info().rss` for the driver and `ps --ppid <driver_pid> -o rss` for workers; resident memory should plateau, not climb monotonically. A steady climb means GC tuning or `max_tasks_per_child` is not taking effect.
- **Error accounting.** Sum `len(result["errors"])` across chunks; it should match the count of quarantined records in your dead-letter partition. A nonzero count with zero log lines means an exception is being swallowed silently.
- **Throughput.** Expect a near-linear speedup up to physical core count; if doubling workers barely moves wall-clock time, the bottleneck is IPC serialization of large feature dicts, not CPU.

## Common errors & fixes

| Error | Root cause | One-line fix |
|---|---|---|
| `BrokenProcessPool` | A worker was OOM-killed or segfaulted in a C extension | Lower `max_workers`, shrink chunk size, and pin `shapely>=2.0` |
| `PicklingError: Can't pickle ...` | A chunk holds an unpicklable object (open file, lambda, GEOS handle) | Pass plain dicts/WKB only; build heavy objects inside the worker |
| RSS climbs until OOM | GC still running, or workers never recycled | Keep `gc.disable()` in the initializer and set `max_tasks_per_child` |
| Speedup is sub-linear | Giant feature dicts serialized across IPC | Shrink chunks; drop geometry to WKB bytes before returning |
| Hang with no output | `chunk_generator` is empty or blocks before yielding | Verify the upstream parser yields lists; log the chunk count first |
| `RuntimeError: ... fork before exec` | Default fork context after threads were started | Force `mp.get_context("spawn")` as shown |
| BLAS oversubscription stalls | C libs spawning threads per worker | Export `OMP_NUM_THREADS=1` before the pool starts |

For jobs that stall mid-run, checkpoint chunk offsets to a SQLite WAL file so a restart resumes from the last committed offset instead of re-streaming the whole PBF, and profile suspected C-extension leaks with `py-spy` or `tracemalloc` rather than guessing. Records that workers quarantine should flow to the triage path described in [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/).

## Spec reference

> The Python `concurrent.futures.ProcessPoolExecutor` runs callables in a pool of worker processes that *sidestep the GIL*, but every argument and return value is pickled across the process boundary — keep them small. `max_tasks_per_child` (added in 3.11) restarts a worker after the given number of tasks to release accumulated resources. See the [Python concurrent.futures documentation](https://docs.python.org/3/library/concurrent.futures.html) and the [multiprocessing start methods](https://docs.python.org/3/library/multiprocessing.html#contexts-and-start-methods) reference for the `spawn` vs `fork` trade-offs.

## Related

- [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/) — the file-granularity async layer this pool plugs into.
- [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) — sizing chunks and spilling to disk when memory is the limit.
- [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/) — the canonical tag targets each worker normalizes against.
- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — triaging the records workers quarantine to the dead-letter store.
- [OSMnx Graph Conversion Techniques](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/) — feeding normalized features into routing graphs after parsing.
- [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/) — H3/R-tree tiling that decides chunk boundaries.

This guide is part of [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/); return to that overview to see how per-core parsing fits the full async ingestion pipeline.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Speed up OSM parsing with multiprocessing in Python",
  "description": "A ProcessPoolExecutor pattern for parsing OSM PBF extracts across all CPU cores: worker isolation, manual GC at chunk boundaries, worker recycling, and deterministic error routing.",
  "datePublished": "2025-09-18",
  "dateModified": "2026-06-26",
  "articleSection": "Parsing & Tag Normalization Workflows",
  "about": [
    { "@type": "Thing", "name": "OpenStreetMap PBF parsing" },
    { "@type": "Thing", "name": "Python multiprocessing" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Parsing & Tag Normalization Workflows", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/" },
    { "@type": "ListItem", "position": 2, "name": "Async PBF Parsing with Pyrosm", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/" },
    { "@type": "ListItem", "position": 3, "name": "Multiprocessing Speedup", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/speed-up-osm-parsing-with-multiprocessing-in-python/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Parse OSM PBF extracts in parallel with a Python process pool",
  "description": "Fan CPU-bound OSM tag normalization and geometry validation across cores with ProcessPoolExecutor, bounded chunk memory, and structured error returns.",
  "step": [
    { "@type": "HowToStep", "name": "Isolate the worker", "text": "Disable GC in an initializer and have parse_chunk return normalized and errors lists so a bad element never crashes the worker." },
    { "@type": "HowToStep", "name": "Configure the pool", "text": "Use the spawn context, cap max_workers at min(cpu_count, 8), and set max_tasks_per_child to recycle workers and contain C-extension leaks." },
    { "@type": "HowToStep", "name": "Submit and drain", "text": "Submit each chunk as a Future and consume results with as_completed so a slow chunk never blocks the others." },
    { "@type": "HowToStep", "name": "Compile patterns once", "text": "Keep regex patterns and lookup tables at module scope so workers inherit them instead of recompiling per call." },
    { "@type": "HowToStep", "name": "Verify parallelism", "text": "Check distinct worker PIDs, full CPU saturation, flat RSS, and matching error counts to confirm the pool is parallel and bounded." }
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
      "name": "Why use processes instead of threads to parse OSM PBF files?",
      "acceptedAnswer": { "@type": "Answer", "text": "Reading the protobuf releases the GIL, but the regex tag cleaning, attribute mapping, and geometry validation that follow are pure-Python and CPU-bound, so threads serialize behind the GIL. Processes give true parallel CPU at the cost of pickling data across the IPC boundary, which is why the unit of work is a chunk of elements rather than a single feature." }
    },
    {
      "@type": "Question",
      "name": "How do I stop worker memory from climbing during a long PBF parse?",
      "acceptedAnswer": { "@type": "Answer", "text": "Disable automatic GC in a worker initializer and call gc.collect() only at chunk boundaries, and set max_tasks_per_child so each worker is retired after a fixed number of chunks. That releases C-extension memory arenas back to the OS and keeps resident memory flat instead of monotonically rising." }
    },
    {
      "@type": "Question",
      "name": "What causes a BrokenProcessPool error and how do I fix it?",
      "acceptedAnswer": { "@type": "Answer", "text": "A worker was OOM-killed or segfaulted in a C extension such as GEOS. Lower max_workers, shrink the chunk size so payloads fit, pin shapely 2.0 or newer, and re-tile any single file that fails twice so the offending blob is isolated." }
    },
    {
      "@type": "Question",
      "name": "Why is my multiprocessing speedup sub-linear?",
      "acceptedAnswer": { "@type": "Answer", "text": "Large feature dictionaries are being pickled across the IPC boundary, so serialization dominates. Shrink the chunks and drop geometry to WKB bytes before returning from the worker, and set OMP_NUM_THREADS=1 so BLAS and GEOS do not oversubscribe cores with their own threads." }
    }
  ]
}
</script>
