---
title: "Finding the Replication Sequence for a Timestamp"
description: "Given a wall-clock datetime, resolve the OSM replication sequence number to start applying diffs from — using pyosmium's timestamp_to_sequence and a manual binary-search fallback."
pageTitle: "Find the OSM Replication Sequence for a Timestamp"
pageDescription: "Convert a datetime to the OSM replication sequence to begin diff-sync from, with pyosmium ReplicationServer.timestamp_to_sequence and a binary-search-over-state.txt fallback."
slug: finding-the-replication-sequence-for-a-timestamp
type: article
breadcrumb: "Sequence for a Timestamp"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# Finding the Replication Sequence for a Timestamp

You have a wall-clock datetime — the moment a base extract was cut, or the point you want a catch-up to begin — and you need the replication sequence number to start fetching diffs from, because the replication stream is addressed by integer, not by time.

## Prerequisites

- [ ] `pyosmium` ≥ 3.6 installed (`pip install "osmium>=3.6"`), which ships the `osmium.replication.server.ReplicationServer` client.
- [ ] `requests` ≥ 2.31 available for the manual fallback that fetches `state.txt` files directly.
- [ ] A timezone-aware `datetime` in UTC for the target instant — a naive datetime is the most common source of an off-by-one result.
- [ ] Familiarity with [Replication Sequence Numbers & State Tracking](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/), which defines the sequence-to-path mapping this lookup returns.
- [ ] The replication base URL for your stream (planet minutely, or a regional feed) — see [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/) for which stream matches your extract.
- [ ] Python 3.10+ for the union type hints used below.

## Conceptual minimum

The replication server does not offer a "give me the sequence for this time" endpoint, so the mapping from timestamp to sequence has to be discovered. The reliable method exploits the one invariant that always holds: sequence numbers and their timestamps are jointly monotonic, so the `state.txt` files form a sorted-by-time array indexed by sequence. Finding the sequence whose timestamp is at-or-before your target is therefore a binary search over that array, where each "array read" is an HTTP fetch of one `state.txt`. pyosmium wraps exactly this search in `ReplicationServer.timestamp_to_sequence`, and understanding the underlying probe is what lets you reimplement it when pyosmium is unavailable or you are talking to a non-standard feed.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="bisect-seq-t bisect-seq-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="bisect-seq-t">Binary search over the replication stream to find the sequence for a timestamp</title>
  <desc id="bisect-seq-d">A left-to-right chain. The search starts from the stream head sequence and a known-old lower bound. Each step fetches one state.txt at the midpoint and compares its timestamp against the target, halving the range. About 24 fetches are enough to locate any sequence in a ten-million-wide range. The final step steps back one sequence so the chosen diff is guaranteed to be at or before the target rather than just after it.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="bsq" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Bisect the stream: 24 fetches instead of 43 200</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">bounds</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">lo = known-old seq</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">hi = head from state.txt</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#bsq)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">probe midpoint</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">GET (lo+hi)/2 .state.txt</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">read its timestamp</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#bsq)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">halve</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">target earlier → hi = mid</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">else lo = mid</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#bsq)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">step back one</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">guarantee seq ≤ target</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">never overshoot</text>
  <text x="440" y="158" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Cache the probed state.txt responses. A catch-up script that bisects twice in one run should not fetch the same midpoints twice.</text>
</svg>
<figcaption>Twenty-four HTTP requests to place a timestamp anywhere in a decade of minutely history. The linear alternative — walking back from the head — is 43 200 requests for a single month.</figcaption>
</figure>

The number you want is the sequence whose data is current *at or just before* your target instant, because applying that diff and everything after it brings the data up through your target without ever skipping a change. Picking the sequence *after* the target would leave a gap; that is why the search rounds down. This lookup is the seeding step referenced by the parent guide, [Replication Sequence Numbers & State Tracking](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/) — you run it once to find where a sync should begin, then hand the result to the diff-applying loop.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 300" role="img" aria-label="Binary search over replication state files to find the sequence for a target timestamp. A number line of sequences from a low bound to the current upstream sequence is labelled with increasing timestamps. A target timestamp T falls between two sequences. The search probes the midpoint state.txt, compares its timestamp to T, and discards the half that cannot contain the answer, converging on the greatest sequence whose timestamp is at or before T." style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>Binary search from timestamp to replication sequence</title>
  <desc>Sequences are sorted by timestamp; the search probes a midpoint state.txt, compares its timestamp to the target T, and halves the range until it lands on the greatest sequence at or before T.</desc>
  <defs>
    <marker id="frs-arr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker>
  </defs>
  <rect x="0" y="0" width="900" height="300" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="450" y="26" text-anchor="middle" font-size="14" fill="currentColor" font-weight="700">Sequences are sorted by time — find the last one at or before T</text>
  <!-- number line -->
  <line x1="70" y1="120" x2="830" y2="120" stroke="currentColor" stroke-width="1.5"/>
  <line x1="70" y1="112" x2="70" y2="128" stroke="currentColor" stroke-width="1.5"/>
  <line x1="830" y1="112" x2="830" y2="128" stroke="currentColor" stroke-width="1.5"/>
  <text x="70" y="148" text-anchor="middle" font-size="11" fill="currentColor">low bound</text>
  <text x="70" y="164" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.8">earlier</text>
  <text x="830" y="148" text-anchor="middle" font-size="11" fill="currentColor">current seq</text>
  <text x="830" y="164" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.8">now (root cursor)</text>
  <!-- midpoint probe -->
  <line x1="450" y1="108" x2="450" y2="132" stroke="var(--osm-accent,#0369a1)" stroke-width="2"/>
  <rect x="380" y="60" width="140" height="40" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="450" y="84" text-anchor="middle" font-size="11.5" fill="currentColor">probe mid state.txt</text>
  <line x1="450" y1="100" x2="450" y2="106" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5" marker-end="url(#frs-arr)"/>
  <!-- target T -->
  <line x1="600" y1="108" x2="600" y2="132" stroke="var(--osm-ok,#15803d)" stroke-width="2"/>
  <polygon points="600,96 592,108 608,108" fill="var(--osm-ok,#15803d)"/>
  <text x="600" y="90" text-anchor="middle" font-size="12" fill="currentColor" font-weight="700">target T</text>
  <!-- comparison result -->
  <rect x="240" y="196" width="420" height="72" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="450" y="222" text-anchor="middle" font-size="12" fill="currentColor">if mid.timestamp &lt; T → answer is right of mid</text>
  <text x="450" y="244" text-anchor="middle" font-size="12" fill="currentColor">else → answer is left of mid; halve and repeat</text>
  <text x="450" y="262" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.8">converges on greatest sequence with timestamp ≤ T</text>
</svg>

## Runnable solution

The primary path uses pyosmium; the fallback reimplements the binary search directly against `state.txt` files for environments where pyosmium's client is unavailable or points at a feed it does not recognise.

```python
from __future__ import annotations

import logging
from datetime import datetime, timezone

import osmium.replication.server as rserv

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.replication.seqlookup")

MINUTE_URL = "https://planet.openstreetmap.org/replication/minute"


def sequence_for_timestamp(target: datetime, base_url: str = MINUTE_URL) -> int:
    """Return the sequence whose data is current at or before ``target``.

    ``target`` must be timezone-aware UTC. Applying this sequence and every
    later diff brings a snapshot up through ``target`` with no skipped change.
    """
    if target.tzinfo is None:
        raise ValueError("target datetime must be timezone-aware (UTC)")
    target = target.astimezone(timezone.utc)

    server = rserv.ReplicationServer(base_url)
    try:
        seq = server.timestamp_to_sequence(target)
    finally:
        server.close()

    if seq is None:
        raise LookupError(f"no published sequence at or before {target.isoformat()}")
    logger.info("timestamp %s -> sequence %d", target.isoformat(), seq)
    return seq


if __name__ == "__main__":
    when = datetime(2026, 7, 11, 0, 0, tzinfo=timezone.utc)
    print(sequence_for_timestamp(when))
```

The manual fallback fetches only the `state.txt` files the search actually probes — typically around `log2(range)` requests, roughly two dozen even for a multi-year span:

```python
from __future__ import annotations

import logging
from datetime import datetime, timezone

import requests

logger = logging.getLogger("osm.replication.seqlookup.manual")


def _fragment(seq: int) -> str:
    p = f"{seq:09d}"
    return f"{p[0:3]}/{p[3:6]}/{p[6:9]}"


def _state_timestamp(seq: int, base_url: str) -> datetime:
    url = f"{base_url.rstrip('/')}/{_fragment(seq)}.state.txt"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    for line in resp.text.splitlines():
        if line.startswith("timestamp="):
            raw = line.split("=", 1)[1].strip().replace("\\:", ":")
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    raise ValueError(f"no timestamp field in {url}")


def _current_sequence(base_url: str) -> int:
    resp = requests.get(f"{base_url.rstrip('/')}/state.txt", timeout=30)
    resp.raise_for_status()
    for line in resp.text.splitlines():
        if line.startswith("sequenceNumber="):
            return int(line.split("=", 1)[1].strip())
    raise ValueError("no sequenceNumber in root state.txt")


def sequence_for_timestamp_manual(target: datetime, base_url: str, lo: int = 1) -> int:
    """Binary-search the state.txt array for the greatest sequence <= target."""
    target = target.astimezone(timezone.utc)
    hi = _current_sequence(base_url)
    if _state_timestamp(lo, base_url) > target:
        raise LookupError("target predates the low bound; widen lo or reset base")

    best = lo
    while lo <= hi:
        mid = (lo + hi) // 2
        if _state_timestamp(mid, base_url) <= target:
            best = mid        # mid is a candidate; look for a later one
            lo = mid + 1
        else:
            hi = mid - 1      # mid is too new; discard the upper half
    logger.info("manual search resolved %s -> sequence %d", target.isoformat(), best)
    return best
```

## Step-by-step walkthrough

1. **Require an aware UTC datetime.** `sequence_for_timestamp` rejects a naive datetime outright — comparing naive and aware datetimes raises, and silently assuming local time is how a lookup lands an hour off. `astimezone(timezone.utc)` normalizes any aware input.
2. **Delegate to pyosmium first.** `ReplicationServer(base_url).timestamp_to_sequence(target)` performs the same binary search internally and is the maintained, correct implementation; always close the server to release its HTTP session.
3. **Handle the empty result.** `timestamp_to_sequence` returns `None` when the target is older than anything the feed still publishes; surface that as a clear `LookupError` rather than passing `None` into path arithmetic.
4. **Fall back to explicit probing.** `_current_sequence` reads the root cursor for the upper bound, then the loop halves the range, reading one `state.txt` per iteration through `_state_timestamp`, which unescapes the backslash-colons before parsing.
5. **Round down deliberately.** The `best` variable keeps the greatest sequence whose timestamp is ≤ the target, so the caller applies from `best` forward and never skips a change straddling the boundary.

## Verification

Confirm the resolved sequence is the right one before feeding it to a sync loop:

- **Bracket the answer.** Fetch `best.state.txt` and `(best + 1).state.txt`; the first timestamp must be ≤ your target and the second strictly greater. If both are ≤ target, the search rounded down too far.
- **Cross-check the two methods.** For the same target, `sequence_for_timestamp` and `sequence_for_timestamp_manual` should return the identical integer; a mismatch of one usually means a naive-datetime comparison slipped in.
- **Watch the log line.** The `timestamp … -> sequence` line records exactly what was resolved; keep it so a later audit can reconstruct where a sync was seeded.
- **Count the probes.** The manual search should touch roughly `log2(current - lo)` state files — about 24 for a minutely feed several years deep. Far more requests than that means the range bounds are wrong.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| `TypeError: can't compare offset-naive and offset-aware` | Naive target datetime | Attach `tzinfo=timezone.utc` before calling |
| Result an hour off | Local-time datetime assumed UTC | Convert with `astimezone(timezone.utc)` first |
| `LookupError: no published sequence` | Target predates the feed's retained history | Seed from a fresh base extract instead |
| `ValueError` parsing timestamp | Backslash-escaped colons left in the field | Replace `\:` with `:` before `fromisoformat` |
| Wrong sequence entirely | Regional target against the planet feed | Pass the extract's own `base_url` |
| Hundreds of HTTP requests | `lo`/`hi` bounds wrong, search not converging | Read the root cursor for `hi`; keep `lo` ≥ 1 |

<figure class="diagram-wrap">
<svg viewBox="0 0 880 251" role="img" aria-labelledby="bisect-err-t bisect-err-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="bisect-err-t">Three failure modes of a timestamp-to-sequence search</title>
  <desc id="bisect-err-d">Three panels. Off-by-one: landing on the sequence just after the target means the first applied diff contains edits the caller wanted excluded, fixed by always stepping back one. Timezone drift: state.txt timestamps are UTC with a trailing Z, and comparing them against a naive local datetime shifts the result by the UTC offset, fixed by parsing to an aware UTC datetime. Aged-out range: very old sequences may no longer be published, so the lower bound must be probed rather than assumed, and the search must fail loudly rather than clamp silently.</desc>
  <rect x="0" y="0" width="880" height="251" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three ways the search returns a plausible wrong sequence</text>
  <rect x="26" y="52" width="258" height="157" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Off by one</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Landed on the sequence after T</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">First diff applied includes</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">edits the caller excluded</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Fix: always step back one</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Assert: state(seq).ts ≤ T</text>
  <rect x="310" y="52" width="258" height="157" rx="8" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.5"/>
  <text x="439" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Timezone drift</text>
  <text x="324" y="104" font-size="10.5" fill="currentColor" opacity="0.92">state.txt is UTC, suffixed Z</text>
  <text x="324" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Compared to a naive datetime</text>
  <text x="324" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Result shifts by the UTC offset</text>
  <text x="324" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Fix: parse to aware UTC</text>
  <text x="324" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Assert: tzinfo is not None</text>
  <rect x="594" y="52" width="258" height="157" rx="8" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.5"/>
  <text x="723" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Aged-out lower bound</text>
  <text x="608" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Old sequences may be unpublished</text>
  <text x="608" y="125" font-size="10.5" fill="currentColor" opacity="0.92">A 404 is not "too early"</text>
  <text x="608" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Clamping hides real data loss</text>
  <text x="608" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Fix: probe the bound, fail loudly</text>
  <text x="608" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Assert: lo actually resolves</text>
  <text x="868" y="235" text-anchor="end" font-size="10.5" fill="currentColor" opacity="0.85">All three return a number. None of them raise. Assert the post-condition — the chosen sequence timestamp must be at or before the target — and all three become visible.</text>
</svg>
<figcaption>The timezone one is the quiet killer in a nightly job: it works all year and then produces an hour-shifted answer the week the clocks change.</figcaption>
</figure>

## Specification reference

> The pyosmium replication client exposes `timestamp_to_sequence(timestamp)` on `osmium.replication.server.ReplicationServer`, which locates the sequence covering a given point in time by probing the server's `state.txt` files — see the [pyosmium replication documentation](https://docs.osmcode.org/pyosmium/latest/reference/Replication.html). The `state.txt` format, the `sequenceNumber`/`timestamp` fields, and the minutely/hourly/daily layout are described on the OSM wiki under [Planet.osm/diffs](https://wiki.openstreetmap.org/wiki/Planet.osm/diffs). Timestamp parsing follows the ISO 8601 rules implemented by [`datetime.fromisoformat`](https://docs.python.org/3/library/datetime.html#datetime.datetime.fromisoformat).

## Frequently Asked Questions

<details>
<summary>Should the resolved sequence be applied inclusively or exclusively?</summary>

The function rounds down to the greatest sequence whose timestamp is at or before your target, so that sequence's diff is the first you apply. Applying it and every later diff brings the data up through the target with no gap. If your base snapshot is already current as of that sequence, start from the next one to avoid re-applying it.
</details>

<details>
<summary>Why does pyosmium sometimes return None?</summary>

timestamp_to_sequence returns None when the target instant is older than the earliest state the feed still serves, or newer than the latest published sequence. Treat None as a signal to reseed from a fresh base extract for old targets, or to wait and retry for targets in the immediate future that upstream has not yet published.
</details>

<details>
<summary>How many network requests does the lookup make?</summary>

The search is logarithmic in the number of sequences between the low bound and the current cursor, so it fetches roughly log2 of that range in state.txt files — about two dozen requests even for a feed several years deep. pyosmium's built-in search has the same complexity, so neither method downloads the whole history.
</details>

<details>
<summary>Does this work for regional Geofabrik feeds?</summary>

Yes, as long as you pass that feed's own replication base URL. Regional feeds number their sequences independently of the planet stream, so a sequence resolved against the planet feed is meaningless for a regional extract and vice versa. Match the base URL to the extract's osmosis_replication_base_url header.
</details>

## Related

- [Replication Sequence Numbers & State Tracking](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/) — the sequence-to-path mapping and state.txt format this lookup builds on.
- [Recovering from a Replication Sequence Gap](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/recovering-from-a-replication-sequence-gap/) — what to do once you detect a missed diff.
- [Applying OSC Change Files with Osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/) — consuming the diffs from the sequence you resolve here.
- [Catching Up a Stale OSM Extract with Pyosmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/catching-up-a-stale-osm-extract-with-pyosmium/) — the loop that applies diffs from a start sequence forward.
- [How to Decode OSM PBF Headers in Python](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/how-to-decode-osm-pbf-headers-in-python/) — reading the header timestamp when a sequence anchor is absent.

Up one level: [Replication Sequence Numbers & State Tracking](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Should the resolved sequence be applied inclusively or exclusively?",
      "acceptedAnswer": { "@type": "Answer", "text": "The function rounds down to the greatest sequence whose timestamp is at or before your target, so that sequence's diff is the first you apply. Applying it and every later diff brings the data up through the target with no gap. If your base snapshot is already current as of that sequence, start from the next one to avoid re-applying it." }
    },
    {
      "@type": "Question",
      "name": "Why does pyosmium sometimes return None?",
      "acceptedAnswer": { "@type": "Answer", "text": "timestamp_to_sequence returns None when the target instant is older than the earliest state the feed still serves, or newer than the latest published sequence. Treat None as a signal to reseed from a fresh base extract for old targets, or to wait and retry for targets in the immediate future that upstream has not yet published." }
    },
    {
      "@type": "Question",
      "name": "How many network requests does the lookup make?",
      "acceptedAnswer": { "@type": "Answer", "text": "The search is logarithmic in the number of sequences between the low bound and the current cursor, so it fetches roughly log2 of that range in state.txt files — about two dozen requests even for a feed several years deep. pyosmium's built-in search has the same complexity, so neither method downloads the whole history." }
    },
    {
      "@type": "Question",
      "name": "Does this work for regional Geofabrik feeds?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes, as long as you pass that feed's own replication base URL. Regional feeds number their sequences independently of the planet stream, so a sequence resolved against the planet feed is meaningless for a regional extract and vice versa. Match the base URL to the extract's osmosis_replication_base_url header." }
    }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Finding the Replication Sequence for a Timestamp",
  "description": "Given a wall-clock datetime, resolve the OSM replication sequence number to start applying diffs from — using pyosmium's timestamp_to_sequence and a manual binary-search fallback.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "OSM Replication & Diff Sync",
  "about": ["OSM replication sequence lookup", "timestamp to sequence", "pyosmium ReplicationServer"]
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
    { "@type": "ListItem", "position": 4, "name": "Finding the Replication Sequence for a Timestamp", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/finding-the-replication-sequence-for-a-timestamp/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Find the OSM replication sequence for a timestamp",
  "description": "Resolve the replication sequence to start applying diffs from for a given UTC datetime, using pyosmium or a manual binary search over state.txt files.",
  "step": [
    { "@type": "HowToStep", "name": "Normalize the target to aware UTC", "text": "Reject naive datetimes and convert any aware datetime to UTC so timestamp comparisons are valid." },
    { "@type": "HowToStep", "name": "Call timestamp_to_sequence", "text": "Use pyosmium ReplicationServer.timestamp_to_sequence to binary-search the feed for the covering sequence, then close the server." },
    { "@type": "HowToStep", "name": "Handle an empty result", "text": "Treat a None result as the target predating retained history and reseed from a fresh base extract." },
    { "@type": "HowToStep", "name": "Fall back to manual probing", "text": "Read the root cursor for the upper bound and binary-search state.txt files, unescaping backslash-colons before parsing each timestamp." },
    { "@type": "HowToStep", "name": "Round down and verify", "text": "Keep the greatest sequence with timestamp at or before the target, then bracket it against the next sequence to confirm." }
  ]
}
</script>
