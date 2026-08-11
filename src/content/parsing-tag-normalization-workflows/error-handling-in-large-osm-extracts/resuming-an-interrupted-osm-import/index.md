---
title: "Resuming an Interrupted OSM Import"
description: "Make a multi-hour OSM import restartable: atomic units, temp-file-and-rename commits, markers written after the work, and a reconcile pass for the crash window."
pageTitle: "Resume an Interrupted OSM Import"
pageDescription: "A resumable OSM import — which sinks can replay safely, the commit-then-mark ordering, fsync discipline, signal handling, and a test that forces the crash rather than waiting for it."
slug: "resuming-an-interrupted-osm-import"
type: "article"
breadcrumb: "Resuming an Import"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Resuming an Interrupted OSM Import

Make a multi-hour import restartable, so a crash at seventy percent costs the remaining thirty rather than the whole job.

## Prerequisites

- [ ] A long-running import: a country or planet extract into files or a database
- [ ] Python 3.10+ and a sink you control
- [ ] A durable place for markers — a file, a table, an object-store key
- [ ] The error taxonomy from [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/)

## Conceptual minimum

Resumability is usually approached as a bookkeeping problem — remember how far we got — and that is the smaller half. The larger half is whether re-processing a unit is safe at all.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 318" role="img" aria-labelledby="resume-sinks-t resume-sinks-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="resume-sinks-t">Which sinks allow an interrupted import to resume</title>
  <desc id="resume-sinks-d">A grid of five sinks. An append-only file cannot resume because the position is unknown and the file may be half-written. Partitioned files can resume because a partition is either complete or absent. A database with upsert can resume because re-applying a row is a no-op. A database with plain insert cannot, because a second run doubles the rows. An in-place file rewrite cannot, because the source has already been consumed.</desc>
  <rect x="0" y="0" width="880" height="318" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Resumability is a property of the sink, not of the loop</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">can you resume?</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">what makes it work</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">append-only file</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">no — position unknown</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">nothing; the file may be half-written</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">partitioned files</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">yes</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">a partition is complete or absent</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">database with upsert</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">yes</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">re-applying a row is a no-op</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">database with plain insert</text>
  <rect x="213" y="204" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">no — duplicates</text>
  <rect x="535" y="204" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">nothing; the second run doubles rows</text>
  <text x="198" y="264" text-anchor="end" font-size="11.5" fill="currentColor">in-place file rewrite</text>
  <rect x="213" y="244" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">no — the source is gone</text>
  <rect x="535" y="244" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">nothing; recover from a copy</text>
  <text x="440" y="300" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Two of these five resume cleanly, and both do it the same way: make re-processing the same input produce the same result.</text>
</svg>
<figcaption>Resumability is designed into the write path. No amount of checkpoint bookkeeping rescues a sink that cannot absorb the same input twice.</figcaption>
</figure>

If replaying a unit duplicates rows, no marker helps: the resume produces a corrupt result rather than a slow one. So the first design decision is the write path, and the two shapes that work are a partition that is either complete or absent, and an upsert keyed on something stable.

Given a safe write path, the ordering rule is short and absolute.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="resume-order-t resume-order-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="resume-order-t">The commit ordering that makes a resume safe</title>
  <desc id="resume-order-d">A four-stage chain. Process one unit, a partition or a block range, which must be atomic. Write it under a temporary name invisible to readers. Rename it atomically, which is the commit point at which it exists and is complete. Only then record the marker saying the unit is done, never before.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="rs" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Commit the work before the marker, always</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">process a unit</text>
  <text x="116" y="107" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.85">one partition, one block range</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">the unit must be atomic</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#rs)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">write to a temp name</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">part-00042.parquet.tmp</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">invisible to readers</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#rs)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">atomic rename</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">now it exists, complete</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">the commit point</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#rs)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">record the marker</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">unit 42 done</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">after, never before</text>
  <text x="440" y="158" text-anchor="middle" font-size="10.0" fill="currentColor" opacity="0.85">A crash between the rename and the marker replays one unit — free, because the unit is idempotent. A crash the other way round loses it forever.</text>
</svg>
<figcaption>The asymmetry is deliberate: a crash must be able to duplicate work, never to skip it.</figcaption>
</figure>

Commit the work, then record the marker. A crash in between replays one unit, which costs a little time and no correctness because the unit is idempotent. Recording the marker first inverts that: a crash loses the unit permanently and nothing will ever notice — the same asymmetry as the checkpoint discipline in [Building a Minutely Update Pipeline](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/).

<figure class="diagram-wrap">
<svg viewBox="0 0 880 282" role="img" aria-labelledby="resume-value-t resume-value-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="resume-value-t">Remaining wall-clock after a crash, by resume unit size</title>
  <desc id="resume-value-d">A bar chart for a 412 million object import that crashed at 71 percent after four hours 20 minutes. Restarting from scratch takes six hours six minutes with four hours 20 wasted. Resuming with the whole file as one unit is identical, because there are no units to skip. Resuming with one partition as the unit, 84 in total, takes one hour 52 minutes and skips 60 partitions. Resuming with a block range as the unit takes one hour 46 minutes at the finest granularity.</desc>
  <rect x="0" y="0" width="880" height="282" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">What resuming is worth</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">412 M-object import, crash at 71% after 4 h 20 m</text>
  <line x1="250" y1="68" x2="250" y2="228" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">restart from scratch</text>
  <rect x="250" y="74" width="470" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="868" y="89" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">6 h 06 m total · 4 h 20 m wasted</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">resume, unit = whole file</text>
  <rect x="250" y="116" width="470" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="868" y="131" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">6 h 06 m · no units to skip</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">resume, unit = 1 partition (84)</text>
  <rect x="250" y="158" width="144" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="404" y="173" font-size="11" fill="currentColor" opacity="0.9">1 h 52 m · 60 partitions skipped</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">resume, unit = block range</text>
  <rect x="250" y="200" width="136" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="396" y="215" font-size="11" fill="currentColor" opacity="0.9">1 h 46 m · finest granularity</text>
  <text x="440" y="264" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Unit size sets the ceiling on what a resume can recover. One unit for the whole job is a checkpoint that never fires.</text>
</svg>
<figcaption>Most of the benefit arrives at the first sensible unit boundary. Going finer than a partition buys minutes, not hours.</figcaption>
</figure>

## Runnable solution

```python
#!/usr/bin/env python3
"""A resumable import: atomic units, markers written after the work, safe replay."""
from __future__ import annotations

import json
import logging
import os
import signal
import tempfile
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


class Markers:
    """Durable record of completed units. One line per unit, fsync'd on write."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.done: set[str] = set()
        if path.exists():
            for line in path.read_text().splitlines():
                if line.strip():
                    self.done.add(json.loads(line)["unit"])
            logger.info("resuming: %d unit(s) already complete", len(self.done))

    def record(self, unit: str, rows: int) -> None:
        # Append + flush + fsync: a marker that is not on disk is not a marker.
        with self.path.open("a") as handle:
            handle.write(json.dumps({"unit": unit, "rows": rows}) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        self.done.add(unit)

    def __contains__(self, unit: str) -> bool:
        return unit in self.done


def write_atomically(target: Path, write: Callable[[Path], int]) -> int:
    """Write via a temp file in the same directory, then rename.

    Same directory matters: rename is only atomic within one filesystem, and a
    temp file in /tmp is frequently on a different one.
    """
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=target.parent, suffix=".tmp")
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        rows = write(tmp)
        # Durability before visibility: the data must be on disk before the rename.
        with tmp.open("rb") as handle:
            os.fsync(handle.fileno())
        tmp.replace(target)                     # atomic within the filesystem
        return rows
    except BaseException:
        tmp.unlink(missing_ok=True)             # never leave a half-written .tmp
        raise


@dataclass
class Interrupted(Exception):
    """Raised on SIGTERM so the current unit unwinds cleanly rather than being killed."""
    signum: int


def _install_signal_handlers() -> None:
    def handler(signum, _frame):
        raise Interrupted(signum)
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, handler)


def run_import(units: Iterable[str],
               process: Callable[[str, Path], int],
               out_dir: Path,
               marker_path: Path) -> None:
    """Process each unit exactly once across any number of runs."""
    _install_signal_handlers()
    markers = Markers(marker_path)
    total_rows = skipped = 0

    for unit in units:
        if unit in markers:
            skipped += 1
            continue
        target = out_dir / f"{unit}.parquet"
        try:
            rows = write_atomically(target, lambda tmp, u=unit: process(u, tmp))
        except Interrupted as stop:
            logger.warning("interrupted by signal %d during unit %s — "
                           "that unit will be replayed on the next run", stop.signum, unit)
            raise SystemExit(130)
        markers.record(unit, rows)              # AFTER the rename, never before
        total_rows += rows
        logger.info("unit %s: %d row(s)", unit, rows)

    logger.info("import complete: %d unit(s) skipped, %d row(s) written this run",
                skipped, total_rows)


def reconcile(units: Iterable[str], out_dir: Path, marker_path: Path) -> list[str]:
    """Find units whose marker and output disagree — the crash-window casualties."""
    markers = Markers(marker_path)
    problems: list[str] = []
    for unit in units:
        exists = (out_dir / f"{unit}.parquet").exists()
        recorded = unit in markers
        if exists and not recorded:
            problems.append(f"{unit}: written but not marked (crash before marker)")
        if recorded and not exists:
            problems.append(f"{unit}: marked but missing (output deleted?)")
    for problem in problems:
        logger.warning("%s", problem)
    return problems
```

## Step-by-step walkthrough

`Markers.record` flushes and `fsync`s. A marker sitting in the operating system's page cache when the machine loses power is not a marker, and this is the one place in the loop where the cost of an fsync — a few milliseconds per unit — is obviously worth paying.

`write_atomically` creates its temporary file in the *target directory*. `rename` is atomic only within a single filesystem, so a temp file in `/tmp` followed by a rename into a data volume is a copy, not a rename, and it is not atomic. It also `fsync`s the data before renaming, because a rename that becomes visible before the data it points at has reached the disk gives you a complete-looking file full of nothing after a power loss.

The `except BaseException` on the temp file is deliberately broad. `KeyboardInterrupt` and `SystemExit` do not derive from `Exception`, and without catching them a Ctrl-C leaves `.tmp` files scattered through the output directory for the next run to trip over.

The signal handler converts `SIGTERM` into an exception so the current unit unwinds through the same cleanup path as any other failure. Without it, a container being stopped kills the process mid-write and leaves the temp file behind — harmless here because temp files are ignored on resume, but only because the naming keeps them invisible.

`reconcile` looks for the two states that disagree. "Written but not marked" is the expected crash-window casualty and is harmless: the unit replays and overwrites itself. "Marked but missing" is not expected and means something removed output behind the marker's back, which is worth failing on.

## Verification

Prove the resume works by causing the crash rather than waiting for one:

```bash
# Start the import, kill it partway, then run it again.
timeout 60 python3 import.py; echo "exit $?"
python3 import.py            # should log "resuming: N unit(s) already complete"
```

The second run's log line is the whole test. If it reports zero complete units, markers are not being persisted; if it reports every unit, the marker is being written before the work.

Then prove idempotence directly, which is the property the resume depends on:

```bash
python3 import.py            # run to completion
find out -name '*.parquet' -printf '%s %p\n' | sort > /tmp/first
rm -f markers.jsonl          # force a full replay
python3 import.py
find out -name '*.parquet' -printf '%s %p\n' | sort > /tmp/second
diff /tmp/first /tmp/second && echo "idempotent"
```

Byte-identical output from a full replay means a resume can never produce something a clean run would not.

Finally, check for leftovers, since a stray temp file is the visible symptom of an incomplete cleanup path:

```bash
find out -name '*.tmp' -print | head       # expect nothing
python3 -c "from import_ import reconcile; ..."   # expect no problems
```

## Common errors and fixes

| Symptom | Root cause | Fix |
|---|---|---|
| Resume skips a unit that was never written | Marker recorded before the work | Record after the atomic rename |
| Duplicate rows after a resume | Sink appends rather than replaces | Use partitions or upserts |
| Half-written files after a crash | Written directly to the target name | Temp file plus atomic rename |
| Rename is not atomic | Temp file on another filesystem | Create it in the target directory |
| Markers lost after a power cut | No fsync | Flush and fsync each marker |
| `.tmp` files accumulate | Cleanup missed on `KeyboardInterrupt` | Catch `BaseException` around the temp file |
| Resume replays everything | Unit identity not stable between runs | Derive unit ids from the input, not from enumeration order |

## Frequently Asked Questions

<details>
<summary>How large should a unit be?</summary>

Large enough that the per-unit overhead — a temp file, an fsync, a marker — is negligible, and small enough that losing one is cheap. For file sinks a partition is almost always the right unit; for database sinks a batch of tens of thousands of rows in one transaction works well. The measurement above shows most of the benefit arriving at the first sensible boundary, so there is little reason to go finer than a partition.
</details>

<details>
<summary>Can I resume a database import the same way?</summary>

Yes, with one simplification: put the marker insert *inside* the same transaction as the data. Then the marker and the data commit or roll back together and the crash window disappears entirely — the same property that makes a PostGIS sink attractive in [Applying Minutely Diffs to a PostGIS Database](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/applying-minutely-diffs-to-a-postgis-database/). This is only available when the marker and the data live in the same database.
</details>

<details>
<summary>What if the input file changes between runs?</summary>

Then the resume is invalid, because unit 42 of the new file is not unit 42 of the old one. Record a hash of the input alongside the markers and refuse to resume when it differs — a fresh extract downloaded overnight is exactly the situation where a silent mismatch produces a dataset that is half one week's data and half the next.
</details>

<details>
<summary>Is a marker file good enough, or do I need a database?</summary>

A file is fine for a single-process import, which is the common case. It stops being fine the moment two workers process units concurrently, because appending from several processes without coordination interleaves lines. At that point either give each worker its own marker file or move the markers into something with atomic writes.
</details>

## Specification reference

> POSIX `rename(2)` is atomic when source and destination are on the same filesystem: the destination always names either the old file or the new one, never a partial state. It does not imply durability — the rename may be reordered ahead of the data writes unless the file is `fsync`ed first, and on some filesystems the containing directory must be `fsync`ed for the rename itself to survive a power loss.

## Related

- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — the topic this recovery belongs to.
- [Building a Minutely Update Pipeline](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/) — the same commit ordering, for diffs.
- [Partitioning a GeoParquet OSM Lake by H3 Cell](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/partitioning-a-geoparquet-osm-lake-by-h3-cell/) — a layout whose units are naturally atomic.
- [Sizing PBF Chunk Batches to a Memory Budget](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/sizing-pbf-chunk-batches-to-a-memory-budget/) — how big a unit can be before memory decides.
- [Splitting a Planet File into Regional Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/splitting-a-planet-file-into-regional-extracts/) — a batch job with the same partial-failure problem.

Up one level: [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/).
