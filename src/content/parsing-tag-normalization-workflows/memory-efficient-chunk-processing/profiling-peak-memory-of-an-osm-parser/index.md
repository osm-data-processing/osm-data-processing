---
title: "Profiling Peak Memory of an OSM Parser"
description: "Measure what a parser actually holds rather than what you think it holds: resident peak, allocation attribution, and a growth test that distinguishes a leak from a cache."
pageTitle: "Measuring Peak Memory in an OSM Parsing Pipeline"
pageDescription: "Profile an OSM parser properly — sample resident memory over time, attribute allocations to code, and run a growth test that separates an unbounded structure from a legitimate cache."
slug: profiling-peak-memory-of-an-osm-parser
type: article
breadcrumb: "Profiling Memory"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Profiling Peak Memory of an OSM Parser

Every OSM pipeline is eventually killed by the operating system for using too much memory, and the debugging that follows is usually guesswork because nobody measured anything before it happened.

## Prerequisites

- [ ] Python 3.10+; `tracemalloc` and `resource` are in the standard library.
- [ ] `psutil` for sampling resident memory, or a willingness to read the process filesystem.
- [ ] A parser to measure, and two differently-sized inputs.
- [ ] The strategies in [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/), so the measurement has something to inform.
- [ ] Patience for a full run, since peak memory is by definition not visible early.

## Conceptual minimum

Three different numbers get called "memory usage" and they answer different questions.

**Resident set size** is what the operating system counts and what gets a process killed. It includes memory the allocator has freed but not returned, and pages of memory-mapped files that happen to be resident. It is the number that matters operationally and the least useful for finding a cause.

**Allocated bytes**, as tracked by the language runtime, attribute memory to the code that requested it. That makes it the number for diagnosis, and it deliberately excludes anything the runtime did not allocate — which includes memory-mapped files and native library allocations.

**Peak versus current** is the distinction that catches people. A pipeline sitting at two gigabytes may have peaked at twelve during a merge, and only the peak explains why it was killed.

The diagnostic question is almost always **does it grow with input size**. A structure whose size tracks the file is unbounded and will fail on a larger one; a cache that plateaus is fine however large it looks. Two runs on differently-sized inputs answer that question definitively, and nothing else does.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="ppm1-t ppm1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="ppm1-t">Three memory numbers, what each includes, and what each is for</title>
  <desc id="ppm1-d">A grid of three measurements against what each includes and the question it answers. Resident set size includes freed-but-unreturned memory and resident pages of mapped files, and answers whether the process will be killed. Runtime-allocated bytes include only what the language runtime requested, exclude mapped files and native allocations, and answer which code is responsible. Peak values of either answer why a process died, where current values answer only how it is behaving now.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three numbers, three different questions</text>
  <rect x="216" y="48" width="319" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="376" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Includes</text>
  <rect x="535" y="48" width="319" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="694" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Answers</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Resident set size</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">freed, mapped pages</text>
  <text x="694" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">will it be killed?</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Runtime allocations</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">only runtime requests</text>
  <text x="694" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">which code?</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Peak, either one</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">the maximum reached</text>
  <text x="694" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">why it died</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Current, either one</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">this instant</text>
  <text x="694" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">how it is now</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Reporting only current allocated bytes, which is the easiest number to obtain, answers neither operational question.</text>
</svg>
<figcaption>A pipeline killed for memory needs the first row to confirm it and the second to explain it.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
import resource
import threading
import time
import tracemalloc
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import dataclass, field

import psutil

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.profile.memory")

SAMPLE_INTERVAL = 0.25


@dataclass
class MemoryProfile:
    peak_rss_mb: float = 0.0
    final_rss_mb: float = 0.0
    peak_allocated_mb: float = 0.0
    samples: list[float] = field(default_factory=list)
    top_allocators: list[str] = field(default_factory=list)
    seconds: float = 0.0


class Sampler(threading.Thread):
    """Resident memory is sampled, not queried: the peak is a maximum over time."""

    def __init__(self, interval: float = SAMPLE_INTERVAL) -> None:
        super().__init__(daemon=True)
        self.interval = interval
        self.samples: list[float] = []
        self._stop = threading.Event()
        self._process = psutil.Process()

    def run(self) -> None:
        while not self._stop.is_set():
            self.samples.append(self._process.memory_info().rss / 1024 ** 2)
            self._stop.wait(self.interval)

    def stop(self) -> None:
        self._stop.set()
        self.join(timeout=2.0)


@contextmanager
def profile(top: int = 8):
    """Measure resident peak, allocation peak and the top allocating lines."""
    tracemalloc.start(25)
    sampler = Sampler()
    sampler.start()
    started = time.perf_counter()
    result = MemoryProfile()
    try:
        yield result
    finally:
        result.seconds = time.perf_counter() - started
        snapshot = tracemalloc.take_snapshot()
        _current, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        sampler.stop()

        result.samples = sampler.samples
        result.peak_rss_mb = max(sampler.samples) if sampler.samples else 0.0
        result.final_rss_mb = sampler.samples[-1] if sampler.samples else 0.0
        result.peak_allocated_mb = peak / 1024 ** 2
        # The kernel's own high-water mark, as a cross-check on the sampling.
        kernel_peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
        result.top_allocators = [
            f"{stat.size / 1024 ** 2:7.1f} MB  {stat.traceback.format()[-1].strip()}"
            for stat in snapshot.statistics("lineno")[:top]]

        logger.info("peak rss %.0f MB (kernel says %.0f), final %.0f MB, "
                    "peak allocated %.0f MB, %.1fs",
                    result.peak_rss_mb, kernel_peak, result.final_rss_mb,
                    result.peak_allocated_mb, result.seconds)
        for line in result.top_allocators:
            logger.info("  %s", line)


def growth_test(run: Callable[[str], None], small: str, large: str,
                size_ratio: float) -> str:
    """Does memory grow with input size? This is the only question that matters.

    A structure whose footprint tracks the input is unbounded and will fail on
    a larger file; one that plateaus is a cache and is fine however large.
    """
    with profile() as a:
        run(small)
    with profile() as b:
        run(large)

    growth = b.peak_rss_mb / max(a.peak_rss_mb, 1.0)
    logger.info("input grew %.1fx, peak memory grew %.2fx", size_ratio, growth)

    if growth > size_ratio * 0.7:
        return ("UNBOUNDED: memory tracks input size; a structure is "
                "accumulating per element")
    if growth > 1.3:
        return "PARTIAL: something grows with input, but sub-linearly"
    return "BOUNDED: memory is flat; the footprint is a cache or a buffer"


if __name__ == "__main__":
    logger.info("run the growth test before optimising anything")
```

## Step-by-step walkthrough

1. **Sample resident memory rather than querying it.** The peak is a maximum over time, and a single reading after the run has finished misses it entirely — often by a factor of five.
2. **Cross-check against the kernel's high-water mark.** The operating system tracks a peak of its own, and a large disagreement with the sampled maximum means the sampling interval is too coarse for a short spike.
3. **Track allocations separately.** Runtime allocation tracking attributes memory to lines of code, which is what turns "it used twelve gigabytes" into "this dictionary used twelve gigabytes".
4. **Take the snapshot before stopping the tracker.** Stopping first discards everything, which is an easy mistake to make and produces an empty report.
5. **Report peak and final separately.** A large gap between them means a transient spike — a merge, a sort, a batch — rather than steady growth, and the two have completely different fixes.
6. **Run the growth test first.** Comparing peak memory across two input sizes distinguishes an unbounded structure from a large but constant cache, and that distinction determines whether there is a problem at all.
7. **Compare growth against the size ratio.** Memory growing roughly in proportion to input is the signature of accumulation; growing far less is a cache warming up.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="ppm2-t ppm2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="ppm2-t">Three memory profiles and what each shape means</title>
  <desc id="ppm2-d">Three panels describing shapes seen when resident memory is plotted over a run. A flat profile that rises quickly and then plateaus indicates a bounded cache or buffer, and is healthy however large the plateau. A linearly rising profile indicates a structure accumulating per element, which will fail on a larger input and is the only shape that is genuinely a bug. A sawtooth profile with periodic spikes indicates a batch or merge operation, where the peak rather than the average is what must fit in memory.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three shapes, and only one is a bug</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Rises then plateaus</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">A bounded cache</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Healthy at any size</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Plateau is configurable</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">No action needed</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Rises linearly</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Accumulating per element</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Fails on a larger file</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">The only real bug</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Find it with allocation stats</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Sawtooth spikes</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">A batch or a merge</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Peak must fit, not the mean</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Reduce the batch size</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Or the spike is the limit</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Plotting the samples costs nothing and identifies which of the three you have in seconds, before any code is read.</text>
</svg>
<figcaption>Most memory investigations begin by reading code and should begin by looking at the shape of the curve.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 248" role="img" aria-labelledby="ppm3-t ppm3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="ppm3-t">How the growth test reads for four different structures</title>
  <desc id="ppm3-d">Four structures measured across a fourfold increase in input size, with the factor by which peak memory grew. A fixed-size read buffer does not grow at all. A bounded cache grows slightly as it fills more completely on the larger input. A per-element accumulation grows in proportion to the input, which is the unbounded signature. An unbounded queue between producer and consumer grows fastest of all, because it absorbs the difference in rate as well as the volume.</desc>
  <rect x="0" y="0" width="880" height="248" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Peak memory growth against a fourfold input increase</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">Fixed read buffer</text>
  <rect x="256" y="60" width="94" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">no growth</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">Bounded cache</text>
  <rect x="256" y="100" width="112" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 1.2x</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">Per-element accumulation</text>
  <rect x="256" y="140" width="356" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 3.8x</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">Unbounded queue</text>
  <rect x="256" y="180" width="478" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 5.1x</text>
  <text x="868" y="232" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">A growth factor approaching the input ratio is the unbounded signature; anything near one is a structure whose size you chose.</text>
</svg>
<figcaption>The bottom two rows are bugs and the top two are configuration, and the test separates them without reading any code.</figcaption>
</figure>

## Verification

- **Peak exceeds final.** If they are equal, the sampler probably started too late or the interval is too coarse.
- **The kernel agrees.** The sampled peak and the kernel's high-water mark should be close; a large gap means a missed spike.
- **The growth test is decisive.** Two inputs differing by a factor of four should produce an unambiguous verdict.
- **Top allocators are plausible.** The largest entries should be structures you can name; an unfamiliar line is where to look.
- **The profile is reproducible.** Two runs on identical input should report peaks within a few percent.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Reported memory far below reality | Measured after the run finished | Sample throughout and take the maximum |
| Allocation report is empty | Snapshot taken after stopping the tracker | Snapshot first, then stop |
| Peak missed entirely | Sampling interval too coarse for a spike | Shorten the interval and cross-check the kernel peak |
| Mapped files not accounted for | Only runtime allocations measured | Measure resident memory as well |
| Optimising the wrong thing | Growth test skipped | Establish bounded or unbounded before touching code |
| Profiles differ between runs | Input or environment varying | Fix the input and the interval before comparing |
| Native allocations invisible | Runtime tracking used alone | Use resident memory for anything outside the runtime |

## Specification reference

> Resident set size measures the portion of a process's memory held in physical RAM, including pages of memory-mapped files and memory freed by the program but not returned to the operating system. Runtime allocation tracking attributes only allocations made through the language runtime and reports both current and peak traced memory. See the [Python tracemalloc documentation](https://docs.python.org/3/library/tracemalloc.html) for the snapshot and peak interfaces.

## Frequently Asked Questions

<details>
<summary>Why is peak memory so much higher than what I measured?</summary>

Because you almost certainly measured after the run, and by then the allocator has released the transient structures that caused the peak. Memory usage is a curve, and the number that gets a process killed is its maximum. Sampling throughout the run and taking the maximum is the only way to capture it, and the difference between that and a single final reading is routinely a factor of several.
</details>

<details>
<summary>Which should I measure, resident memory or allocations?</summary>

Both, because they answer different questions. Resident memory is what the operating system counts and what determines whether the process survives, but it includes mapped files and unreturned free memory, so it rarely points at a cause. Allocation tracking attributes bytes to lines of code, which is what you need to fix anything, but it cannot see memory-mapped files or native library allocations.
</details>

<details>
<summary>How do I tell a leak from a cache?</summary>

Run the same code on two inputs of different sizes. A cache plateaus, so its peak is similar for both; an accumulating structure grows roughly in proportion to the input, so its peak tracks the size ratio. That single comparison answers the question definitively and takes two runs, where reading code to find the culprit can take an afternoon and still leave doubt.
</details>

<details>
<summary>What does a sawtooth profile mean?</summary>

A batch operation — a sort, a merge, a flush — that accumulates and then releases. The average is irrelevant and the peak is what must fit, so the fix is to reduce the batch size rather than to look for a leak. It is also the profile most likely to be missed by coarse sampling, because the spikes can be shorter than the interval.
</details>

## Related

- [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) — the parent topic and the strategies this measures.
- [Using an LMDB Node Store for OSM Parsing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/using-an-lmdb-node-store-for-osm-parsing/) — a change whose effect this profile confirms.
- [Sizing PBF Chunk Batches to a Memory Budget](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/sizing-pbf-chunk-batches-to-a-memory-budget/) — turning the measured peak into a batch size.
- [Bounded LRU Node Cache for OSM Streaming](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/bounded-lru-node-cache-for-osm-streaming/) — the structure a plateau usually represents.
- [Applying Backpressure in an Asyncio OSM Pipeline](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/applying-backpressure-in-an-asyncio-osm-pipeline/) — the fix when growth comes from an unbounded queue.

Up one level: [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Profiling Peak Memory of an OSM Parser",
  "description": "Measure what a parser actually holds rather than what you think it holds: resident peak, allocation attribution, and a growth test that distinguishes a leak from a cache.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Parsing & Tag Normalization Workflows",
  "about": ["memory profiling", "resident set size", "growth testing"]
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
    { "@type": "ListItem", "position": 4, "name": "Profiling Peak Memory of an OSM Parser", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/profiling-peak-memory-of-an-osm-parser/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Profile peak memory in an OSM parsing pipeline",
  "description": "Sample resident memory throughout the run, cross-check against the kernel high-water mark, track allocations by line, report peak separately from final, and run a growth test across two input sizes.",
  "step": [
    { "@type": "HowToStep", "name": "Sample throughout", "text": "Record resident memory on a timer during the run and take the maximum, since a single reading afterwards misses the peak." },
    { "@type": "HowToStep", "name": "Cross-check the kernel peak", "text": "Compare the sampled maximum against the operating system's own high-water mark to detect a missed spike." },
    { "@type": "HowToStep", "name": "Track allocations by line", "text": "Use runtime allocation tracking to attribute bytes to the code that requested them." },
    { "@type": "HowToStep", "name": "Snapshot before stopping", "text": "Take the allocation snapshot while tracking is still active, since stopping discards it." },
    { "@type": "HowToStep", "name": "Report peak and final apart", "text": "Distinguish a transient spike from steady growth, since the two have different fixes." },
    { "@type": "HowToStep", "name": "Run the growth test", "text": "Compare peak memory across two input sizes to establish whether the footprint is bounded before changing any code." }
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
      "name": "Why is peak memory so much higher than what I measured?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because you almost certainly measured after the run, by which time the allocator has released the transient structures that caused the peak. Memory usage is a curve and the number that kills a process is its maximum. Sampling throughout and taking the maximum is the only way to capture it, and the difference is routinely a factor of several." }
    },
    {
      "@type": "Question",
      "name": "Should I measure resident memory or runtime allocations?",
      "acceptedAnswer": { "@type": "Answer", "text": "Both, because they answer different questions. Resident memory determines whether the process survives but includes mapped files and unreturned free memory, so it rarely points at a cause. Allocation tracking attributes bytes to lines of code but cannot see memory-mapped files or native library allocations." }
    },
    {
      "@type": "Question",
      "name": "How do I tell a memory leak from a cache?",
      "acceptedAnswer": { "@type": "Answer", "text": "Run the same code on two inputs of different sizes. A cache plateaus, so its peak is similar for both; an accumulating structure grows roughly in proportion to the input. That comparison answers the question definitively in two runs, where reading code can take an afternoon and still leave doubt." }
    },
    {
      "@type": "Question",
      "name": "What does a sawtooth memory profile mean?",
      "acceptedAnswer": { "@type": "Answer", "text": "A batch operation — a sort, a merge, a flush — that accumulates and then releases. The average is irrelevant and the peak is what must fit, so the fix is a smaller batch rather than a leak hunt. It is also the profile most likely to be missed by coarse sampling." }
    }
  ]
}
</script>
