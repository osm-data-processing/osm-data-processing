---
title: "Catching Up a Stale OSM Extract with pyosmium"
description: "Bring a weeks-behind OSM extract current: discover its starting replication sequence, then fetch and apply every intervening .osc.gz in order using pyosmium's ReplicationServer API."
pageTitle: "Catch Up a Stale OSM Extract with pyosmium"
pageDescription: "Use pyosmium's ReplicationServer — timestamp_to_sequence and apply_diffs — to catch a weeks-behind OSM extract up to live, with the pyosmium-get-changes CLI alternative."
slug: catching-up-a-stale-osm-extract-with-pyosmium
type: article
breadcrumb: "Catching Up a Stale Extract"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# Catching Up a Stale OSM Extract with pyosmium

You have an `.osm.pbf` that was current three weeks ago and needs to reach today, and the only trace of where it stands is a timestamp — so you must find the replication sequence that timestamp corresponds to, then fetch and apply every diff from there to the stream head, in order.

## Prerequisites

- [ ] `pyosmium` 3.6+ installed (`pip install "osmium>=3.6"`) — provides `osmium.replication.server.ReplicationServer`.
- [ ] `osmium-tool` 1.11+ on `PATH` for the `apply-changes` fallback and for verification.
- [ ] The stale base extract on disk, and its **completeness timestamp** — the instant up to which it is current. If unknown, read it from the header via [How to Decode OSM PBF Headers in Python](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/how-to-decode-osm-pbf-headers-in-python/).
- [ ] The correct replication base URL for your data (global `https://planet.openstreetmap.org/replication/hour/`, or a Geofabrik region stream) — chosen per [Applying .osc Change Files with osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/).
- [ ] Python 3.10+ for the type hints used below.
- [ ] Outbound HTTPS to the replication server, and disk for the fetched diffs plus the rewritten output.

## Conceptual minimum

A replication stream is an append-only sequence of numbered diffs, and "catching up" is nothing more than replaying the contiguous run of diffs between where your file stands and the stream's current head. The one non-obvious part is *finding the starting point*. Your extract knows a timestamp, but diffs are addressed by integer sequence, so you need a timestamp-to-sequence lookup. pyosmium's `ReplicationServer.timestamp_to_sequence` does exactly that: it binary-searches the stream's `state.txt` files to find the sequence whose completeness time brackets your timestamp. Once you hold that starting sequence, `apply_diffs` streams every subsequent change through libosmium's version-aware merge — the same create/modify/delete semantics detailed in the parent guide, [Applying .osc Change Files with osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/) — and reports the sequence it reached.

The critical choice is *cadence for the catch-up itself*. A three-week gap on the minutely stream is roughly 30,000 tiny files; on the hourly stream it is a few hundred; on the daily stream a few dozen. Use the coarsest stream that still lands you close enough to live, catch up on that, then switch to your steady-state stream for ongoing tracking. This is why the diagram below frames catch-up as a bounded loop over a *sequence gap*, not an open-ended poll.

<svg viewBox="0 0 960 300" role="img" aria-label="Catch-up loop over a replication sequence gap. The stale extract sits at a start sequence derived from its timestamp. A loop fetches the diff at the current sequence, applies it to the working file, and increments the sequence, repeating until it reaches the stream head sequence. When the head is reached the file is current and the loop exits." xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:960px;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>Catch-up loop closing the gap between a stale sequence and the stream head</title>
  <desc>The stale extract's timestamp maps to a start sequence. A loop fetches the diff at the current sequence, applies it, increments, and repeats until the head sequence is reached, at which point the extract is current.</desc>
  <defs>
    <marker id="catchup-arrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker>
  </defs>
  <text x="480" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Replay the contiguous gap, one sequence at a time</text>
  <!-- start -->
  <rect x="24" y="120" width="160" height="66" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="104" y="148" text-anchor="middle" font-size="12.5" font-weight="600" fill="currentColor">Stale extract</text>
  <text x="104" y="167" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.82">timestamp → seq S</text>
  <!-- fetch -->
  <rect x="248" y="120" width="150" height="66" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="323" y="148" text-anchor="middle" font-size="12.5" font-weight="600" fill="currentColor">Fetch diff</text>
  <text x="323" y="167" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.82">seq = current</text>
  <!-- apply -->
  <rect x="462" y="120" width="150" height="66" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="537" y="148" text-anchor="middle" font-size="12.5" font-weight="600" fill="currentColor">Apply + incr</text>
  <text x="537" y="167" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.82">seq += 1</text>
  <!-- head test / done -->
  <rect x="676" y="120" width="160" height="66" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="756" y="148" text-anchor="middle" font-size="12.5" font-weight="600" fill="currentColor">seq == head?</text>
  <text x="756" y="167" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.82">yes → current</text>
  <line x1="184" y1="153" x2="246" y2="153" stroke="currentColor" stroke-width="1.6" marker-end="url(#catchup-arrow)"/>
  <line x1="398" y1="153" x2="460" y2="153" stroke="currentColor" stroke-width="1.6" marker-end="url(#catchup-arrow)"/>
  <line x1="612" y1="153" x2="674" y2="153" stroke="currentColor" stroke-width="1.6" marker-end="url(#catchup-arrow)"/>
  <!-- loop back: no -->
  <path d="M756,186 V246 H323 V188" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 3" marker-end="url(#catchup-arrow)"/>
  <text x="540" y="240" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">no → next sequence</text>
</svg>

## Runnable solution

The script below finds the starting sequence from the extract's timestamp, then drives `apply_diffs` to write a current file. `apply_diffs` handles the fetch-apply loop internally and returns the sequence it stopped at, which you persist for steady-state tracking.

```python
from __future__ import annotations

import datetime as dt
import logging

import osmium
from osmium.replication.server import ReplicationServer

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.catchup")

# Coarse stream for a long gap; switch to minute/ for steady-state after.
REPL_URL = "https://planet.openstreetmap.org/replication/hour/"


def find_start_sequence(server: ReplicationServer, when: dt.datetime) -> int:
    """Resolve the replication sequence current as of a timestamp.

    timestamp_to_sequence binary-searches the stream's state files. Subtract one
    so the first applied diff re-covers the boundary interval rather than skipping
    edits that landed within the extract's last partial window.
    """
    seq = server.timestamp_to_sequence(when)
    if seq is None:
        raise RuntimeError(f"no replication sequence found for {when.isoformat()}")
    start = max(seq - 1, 0)
    logger.info("timestamp %s maps to start sequence %d", when.isoformat(), start)
    return start


def catch_up(base: str, out: str, since: dt.datetime, max_diffs: int = 1000) -> int:
    """Bring a stale extract current and return the sequence reached."""
    server = ReplicationServer(REPL_URL)
    try:
        start = find_start_sequence(server, since)
        writer = osmium.SimpleWriter(out)
        try:
            # apply_diffs fetches and merges every diff from start+1 forward,
            # up to max_diffs, streaming create/modify/delete into the writer.
            reached = server.apply_diffs(
                writer, start, max_size=max_diffs, idx="flex_mem", simplify=True
            )
        finally:
            writer.close()
    finally:
        server.close()

    if reached is None:
        logger.warning("already current; no diffs to apply from sequence %d", start)
        return start
    logger.info("caught up: applied through sequence %d", reached)
    return reached


if __name__ == "__main__":
    # The extract was complete as of this instant (read from its PBF header).
    complete_as_of = dt.datetime(2026, 6, 23, 0, 0, tzinfo=dt.timezone.utc)
    final_seq = catch_up("stale.osm.pbf", "current.osm.pbf", complete_as_of)
    logger.info("record sequence %d as the new steady-state anchor", final_seq)
```

### CLI alternative with pyosmium-get-changes

When you would rather fetch the merged diff separately and apply it with `osmium`, the `pyosmium-get-changes` command downloads the gap into a single `.osc.gz`:

```bash
# Fetch every change since the extract's sequence into one merged diff,
# then apply it to the base with osmium.
pyosmium-get-changes \
  --server https://planet.openstreetmap.org/replication/hour/ \
  --start-date 2026-06-23T00:00:00Z \
  --size 4096 \
  -o catchup.osc.gz

osmium apply-changes stale.osm.pbf catchup.osc.gz \
  --output current.osm.pbf --overwrite
```

## Step-by-step walkthrough

1. **Pick the catch-up stream.** `REPL_URL` targets the hourly stream so a multi-week gap is hundreds of diffs, not tens of thousands; you will re-point at `minute/` only once the file is near-live.
2. **Map timestamp to sequence.** `find_start_sequence` calls `timestamp_to_sequence`, which binary-searches `state.txt` files, then subtracts one so the boundary window is re-covered rather than skipped — replaying a diff is a safe no-op under version semantics.
3. **Drive apply_diffs.** `server.apply_diffs(writer, start, ...)` fetches each diff after `start` and streams its objects through libosmium's merge into the `SimpleWriter`; `simplify=True` collapses multiple versions of the same object within the batch to the latest, which is what a current-state output wants.
4. **Bound the batch.** `max_size` caps how far one call advances, so a very large gap is processed in bounded chunks instead of one unbounded download; call `catch_up` in a loop until `reached` stops advancing to finish a huge gap.
5. **Close in order.** The `SimpleWriter` is closed before the server so the output file is flushed completely, and the server connection is released in the outer `finally`.
6. **Record the anchor.** The returned sequence becomes your steady-state starting point — persist it exactly as [Replication Sequence Numbers and State](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/) describes.

## Verification

- **Sequence advanced.** The final log line reports a sequence far above the start; if `reached` equals `start`, the extract was already current or the timestamp resolved past the head.
- **Header is fresh.** Run `osmium fileinfo -e current.osm.pbf` and confirm the reported `osmosis_replication_timestamp` is within one diff interval of now.
- **Object counts moved.** Compare `osmium fileinfo` node/way/relation counts before and after; a three-week catch-up on an active region changes counts by a visible margin.
- **Re-run is a no-op.** Running `catch_up` again immediately should return the same sequence and add nothing, proving idempotency.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| `timestamp_to_sequence` returns `None` | Timestamp older than the stream's retention | Re-anchor from a fresh base extract instead of catching up |
| Catch-up never finishes | Minutely stream over a multi-week gap | Use the hourly or daily stream for the bulk of the gap |
| Output missing recent edits | Timestamp resolved one window too late | Subtract one from the resolved start sequence |
| `HTTP 404` on a diff | Wrong replication base URL for the region | Point `--server` / `REPL_URL` at the matching stream |
| Memory climbs on a large batch | In-memory location index on a big region | Keep `idx="flex_mem"` bounded via smaller `max_size` chunks |
| Duplicate versions in output | `simplify=False` on a current-state target | Set `simplify=True` to collapse to latest per object |

## Specification reference

> The pyosmium replication client resolves timestamps to sequence numbers and applies change files through libosmium. See the official pyosmium documentation for [`osmium.replication.server.ReplicationServer`](https://docs.osmcode.org/pyosmium/latest/reference/replication.html) covering `timestamp_to_sequence` and `apply_diffs`, and the [OSM Wiki "Planet.osm/diffs"](https://wiki.openstreetmap.org/wiki/Planet.osm/diffs) page for the replication directory layout and `state.txt` format the client reads.

## Frequently Asked Questions

<details>
<summary>How do I find the sequence my stale extract corresponds to?</summary>

Read the extract's completeness timestamp from its PBF header, then call `ReplicationServer.timestamp_to_sequence` with that timestamp. It binary-searches the stream's `state.txt` files and returns the sequence whose completeness time brackets your timestamp. Subtract one from the result so the boundary window is re-applied rather than skipped.
</details>

<details>
<summary>Should I catch up over the minutely stream?</summary>

Not for a large gap. A multi-week gap on the minutely stream is tens of thousands of tiny files. Use the hourly or daily stream to cover the bulk cheaply, then switch to minutely for steady-state tracking once the file is within a day or two of live.
</details>

<details>
<summary>What if the timestamp is older than the stream retains?</summary>

`timestamp_to_sequence` returns `None` because the diffs no longer exist to fetch. You cannot catch up incrementally past the retention window; download a fresh base extract with a recent header sequence and resume steady-state tracking from there.
</details>

<details>
<summary>Is it safe to re-run the catch-up script?</summary>

Yes. Applying diffs is version-aware whole-object replacement, so replaying diffs already merged is a no-op. Re-running from the same start sequence produces identical output and simply reports the same reached sequence, which is why the boundary-window overlap is harmless.
</details>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "How do I find the sequence my stale extract corresponds to?",
      "acceptedAnswer": { "@type": "Answer", "text": "Read the extract's completeness timestamp from its PBF header, then call ReplicationServer.timestamp_to_sequence with that timestamp. It binary-searches the stream's state.txt files and returns the sequence whose completeness time brackets your timestamp. Subtract one from the result so the boundary window is re-applied rather than skipped." }
    },
    {
      "@type": "Question",
      "name": "Should I catch up over the minutely stream?",
      "acceptedAnswer": { "@type": "Answer", "text": "Not for a large gap. A multi-week gap on the minutely stream is tens of thousands of tiny files. Use the hourly or daily stream to cover the bulk cheaply, then switch to minutely for steady-state tracking once the file is within a day or two of live." }
    },
    {
      "@type": "Question",
      "name": "What if the timestamp is older than the stream retains?",
      "acceptedAnswer": { "@type": "Answer", "text": "timestamp_to_sequence returns None because the diffs no longer exist to fetch. You cannot catch up incrementally past the retention window; download a fresh base extract with a recent header sequence and resume steady-state tracking from there." }
    },
    {
      "@type": "Question",
      "name": "Is it safe to re-run the catch-up script?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes. Applying diffs is version-aware whole-object replacement, so replaying diffs already merged is a no-op. Re-running from the same start sequence produces identical output and simply reports the same reached sequence, which is why the boundary-window overlap is harmless." }
    }
  ]
}
</script>

## Related

- [Applying .osc Change Files with osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/) — the create/modify/delete merge semantics this catch-up relies on.
- [Replication Sequence Numbers and State](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/) — recording the anchor sequence the catch-up returns.
- [Applying Minutely Diffs to a PostGIS Database](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/applying-minutely-diffs-to-a-postgis-database/) — the database counterpart to this file-based catch-up.
- [How to Decode OSM PBF Headers in Python](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/how-to-decode-osm-pbf-headers-in-python/) — reading the extract's completeness timestamp.
- [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/) — the wider update-loop context.

Up one level: [Applying .osc Change Files with osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Catching Up a Stale OSM Extract with pyosmium",
  "description": "Bring a weeks-behind OSM extract current: discover its starting replication sequence, then fetch and apply every intervening .osc.gz in order using pyosmium's ReplicationServer API.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "OSM Replication & Diff Sync",
  "about": ["pyosmium replication", "OSM extract catch-up", "timestamp to sequence"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Replication & Diff Sync", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/" },
    { "@type": "ListItem", "position": 3, "name": "Applying .osc Change Files with osmium", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/" },
    { "@type": "ListItem", "position": 4, "name": "Catching Up a Stale OSM Extract with pyosmium", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/catching-up-a-stale-osm-extract-with-pyosmium/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Catch up a stale OSM extract with pyosmium",
  "description": "Resolve a stale extract's starting replication sequence from its timestamp and apply every intervening diff with pyosmium to bring it current.",
  "step": [
    { "@type": "HowToStep", "name": "Read the extract timestamp", "text": "Read the completeness timestamp from the stale extract's PBF header so you know how far behind it is." },
    { "@type": "HowToStep", "name": "Pick a catch-up stream", "text": "Choose the hourly or daily replication stream so a multi-week gap is hundreds of diffs rather than tens of thousands." },
    { "@type": "HowToStep", "name": "Map timestamp to sequence", "text": "Call ReplicationServer.timestamp_to_sequence and subtract one so the boundary window is re-covered rather than skipped." },
    { "@type": "HowToStep", "name": "Apply the diff span", "text": "Drive apply_diffs from the start sequence into a SimpleWriter, bounding each call with max_size and looping until the sequence stops advancing." },
    { "@type": "HowToStep", "name": "Record the anchor", "text": "Persist the returned sequence as the steady-state starting point and verify freshness with osmium fileinfo." }
  ]
}
</script>
