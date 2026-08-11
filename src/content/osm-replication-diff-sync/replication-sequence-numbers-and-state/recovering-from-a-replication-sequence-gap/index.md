---
title: "Recovering from a Replication Sequence Gap"
description: "Detect that an OSM diff was missed or applied out of order by comparing the local checkpoint against upstream state, then replay the missing sequence range in order or reset from a fresh base."
pageTitle: "Recover from an OSM Replication Sequence Gap"
pageDescription: "Detect a skipped or out-of-order OSM replication diff from a local-vs-upstream sequence mismatch and recover by replaying the missing range in order or reseeding from a base extract."
slug: recovering-from-a-replication-sequence-gap
type: article
breadcrumb: "Recovering from a Gap"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# Recovering from a Replication Sequence Gap

A diff-sync process reports a local applied sequence that is more than one step behind the upstream cursor, or a diff was applied out of order — and you need to tell whether a change file was skipped and, if so, replay the missing range safely without corrupting the object-version history.

## Prerequisites

- [ ] `pyosmium` ≥ 3.6 installed (`pip install "osmium>=3.6"`) for fetching and applying `.osc.gz` diffs.
- [ ] `requests` ≥ 2.31 for reading the upstream root cursor and per-sequence `state.txt` files.
- [ ] A durable checkpoint recording the last *fully applied* sequence — the atomic checkpoint from [Replication Sequence Numbers & State Tracking](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/).
- [ ] Access to the base extract or a way to re-download one, for the reset-from-scratch branch.
- [ ] The correct replication base URL for your stream, per [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/).
- [ ] Python 3.10+ for the `match` statement and union hints used below.

## Conceptual minimum

Replication offers no notification that a step was missed. The protocol guarantees only that if you apply every sequence in ascending order exactly once, your data converges to upstream; violate that — skip `455`, or apply `456` before `455` — and the local database silently diverges, because OSM diffs are not commutative. Each `.osc.gz` encodes creates, modifications, and deletes keyed to specific object versions, so applying them out of order can, for example, try to modify an object a later diff already deleted, or resurrect one an earlier diff removed. The only detector is your own bookkeeping: the gap is the difference between the last sequence you recorded as applied and the sequence upstream reports as current.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 238" role="img" aria-labelledby="gap-kinds-t gap-kinds-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="gap-kinds-t">Three kinds of sequence gap and the recovery each one needs</title>
  <desc id="gap-kinds-d">A grid of three gap causes against the correct recovery. A contiguous gap from downtime, where every missing diff is still published, is recovered by replaying the range in ascending order. A gap where part of the range has aged out of the stream is recovered by resetting from a fresh base extract, because the missing edits cannot be reconstructed. A checkpoint that is ahead of the data, from writing state before applying, cannot be recovered by replay at all and needs a rebuild, because the pipeline does not know which diffs were really applied.</desc>
  <rect x="0" y="0" width="880" height="238" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Not every gap is recoverable by replaying diffs</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">can you replay?</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">correct recovery</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">downtime, range still published</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">yes</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">replay ascending, one at a time</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">part of the range aged out</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">no</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">fresh base extract, re-anchor</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">checkpoint ahead of the data</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">no — extent unknown</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">rebuild from a known-good base</text>
  <text x="440" y="220" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Detecting the third case at all requires an independent check — object counts against upstream, or a spot-check against the live API.</text>
</svg>
<figcaption>The third case is the reason checkpoint ordering matters so much. A gap you can see is a delay; a checkpoint that lies about the past is a rebuild.</figcaption>
</figure>

Recovery has two shapes. When the missing range is small and still published, the fix is to replay every sequence from `checkpoint + 1` up to the upstream cursor, strictly in order — this is a normal catch-up, just triggered by gap detection rather than a schedule. When the local state is already inconsistent (a diff was applied out of order, or the missing range has aged out of the feed's retained history), no replay can repair it, and the correct move is to reset from a fresh base extract whose PBF header carries a known-good replication anchor, discarding the diverged state entirely. Distinguishing the two is what this page is about; the actual application of diffs is covered in [applying OSC change files with osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/), and the numbering it relies on comes from the parent guide, [Replication Sequence Numbers & State Tracking](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/).

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 340" role="img" aria-label="Decision flow for recovering from a replication sequence gap. The local checkpoint sequence is compared against the upstream cursor. If they are equal the pipeline is in sync. If the local sequence is exactly one behind, apply the next diff normally. If it is several behind but the missing range is still published, replay the range in ascending order. If the local state is inconsistent or the missing range has aged out of history, reset from a fresh base extract." style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>Sequence gap recovery decision flow</title>
  <desc>Compare local checkpoint to upstream cursor: equal means in sync; one behind means apply next; several behind and still published means replay the range in order; inconsistent or aged out means reset from a fresh base.</desc>
  <defs>
    <marker id="rsg-arr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker>
  </defs>
  <rect x="0" y="0" width="920" height="340" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="460" y="26" text-anchor="middle" font-size="14" fill="currentColor" font-weight="700">local checkpoint vs upstream cursor decides the recovery path</text>
  <!-- top compare box -->
  <rect x="330" y="46" width="260" height="52" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="460" y="68" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="600">gap = upstream − local</text>
  <text x="460" y="86" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">read both, compare</text>
  <!-- branch lines -->
  <line x1="460" y1="98" x2="460" y2="120" stroke="currentColor" stroke-width="1.5"/>
  <line x1="120" y1="120" x2="800" y2="120" stroke="currentColor" stroke-width="1.5"/>
  <line x1="120" y1="120" x2="120" y2="150" stroke="currentColor" stroke-width="1.5" marker-end="url(#rsg-arr)"/>
  <line x1="347" y1="120" x2="347" y2="150" stroke="currentColor" stroke-width="1.5" marker-end="url(#rsg-arr)"/>
  <line x1="573" y1="120" x2="573" y2="150" stroke="currentColor" stroke-width="1.5" marker-end="url(#rsg-arr)"/>
  <line x1="800" y1="120" x2="800" y2="150" stroke="currentColor" stroke-width="1.5" marker-end="url(#rsg-arr)"/>
  <!-- 4 outcome boxes -->
  <rect x="40" y="152" width="160" height="92" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="120" y="176" text-anchor="middle" font-size="12" fill="currentColor" font-weight="700">gap = 0</text>
  <text x="120" y="200" text-anchor="middle" font-size="11.5" fill="currentColor">in sync</text>
  <text x="120" y="220" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.8">nothing to do</text>
  <rect x="267" y="152" width="160" height="92" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="347" y="176" text-anchor="middle" font-size="12" fill="currentColor" font-weight="700">gap = 1</text>
  <text x="347" y="200" text-anchor="middle" font-size="11.5" fill="currentColor">apply next diff</text>
  <text x="347" y="220" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.8">normal step</text>
  <rect x="493" y="152" width="160" height="92" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="573" y="176" text-anchor="middle" font-size="12" fill="currentColor" font-weight="700">gap &gt; 1, published</text>
  <text x="573" y="200" text-anchor="middle" font-size="11.5" fill="currentColor">replay range</text>
  <text x="573" y="220" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.8">ascending order</text>
  <rect x="720" y="152" width="160" height="92" rx="8" fill="none" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="800" y="172" text-anchor="middle" font-size="12" fill="currentColor" font-weight="700">inconsistent</text>
  <text x="800" y="190" text-anchor="middle" font-size="11.5" fill="currentColor">or aged out</text>
  <text x="800" y="212" text-anchor="middle" font-size="11.5" fill="currentColor">reset from base</text>
  <text x="800" y="230" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.8">discard state</text>
  <text x="460" y="300" text-anchor="middle" font-size="11.5" fill="currentColor" opacity="0.9">Replay only closes a gap of still-published diffs; a diverged state must be reseeded.</text>
</svg>

## Runnable solution

The module reads both positions, classifies the gap, and either replays the missing range in order or signals that a reset is required. It never applies a diff without advancing the checkpoint immediately after, so a crash mid-replay resumes correctly.

```python
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone

import requests
import osmium.replication.server as rserv

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.replication.gap")

MINUTE_URL = "https://planet.openstreetmap.org/replication/minute"


@dataclass(frozen=True)
class GapReport:
    local: int
    upstream: int
    oldest_available: int

    @property
    def gap(self) -> int:
        return self.upstream - self.local

    @property
    def action(self) -> str:
        if self.gap < 0:
            return "reset"          # local ahead of upstream = corrupt checkpoint
        if self.gap == 0:
            return "in_sync"
        if self.local + 1 < self.oldest_available:
            return "reset"          # missing range has aged out of the feed
        return "replay"


def _root_sequence(base_url: str) -> int:
    resp = requests.get(f"{base_url.rstrip('/')}/state.txt", timeout=30)
    resp.raise_for_status()
    for line in resp.text.splitlines():
        if line.startswith("sequenceNumber="):
            return int(line.split("=", 1)[1].strip())
    raise ValueError("no sequenceNumber in root state.txt")


def diagnose_gap(local_seq: int, base_url: str, oldest_available: int) -> GapReport:
    """Compare the local checkpoint against upstream and classify the gap."""
    upstream = _root_sequence(base_url)
    report = GapReport(local=local_seq, upstream=upstream, oldest_available=oldest_available)
    logger.info(
        "local=%d upstream=%d gap=%d -> action=%s",
        report.local, report.upstream, report.gap, report.action,
    )
    return report


def replay_range(report: GapReport, base_url: str, apply_one, save_checkpoint) -> int:
    """Apply every missing sequence in ascending order, checkpointing each step.

    ``apply_one(seq)`` fetches and applies one diff to the target store.
    ``save_checkpoint(seq)`` durably records the last applied sequence.
    Returns the final applied sequence.
    """
    if report.action != "replay":
        raise RuntimeError(f"replay refused: action is {report.action!r}, not 'replay'")

    current = report.local
    for seq in range(report.local + 1, report.upstream + 1):
        apply_one(seq)             # MUST apply strictly in this ascending order
        save_checkpoint(seq)       # advance only after a successful apply
        current = seq
        logger.info("replayed sequence %d (%d remaining)", seq, report.upstream - seq)
    return current
```

## Step-by-step walkthrough

1. **Read the local checkpoint.** The last fully-applied sequence comes from the durable checkpoint written by the sync loop; treat a missing checkpoint as "reset required," not as sequence zero.
2. **Read the upstream cursor.** `_root_sequence` fetches the cadence's root `state.txt` — a single request — to learn how far upstream has advanced.
3. **Classify with `GapReport.action`.** A gap of zero is in-sync; a positive gap whose missing range is still published is `replay`; a negative gap (local ahead of upstream) means the checkpoint is corrupt; and a missing range older than the feed's retained history is `reset`.
4. **Refuse to replay a diverged state.** `replay_range` raises unless the action is exactly `replay`, so an out-of-order or aged-out situation can never be papered over by re-running diffs that will not repair it.
5. **Apply strictly ascending, checkpoint per step.** The loop applies `local + 1` through `upstream` in order and advances the checkpoint after each successful apply, so a crash resumes at the next unapplied sequence rather than restarting the range.
6. **Return the final sequence.** The caller compares the returned value against the upstream cursor to confirm the gap is closed.

## Verification

- **Recompute the gap after replay.** Call `diagnose_gap` again; `action` should read `in_sync` (or `apply next` if upstream advanced during the replay) and the gap should be zero or one.
- **Spot-check a boundary object.** Pick an object edited inside the replayed range and confirm its local version matches the value in the last replayed diff — proof the range applied in order.
- **Confirm monotonic checkpoints.** The checkpoint's sequence must only ever increase; a log showing it decrement means an out-of-order apply and mandates a reset.
- **Reject the reset path silently succeeding.** If `action` is `reset`, replay must raise rather than log success — verify the `RuntimeError` fires so a diverged database is never reported as recovered.
- **Watch the countdown log.** The `remaining` counter in each replay line should decrease by one every step; a stall or jump signals a fetch failure mid-range.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="gap-verify-t gap-verify-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="gap-verify-t">Proving a gap recovery actually closed the hole</title>
  <desc id="gap-verify-d">A left-to-right chain of four checks after a recovery. The checkpoint must equal the stream head. Replaying the recovered range a second time must be a no-op, proving idempotence. A spot-check of objects known to have been edited during the gap window must match the live API. And ongoing lag must settle back to its normal band rather than plateauing, which would mean the loop is still behind.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="gvf" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four checks — the replay-twice test is the one that proves the applier</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">checkpoint = head</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">the arithmetic closes</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">necessary, not sufficient</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#gvf)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">replay the range again</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">must change nothing</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">proves idempotence</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#gvf)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">spot-check the window</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">objects edited during the gap</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">match the live API</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#gvf)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">watch the lag settle</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">back to its normal band</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">a plateau means still behind</text>
  <text x="440" y="158" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Record the recovered range in the run log. The next person to see a count discrepancy will want to know which window was replayed and when.</text>
</svg>
<figcaption>The second check is the one worth automating: if replaying the same range twice changes anything, the applier is not version-safe and the recovery cannot be trusted.</figcaption>
</figure>

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| `replay refused: action is 'reset'` | Missing range aged out of the feed | Reseed from a fresh base extract's PBF anchor |
| Gap is negative | Corrupt or stale checkpoint ahead of upstream | Reset; never trust a local sequence past the cursor |
| Modify targets a deleted object | Diffs applied out of ascending order | Enforce ascending `range`; reset the diverged state |
| Replay re-applies from the start after crash | Checkpoint advanced before the apply committed | Save the checkpoint only after `apply_one` succeeds |
| 404 mid-replay | Requested a sequence above the cursor | Cap the range at the upstream root sequence |
| Wrong objects entirely | Regional checkpoint against the planet feed | Match `base_url` to the extract's own feed |

## Specification reference

> Applying OsmChange diffs out of sequence corrupts state because each diff references specific object versions; the replication model requires strictly ordered, once-only application, as documented on the OSM wiki under [Planet.osm/diffs](https://wiki.openstreetmap.org/wiki/Planet.osm/diffs) and in the [OsmChange format](https://wiki.openstreetmap.org/wiki/OsmChange) specification. The pyosmium replication client used to fetch and apply ranges is described in the [pyosmium replication reference](https://docs.osmcode.org/pyosmium/latest/reference/Replication.html).

## Frequently Asked Questions

<details>
<summary>How do I know a diff was actually missed rather than just pending?</summary>

Compare your last fully-applied sequence to the upstream root cursor. A gap of one is normal — upstream simply published a new step you have not applied yet. A gap larger than one means intervening sequences exist that you never applied, which is a genuine miss you must replay. The distinction is purely the size of the difference.
</details>

<details>
<summary>When must I reset from a base extract instead of replaying?</summary>

Reset when the state is already inconsistent or unrecoverable: a diff was applied out of order, the local sequence is somehow ahead of upstream, or the missing range has aged out of the feed's retained history so the diffs are no longer downloadable. In all three cases replaying cannot repair the divergence, so you discard the local state and reseed from a fresh snapshot.
</details>

<details>
<summary>Why must diffs be applied in strictly ascending order?</summary>

OSM diffs are not commutative. Each change file encodes creates, modifications, and deletes tied to specific object versions, so applying a later diff before an earlier one can try to modify an object that a subsequent diff already deleted, or resurrect one an earlier diff removed. Only strict ascending, once-only application converges the local data to upstream.
</details>

<details>
<summary>How do I make replay crash-safe?</summary>

Advance the durable checkpoint only after each diff has been successfully applied and committed to the target store. Then a crash mid-replay resumes at the next unapplied sequence rather than re-running the whole range or skipping a step. Never write the checkpoint before the apply commits, or a torn run leaves an ambiguous position.
</details>

## Related

- [Replication Sequence Numbers & State Tracking](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/) — the checkpoint and state.txt semantics gap detection depends on.
- [Finding the Replication Sequence for a Timestamp](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/finding-the-replication-sequence-for-a-timestamp/) — resolving a start sequence when reseeding from a base extract.
- [Applying OSC Change Files with Osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/) — the mechanics of applying the diffs a replay fetches.
- [Catching Up a Stale OSM Extract with Pyosmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/catching-up-a-stale-osm-extract-with-pyosmium/) — the ordered catch-up loop replay reuses.
- [How to Decode OSM PBF Headers in Python](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/how-to-decode-osm-pbf-headers-in-python/) — reading the replication anchor from a fresh base extract during a reset.

Up one level: [Replication Sequence Numbers & State Tracking](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "How do I know a diff was actually missed rather than just pending?",
      "acceptedAnswer": { "@type": "Answer", "text": "Compare your last fully-applied sequence to the upstream root cursor. A gap of one is normal — upstream simply published a new step you have not applied yet. A gap larger than one means intervening sequences exist that you never applied, which is a genuine miss you must replay. The distinction is purely the size of the difference." }
    },
    {
      "@type": "Question",
      "name": "When must I reset from a base extract instead of replaying?",
      "acceptedAnswer": { "@type": "Answer", "text": "Reset when the state is already inconsistent or unrecoverable: a diff was applied out of order, the local sequence is somehow ahead of upstream, or the missing range has aged out of the feed's retained history so the diffs are no longer downloadable. In all three cases replaying cannot repair the divergence, so you discard the local state and reseed from a fresh snapshot." }
    },
    {
      "@type": "Question",
      "name": "Why must diffs be applied in strictly ascending order?",
      "acceptedAnswer": { "@type": "Answer", "text": "OSM diffs are not commutative. Each change file encodes creates, modifications, and deletes tied to specific object versions, so applying a later diff before an earlier one can try to modify an object that a subsequent diff already deleted, or resurrect one an earlier diff removed. Only strict ascending, once-only application converges the local data to upstream." }
    },
    {
      "@type": "Question",
      "name": "How do I make replay crash-safe?",
      "acceptedAnswer": { "@type": "Answer", "text": "Advance the durable checkpoint only after each diff has been successfully applied and committed to the target store. Then a crash mid-replay resumes at the next unapplied sequence rather than re-running the whole range or skipping a step. Never write the checkpoint before the apply commits, or a torn run leaves an ambiguous position." }
    }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Recovering from a Replication Sequence Gap",
  "description": "Detect that an OSM diff was missed or applied out of order by comparing the local checkpoint against upstream state, then replay the missing sequence range in order or reset from a fresh base.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "OSM Replication & Diff Sync",
  "about": ["OSM replication gap recovery", "missed diff detection", "ordered diff replay"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Replication & Diff Sync", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/" },
    { "@type": "ListItem", "position": 3, "name": "Replication Sequence Numbers & State Tracking", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/" },
    { "@type": "ListItem", "position": 4, "name": "Recovering from a Replication Sequence Gap", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/recovering-from-a-replication-sequence-gap/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Recover from an OSM replication sequence gap",
  "description": "Detect a missed or out-of-order diff from a local-vs-upstream sequence mismatch and recover by replaying the missing range in order or resetting from a fresh base.",
  "step": [
    { "@type": "HowToStep", "name": "Read both positions", "text": "Load the last fully-applied local checkpoint and fetch the upstream root cursor sequence." },
    { "@type": "HowToStep", "name": "Classify the gap", "text": "A gap of zero is in sync, one is a normal step, a larger still-published gap is a replay, and a negative or aged-out gap requires a reset." },
    { "@type": "HowToStep", "name": "Refuse to replay a diverged state", "text": "Raise rather than replay when the action is reset, so an inconsistent database is never papered over." },
    { "@type": "HowToStep", "name": "Replay ascending and checkpoint per step", "text": "Apply each missing sequence from local+1 to upstream in order, advancing the checkpoint only after each successful apply." },
    { "@type": "HowToStep", "name": "Verify the gap closed", "text": "Recompute the gap; it should read in sync, and boundary objects should match the last replayed diff." }
  ]
}
</script>
