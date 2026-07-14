---
title: "Sizing PBF Chunk Batches to a Memory Budget"
description: "Derive a safe rows-per-chunk from measured per-element memory width and the RAM you can spend, then guard it at runtime with a psutil check that shrinks the batch before RSS reaches the ceiling."
pageTitle: "Size OSM PBF Chunk Batches to a Memory Budget"
pageDescription: "Compute a safe OSM chunk_size from pandas memory_usage(deep=True) per-element bytes and a RAM budget, with a psutil adaptive guard that shrinks the batch as resident memory approaches the limit."
slug: sizing-pbf-chunk-batches-to-a-memory-budget
type: article
breadcrumb: "Sizing Chunk Batches"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# Sizing PBF Chunk Batches to a Memory Budget

Replace the guessed `chunk_size` in a streaming OSM pipeline with a number you compute: measure the real per-element memory width of your rows, subtract fixed overhead from the RAM you are allowed to use, and let a runtime guard shrink the batch before resident memory reaches the ceiling.

## Prerequisites

Check these before trusting the sizing math; an unmeasured `bytes_per_element` is the reason a batch tuned on one extract crashes on another.

- [ ] Python 3.10+ for the type hints and `float | None` syntax used below.
- [ ] `pandas` ≥ 2.1 installed (`pip install "pandas>=2.1"`) for `DataFrame.memory_usage(deep=True)`.
- [ ] `psutil` ≥ 5.9 installed (`pip install "psutil>=5.9"`) for the resident-set (RSS) guard.
- [ ] A representative sample of parsed OSM rows — the same shape produced upstream by [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/) — so the width you measure matches the width you will stream.
- [ ] The buffered-flush pattern from [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/), whose `chunk_size` this page computes instead of hard-codes.
- [ ] A known memory budget in bytes (container limit, cgroup `memory.max`, or a self-imposed fraction of total RAM).

## Conceptual minimum

Every streaming OSM job that flushes fixed-size batches has one dial that decides whether it survives a dense extract: how many rows it lets accumulate before spilling. Pick it too small and you drown in per-flush overhead and tiny row groups; too large and the buffer plus its transient copy blow past the RAM ceiling and the kernel OOM-killer ends the run. The mistake is treating that dial as a constant to be guessed, when it is really the output of a short calculation. If you know how many bytes one buffered element actually occupies, and how many bytes you are permitted to spend, the safe batch size follows directly. This is the same budgeting instinct that the parent [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) guide applies to the buffer as a whole — here it is made explicit and measured per element.

The width of an OSM row is dominated by its tag payload, and tags are contributor-defined free text, so the *only* reliable per-element figure is a measured one. `DataFrame.memory_usage(deep=True)` walks the actual Python objects behind each column — including the variable-length strings a shallow measurement misses — and dividing its total by the row count gives a faithful bytes-per-element for your real data rather than a schema guess. Reserve a fixed `overhead` for the interpreter, imported libraries, and any long-lived caches (the location store, for instance), and the batch size is a floor division:

$$
\text{chunk\_size} = \left\lfloor \frac{B_{\text{budget}} - B_{\text{overhead}}}{\bar{w}_{\text{element}}} \right\rfloor
$$

where $B_{\text{budget}}$ is the RAM you can spend, $B_{\text{overhead}}$ is the fixed resident floor, and $\bar{w}_{\text{element}}$ is the measured deep bytes per row. Because a flush briefly holds the buffer and its serialized copy at once, divide the numerator by a small safety factor (or the measured peak-to-buffer ratio) so the transient copy still fits. A static number computed this way is correct only for the data you measured, though — tag density drifts between rural and urban tiles — so pair it with a runtime [`psutil`](https://psutil.readthedocs.io/en/latest/) guard that samples RSS and shrinks the next batch when the process creeps toward the ceiling. The static formula sets the starting point; the adaptive feedback keeps a mis-measurement from becoming a crash.

<svg viewBox="0 0 800 300" role="img" aria-label="A memory budget in bytes and a measured deep bytes-per-element figure both feed a floor-division that yields the chunk size in rows. The chunk size drives batch accumulation and flush. A psutil RSS sample of the running process feeds an adaptive feedback arrow back to the chunk size, shrinking it when resident memory approaches the ceiling." xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:800px;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>From RAM budget and measured element width to an adaptive chunk size</title>
  <desc>A RAM budget box and a measured bytes-per-element box both feed a floor-division node that outputs chunk size in rows. Chunk size drives a batch-accumulate-and-flush stage. A psutil RSS sample of the process forms an adaptive feedback loop back to chunk size, shrinking it when resident memory nears the ceiling.</desc>
  <defs>
    <marker id="szArr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker>
  </defs>
  <text x="400" y="24" text-anchor="middle" font-size="14" fill="currentColor" font-weight="700">Compute the batch size, then let RSS correct it</text>
  <!-- budget box -->
  <rect x="24" y="52" width="176" height="58" rx="6" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.5"/>
  <text x="112" y="76" text-anchor="middle" font-size="12.5" fill="currentColor">RAM budget</text>
  <text x="112" y="94" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">B_budget &#8722; overhead</text>
  <!-- bytes/element box -->
  <rect x="24" y="132" width="176" height="58" rx="6" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.5"/>
  <text x="112" y="156" text-anchor="middle" font-size="12.5" fill="currentColor">bytes / element</text>
  <text x="112" y="174" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">memory_usage(deep)</text>
  <!-- division node -->
  <rect x="286" y="92" width="150" height="58" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="361" y="116" text-anchor="middle" font-size="12.5" fill="currentColor">floor divide</text>
  <text x="361" y="134" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">budget / width</text>
  <line x1="200" y1="81" x2="284" y2="112" stroke="currentColor" stroke-width="1.5" marker-end="url(#szArr)"/>
  <line x1="200" y1="161" x2="284" y2="130" stroke="currentColor" stroke-width="1.5" marker-end="url(#szArr)"/>
  <!-- chunk size box -->
  <rect x="500" y="92" width="150" height="58" rx="6" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.5"/>
  <text x="575" y="116" text-anchor="middle" font-size="12.5" fill="currentColor">chunk_size</text>
  <text x="575" y="134" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">rows per batch</text>
  <line x1="436" y1="121" x2="498" y2="121" stroke="currentColor" stroke-width="1.5" marker-end="url(#szArr)"/>
  <!-- accumulate & flush -->
  <rect x="500" y="196" width="150" height="58" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="575" y="220" text-anchor="middle" font-size="12.5" fill="currentColor">accumulate</text>
  <text x="575" y="238" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">&amp; flush batch</text>
  <line x1="575" y1="150" x2="575" y2="194" stroke="currentColor" stroke-width="1.5" marker-end="url(#szArr)"/>
  <!-- psutil sample -->
  <rect x="286" y="196" width="150" height="58" rx="6" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 3"/>
  <text x="361" y="220" text-anchor="middle" font-size="12.5" fill="currentColor">psutil RSS</text>
  <text x="361" y="238" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">sample process</text>
  <line x1="500" y1="225" x2="438" y2="225" stroke="currentColor" stroke-width="1.5" marker-end="url(#szArr)"/>
  <!-- adaptive feedback up to chunk size -->
  <path d="M361,196 L361,121 L498,121" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 3" marker-end="url(#szArr)"/>
  <text x="372" y="186" text-anchor="start" font-size="10" fill="currentColor" opacity="0.85">near ceiling &#8594; shrink next batch</text>
</svg>

## Runnable solution

The module below measures per-element width from a sample DataFrame, computes a starting `chunk_size` from the budget, and wraps accumulation in an adaptive guard that halves the batch target whenever RSS climbs past a high-water fraction of the budget. The measurement and the guard are independent, so you can use the sizing math alone, the guard alone, or both.

```python
from __future__ import annotations

import logging
import sys

import pandas as pd
import psutil

logger = logging.getLogger(__name__)


def bytes_per_element(sample: pd.DataFrame) -> float:
    """Measured deep memory width of one row, in bytes.

    ``memory_usage(deep=True)`` follows the Python objects behind object and
    string columns (the variable-length tag strings a shallow count misses),
    so the per-row figure reflects real data rather than a schema estimate.
    """
    if sample.empty:
        raise ValueError("need a non-empty sample to measure element width")
    total = int(sample.memory_usage(deep=True).sum())
    return total / len(sample)


def sizing_overhead() -> int:
    """A conservative fixed floor: current process RSS at measurement time."""
    return psutil.Process().memory_info().rss


def compute_chunk_size(
    budget_bytes: int,
    element_bytes: float,
    overhead_bytes: int,
    safety: float = 2.0,
) -> int:
    """chunk_size = floor((budget - overhead) / (element_bytes * safety)).

    ``safety`` reserves room for the transient copy a flush holds alongside
    the live buffer; 2.0 mirrors the buffer-plus-DataFrame peak.
    """
    spendable = budget_bytes - overhead_bytes
    if spendable <= 0:
        raise ValueError("overhead already exceeds the budget; raise the budget")
    size = int(spendable // (element_bytes * safety))
    if size < 1:
        raise ValueError("budget too small for even one row at this width")
    logger.info(
        "sized chunk: %d rows (%.1f B/elem, %.2f GiB spendable)",
        size, element_bytes, spendable / 2**30,
    )
    return size


class AdaptiveBatcher:
    """Accumulate rows to a computed target, shrinking it as RSS rises.

    When resident memory crosses ``high_water`` of the budget the target is
    halved before the next batch, so a per-element under-estimate (dense
    urban tags) cannot walk the process into an OOM kill.
    """

    def __init__(self, budget_bytes: int, target: int, high_water: float = 0.85) -> None:
        self.budget_bytes = budget_bytes
        self.target = max(1, target)
        self.high_water = high_water
        self._proc = psutil.Process()

    def _rss_fraction(self) -> float:
        return self._proc.memory_info().rss / self.budget_bytes

    def should_flush(self, buffered_rows: int) -> bool:
        if buffered_rows >= self.target:
            return True
        # Pre-emptive flush if we are already close to the ceiling.
        return self._rss_fraction() >= self.high_water and buffered_rows > 0

    def note_after_flush(self) -> None:
        """Shrink the target if the last cycle pushed RSS toward the ceiling."""
        frac = self._rss_fraction()
        if frac >= self.high_water and self.target > 1:
            self.target = max(1, self.target // 2)
            logger.warning(
                "RSS at %.0f%% of budget; target shrunk to %d rows",
                frac * 100, self.target,
            )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    # 1. Measure width from a representative sample of parsed OSM rows.
    sample = pd.read_parquet("sample_rows.parquet")  # a few thousand real rows
    width = bytes_per_element(sample)
    logger.info("cross-check: sys.getsizeof(sample)=%d", sys.getsizeof(sample))

    # 2. Compute the starting batch size against an 8 GiB budget.
    budget = 8 * 2**30
    target = compute_chunk_size(budget, width, sizing_overhead())

    # 3. Drive accumulation with the adaptive guard.
    batcher = AdaptiveBatcher(budget, target)
    buffer: list[dict] = []
    for row in stream_parsed_rows():   # your pyosmium / pyrosm producer
        buffer.append(row)
        if batcher.should_flush(len(buffer)):
            flush_to_parquet(buffer)   # your writer from the chunk-processing stage
            buffer.clear()
            batcher.note_after_flush()
    if buffer:
        flush_to_parquet(buffer)
```

## Step-by-step walkthrough

1. **Measure, do not guess** — `bytes_per_element` sums `memory_usage(deep=True)` and divides by row count, so variable-length tag strings are counted at their true cost rather than as an opaque pointer.
2. **Overhead is the resident floor** — `sizing_overhead()` snapshots the current process RSS (interpreter, imports, any warm caches) so the budget the batch draws on is what is actually *left*, not the raw total.
3. **The `safety` factor covers the flush copy** — dividing by `element_bytes * 2.0` reserves headroom for the moment the live buffer and its serialized DataFrame coexist, the same factor-of-two peak the parent stage describes.
4. **`compute_chunk_size` fails loud** — if overhead already exceeds the budget, or the budget cannot hold a single row, it raises rather than returning a zero that would spin forever.
5. **`should_flush` has two triggers** — the normal one is reaching the row target; the second is a pre-emptive flush when RSS is already past `high_water`, which catches a batch whose rows turned out wider than the sample.
6. **`note_after_flush` closes the loop** — if a cycle ended near the ceiling it halves the target, so the process converges to a sustainable batch size instead of repeatedly brushing the limit.
7. **`sys.getsizeof` is a sanity cross-check** — it reports the shallow container size only, so a large gap between it and the deep figure confirms the tag strings dominate and the deep measurement was necessary.

## Verification

Prove the size is safe before committing it to a long run:

- **Recompute is stable.** Measure `bytes_per_element` on two disjoint samples; the figures should agree within a few percent, or your sample is not representative.
- **The formula matches observed peak.** Run one batch at the computed `chunk_size` and read RSS at the flush; peak should land near `overhead + chunk_size × element_bytes × safety`, not far above it.
- **The guard actually shrinks.** Feed a deliberately dense (urban) tile and confirm a `target shrunk to` warning appears and the run still completes without an OOM kill.
- **No premature flushing on sparse data.** On a rural tile, `should_flush` should fire on the row target, not the RSS trigger — if it fires early, `high_water` is set too low.
- **Determinism of the static size.** For a fixed sample, budget, and overhead, `compute_chunk_size` must return the same integer every time.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| OOM kill despite a computed size | Width measured on sparse rows, run hit dense tags | Measure on the densest sample, or rely on the `high_water` guard. |
| `chunk_size` of a few rows | Overhead nearly equals the budget | Lower a warm cache's footprint or raise the budget. |
| Shallow width far too small | Used `memory_usage()` without `deep=True` | Always pass `deep=True` so string payloads are counted. |
| Batch never flushes | `should_flush` compared against a stale target | Call `note_after_flush` each cycle so the target updates. |
| Guard shrinks to 1 and stalls | RSS ceiling set below the true resident floor | Raise the budget above measured overhead plus one batch. |
| `psutil.AccessDenied` on RSS read | Sandboxed process without self-inspect rights | Fall back to the static size; skip the runtime guard. |

## Specification reference

> Per-element width must be measured deeply, because the default is shallow: pandas documents that `DataFrame.memory_usage(deep=True)` will "introspect the data deeply by interrogating object dtypes for system-level memory consumption, and include it in the returned values" — see the [pandas `memory_usage` documentation](https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.memory_usage.html). The runtime ceiling is read from the operating system: the resident set size returned by [`psutil.Process().memory_info()`](https://psutil.readthedocs.io/en/latest/#psutil.Process.memory_info) is "the non-swapped physical memory a process has used," which is the figure a container's cgroup limit and the OOM-killer both watch, making it the correct signal for the adaptive guard.

## Frequently Asked Questions

<details>
<summary>Why measure per-element width instead of using a fixed rule of thumb?</summary>

Because OSM row width is dominated by tags, and tags are unbounded free text that varies wildly between a bare geometry node and a densely tagged shop or boundary. A rule of thumb calibrated on one region silently under- or over-shoots on another. Measuring `memory_usage(deep=True)` on a real sample ties the batch size to your actual data, and the adaptive guard absorbs whatever variance the sample missed.
</details>

<details>
<summary>What memory budget should I feed the formula?</summary>

Use the hard ceiling the environment enforces, minus a margin. In a container that is the cgroup `memory.max`; on a shared host it is a self-imposed fraction of total RAM that leaves room for the OS page cache and any co-resident processes. Whatever you choose, subtract the measured overhead so the batch draws only on genuinely free memory rather than the gross total.
</details>

<details>
<summary>How is this different from the parent chunk-processing guide's chunk_size?</summary>

The parent stage shows the mechanism — a bounded buffer that flushes at `chunk_size` — but treats that number as a given. This page supplies the number: it derives `chunk_size` from a measured element width and a RAM budget, then adds a feedback loop that corrects a mis-measurement at runtime. One is the machine; the other is how you set its single dial.
</details>

<details>
<summary>Does the psutil guard replace the static calculation?</summary>

No, they are complementary. The static formula gives a sensible starting batch so the first cycles are neither wastefully tiny nor immediately over the ceiling. The guard is a safety net for drift — dense tiles, a warm cache growing, a fragmented heap — that no up-front number can predict. Ship both: the formula for a good default, the guard so a bad default cannot crash the run.
</details>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Sizing PBF Chunk Batches to a Memory Budget",
  "description": "Derive a safe rows-per-chunk from measured per-element memory width and the RAM you can spend, then guard it at runtime with a psutil check that shrinks the batch before RSS reaches the ceiling.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "Parsing & Tag Normalization Workflows",
  "about": ["memory budgeting", "OSM chunk sizing", "psutil RSS guard"]
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
    { "@type": "ListItem", "position": 4, "name": "Sizing Chunk Batches", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/sizing-pbf-chunk-batches-to-a-memory-budget/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Size OSM PBF chunk batches to a memory budget",
  "description": "Measure per-element memory width, compute a safe chunk size from a RAM budget, and add a psutil guard that shrinks the batch as resident memory approaches the ceiling.",
  "step": [
    { "@type": "HowToStep", "name": "Measure per-element width", "text": "Sum DataFrame.memory_usage(deep=True) over a representative sample and divide by the row count to get true bytes per element including tag strings." },
    { "@type": "HowToStep", "name": "Reserve fixed overhead", "text": "Snapshot the current process RSS as the resident floor so the batch draws only on the memory left after interpreter, imports, and warm caches." },
    { "@type": "HowToStep", "name": "Floor-divide for the size", "text": "Compute chunk_size as floor of budget minus overhead divided by element bytes times a safety factor that reserves room for the flush copy." },
    { "@type": "HowToStep", "name": "Add a runtime RSS guard", "text": "Sample RSS with psutil each cycle and flush pre-emptively or halve the target when resident memory crosses a high-water fraction of the budget." },
    { "@type": "HowToStep", "name": "Verify against observed peak", "text": "Run one batch and confirm peak RSS lands near overhead plus chunk_size times element bytes times the safety factor before committing to a long run." }
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
      "name": "Why measure per-element width instead of using a fixed rule of thumb?",
      "acceptedAnswer": { "@type": "Answer", "text": "OSM row width is dominated by tags, which are unbounded free text that varies between a bare geometry node and a densely tagged shop or boundary. A rule of thumb calibrated on one region under- or over-shoots on another. Measuring memory_usage(deep=True) on a real sample ties the batch size to actual data, and the adaptive guard absorbs whatever variance the sample missed." }
    },
    {
      "@type": "Question",
      "name": "What memory budget should I feed the formula?",
      "acceptedAnswer": { "@type": "Answer", "text": "Use the hard ceiling the environment enforces minus a margin. In a container that is the cgroup memory.max; on a shared host it is a self-imposed fraction of total RAM that leaves room for the OS page cache and co-resident processes. Subtract the measured overhead so the batch draws only on genuinely free memory rather than the gross total." }
    },
    {
      "@type": "Question",
      "name": "How is this different from the parent chunk-processing guide's chunk_size?",
      "acceptedAnswer": { "@type": "Answer", "text": "The parent stage shows the mechanism, a bounded buffer that flushes at chunk_size, but treats the number as a given. This page supplies the number: it derives chunk_size from a measured element width and a RAM budget, then adds a feedback loop that corrects a mis-measurement at runtime. One is the machine, the other is how you set its single dial." }
    },
    {
      "@type": "Question",
      "name": "Does the psutil guard replace the static calculation?",
      "acceptedAnswer": { "@type": "Answer", "text": "No, they are complementary. The static formula gives a sensible starting batch so the first cycles are neither wastefully tiny nor immediately over the ceiling. The guard is a safety net for drift from dense tiles, a growing warm cache, or a fragmented heap that no up-front number can predict. Ship both: the formula for a good default and the guard so a bad default cannot crash the run." }
    }
  ]
}
</script>

## Related

- [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) — the streaming buffer whose `chunk_size` this page computes and guards.
- [A Bounded LRU Node Cache for OSM Streaming](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/bounded-lru-node-cache-for-osm-streaming/) — the companion lever that caps the location store rather than the record batch.
- [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/) — the parallel producer whose row shape you should sample when measuring element width.
- [Batch Attribute Mapping Strategies](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/) — the tag registries whose payload width drives most of the per-element cost.
- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — where a batch that overruns its budget routes its overflow and defective rows.
- [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) — why a block-streamed source lets a computed batch size hold across the whole file.

Up one level: [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/).
