---
title: "Building a Minutely Update Pipeline"
description: "Engineer a durable, crash-safe minutely OSM update loop: a checkpoint store for the last applied sequence, an idempotent fetch→apply→re-index→advance cycle, lag monitoring, alerting, and back-off on upstream errors."
pageTitle: "Building a Minutely OSM Update Pipeline in Python"
pageDescription: "A crash-safe fetch-apply-checkpoint loop for OSM minutely diffs: durable sequence store, idempotent apply-then-advance ordering, touched-feature re-indexing, replication-lag alerts, and retry back-off."
slug: building-a-minutely-update-pipeline
type: guide
breadcrumb: "Minutely Update Pipeline"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# Building a Minutely Update Pipeline

A single applied diff is a manual operation; keeping an extract current for months without a human touching it is a systems problem. Picture an analytics database that a team believes is live: a cron entry fetches the newest OsmChange file every minute and applies it, and for weeks the map looks fresh. Then the host reboots mid-apply, the process dies after the merge but before anyone records that the diff was consumed, and the next run re-applies the same sequence — double-deleting a node that a later diff had already recreated. Nobody notices until a routing query returns a road that upstream restored two hours ago. The dataset is now silently forked from the planet, and no error was ever raised. That failure is the reason a minutely pipeline is not a loop around `osmium apply-changes` but a small state machine with a durable memory of exactly what it has already done. This guide sits inside the [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/) section, which explains why an extract drifts from upstream in the first place; here the concern narrows to automating the catch-up forever, safely.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 384" role="img" aria-label="The durable minutely update loop. A scheduler timer tick triggers fetch of the next replication diff, which is applied to the base extract with osmium, then only the touched features are re-indexed, and finally the last-applied sequence checkpoint is advanced atomically before a success notification fires and the loop waits for the next tick. If fetching or applying a diff raises an upstream error, control branches to an exponential back-off and retry that returns to the fetch step without advancing the checkpoint." style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit">
  <title>Crash-safe fetch, apply, re-index, and advance-checkpoint update loop</title>
  <desc>A scheduler tick starts a cycle: fetch the next diff, apply changes with osmium, re-index only the touched features, then advance the durable checkpoint atomically and notify success before waiting for the next tick. Fetch or apply errors branch to an exponential back-off and retry that loops back to fetch and never advances the checkpoint.</desc>
  <defs>
    <marker id="mup-arr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker>
  </defs>
  <rect x="0" y="0" width="1080" height="384" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="540" y="26" text-anchor="middle" font-size="15" fill="currentColor" font-weight="700">Apply first, advance the checkpoint last — the loop is crash-safe by ordering</text>
  <!-- top row -->
  <rect x="24" y="64" width="168" height="62" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="108" y="90" text-anchor="middle" font-size="13" fill="currentColor" font-weight="600">Scheduler</text>
  <text x="108" y="109" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">timer tick</text>
  <rect x="234" y="64" width="168" height="62" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="318" y="90" text-anchor="middle" font-size="13" fill="currentColor" font-weight="600">Fetch next diff</text>
  <text x="318" y="109" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">seq+1 · .osc.gz</text>
  <rect x="444" y="64" width="168" height="62" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="528" y="90" text-anchor="middle" font-size="13" fill="currentColor" font-weight="600">Apply changes</text>
  <text x="528" y="109" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">osmium merge</text>
  <rect x="654" y="64" width="168" height="62" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="738" y="90" text-anchor="middle" font-size="13" fill="currentColor" font-weight="600">Re-index touched</text>
  <text x="738" y="109" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">changed ids only</text>
  <rect x="864" y="64" width="168" height="62" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="948" y="86" text-anchor="middle" font-size="13" fill="currentColor" font-weight="600">Advance</text>
  <text x="948" y="103" text-anchor="middle" font-size="13" fill="currentColor" font-weight="600">checkpoint</text>
  <text x="948" y="120" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">atomic write</text>
  <!-- top arrows -->
  <line x1="192" y1="95" x2="232" y2="95" stroke="currentColor" stroke-width="1.5" marker-end="url(#mup-arr)"/>
  <line x1="402" y1="95" x2="442" y2="95" stroke="currentColor" stroke-width="1.5" marker-end="url(#mup-arr)"/>
  <line x1="612" y1="95" x2="652" y2="95" stroke="currentColor" stroke-width="1.5" marker-end="url(#mup-arr)"/>
  <line x1="822" y1="95" x2="862" y2="95" stroke="currentColor" stroke-width="1.5" marker-end="url(#mup-arr)"/>
  <!-- notify -->
  <rect x="864" y="196" width="168" height="56" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="948" y="220" text-anchor="middle" font-size="13" fill="currentColor" font-weight="600">Notify success</text>
  <text x="948" y="238" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">emit lag metric</text>
  <line x1="948" y1="126" x2="948" y2="194" stroke="currentColor" stroke-width="1.5" marker-end="url(#mup-arr)"/>
  <!-- back-off branch -->
  <rect x="444" y="196" width="168" height="56" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="528" y="220" text-anchor="middle" font-size="13" fill="currentColor" font-weight="600">Back-off &amp; retry</text>
  <text x="528" y="238" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">exponential wait</text>
  <path d="M528,126 V196" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 3" marker-end="url(#mup-arr)"/>
  <text x="596" y="162" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">error / 404</text>
  <path d="M470,196 V160 H318 V128" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 3" marker-end="url(#mup-arr)"/>
  <!-- success return loop -->
  <path d="M948,252 V324 H108 V128" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#mup-arr)"/>
  <text x="540" y="344" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.9">wait for next tick — checkpoint now names the last fully applied sequence</text>
</svg>

## Prerequisites

This guide composes three capabilities that each have their own reference. You need the mechanics of merging a change file into a base extract, covered in [applying .osc change files with osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/) — the pipeline calls that operation once per cycle and treats its version-order guarantees as a given. You need the addressing model for the replication stream, laid out in [replication sequence numbers and state](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/), because the entire pipeline is organised around a single monotonically increasing integer: the last sequence you have durably applied. And because every applied diff mutates only a handful of features yet can invalidate downstream lookups, you need the incremental-update discipline from [spatial indexing for OSM extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/), so the re-index step touches changed ids rather than rebuilding the whole index each minute. Readers who have those three can treat what follows as the orchestration layer that binds them into a service.

## The Checkpoint: The Only State That Must Survive a Crash

Everything in a minutely pipeline is derived except one number. The **checkpoint** is the sequence number of the last replication diff that has been fully applied to the base extract *and* had its side effects (re-indexing, downstream fan-out) completed. It is the pipeline's single source of truth about where it is in the stream, and its integrity is the whole game: if the checkpoint is ahead of reality, you skip diffs and silently lose edits; if it is behind reality, you re-apply diffs and corrupt state. The correctness of the loop reduces to one invariant — the checkpoint advances if and only if the diff it names has been applied exactly once.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 278" role="img" aria-labelledby="ckpt-store-t ckpt-store-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="ckpt-store-t">Four checkpoint stores compared on the guarantee each one actually gives</title>
  <desc id="ckpt-store-d">A grid comparing a plain text file, a text file written then renamed, a SQLite row and a Postgres row in the same transaction as the data. The plain file can be torn by a crash mid-write. The rename is atomic on the same filesystem but is not tied to the data write. SQLite gives durability but still commits separately from the data. A Postgres row updated inside the same transaction as the applied rows is the only option where the checkpoint and the data cannot disagree.</desc>
  <rect x="0" y="0" width="880" height="278" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Where the checkpoint lives decides which crash you survive</text>
  <text x="317" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">torn write?</text>
  <text x="531" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">can disagree with data?</text>
  <text x="745" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">use when</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">plain text file</text>
  <rect x="213" y="84" width="208" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="317" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">yes — avoid</text>
  <rect x="427" y="84" width="208" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="531" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">yes</text>
  <rect x="641" y="84" width="208" height="32" rx="5" fill="none" stroke="currentColor" stroke-width="1.2"/>
  <text x="745" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">never</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">write + atomic rename</text>
  <rect x="213" y="124" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="317" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">no</text>
  <rect x="427" y="124" width="208" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="531" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">yes, briefly</text>
  <rect x="641" y="124" width="208" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="745" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">file sinks</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">SQLite row</text>
  <rect x="213" y="164" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="317" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">no</text>
  <rect x="427" y="164" width="208" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="531" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">yes, briefly</text>
  <rect x="641" y="164" width="208" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="745" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">multi-process loops</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">same txn as the data</text>
  <rect x="213" y="204" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="317" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">no</text>
  <rect x="427" y="204" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="531" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">no</text>
  <rect x="641" y="204" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="745" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">PostGIS sink</text>
  <text x="440" y="260" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">When the checkpoint and the data can disagree, make the replay idempotent — that is what closes the window you cannot remove.</text>
</svg>
<figcaption>Only the last row removes the window entirely, and it is available only when the sink is the same database. For a file-based sink, atomic rename plus idempotent replay is the honest best.</figcaption>
</figure>

Three properties are non-negotiable for the checkpoint store:

- **Durability.** It must survive process death, host reboot, and OOM kills. A value held only in memory or in an unflushed file is not a checkpoint; it is a guess.
- **Atomic advancement.** Moving from sequence *N* to *N+1* must be all-or-nothing. A checkpoint file that can be observed half-written (a truncated integer, a torn JSON document) reintroduces exactly the ambiguity it exists to remove.
- **Co-location with the data it describes.** The checkpoint describes the state of a specific base file. If the base extract and the checkpoint can drift apart — restored from different backups, for instance — the number becomes a lie. Keep them versioned together.

The cheapest durable store that satisfies atomicity is a small file written via the write-temp-then-`os.replace` idiom, because `os.replace` maps to an atomic `rename(2)` on POSIX filesystems: a reader either sees the whole old file or the whole new file, never a torn one. Teams already running a database frequently store the checkpoint in a single-row table instead, so the diff apply and the checkpoint advance can share one transaction — the strongest possible coupling, described in [applying minutely diffs to a PostGIS database](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/applying-minutely-diffs-to-a-postgis-database/).

## State-Store Reference

The checkpoint document is deliberately tiny, but each field earns its place. The table below is the schema the runnable loop below reads and writes.

| Field | Type | Purpose | Failure if omitted |
|---|---|---|---|
| `sequence` | int | Last fully applied replication sequence number | Cannot compute which diff to fetch next |
| `base_path` | str | Path to the extract this sequence describes | Checkpoint can be paired with the wrong data |
| `applied_at` | ISO-8601 str | Wall-clock time the advance was committed | Lag cannot be estimated without a timestamp |
| `server_ts` | ISO-8601 str | `timestamp` from the diff's `.state.txt` | Lag measured against upstream, not local clock |
| `checksum` | str | Hash of the base file after the last apply | Detects a base/checkpoint mismatch on restart |

Two of these fields deserve emphasis. `server_ts` is the `timestamp=` line from the replication `.state.txt` that accompanies each diff; it is upstream's own statement of how fresh the diff is, and comparing it to now is the honest measure of **replication lag**. `checksum` lets the loop refuse to start when the base file on disk is not the one the checkpoint was written for — the guard that catches a restore-from-wrong-backup before it compounds into silent divergence. Sequence numbers themselves, their zero-padded directory layout, and how to translate a wall-clock time into a starting sequence are the subject of [finding the replication sequence for a timestamp](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/finding-the-replication-sequence-for-a-timestamp/).

## Step-by-Step: The Orchestration Loop

The loop below is the whole pipeline in one module. It reads the checkpoint, computes the next sequence, fetches and applies that diff, re-indexes only the touched features, and — only then — advances the checkpoint atomically. Each cycle is independent and idempotent: run it from a timer every minute, or run it in a `while` loop; the correctness argument does not change.

1. **Load the checkpoint and verify the base.** Read the durable sequence and confirm the base file's checksum matches. A mismatch aborts before any mutation — the data is not what the checkpoint claims.
2. **Compute and fetch the next diff.** The target is `sequence + 1`. Fetch its `.osc.gz` and `.state.txt`; a `404` means you have caught up to the head of the stream, which is a normal idle state, not an error.
3. **Apply then collect touched ids.** Merge the diff into the base in version order, capturing the set of node, way, and relation ids the diff created, modified, or deleted.
4. **Re-index only the touched features.** Delete the changed ids from the spatial index and re-insert the survivors. This is the step that makes minutely updates affordable — you never rebuild the index.
5. **Advance the checkpoint atomically.** Write the new sequence, timestamp, and checksum to a temp file and `os.replace` it into place. This line, and only this line, commits the cycle.
6. **Notify and emit metrics.** Publish the lag derived from `server_ts` so monitoring can see progress; on failure, hand control to back-off without advancing the checkpoint.

```python
from __future__ import annotations

import gzip
import hashlib
import json
import logging
import os
import tempfile
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path

import requests

logger = logging.getLogger("osm.minutely_pipeline")

REPLICATION_BASE = "https://planet.openstreetmap.org/replication/minute"


class CaughtUp(Exception):
    """Raised when the requested sequence does not exist yet (HTTP 404)."""


class UpstreamError(Exception):
    """Transient fetch/apply failure that should trigger back-off, not advance."""


@dataclass(frozen=True)
class Checkpoint:
    sequence: int
    base_path: str
    applied_at: str
    server_ts: str
    checksum: str


def sha256_of(path: Path) -> str:
    """Cheap integrity hash of the base extract."""
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def load_checkpoint(store: Path) -> Checkpoint:
    data = json.loads(store.read_text(encoding="utf-8"))
    return Checkpoint(**data)


def save_checkpoint(store: Path, cp: Checkpoint) -> None:
    """Atomically replace the checkpoint file (write-temp-then-rename)."""
    tmp = store.with_suffix(store.suffix + ".tmp")
    tmp.write_text(json.dumps(asdict(cp), indent=2), encoding="utf-8")
    os.replace(tmp, store)  # atomic rename(2) on POSIX


def seq_to_path(seq: int) -> str:
    """001/234/567 layout used by every OSM replication server."""
    s = f"{seq:09d}"
    return f"{s[0:3]}/{s[3:6]}/{s[6:9]}"


def fetch_diff(seq: int, workdir: Path) -> tuple[Path, str]:
    """Download one .osc.gz and its .state.txt; return (osc_path, server_ts)."""
    stub = f"{REPLICATION_BASE}/{seq_to_path(seq)}"
    state = requests.get(f"{stub}.state.txt", timeout=30)
    if state.status_code == 404:
        raise CaughtUp(f"sequence {seq} not published yet")
    state.raise_for_status()

    server_ts = ""
    for line in state.text.splitlines():
        if line.startswith("timestamp="):
            server_ts = line.split("=", 1)[1].replace("\\", "").strip()

    osc = requests.get(f"{stub}.osc.gz", timeout=60)
    osc.raise_for_status()
    dest = workdir / f"{seq:09d}.osc.gz"
    dest.write_bytes(osc.content)
    return dest, server_ts


def apply_and_collect(base: Path, osc_gz: Path) -> set[tuple[str, int]]:
    """Merge the diff into the base and return the set of touched (kind, id).

    Delegates the actual version-ordered merge to osmium/pyosmium (see the
    'Applying .osc change files' guide). Here we also parse the OsmChange to
    learn which primitives were touched so the index can be updated in place.
    """
    from apply_osc import apply_changes  # your wrapper over osmium apply-changes

    touched: set[tuple[str, int]] = set()
    with gzip.open(osc_gz, "rt", encoding="utf-8") as fh:
        import xml.etree.ElementTree as ET

        for _event, elem in ET.iterparse(fh, events=("end",)):
            if elem.tag in {"node", "way", "relation"}:
                touched.add((elem.tag, int(elem.get("id", "0"))))
                elem.clear()

    apply_changes(base=base, osc_gz=osc_gz)  # version-aware merge, in place
    return touched


def reindex_touched(index, base: Path, touched: set[tuple[str, int]]) -> None:
    """Delete changed ids from the index and re-insert the survivors."""
    from geometry_store import geometry_for  # resolves current geometry by id

    for kind, osm_id in touched:
        index.delete_feature(kind, osm_id)
        geom = geometry_for(base, kind, osm_id)
        if geom is not None:               # None => the diff deleted it
            index.insert_feature(kind, osm_id, geom.bounds, geom)


def lag_seconds(server_ts: str) -> float:
    if not server_ts:
        return float("nan")
    ts = datetime.fromisoformat(server_ts.replace("Z", "+00:00"))
    return (datetime.now(timezone.utc) - ts).total_seconds()


def run_one_cycle(store: Path, index, notify) -> bool:
    """Advance the extract by exactly one sequence. Returns False when caught up."""
    cp = load_checkpoint(store)
    base = Path(cp.base_path)

    if sha256_of(base) != cp.checksum:
        raise RuntimeError("base file does not match checkpoint checksum; refusing to run")

    target = cp.sequence + 1
    workdir = base.parent / "diffs"
    workdir.mkdir(exist_ok=True)

    try:
        osc_gz, server_ts = fetch_diff(target, workdir)
    except CaughtUp:
        logger.debug("caught up at sequence %d", cp.sequence)
        return False
    except requests.RequestException as exc:
        raise UpstreamError(f"fetch failed for {target}: {exc}") from exc

    # --- Apply BEFORE advancing the checkpoint: crash-safety by ordering. ---
    touched = apply_and_collect(base, osc_gz)
    reindex_touched(index, base, touched)

    new_cp = Checkpoint(
        sequence=target,
        base_path=str(base),
        applied_at=datetime.now(timezone.utc).isoformat(),
        server_ts=server_ts,
        checksum=sha256_of(base),
    )
    save_checkpoint(store, new_cp)  # <-- the single commit point

    lag = lag_seconds(server_ts)
    logger.info("applied seq %d, %d features touched, lag %.0fs", target, len(touched), lag)
    notify(sequence=target, touched=len(touched), lag_seconds=lag)
    osc_gz.unlink(missing_ok=True)
    return True


def serve(store: Path, index, notify, poll_seconds: int = 60) -> None:
    """Run cycles forever with exponential back-off on transient errors."""
    backoff = poll_seconds
    while True:
        try:
            progressed = run_one_cycle(store, index, notify)
            backoff = poll_seconds                 # reset after any clean cycle
            time.sleep(0 if progressed else poll_seconds)
        except UpstreamError as exc:
            backoff = min(backoff * 2, 900)        # cap at 15 minutes
            logger.warning("%s; backing off %ds", exc, backoff)
            time.sleep(backoff)
```

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Build a crash-safe minutely OSM update loop",
  "description": "Automate continuous OSM catch-up with a durable checkpoint, an idempotent apply-then-advance cycle, incremental re-indexing, and exponential back-off on upstream errors.",
  "step": [
    { "@type": "HowToStep", "name": "Load the checkpoint and verify the base", "text": "Read the durable last-applied sequence and confirm the base file checksum matches before any mutation, aborting on mismatch." },
    { "@type": "HowToStep", "name": "Fetch the next diff", "text": "Target sequence+1, download its .osc.gz and .state.txt, and treat a 404 as a normal caught-up idle state rather than an error." },
    { "@type": "HowToStep", "name": "Apply and collect touched ids", "text": "Merge the diff into the base in version order and capture the node, way, and relation ids the diff created, modified, or deleted." },
    { "@type": "HowToStep", "name": "Re-index only the touched features", "text": "Delete the changed ids from the spatial index and re-insert the survivors so the index is never rebuilt from scratch." },
    { "@type": "HowToStep", "name": "Advance the checkpoint atomically", "text": "Write the new sequence, timestamp, and checksum to a temp file and os.replace it into place as the single commit point of the cycle." },
    { "@type": "HowToStep", "name": "Notify and emit lag", "text": "Publish replication lag derived from the diff timestamp; on transient failure hand control to exponential back-off without advancing the checkpoint." }
  ]
}
</script>

## Idempotency and Crash-Safety: Ordering Is the Proof

The correctness of this loop rests on one design decision: **apply the diff, then advance the checkpoint — never the reverse.** Consider the two crash windows. If the process dies *after* applying but *before* advancing the checkpoint, the next run recomputes `target = sequence + 1` and re-applies the same diff. That is safe precisely because an OsmChange merge is idempotent when applied in version order: re-creating a node that already exists at that version, or re-deleting an already-deleted node, is a no-op — the same property the [applying .osc change files with osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/) guide relies on. If instead you advanced the checkpoint first and then crashed before applying, you would have permanently skipped a diff with no record that it was missed. The ordering converts an unrecoverable data-loss bug into a harmless, self-healing repeat.

Two caveats keep this guarantee real. First, the apply operation itself must not leave the base file half-written; osmium writes to a new output and swaps, so a killed apply leaves the old base intact and the checkpoint still points at it — consistent. Second, the checksum guard is what makes re-apply provably safe across a restart: if a partial apply had corrupted the base, the checksum on the next boot would not match, and the loop refuses to run rather than compounding damage. Idempotency plus a durable checkpoint plus a pre-flight integrity check is the full crash-safety story; remove any one and a reboot can fork your dataset.

## Re-Processing Only Touched Features

A minutely diff typically mutates a few hundred to a few thousand primitives against a base of hundreds of millions. Re-deriving anything over the whole extract each minute — re-indexing, re-normalizing tags, re-tiling — throws away the central advantage of incremental replication and turns a one-second cycle into a ten-minute one. The `touched` set returned by the apply step is the surgical scope: parse the OsmChange once to learn which ids appear in any `<create>`, `<modify>`, or `<delete>` block, and drive every downstream refresh from that set alone.

For the spatial index this means a delete-then-reinsert keyed on id, which is exactly the incremental-update pattern in [spatial indexing for OSM extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/); an R-tree supports per-feature deletion, so a touched way is removed and its new geometry re-inserted without disturbing its neighbours. One subtlety bites here: a modified node changes the geometry of every *way* that references it, even though those ways are absent from the diff. A correct re-index resolves the parents of each touched node — via a node→way reverse index maintained alongside the primary one — and re-indexes those parents too. Miss that dependency closure and the index slowly desynchronizes from the geometry it is supposed to describe. The same touched-set discipline feeds tag re-normalization: only the changed features are re-run through the cleaning stage, so the cost of staying current scales with edit volume, not dataset size.

## Monitoring Replication Lag and Alerting

Replication lag is the age of the newest diff you have applied, measured against the upstream clock — not your own. Compute it as `now − server_ts`, where `server_ts` is the `timestamp=` from the applied diff's `.state.txt`. A healthy minutely pipeline sits at a lag of roughly one to three minutes: the newest diff is always a minute or two old at the source, and your apply adds a little. The signal that matters is not the absolute value but the **trend**. A lag that climbs monotonically means the pipeline is falling behind — either an apply is taking longer than the interval, or every cycle is hitting back-off — and it will never recover on its own because each minute adds a diff faster than you clear it.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 251" role="img" aria-labelledby="lag-signals-t lag-signals-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="lag-signals-t">Three lag signals and what each one alone fails to notice</title>
  <desc id="lag-signals-d">Three panels. Sequence lag, the difference between head and applied sequence, catches a slow or stopped loop but reads as zero if the upstream stream itself has stalled. Timestamp lag, now minus the applied diff timestamp, catches an upstream stall too but is noisy when the stream publishes late. Loop heartbeat, time since the last successful iteration, catches a crashed process but says nothing about correctness. Each panel names the failure the other two miss.</desc>
  <rect x="0" y="0" width="880" height="251" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three lag signals, three different blind spots</text>
  <rect x="26" y="52" width="258" height="157" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Sequence lag</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">head_seq − applied_seq</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Catches: slow loop, stuck apply</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Blind to: upstream stream stalled</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">(both numbers freeze → lag reads 0)</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Alert above: 5 sequences</text>
  <rect x="310" y="52" width="258" height="157" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="439" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Timestamp lag</text>
  <text x="324" y="104" font-size="10.5" fill="currentColor" opacity="0.92">now − applied diff timestamp</text>
  <text x="324" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Catches: upstream stall, slow loop</text>
  <text x="324" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Blind to: nothing, but noisy</text>
  <text x="324" y="167" font-size="10.5" fill="currentColor" opacity="0.92">(publishing is not exactly minutely)</text>
  <text x="324" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Alert above: 10 minutes</text>
  <rect x="594" y="52" width="258" height="157" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="723" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Loop heartbeat</text>
  <text x="608" y="104" font-size="10.5" fill="currentColor" opacity="0.92">now − last successful iteration</text>
  <text x="608" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Catches: crashed or wedged process</text>
  <text x="608" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Blind to: applying the wrong diffs</text>
  <text x="608" y="167" font-size="10.5" fill="currentColor" opacity="0.92">(a fast wrong loop looks healthy)</text>
  <text x="608" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Alert above: 5 minutes</text>
  <text x="440" y="235" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">The pairing that matters: sequence lag at zero <em>and</em> timestamp lag rising means the problem is upstream, not yours.</text>
</svg>
<figcaption>No single number is sufficient. Alert on sequence lag for pipeline health, timestamp lag for data freshness, and a heartbeat for liveness — the three fail in different directions.</figcaption>
</figure>

Emit lag as a gauge metric on every successful cycle and alert on two conditions: lag exceeding a ceiling (say ten minutes) for a sustained window, and *staleness* — no successful checkpoint advance within a window even though diffs exist upstream. The second catches a wedged process that is not erroring loudly but has simply stopped making progress. A useful third signal is the gap between the head sequence upstream and your checkpoint: fetch the top-level `state.txt` at the replication root, compare its sequence to yours, and you have an exact count of how many diffs you are behind, which is a cleaner backlog measure than seconds when you are recovering from an outage.

## Performance and Scale Considerations

The dominant cost in a minutely cycle is not fetching or parsing the few-kilobyte diff — it is applying it to a large base file and refreshing derived structures. Three levers keep each cycle inside its one-minute budget:

- **Never rebuild, always mutate.** The re-index and re-normalize steps must be O(touched), not O(base). If any downstream step scales with dataset size, the pipeline cannot keep a minutely cadence on a continental extract.
- **Batch when you fall behind.** After an outage you may be hundreds of sequences behind. Applying diffs one at a time still works, but osmium can merge many `.osc.gz` files in a single pass; catch up in batches, then advance the checkpoint to the last sequence in the batch, and only drop to per-minute cadence once lag is back to baseline. The catch-up procedure is detailed in [catching up a stale OSM extract with pyosmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/catching-up-a-stale-osm-extract-with-pyosmium/).
- **Keep the base on fast storage.** Each apply reads and rewrites the base extract; on a planet-scale file that I/O dominates. An SSD and a base kept in PBF (not XML) turn a minutes-long apply into seconds.

At planet scale, teams frequently stop applying to a monolithic PBF and instead apply into PostGIS, where an apply is a set of row upserts rather than a file rewrite — the trade-off explored in [applying minutely diffs to a PostGIS database](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/applying-minutely-diffs-to-a-postgis-database/).

## Failure Modes and Gotchas

- **Advancing the checkpoint before the apply commits.** The single most dangerous inversion: it turns a crash into a permanently skipped diff. The checkpoint write must be the last statement of the cycle.
- **Treating a 404 as an error.** The next sequence not existing yet is the normal caught-up state. Back off and retry, but do not alert or escalate — otherwise a healthy idle pipeline pages you every minute.
- **Ignoring reverse dependencies on re-index.** A modified node silently changes the geometry of its parent ways. Re-index the parents, not just the primitives named in the diff.
- **Non-atomic checkpoint writes.** Writing the sequence in place, without a temp-file-and-rename, exposes a torn file to any reader that starts mid-write — reintroducing the ambiguity the checkpoint exists to remove.
- **Unbounded back-off retries against a genuine problem.** Exponential back-off masks a persistent upstream outage or a permanently malformed diff as "just slow." Cap the back-off and alert once it saturates, so a stuck pipeline surfaces instead of retrying silently forever.
- **Sharing one checkpoint across two base files.** A checkpoint describes a specific base; pointing two pipelines at one store, or restoring base and checkpoint from different backups, makes the number lie. The checksum guard is the defence.
- **Fetch and apply on the same clock as the timer.** If an apply routinely runs longer than the interval, overlapping runs corrupt state. Serialize with a lock (the subject of the scheduling guide below) so cycles never overlap.

## Integration Points: Wiring the Loop to a Scheduler and a Sink

The loop is a library function; something must call it on a cadence and something must consume its notifications. The cleanest boundary is a `notify` callback that the pipeline invokes on each successful advance — it knows nothing about metrics backends, and the caller wires it to whatever exists:

```python
def notify(sequence: int, touched: int, lag_seconds: float) -> None:
    """Publish one cycle's outcome to metrics and, on high lag, to alerting."""
    metrics.gauge("osm.replication.lag_seconds", lag_seconds)
    metrics.gauge("osm.replication.sequence", sequence)
    metrics.counter("osm.replication.features_touched", touched)
    if lag_seconds > 600:
        alerts.warn(f"OSM replication lag {lag_seconds:.0f}s at seq {sequence}")
```

Errors that the apply step cannot handle — a malformed diff, an unresolved reference — should be routed into the quarantine discipline from [error handling in large OSM extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) rather than crashing the loop, so one bad sequence is isolated and reviewed instead of halting all forward progress. The remaining question is what invokes `serve()` reliably on a Linux host, survives reboots, isolates failures, and guarantees no two cycles overlap — which is precisely what a systemd service and timer provide.

## Running the Pipeline in Depth

This guide has one companion that takes the loop from a script you run by hand to a supervised service:

- [Scheduling OSM Diff Sync with systemd Timers](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/scheduling-osm-diff-sync-with-systemd-timers/) — a `.service` and `.timer` unit pair that runs the loop on a cadence with journald logging, `Restart=` semantics, and a lock that prevents overlapping runs.

## Frequently Asked Questions

<details>
<summary>Should I advance the checkpoint before or after applying the diff?</summary>

Always after. Apply the diff to the base, complete re-indexing, and only then advance the checkpoint as the final statement of the cycle. If the process dies between apply and advance, the next run re-applies the same sequence, which is a harmless no-op because an OsmChange merge is idempotent in version order. Advancing first and then crashing would permanently skip a diff with no record it was missed.
</details>

<details>
<summary>How do I keep a minutely pipeline from re-processing the whole extract each cycle?</summary>

Parse the OsmChange once to build the set of node, way, and relation ids it creates, modifies, or deletes, and drive every downstream refresh from that set alone. Delete and re-insert only those ids in the spatial index, and re-normalize only those features. Remember that a modified node changes the geometry of every way that references it, so resolve and re-index those parent ways too, even though they are not named in the diff.
</details>

<details>
<summary>What is a healthy replication lag and how do I measure it?</summary>

Compute lag as the current time minus the timestamp from the applied diff's state file, which is upstream's own statement of the diff's age. A healthy minutely pipeline sits around one to three minutes. Watch the trend rather than the absolute value: a lag that climbs monotonically means the pipeline is falling behind and will not recover on its own, because each minute adds a diff faster than you clear it.
</details>

<details>
<summary>How should the pipeline react to a 404 when fetching the next diff?</summary>

Treat it as the normal caught-up state, not an error. A 404 means the sequence you asked for has not been published yet because you are at the head of the stream. Back off for one poll interval and try the same sequence again. Do not alert or escalate on a 404, or a perfectly healthy idle pipeline will page you every minute.
</details>

<details>
<summary>What happens when the pipeline falls far behind after an outage?</summary>

Catch up in batches instead of one diff per minute. osmium can merge many change files in a single pass, so apply a run of sequences at once, advance the checkpoint to the last sequence in the batch, and only return to per-minute cadence once lag is back to baseline. Compare your checkpoint to the head sequence in the replication root's state file to know exactly how many diffs remain.
</details>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Should I advance the checkpoint before or after applying the diff?",
      "acceptedAnswer": { "@type": "Answer", "text": "Always after. Apply the diff to the base, complete re-indexing, and only then advance the checkpoint as the final statement of the cycle. If the process dies between apply and advance, the next run re-applies the same sequence, which is a harmless no-op because an OsmChange merge is idempotent in version order. Advancing first and then crashing would permanently skip a diff with no record it was missed." }
    },
    {
      "@type": "Question",
      "name": "How do I keep a minutely pipeline from re-processing the whole extract each cycle?",
      "acceptedAnswer": { "@type": "Answer", "text": "Parse the OsmChange once to build the set of node, way, and relation ids it creates, modifies, or deletes, and drive every downstream refresh from that set alone. Delete and re-insert only those ids in the spatial index, and re-normalize only those features. Remember that a modified node changes the geometry of every way that references it, so resolve and re-index those parent ways too, even though they are not named in the diff." }
    },
    {
      "@type": "Question",
      "name": "What is a healthy replication lag and how do I measure it?",
      "acceptedAnswer": { "@type": "Answer", "text": "Compute lag as the current time minus the timestamp from the applied diff's state file, which is upstream's own statement of the diff's age. A healthy minutely pipeline sits around one to three minutes. Watch the trend rather than the absolute value: a lag that climbs monotonically means the pipeline is falling behind and will not recover on its own, because each minute adds a diff faster than you clear it." }
    },
    {
      "@type": "Question",
      "name": "How should the pipeline react to a 404 when fetching the next diff?",
      "acceptedAnswer": { "@type": "Answer", "text": "Treat it as the normal caught-up state, not an error. A 404 means the sequence you asked for has not been published yet because you are at the head of the stream. Back off for one poll interval and try the same sequence again. Do not alert or escalate on a 404, or a perfectly healthy idle pipeline will page you every minute." }
    },
    {
      "@type": "Question",
      "name": "What happens when the pipeline falls far behind after an outage?",
      "acceptedAnswer": { "@type": "Answer", "text": "Catch up in batches instead of one diff per minute. osmium can merge many change files in a single pass, so apply a run of sequences at once, advance the checkpoint to the last sequence in the batch, and only return to per-minute cadence once lag is back to baseline. Compare your checkpoint to the head sequence in the replication root's state file to know exactly how many diffs remain." }
    }
  ]
}
</script>

## Related

- [Applying .osc Change Files with osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/) — the version-ordered merge the loop calls once per cycle.
- [Replication Sequence Numbers and State](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/) — the sequence model and state files the checkpoint is built on.
- [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/) — the incremental delete-and-reinsert pattern behind touched-feature re-indexing.
- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — quarantine discipline for a malformed diff that must not halt the loop.
- [Applying Minutely Diffs to a PostGIS Database](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/applying-minutely-diffs-to-a-postgis-database/) — sinking the apply into a database so the checkpoint shares its transaction.
- [Scheduling OSM Diff Sync with systemd Timers](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/scheduling-osm-diff-sync-with-systemd-timers/) — supervising the loop as a service with no overlapping runs.

This guide is part of the [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/) section — return there for the full picture of how an extract tracks upstream over time.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Building a Minutely Update Pipeline",
  "description": "Engineer a durable, crash-safe minutely OSM update loop: a checkpoint store for the last applied sequence, an idempotent fetch-apply-re-index-advance cycle, lag monitoring, alerting, and back-off on upstream errors.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "OSM Replication & Diff Sync",
  "about": ["OSM minutely replication", "crash-safe update pipeline", "replication lag monitoring"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Replication & Diff Sync", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/" },
    { "@type": "ListItem", "position": 3, "name": "Building a Minutely Update Pipeline", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/" }
  ]
}
</script>
