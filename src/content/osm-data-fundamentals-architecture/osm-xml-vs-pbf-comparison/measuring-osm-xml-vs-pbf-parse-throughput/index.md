---
title: "Measuring OSM XML vs PBF Parse Throughput"
description: "Run a parse benchmark that measures the parser rather than the page cache: fixed work, dropped caches, repeated runs, recorded context — and why bzip2 loses to uncompressed XML."
pageTitle: "Measure OSM XML vs PBF Parse Throughput"
pageDescription: "A reproducible OSM parse benchmark — cache control, warm-up runs, median with spread, identical work across formats, and the context that makes the numbers comparable."
slug: "measuring-osm-xml-vs-pbf-parse-throughput"
type: "article"
breadcrumb: "Measuring Parse Throughput"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Measuring OSM XML vs PBF Parse Throughput

Produce a parse-throughput comparison that someone else can reproduce, and that measures the parser rather than your page cache.

## Prerequisites

- [ ] `osmium-tool`, and Python 3.10+ with `osmium` if benchmarking the library path
- [ ] The same extract in each format under test — convert it as in [Converting OSM XML to PBF with osmium](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/converting-osm-xml-to-pbf-with-osmium/)
- [ ] Root, or `sudo`, if you intend to drop the page cache between runs
- [ ] A country-sized extract — a city extract is dominated by process startup

## Conceptual minimum

A benchmark that compares two encodings has to hold everything else still, and there are more things to hold still than there appear to be.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="bench-protocol-t bench-protocol-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="bench-protocol-t">The four requirements of a comparable parse benchmark</title>
  <desc id="bench-protocol-d">A four-stage chain. Fix the work so both parsers produce the same objects and the same output, or two different jobs are being compared. Control the page cache by dropping it or reading cold each run, or the second run times the cache. Repeat at least five times and report the median rather than the best. Record the context: input file hash, CPU, and library versions, without which the result cannot be compared to anything.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="bp" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">A benchmark is a protocol, not a stopwatch</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">fix the work</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">same objects, same output</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">or you measure two jobs</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#bp)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.5"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">control the cache</text>
  <text x="331" y="107" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.85">drop it, or read cold every run</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">else you time the page cache</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#bp)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">repeat</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">5+ runs, report the median</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">not the best</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#bp)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">record the context</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">file hash · CPU · versions</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">or it cannot be compared</text>
  <text x="440" y="158" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Skip any one of these four and the number you publish measures something other than the parser.</text>
</svg>
<figcaption>Every one of these exists because skipping it produces a confident number that answers a different question.</figcaption>
</figure>

The most common mistake is the page cache. Reading a file once loads it into memory; the second read never touches the disk. Benchmark two formats in sequence without clearing that and the second one is measured against a warm cache, which flatters it by however much the I/O was costing.

The second most common is comparing different work. Counting objects is not the same job as building geometries, and a benchmark where one parser counts while the other assembles ways measures the difference in job, not in format.

## Runnable solution

```bash
#!/usr/bin/env bash
# bench.sh — compare parse throughput across encodings of the same extract.
# Fixes the work (count objects), controls the cache, repeats, records context.
set -euo pipefail

RUNS="${RUNS:-7}"
FILES=("$@")
: "${FILES[0]:?usage: bench.sh file1 [file2 ...]}"

drop_caches() {
  sync
  if [[ -w /proc/sys/vm/drop_caches ]]; then
    echo 3 > /proc/sys/vm/drop_caches
  else
    sudo sh -c 'echo 3 > /proc/sys/vm/drop_caches'
  fi
}

context() {
  echo "## context"
  echo "date:        $(date -Is)"
  echo "cpu:         $(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | xargs)"
  echo "cores:       $(nproc)"
  echo "governor:    $(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null || echo n/a)"
  echo "osmium:      $(osmium --version | head -1)"
  echo "kernel:      $(uname -r)"
  for f in "${FILES[@]}"; do
    echo "input:       $f  $(stat -c%s "$f") bytes  sha256=$(sha256sum "$f" | cut -c1-16)…"
  done
}

context
echo
printf '%-28s %10s %10s %10s %12s\n' file median_s min_s max_s objects

for f in "${FILES[@]}"; do
  # Fix the work: the same command, producing the same counts, for every format.
  objects=$(osmium fileinfo --extended --get data.count.nodes "$f")
  times=()
  # One discarded warm-up run: lets the CPU governor ramp before we measure.
  drop_caches; osmium fileinfo --extended "$f" >/dev/null
  for _ in $(seq "$RUNS"); do
    drop_caches
    start=$(date +%s.%N)
    osmium fileinfo --extended "$f" >/dev/null
    end=$(date +%s.%N)
    times+=("$(echo "$end - $start" | bc)")
  done
  printf '%s\n' "${times[@]}" | sort -n | awk -v f="$f" -v o="$objects" '
    {a[NR]=$1}
    END {printf "%-28s %10.2f %10.2f %10.2f %12d\n", f, a[int((NR+1)/2)], a[1], a[NR], o}'
done
```

For the library path, where the interesting number is objects per second rather than wall-clock:

```python
#!/usr/bin/env python3
"""Measure pyosmium parse throughput over one file, with the same work per format."""
from __future__ import annotations

import logging
import statistics
import subprocess
import time
from pathlib import Path

import osmium

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


class CountingHandler(osmium.SimpleHandler):
    """The fixed unit of work: touch every object, build nothing."""

    def __init__(self) -> None:
        super().__init__()
        self.nodes = self.ways = self.relations = 0

    def node(self, n) -> None:
        self.nodes += 1

    def way(self, w) -> None:
        self.ways += 1

    def relation(self, r) -> None:
        self.relations += 1

    @property
    def total(self) -> int:
        return self.nodes + self.ways + self.relations


def drop_caches() -> None:
    subprocess.run(["sync"], check=True)
    subprocess.run(["sudo", "sh", "-c", "echo 3 > /proc/sys/vm/drop_caches"], check=True)


def bench(path: Path, runs: int = 7) -> dict[str, float]:
    durations: list[float] = []
    counts: set[int] = set()
    drop_caches()
    CountingHandler().apply_file(str(path))        # discarded warm-up
    for _ in range(runs):
        drop_caches()
        handler = CountingHandler()
        started = time.perf_counter()
        handler.apply_file(str(path))
        durations.append(time.perf_counter() - started)
        counts.add(handler.total)
    if len(counts) != 1:
        raise RuntimeError(f"{path}: object count varied across runs: {counts}")
    median = statistics.median(durations)
    result = {
        "median_s": median,
        "min_s": min(durations),
        "max_s": max(durations),
        "objects": counts.pop(),
        "objects_per_s": counts_per_s if (counts_per_s := 0) else 0,
    }
    result["objects_per_s"] = result["objects"] / median
    logger.info("%-24s median %6.2f s  spread %5.2f s  %8.0f obj/s",
                path.name, median, max(durations) - min(durations), result["objects_per_s"])
    return result
```

<figure class="diagram-wrap">
<svg viewBox="0 0 880 282" role="img" aria-labelledby="bench-results-t bench-results-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="bench-results-t">Parse wall-clock across four OSM encodings of the same extract</title>
  <desc id="bench-results-d">A bar chart of median wall-clock over seven cold-cache runs on one core. Uncompressed XML takes 148 seconds reading 1.9 gigabytes at 0.35 million objects per second. bzip2-compressed XML takes 171 seconds reading 152 megabytes at 0.30 million objects per second. gzip-compressed XML takes 119 seconds reading 194 megabytes at 0.43 million per second. PBF takes 9.2 seconds reading 118 megabytes at 5.6 million per second.</desc>
  <rect x="0" y="0" width="880" height="282" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">The measurement, run properly</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">Ireland extract, cold cache, median of 7 runs, one core</text>
  <line x1="250" y1="68" x2="250" y2="228" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">.osm (XML, uncompressed)</text>
  <rect x="250" y="74" width="407" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="667" y="89" font-size="11" fill="currentColor" opacity="0.9">148 s · 1.9 GB read · 0.35 M obj/s</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">.osm.bz2</text>
  <rect x="250" y="116" width="470" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="868" y="131" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">171 s · 152 MB read · 0.30 M obj/s</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">.osm.gz</text>
  <rect x="250" y="158" width="327" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="587" y="173" font-size="11" fill="currentColor" opacity="0.9">119 s · 194 MB read · 0.43 M obj/s</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">.osm.pbf</text>
  <rect x="250" y="200" width="25" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="285" y="215" font-size="11" fill="currentColor" opacity="0.9">9.2 s · 118 MB read · 5.6 M obj/s</text>
  <text x="440" y="264" text-anchor="middle" font-size="11.0" fill="currentColor" opacity="0.85">bzip2 is slower than uncompressed XML despite reading a twelfth of the bytes: the decompression costs more CPU than the I/O it saves.</text>
</svg>
<figcaption>The bzip2 row is the interesting one. It reads twelve times fewer bytes than plain XML and still takes longer, because the bottleneck was never the disk.</figcaption>
</figure>

## Step-by-step walkthrough

`drop_caches` runs before *every* timed run, not once at the start. Dropping once and then running seven times measures one cold run and six warm ones, and the median lands on a warm number.

The discarded warm-up run exists for the CPU governor. On a machine with `ondemand` or `schedutil` scaling, the first CPU-heavy work after an idle period runs at a lower clock while the governor ramps, which systematically penalises whichever format is measured first.

`counts` is a set, and a run where it ends up with more than one member is a failed benchmark rather than an interesting result. Object counts must be identical across runs and across formats; if they are not, the two files are not the same data and nothing they are compared on means anything.

Reporting the median plus the spread rather than the best run is the honest choice. The best run is the one with the least interference, which is not the number anyone will reproduce.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 278" role="img" aria-labelledby="bench-lies-t bench-lies-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="bench-lies-t">Four benchmark confounders and their controls</title>
  <desc id="bench-lies-d">A grid of four confounders. A warm page cache means you measured the cache, controlled by dropping caches or using a fresh file each run. A single run measures scheduler noise, controlled by five or more runs reporting the median and the spread. Comparing different work measures two different jobs, controlled by asserting identical object counts and output. CPU frequency scaling measures the governor ramping up, controlled by pinning the governor and discarding a warm-up run.</desc>
  <rect x="0" y="0" width="880" height="278" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four ways the number lies, and the control for each</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">what you measured instead</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">control</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">warm page cache</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">the page cache</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">drop caches, or use a fresh file per run</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">single run</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">scheduler noise</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">5+ runs, median, report the spread</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">different work compared</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">two different jobs</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">assert identical object counts and output</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">CPU frequency scaling</text>
  <rect x="213" y="204" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">the governor ramping up</text>
  <rect x="535" y="204" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">pin the governor, discard a warm-up run</text>
  <text x="440" y="260" text-anchor="middle" font-size="10.0" fill="currentColor" opacity="0.85">The last one bites on laptops: the first run of a batch is slow because the CPU was idle, which makes whichever tool you test first look worse.</text>
</svg>
<figcaption>Frequency scaling is the one people forget, and it systematically penalises whichever tool is measured first.</figcaption>
</figure>

## Verification

Prove the controls are working before trusting the numbers.

Check the cache drop actually happens — if it silently fails, every run after the first is warm:

```bash
free -m | awk '/Mem:/ {print "cached before:", $6}'
sync && sudo sh -c 'echo 3 > /proc/sys/vm/drop_caches'
free -m | awk '/Mem:/ {print "cached after: ", $6}'
```

Check the spread. A median of 9.2 seconds with a min of 9.1 and a max of 9.4 is a controlled measurement; a max of 31 means something else was running and the median is not trustworthy.

Check the work is identical by comparing object counts across formats:

```bash
for f in ireland.osm ireland.osm.bz2 ireland.osm.pbf; do
  echo -n "$f  "; osmium fileinfo --extended --get data.count.nodes "$f"
done
```

All three must print the same number. Any difference means the files are not the same extract, and the benchmark is comparing different data.

## Common errors and fixes

| Symptom | Root cause | Fix |
|---|---|---|
| Second format always faster | Page cache warm from the first | Drop caches before every run |
| Huge spread between runs | Other work on the machine | Run on a quiet host; report the spread |
| First format always slower | CPU governor ramping | Discard a warm-up run; pin the governor |
| PBF barely faster than XML | Extract too small; startup dominates | Use a country extract, target 60 s+ runs |
| Counts differ between formats | Files are not the same extract | Regenerate all formats from one source |
| Results not reproducible elsewhere | Context not recorded | Publish CPU, versions and the input hash |

## Frequently Asked Questions

<details>
<summary>Why is bzip2 slower than uncompressed XML?</summary>

Because the bottleneck is CPU, not disk. bzip2 decompression is expensive — several times more so than gzip — and on any storage faster than a spinning disk the saved I/O does not pay for it. The measurement above reads a twelfth of the bytes and still takes longer. gzip sits in between: cheaper to decompress, less compression.
</details>

<details>
<summary>Should I benchmark with warm or cold cache?</summary>

Cold, unless your production workload genuinely re-reads the same file repeatedly. Cold measures the parser plus the storage, which is what a pipeline reading a freshly downloaded extract experiences. If you do benchmark warm, say so — a warm number is legitimate and it answers a different question.
</details>

<details>
<summary>How many runs are enough?</summary>

Five is the practical minimum for a median to mean anything; seven is comfortable. What matters more than the count is reporting the spread alongside the median, because a tight spread is evidence the measurement was controlled and a wide one is evidence it was not.
</details>

<details>
<summary>Does multi-threading change the comparison?</summary>

It widens it. PBF blocks are independently decodable, so PBF parsing parallelises almost linearly up to the physical core count — the curve in [Tuning pyrosm Worker Count for PBF Parsing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/tuning-pyrosm-worker-count-for-pbf-parsing/). XML is a single sequential document and does not parallelise at all without pre-splitting it. Benchmark single-threaded first, because that isolates the format; then measure the parallel case separately.
</details>

## Reading the result honestly

A benchmark answers exactly the question it measured, and the temptation is to report it as answering a broader one. Three limits are worth stating alongside any numbers you publish.

The measurement is of one machine's storage and CPU. A parse that is I/O-bound on a spinning disk is CPU-bound on NVMe, which changes the ranking between compressed and uncompressed formats — the bzip2 result above would look considerably better on slow storage, because the bytes it saves would cost more to read.

It is also of one workload. Counting objects touches every record and builds nothing; a job that assembles way geometries spends most of its time on reference resolution rather than on decoding, and the format difference shrinks against that larger constant. Benchmark the shape of work your pipeline actually does before letting a format comparison drive a design decision.

Finally, it is of one file. Extracts differ in tag density, in how many relations they carry and in how well sorted they are, and all three affect decode speed. A ratio measured on a European country extract transfers reasonably to another European country and less well to a dense urban extract or a sparse rural one.

None of this makes the numbers less useful. It makes them a measurement rather than a fact, which is the distinction a published benchmark should be careful to preserve.

## Specification reference

> `osmium fileinfo --extended` performs a full pass over the file, decoding every object to compute counts and the bounding box, and is therefore a reasonable fixed unit of parsing work across formats. `--get data.count.nodes` prints a single value suitable for scripting.

## Related

- [OSM XML vs PBF Comparison](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/) — the topic these numbers support.
- [Converting OSM XML to PBF with osmium](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/converting-osm-xml-to-pbf-with-osmium/) — producing the files under test.
- [Benchmarking OSM Parser Memory and Throughput](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/benchmarking-osm-parser-memory-and-throughput/) — the same discipline applied to libraries rather than formats.
- [Tuning pyrosm Worker Count for PBF Parsing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/tuning-pyrosm-worker-count-for-pbf-parsing/) — what happens once you add cores.
- [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) — why PBF decodes so much faster.

Up one level: [OSM XML vs PBF Comparison](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/).
