---
title: "Tuning Pyrosm Worker Count for PBF Parsing"
description: "Choose the process-pool size for parallel pyrosm and pyosmium PBF parsing so throughput scales with cores without exhausting RAM, using a benchmark sweep and a memory-budget sizing formula."
pageTitle: "Tune Pyrosm Worker Count for Parallel PBF Parsing"
pageDescription: "Size the process pool for pyrosm PBF parsing: benchmark throughput versus worker count, measure peak RSS per worker, and cap workers against a RAM budget."
slug: tuning-pyrosm-worker-count-for-pbf-parsing
type: article
breadcrumb: "Tuning Worker Count"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# Tuning Pyrosm Worker Count for PBF Parsing

Pick the number of processes for a parallel pyrosm or pyosmium parse of a tiled OSM extract so throughput climbs with your cores but total resident memory never crosses the RAM budget and triggers an OOM kill — and back the choice with a measured sweep rather than a guess.

## Prerequisites

Work through this list before you trust any worker-count number; the right value is a property of your hardware and your tiles, not a universal constant.

- [ ] Python 3.10+ with `concurrent.futures.ProcessPoolExecutor` available from the standard library.
- [ ] `pyrosm` ≥ 0.6 installed (`pip install pyrosm`) for the per-tile parse used in the benchmark.
- [ ] `psutil` ≥ 5.9 (`pip install psutil`) to sample per-process resident-set size during the sweep.
- [ ] A set of representative `.osm.pbf` tiles produced by the ingestion stage in [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/) — not one atypical tile.
- [ ] A firm RAM budget in bytes: total machine memory minus headroom for the OS, the parent process, and any downstream sink.
- [ ] The core count from `os.cpu_count()`, and awareness of whether your parse is CPU-bound or I/O-bound (covered below).

## Conceptual minimum

Parallel PBF parsing is embarrassingly parallel at the *tile* granularity: each worker process opens one extract, parses it independently, and returns a compact result. Adding workers raises throughput — but only until one of two ceilings is hit. The first is the **core ceiling**: once every physical core is busy on CPU-bound parse work, another worker just time-slices an already-saturated CPU and buys nothing. The second, and the one that actually bites in OSM pipelines, is the **memory ceiling**. Each pyrosm worker materializes a full GeoDataFrame, so its peak resident-set size (RSS) can run to hundreds of megabytes on a dense tile. Multiply that by too many workers and total RSS crosses the RAM budget; the kernel's OOM killer reaps a worker, the pool raises `BrokenProcessPool`, and the whole job dies — usually hours in.

So the correct worker count is the smaller of the two ceilings. If a worker's peak RSS is `peak_RSS_per_worker` and you are willing to spend `RAM_budget` bytes on parsing, then memory admits at most `floor(RAM_budget / peak_RSS_per_worker)` workers, and cores admit at most `cores`. The safe pool size is:

$$ \text{workers} = \min\!\left(\text{cores},\; \left\lfloor \frac{\text{RAM\_budget}}{\text{peak\_RSS\_per\_worker}} \right\rfloor \right) $$

The two inputs behave differently. `cores` is fixed and free to read; `peak_RSS_per_worker` must be *measured*, because it depends on tile density, whether you request geometry, and which feature classes you pull. The measurement matters more than the formula: guess the RSS low and you reintroduce the OOM you were avoiding. Whether cores or memory wins also depends on the nature of the work — a distinction worth making explicit before benchmarking.

<svg viewBox="0 0 720 400" role="img" aria-label="A chart of parsing throughput in tiles per second on the vertical axis against worker count on the horizontal axis. Throughput rises steeply, then bends over into diminishing returns as it approaches the core count, and would plateau. A vertical dashed memory-ceiling line sits before the core count marks the point where total resident memory equals the RAM budget; workers to the right of it are shaded as the out-of-memory-risk zone. The safe operating point is the smaller of the core knee and the memory ceiling." xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:720px;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>Throughput versus worker count with a memory ceiling</title>
  <desc>Throughput in tiles per second rises with worker count, bending into diminishing returns near the core count. A vertical dashed line marks the memory ceiling where total resident set equals the RAM budget; the region to its right is the out-of-memory risk zone. The safe worker count is the smaller of the core knee and the memory ceiling.</desc>
  <defs>
    <marker id="twc-arr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <!-- axes -->
  <line x1="70" y1="330" x2="680" y2="330" stroke="currentColor" stroke-width="1.5" marker-end="url(#twc-arr)"/>
  <line x1="70" y1="330" x2="70" y2="40" stroke="currentColor" stroke-width="1.5" marker-end="url(#twc-arr)"/>
  <text x="375" y="382" text-anchor="middle" font-size="12" fill="currentColor">Worker count</text>
  <text x="24" y="185" text-anchor="middle" font-size="12" fill="currentColor" transform="rotate(-90 24 185)">Throughput (tiles/s)</text>
  <!-- OOM risk zone shading -->
  <rect x="470" y="40" width="210" height="290" fill="currentColor" fill-opacity="0.08"/>
  <text x="575" y="70" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">OOM-risk zone</text>
  <text x="575" y="86" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.75">total RSS &gt; budget</text>
  <!-- throughput curve: steep then diminishing -->
  <path d="M70,330 C150,250 210,150 300,110 C360,86 420,78 470,74" fill="none" stroke="currentColor" stroke-width="2.2"/>
  <!-- projected plateau beyond ceiling (dashed) -->
  <path d="M470,74 C540,70 610,69 660,69" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="5 4" opacity="0.6"/>
  <!-- memory ceiling line -->
  <line x1="470" y1="40" x2="470" y2="330" stroke="currentColor" stroke-width="1.6" stroke-dasharray="6 4"/>
  <text x="470" y="352" text-anchor="middle" font-size="10.5" fill="currentColor">memory ceiling</text>
  <!-- core knee marker -->
  <line x1="560" y1="60" x2="560" y2="330" stroke="currentColor" stroke-width="1.2" stroke-dasharray="3 3" opacity="0.6"/>
  <text x="560" y="352" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.8">core count</text>
  <!-- safe operating point -->
  <circle cx="470" cy="74" r="5.5" fill="currentColor"/>
  <text x="452" y="128" text-anchor="end" font-size="10.5" fill="currentColor">safe operating</text>
  <text x="452" y="143" text-anchor="end" font-size="10.5" fill="currentColor">point = min(knee,</text>
  <text x="452" y="158" text-anchor="end" font-size="10.5" fill="currentColor">ceiling)</text>
  <!-- diminishing-returns annotation -->
  <text x="300" y="96" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">diminishing returns near cores</text>
</svg>

Whether the core knee or the memory ceiling comes first is set by the parse profile. **CPU-bound** parses — pulling networks and reconstructing geometry — saturate cores, so throughput bends over near `cores` and you rarely want more workers than physical cores. **I/O-bound** parses — reading large tiles off a slow disk while doing little per-record work — leave cores idle, so a few extra workers overlap disk latency, but each still costs a full worker's RSS, so the memory ceiling is unforgiving regardless. When memory is the true constraint, widening the pool is the wrong move; fall back to the streaming approach in [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) instead.

## Runnable solution

The script sweeps worker counts from 1 up to the core count, measuring wall-clock throughput and peak per-worker RSS at each step, then applies the sizing formula to recommend a pool size that fits the RAM budget. It targets Python 3.10+, `pyrosm>=0.6`, and `psutil>=5.9`.

```python
from __future__ import annotations

import logging
import os
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import psutil
from pyrosm import OSM

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.worker_tuner")

# RAM you are willing to spend on parsing (bytes): leave OS + parent headroom.
RAM_BUDGET = 12 * 1024**3


def parse_tile(tile_path: str) -> tuple[int, int]:
    """Parse one tile; return (row_count, peak_rss_bytes) for this worker."""
    reader = OSM(tile_path)
    gdf = reader.get_network(network_type="driving")
    rows = 0 if gdf is None or gdf.empty else len(gdf)
    # RSS after the GeoDataFrame is materialized is this worker's peak.
    peak_rss = psutil.Process(os.getpid()).memory_info().rss
    return rows, peak_rss


def sweep(tiles: list[Path], max_workers: int) -> None:
    """Benchmark throughput and per-worker RSS across worker counts."""
    cores = os.cpu_count() or 1
    upper = min(max_workers, cores)
    best_peak_rss = 0

    for n in range(1, upper + 1):
        start = time.perf_counter()
        with ProcessPoolExecutor(max_workers=n) as pool:
            results = list(pool.map(parse_tile, [str(t) for t in tiles]))
        elapsed = time.perf_counter() - start

        peak_rss = max(rss for _, rss in results)
        best_peak_rss = max(best_peak_rss, peak_rss)
        throughput = len(tiles) / elapsed
        logger.info(
            "workers=%d  throughput=%.2f tiles/s  peak_rss/worker=%.0f MiB",
            n, throughput, peak_rss / 1024**2,
        )

    recommend(cores, best_peak_rss)


def recommend(cores: int, peak_rss_per_worker: int) -> int:
    """workers = min(cores, floor(RAM_BUDGET / peak_RSS_per_worker))."""
    if peak_rss_per_worker <= 0:
        logger.warning("no RSS measurement; defaulting to 1 worker")
        return 1
    mem_ceiling = RAM_BUDGET // peak_rss_per_worker
    workers = max(1, min(cores, mem_ceiling))
    logger.info(
        "cores=%d  mem_ceiling=%d (budget %.0f GiB / %.0f MiB per worker)  -> workers=%d",
        cores, mem_ceiling, RAM_BUDGET / 1024**3,
        peak_rss_per_worker / 1024**2, workers,
    )
    return workers


if __name__ == "__main__":
    tiles = sorted(Path("tiles").glob("*.osm.pbf"))
    sweep(tiles, max_workers=os.cpu_count() or 1)
```

## Step-by-step walkthrough

1. **Measure RSS inside the worker.** `psutil.Process(os.getpid()).memory_info().rss`, read *after* the GeoDataFrame is built, captures that worker's true peak — the number that drives the memory ceiling. Measuring from the parent would miss the per-process footprint entirely.
2. **Cap the sweep at core count.** `min(max_workers, cores)` avoids benchmarking pool sizes that only oversubscribe the CPU; past the core knee, CPU-bound throughput flattens and extra workers just add RSS.
3. **Take the worst-case worker.** `max(rss for _, rss in results)` uses the densest tile's footprint, not the average — sizing against the average is how a single urban tile OOM-kills a pool that "looked fine" on rural data.
4. **Apply the formula.** `recommend` computes `floor(RAM_BUDGET / peak_rss_per_worker)` for the memory ceiling and takes the `min` with `cores`, clamped to at least one worker so a huge tile never yields a zero-worker recommendation.
5. **Read throughput, not just success.** The per-`n` throughput line reveals diminishing returns directly: when going from `n` to `n+1` adds little tiles-per-second, you have passed the knee and the extra RSS is buying nothing.
6. **Re-run per dataset.** Peak RSS is dataset-specific. A continental sweep and a metro sweep produce different recommendations, so tune against tiles that represent the job you will actually run.

## Verification

Confirm the recommended count is both fast and safe:

- **Total RSS stays under budget.** During a full run at the recommended worker count, sum resident memory across workers (`ps` or a `psutil` monitor); the peak must sit below `RAM_BUDGET` with headroom to spare. Crossing it means `peak_RSS_per_worker` was underestimated — re-measure on a denser tile.
- **Throughput is near the knee.** Plot the sweep's tiles-per-second against `n`; the recommended count should land at or just before the point where the curve flattens, not deep into the flat region.
- **No `BrokenProcessPool`.** A clean full run with zero OOM-killed workers is the acceptance test. Any such kill means the pool is too wide for the budget.
- **Formula agrees with observation.** The `recommend` log line's `mem_ceiling` should match where total RSS would actually hit the budget in the sweep; a large discrepancy signals RSS was sampled at the wrong moment.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| `BrokenProcessPool` mid-run | Worker OOM-killed; pool too wide | Lower workers to the `recommend` output; re-measure peak RSS. |
| Throughput flat past N workers | Passed the CPU core knee | Cap workers at physical cores; extra processes only add RSS. |
| Recommendation is 0 workers | Single tile's RSS exceeds the budget | Re-tile smaller (finer H3 resolution) or raise `RAM_BUDGET`. |
| RSS reads far too low | Sampled before GeoDataFrame built | Measure after `get_network` returns, inside the worker. |
| Cores idle, disk pegged | I/O-bound parse under-using CPU | Add a few workers to overlap I/O, but watch the memory ceiling. |
| Memory climbs across the sweep | Executors not closed between runs | Use the `with ProcessPoolExecutor(...)` context so each pool joins. |

## Specification reference

> `concurrent.futures.ProcessPoolExecutor(max_workers=None)` "uses `os.cpu_count()` on the number of worker processes" by default and runs each submission in a separate process, sidestepping the GIL for CPU-bound work — see the [concurrent.futures documentation](https://docs.python.org/3/library/concurrent.futures.html#processpoolexecutor). For the underlying process model, start method, and why each worker carries its own memory image, consult the [multiprocessing documentation](https://docs.python.org/3/library/multiprocessing.html); the per-process RSS it describes is precisely the `peak_RSS_per_worker` term in the sizing formula.

## Frequently Asked Questions

<details>
<summary>Should worker count ever exceed the number of physical cores?</summary>

For CPU-bound geometry reconstruction, no — past the core count you only time-slice a saturated CPU and pay another worker's full RSS for near-zero extra throughput. A modest excess can help a purely I/O-bound parse by overlapping disk latency, but the memory ceiling still applies to every worker, so measure before oversubscribing.
</details>

<details>
<summary>Why measure peak RSS per worker instead of using a fixed rule of thumb?</summary>

Peak RSS depends on tile density, whether you request geometry, and which feature classes you pull, so it varies by an order of magnitude between a rural and an urban tile. A fixed rule that works on one dataset OOM-kills on another; measuring the worst-case tile's footprint is the only way the sizing formula stays honest across jobs.
</details>

<details>
<summary>My pool dies with BrokenProcessPool — is that a code bug?</summary>

Usually not. It most often means the kernel's OOM killer reaped a worker because total resident memory crossed the budget, and the pool surfaces the dead worker as BrokenProcessPool. Reduce the worker count to the formula's output, or re-tile into smaller extracts so each worker's peak RSS drops.
</details>

<details>
<summary>Does the choice of parser change the right worker count?</summary>

Yes. A streaming pyosmium handler holds far less per-process memory than a pyrosm GeoDataFrame, so it admits more workers under the same budget, while pyrosm trades memory for a convenient dataframe. Weigh that trade when picking a library; the comparison in the parser-selection guide covers the memory profiles directly.
</details>

## Related

- [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/) — the concurrent parsing pattern whose process pool this guide sizes.
- [Streaming PBF Blocks Through an Asyncio Queue](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/streaming-pbf-blocks-through-an-asyncio-queue/) — bounding in-flight work at the channel so the pool width is not the only memory dial.
- [Choosing an OSM Parser: pyosmium, pyrosm, osmium](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/) — how each library's memory profile shifts the worker-count ceiling.
- [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) — the streaming alternative when memory, not cores, is the binding constraint.
- [Speed Up OSM Parsing with Multiprocessing in Python](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/speed-up-osm-parsing-with-multiprocessing-in-python/) — the multiprocessing fan-out this tuning applies to.

Up one level: [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Tuning Pyrosm Worker Count for PBF Parsing",
  "description": "Choose the process-pool size for parallel pyrosm and pyosmium PBF parsing so throughput scales with cores without exhausting RAM, using a benchmark sweep and a memory-budget sizing formula.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "Parsing & Tag Normalization Workflows",
  "about": ["process pool sizing", "OSM PBF parsing throughput", "memory-bounded parallelism"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Parsing & Tag Normalization Workflows", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/" },
    { "@type": "ListItem", "position": 3, "name": "Async PBF Parsing with Pyrosm", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/" },
    { "@type": "ListItem", "position": 4, "name": "Tuning Pyrosm Worker Count for PBF Parsing", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/tuning-pyrosm-worker-count-for-pbf-parsing/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Tune the process-pool size for parallel PBF parsing",
  "description": "Benchmark procedure that sweeps worker counts, measures per-worker peak RSS, and applies a memory-budget formula to size the pool for pyrosm PBF parsing.",
  "step": [
    { "@type": "HowToStep", "name": "Measure per-worker peak RSS", "text": "Inside each worker, read resident-set size with psutil after the GeoDataFrame is materialized to capture that process's true peak memory." },
    { "@type": "HowToStep", "name": "Sweep worker counts", "text": "Run the parse across worker counts from one up to the core count, recording throughput in tiles per second and peak RSS at each step." },
    { "@type": "HowToStep", "name": "Take the worst-case tile", "text": "Use the maximum per-worker RSS over the densest tile, not the average, so a single urban tile cannot OOM-kill the pool." },
    { "@type": "HowToStep", "name": "Apply the sizing formula", "text": "Compute floor of RAM budget divided by peak RSS per worker for the memory ceiling and take the minimum with the core count." },
    { "@type": "HowToStep", "name": "Verify under a full run", "text": "Confirm total resident memory stays under budget with no BrokenProcessPool, and that throughput sits at or just before the diminishing-returns knee." }
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
      "name": "Should worker count ever exceed the number of physical cores?",
      "acceptedAnswer": { "@type": "Answer", "text": "For CPU-bound geometry reconstruction, no, because past the core count you only time-slice a saturated CPU and pay another worker's full RSS for near-zero extra throughput. A modest excess can help a purely I/O-bound parse by overlapping disk latency, but the memory ceiling still applies to every worker, so measure before oversubscribing." }
    },
    {
      "@type": "Question",
      "name": "Why measure peak RSS per worker instead of using a fixed rule of thumb?",
      "acceptedAnswer": { "@type": "Answer", "text": "Peak RSS depends on tile density, whether you request geometry, and which feature classes you pull, so it varies by an order of magnitude between a rural and an urban tile. A fixed rule that works on one dataset OOM-kills on another; measuring the worst-case tile's footprint is the only way the sizing formula stays honest across jobs." }
    },
    {
      "@type": "Question",
      "name": "My pool dies with BrokenProcessPool — is that a code bug?",
      "acceptedAnswer": { "@type": "Answer", "text": "Usually not. It most often means the kernel's OOM killer reaped a worker because total resident memory crossed the budget, and the pool surfaces the dead worker as BrokenProcessPool. Reduce the worker count to the formula's output, or re-tile into smaller extracts so each worker's peak RSS drops." }
    },
    {
      "@type": "Question",
      "name": "Does the choice of parser change the right worker count?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes. A streaming pyosmium handler holds far less per-process memory than a pyrosm GeoDataFrame, so it admits more workers under the same budget, while pyrosm trades memory for a convenient dataframe. Weigh that trade when picking a library, since the memory profiles differ directly." }
    }
  ]
}
</script>
