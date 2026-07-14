---
title: "Benchmarking OSM Parser Memory and Throughput"
description: "A runnable harness that measures peak RSS and elements-per-second for pyosmium and pyrosm on the same OSM extract, so the parser choice is evidence-based."
pageTitle: "Benchmark OSM Parser Memory and Throughput in Python"
pageDescription: "Measure peak RSS with resource.getrusage and parse throughput with perf_counter for pyosmium versus pyrosm on one extract, isolating each run to keep the high-water mark honest."
slug: benchmarking-osm-parser-memory-and-throughput
type: article
breadcrumb: "Benchmarking OSM Parsers"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# Benchmarking OSM Parser Memory and Throughput

Measure the peak resident memory and parse throughput of pyosmium and pyrosm on the *same* extract, so the decision between streaming and materializing rests on numbers from your data and your machine rather than a rule of thumb.

## Prerequisites

Tick each box before running the harness; a skipped one is the usual reason two parsers appear to use identical memory or wildly different element counts.

- [ ] Python 3.10+ (for the `dataclass`, `|` unions, and structural typing used below).
- [ ] `pyosmium` installed (`pip install osmium`) — the streaming reader described in [pyosmium vs pyrosm vs osmium-tool](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/).
- [ ] `pyrosm` installed (`pip install pyrosm`) for the GeoDataFrame read side of the comparison.
- [ ] Optional: `psutil` (`pip install psutil`) if you want a live RSS sample rather than only the post-run high-water mark.
- [ ] One `.osm.pbf` extract on local disk — a city or small region so both parsers finish quickly and pyrosm does not OOM.
- [ ] A Linux or macOS host — the code normalizes the `ru_maxrss` unit difference between the two.

## Conceptual minimum

Two numbers decide a parser: how much memory it needs at its worst moment, and how fast it turns bytes into elements. The worst-moment figure is *peak* resident set size, and the operating system already tracks it for you — `resource.getrusage(resource.RUSAGE_SELF).ru_maxrss` returns a high-water mark that only ever climbs during a process's life. That property is a gift and a trap: because it never decreases, running pyosmium and pyrosm in the *same* process would report the maximum of the two, hiding the very difference you are trying to see. The fix is to run each parser in its own fresh process and read the high-water mark there. Throughput is simpler — wrap the parse in `time.perf_counter()`, count the elements consumed, and divide. The one subtlety is fairness: the first parser warms the operating system's page cache, so the second reads from RAM instead of disk and looks faster than it is. This page is the empirical companion to the decision guide in [choosing an OSM parser](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/), which explains *why* the two readers scale differently; here we quantify it.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 400" role="img" aria-label="A memory-versus-time chart of a single parser run. Resident memory rises from a low baseline as the parse proceeds and plateaus near a peak. A dashed horizontal line marks that peak, labelled ru_maxrss, the high-water mark that only ever increases and never falls back down. Two dashed vertical lines mark t0 at the start and t1 at the end of the parse; the span between them, measured by perf_counter, is the elapsed time. A caption states the two metrics captured per run: peak RSS equals ru_maxrss, and throughput equals elements divided by elapsed." style="width:100%;max-width:900px;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>How the harness captures peak RSS and throughput from one parser run</title>
  <desc>Resident memory rises and plateaus over a run; a dashed line marks the ru_maxrss high-water peak. Vertical markers t0 and t1 bound the perf_counter elapsed time. Peak RSS is ru_maxrss; throughput is elements divided by elapsed time.</desc>
  <text x="450" y="26" text-anchor="middle" font-size="15" fill="currentColor" font-weight="700">Two numbers per run: the memory peak and the wall-clock rate</text>
  <!-- axes -->
  <line x1="120" y1="60" x2="120" y2="300" stroke="currentColor" stroke-width="1.5"/>
  <line x1="120" y1="300" x2="820" y2="300" stroke="currentColor" stroke-width="1.5"/>
  <text x="112" y="66" text-anchor="end" font-size="10.5" fill="currentColor" opacity="0.85">RSS</text>
  <text x="470" y="332" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">wall-clock time (perf_counter)</text>
  <!-- ru_maxrss high-water line -->
  <line x1="120" y1="104" x2="820" y2="104" stroke="var(--osm-warn,#a16207)" stroke-width="1.5" stroke-dasharray="6 4"/>
  <text x="300" y="97" text-anchor="start" font-size="10.5" fill="currentColor" opacity="0.9">ru_maxrss — high-water peak, never falls</text>
  <!-- RSS curve -->
  <polyline points="120,292 170,262 220,214 280,160 340,128 420,114 520,108 600,104 690,110 760,113" fill="none" stroke="var(--osm-accent,#0369a1)" stroke-width="2"/>
  <!-- t0 / t1 markers -->
  <line x1="160" y1="60" x2="160" y2="300" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.7"/>
  <line x1="760" y1="60" x2="760" y2="300" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.7"/>
  <text x="160" y="315" text-anchor="middle" font-size="10.5" fill="currentColor">t0</text>
  <text x="760" y="315" text-anchor="middle" font-size="10.5" fill="currentColor">t1</text>
  <!-- caption box -->
  <rect x="520" y="205" width="290" height="72" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="665" y="230" text-anchor="middle" font-size="11.5" fill="currentColor" font-weight="600">Captured per run</text>
  <text x="665" y="250" text-anchor="middle" font-size="11" fill="currentColor">peak RSS = ru_maxrss</text>
  <text x="665" y="268" text-anchor="middle" font-size="11" fill="currentColor">throughput = elements ÷ elapsed</text>
</svg>

## Runnable solution

The harness runs each parser in a spawned child process, times the parse, and reports peak RSS and elements per second side by side. It targets pyosmium and pyrosm on Python 3.10+.

```python
from __future__ import annotations

import logging
import multiprocessing as mp
import platform
import resource
import sys
import time
from dataclasses import dataclass

import osmium

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("osm.parser_benchmark")


def maxrss_bytes() -> int:
    """Peak RSS of *this* process, normalized to bytes.

    ru_maxrss is a high-water mark that only ever increases, so it is only
    meaningful when read in a process that ran exactly one parser.
    """
    raw = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    # Linux reports kibibytes; macOS and the BSDs report bytes.
    return raw * 1024 if platform.system() == "Linux" else raw


@dataclass
class Result:
    parser: str
    elements: int
    seconds: float
    peak_rss_bytes: int

    @property
    def throughput(self) -> float:
        return self.elements / self.seconds if self.seconds else 0.0


class _ElementCounter(osmium.SimpleHandler):
    """Count every primitive so both parsers report comparable work."""

    def __init__(self) -> None:
        super().__init__()
        self.n: int = 0

    def node(self, _n: osmium.osm.Node) -> None:
        self.n += 1

    def way(self, _w: osmium.osm.Way) -> None:
        self.n += 1

    def relation(self, _r: osmium.osm.Relation) -> None:
        self.n += 1


def _run_pyosmium(path: str, q: mp.Queue) -> None:
    handler = _ElementCounter()
    t0 = time.perf_counter()
    handler.apply_file(path)
    elapsed = time.perf_counter() - t0
    q.put(Result("pyosmium", handler.n, elapsed, maxrss_bytes()))


def _run_pyrosm(path: str, q: mp.Queue) -> None:
    from pyrosm import OSM  # imported in the child so spawn stays cheap

    t0 = time.perf_counter()
    osm = OSM(path)
    nodes, edges = osm.get_network(nodes=True, network_type="all")
    count = len(nodes) + len(edges)
    elapsed = time.perf_counter() - t0
    q.put(Result("pyrosm", count, elapsed, maxrss_bytes()))


def benchmark(path: str) -> list[Result]:
    """Run each parser in a fresh process so ru_maxrss reflects one parser."""
    ctx = mp.get_context("spawn")  # a clean interpreter → clean high-water mark
    results: list[Result] = []
    for target in (_run_pyosmium, _run_pyrosm):
        q: mp.Queue = ctx.Queue()
        proc = ctx.Process(target=target, args=(path, q))
        proc.start()
        results.append(q.get())
        proc.join()
    return results


def print_table(results: list[Result]) -> None:
    logger.info("%-10s %13s %9s %14s %14s", "parser", "elements", "sec",
                "peak RSS (MB)", "elem/sec")
    for r in results:
        logger.info("%-10s %13d %9.2f %14.1f %14.0f", r.parser, r.elements,
                    r.seconds, r.peak_rss_bytes / 1e6, r.throughput)


if __name__ == "__main__":
    print_table(benchmark(sys.argv[1]))
```

## Step-by-step walkthrough

1. **Normalize the RSS unit** — `maxrss_bytes()` multiplies by 1024 on Linux, where `ru_maxrss` is kibibytes, and leaves it alone on macOS/BSD, where it is already bytes. Skip this and your peaks are off by a factor of 1024.
2. **Count comparable work** — `_ElementCounter` tallies nodes, ways, and relations, so "elements" means the same thing for both parsers and the throughput divisor is fair.
3. **Time only the parse** — `time.perf_counter()` brackets the `apply_file` call (and pyrosm's `get_network`), excluding import and process spin-up so the rate reflects parsing, not startup.
4. **Isolate each parser in its own process** — `mp.get_context("spawn")` starts a fresh interpreter per run, so the high-water mark read by `maxrss_bytes()` belongs to exactly one parser. This is the single most important step: measure both in one process and you get the max of the two, not each.
5. **Import pyrosm lazily** — the `from pyrosm import OSM` lives inside `_run_pyrosm`, so the spawned pyosmium child never pays for pyrosm's heavy import and vice versa.
6. **Report both metrics together** — `print_table` lays peak RSS and elements-per-second side by side, which is the comparison the parser choice actually turns on.

For a live memory trace rather than only the final peak, sample `psutil.Process().memory_info().rss` on a timer thread inside each child; the `getrusage` peak is enough to rank the parsers, but a trace shows *where* pyrosm's footprint spikes during geometry reconstruction — useful context for the windowed approach in [memory-efficient chunk processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/).

## Verification

Confirm the harness measured what you think before trusting the ranking:

- **Peaks must differ.** pyosmium's peak RSS should be a small fraction of pyrosm's on the same extract; if they are near-identical, you are almost certainly measuring in one process — check that `spawn` is in effect.
- **Element counts should be the same order of magnitude.** pyrosm's `network_type="all"` count will not match pyosmium's total-primitive count exactly (pyrosm filters to the network), but a 1000× gap means the read pulled the wrong feature set.
- **Sanity-check the units.** A city extract reporting a peak of tens of kilobytes means the Linux KiB-to-bytes conversion was skipped; a realistic pyrosm peak on a city file is hundreds of megabytes to a few gigabytes.
- **Repeat and look for stability.** Run three times; throughput should cluster within roughly 10–20%. Wild variance points at other load on the machine or cold-versus-warm cache effects.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Both parsers report the same peak RSS | Measured in one process; `ru_maxrss` is a high-water mark | Run each parser in its own spawned process |
| Peak RSS off by ~1024× | `ru_maxrss` unit mismatch (Linux KiB vs macOS bytes) | Normalize per platform as in `maxrss_bytes()` |
| Second parser looks unfairly fast | Warm page cache left by the first run | Alternate order across runs, or drop caches between them |
| `ImportError: pyrosm` in the child | Heavy import at module top under `spawn` | Import `pyrosm` inside the child target function |
| pyrosm counts far fewer elements | `get_network` filters to a network type | Use `network_type="all"`, or compare against a full read |
| Throughput varies run to run | Startup jitter, cache state, competing load | Run 3+ times, report the median, quiesce the machine |
| pyrosm run OOM-killed | Extract too large to materialize | Benchmark on a smaller clip; that OOM is itself the answer |

## Specification reference

> pyosmium processes a file by invoking handler callbacks as it streams elements, which is what keeps its resident memory bounded regardless of file size; see the [pyosmium documentation](https://docs.osmcode.org/pyosmium/latest/) for `SimpleHandler` and `apply_file` semantics. The peak-memory metric comes from `getrusage(RUSAGE_SELF)`, whose `ru_maxrss` field is defined as the maximum resident set size used, in kilobytes on Linux — consult the [Python `resource` documentation](https://docs.python.org/3/library/resource.html) for the field list and platform notes.

## Frequently Asked Questions

<details>
<summary>Why run each parser in a separate process?</summary>

Because `ru_maxrss` is a high-water mark that only ever increases within a process. If pyosmium runs first and pyrosm second in the same interpreter, the value read after pyrosm reflects the larger of the two peaks, so pyosmium's much smaller footprint is invisible. Spawning a fresh process per parser gives each an independent high-water mark, which is the whole point of the comparison.
</details>

<details>
<summary>Is ru_maxrss the same as the memory my parser allocated?</summary>

Not exactly. `ru_maxrss` is the peak resident set size — the most physical RAM the process ever had mapped at once — which is what determines whether you OOM. Allocated memory can be larger (some is swapped or never faulted in) or the resident peak can include shared library pages. For ranking parsers by real-world memory pressure, resident peak is the number that matters.
</details>

<details>
<summary>How do I make the cold-versus-warm cache comparison fair?</summary>

The first parser to touch the file warms the operating system's page cache, so the second reads from RAM and looks faster. Either run each parser on a cold cache (drop caches or reboot between them), or alternate the order across several runs and compare medians so the cache advantage averages out. Reporting whether the numbers are cold or warm is part of an honest benchmark.
</details>

<details>
<summary>Which number matters more, peak RSS or throughput?</summary>

It depends on the binding constraint. If jobs must fit a fixed memory ceiling — a shared runner or a container limit — peak RSS decides feasibility and throughput is secondary. If memory is ample and turnaround time dominates, throughput wins. The value of measuring both is that the parser that is fastest is often not the one that is leanest, and the trade-off is only visible with the two numbers side by side.
</details>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Benchmarking OSM Parser Memory and Throughput",
  "description": "A runnable harness that measures peak RSS and elements-per-second for pyosmium and pyrosm on the same OSM extract, so the parser choice is evidence-based.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "Parsing & Tag Normalization Workflows",
  "about": ["OSM parser benchmarking", "peak RSS measurement", "parse throughput"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Parsing & Tag Normalization Workflows", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/" },
    { "@type": "ListItem", "position": 3, "name": "Choosing an OSM Parser", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/" },
    { "@type": "ListItem", "position": 4, "name": "Benchmarking OSM Parsers", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/benchmarking-osm-parser-memory-and-throughput/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Benchmark OSM parser memory and throughput",
  "description": "Measure peak resident memory and parse throughput of pyosmium and pyrosm on the same extract by isolating each run in its own process.",
  "step": [
    { "@type": "HowToStep", "name": "Normalize the RSS unit", "text": "Convert ru_maxrss to bytes, multiplying by 1024 on Linux where it is kibibytes and leaving it as-is on macOS and BSD where it is bytes." },
    { "@type": "HowToStep", "name": "Count comparable work", "text": "Tally nodes, ways, and relations so the element total means the same thing for both parsers and the throughput divisor is fair." },
    { "@type": "HowToStep", "name": "Time only the parse", "text": "Bracket the parse call with time.perf_counter so the rate reflects parsing rather than import and process startup." },
    { "@type": "HowToStep", "name": "Isolate each parser", "text": "Run each parser in a spawned child process so the ru_maxrss high-water mark reflects exactly one parser instead of the maximum of both." },
    { "@type": "HowToStep", "name": "Report both metrics", "text": "Print peak RSS and elements per second side by side and repeat several times to confirm the numbers are stable." }
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
      "name": "Why run each parser in a separate process?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because ru_maxrss is a high-water mark that only ever increases within a process. If pyosmium runs first and pyrosm second in the same interpreter, the value read after pyrosm reflects the larger of the two peaks, so pyosmium's much smaller footprint is invisible. Spawning a fresh process per parser gives each an independent high-water mark, which is the whole point of the comparison." }
    },
    {
      "@type": "Question",
      "name": "Is ru_maxrss the same as the memory my parser allocated?",
      "acceptedAnswer": { "@type": "Answer", "text": "Not exactly. ru_maxrss is the peak resident set size, the most physical RAM the process ever had mapped at once, which is what determines whether you OOM. Allocated memory can be larger because some is swapped or never faulted in, or the resident peak can include shared library pages. For ranking parsers by real-world memory pressure, resident peak is the number that matters." }
    },
    {
      "@type": "Question",
      "name": "How do I make the cold-versus-warm cache comparison fair?",
      "acceptedAnswer": { "@type": "Answer", "text": "The first parser to touch the file warms the operating system page cache, so the second reads from RAM and looks faster. Either run each parser on a cold cache by dropping caches or rebooting between them, or alternate the order across several runs and compare medians so the cache advantage averages out. Reporting whether the numbers are cold or warm is part of an honest benchmark." }
    },
    {
      "@type": "Question",
      "name": "Which number matters more, peak RSS or throughput?",
      "acceptedAnswer": { "@type": "Answer", "text": "It depends on the binding constraint. If jobs must fit a fixed memory ceiling such as a shared runner or a container limit, peak RSS decides feasibility and throughput is secondary. If memory is ample and turnaround time dominates, throughput wins. The value of measuring both is that the fastest parser is often not the leanest, and the trade-off is only visible with the two numbers side by side." }
    }
  ]
}
</script>

## Related

- [pyosmium vs pyrosm vs osmium-tool: Choosing the Right Parser](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/) — the decision guide these numbers make concrete.
- [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) — what to do when the benchmark says a single-pass read will not fit in memory.
- [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/) — scaling pyrosm past the single-process throughput this harness measures.
- [OSM XML vs PBF Comparison](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/) — why every benchmark here uses `.osm.pbf` as the input.

Up one level: [pyosmium vs pyrosm vs osmium-tool: Choosing the Right Parser](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/).
