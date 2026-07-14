---
title: "Replication Sequence Numbers & State Tracking"
description: "How OSM replication sequence numbers map to state.txt files and directory paths, how PBF headers carry a replication anchor, and how to checkpoint a diff-sync pipeline robustly in Python."
pageTitle: "OSM Replication Sequence Numbers & state.txt Tracking"
pageDescription: "Decode the OSM state.txt format, map a replication sequence number to its 3/3/3 directory path, read the PBF replication header, and checkpoint diff-sync safely in Python."
slug: replication-sequence-numbers-and-state
type: guide
breadcrumb: "Sequence Numbers & State"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# Replication Sequence Numbers & State Tracking

Every OpenStreetMap diff-sync pipeline lives or dies by a single integer. The replication sequence number is the monotonic counter that names each published change file, and the moment a pipeline loses track of which number it has already applied, correctness collapses in one of two silent ways: it re-applies a diff it already consumed (double-counting edits, resurrecting deleted objects) or it skips one entirely (leaving a permanent hole in the local database that no later diff will ever fill). Neither failure raises an exception — the pipeline keeps running, the row counts keep climbing, and the divergence from upstream only surfaces weeks later when a routing graph has a road that was deleted in reality or a building that upstream never had. This guide is the bookkeeping layer of the [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/) section: it defines exactly what a sequence number is, where the `state.txt` that carries it lives, how the number encodes a directory path, and how to persist your applied position so a crashed process resumes on the correct diff rather than guessing.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1040 380" role="img" aria-label="How an OSM replication sequence number maps to a directory path and a state.txt file. The integer 6123456 is left-padded to nine digits 006123456, split into three groups of three digits 006, 123 and 456, and joined with slashes to form the path 006/123/456. Appending that under the replication base URL and minute interval yields the object URLs ending in 456.state.txt and 456.osc.gz. The state.txt file itself contains a sequenceNumber field equal to 6123456 and a timestamp field in ISO 8601 UTC." style="width:100%;max-width:1040px;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>Sequence number to replication path and state.txt fields</title>
  <desc>The sequence 6123456 is zero-padded to 006123456, split 006/123/456, and appended to the base URL to locate 456.state.txt and 456.osc.gz; the state.txt holds sequenceNumber and timestamp fields.</desc>
  <defs>
    <marker id="rsn-arr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker>
  </defs>
  <text x="520" y="26" text-anchor="middle" font-size="15" fill="currentColor" font-weight="700">One integer names one change file — the path is derived, not stored</text>
  <!-- sequence integer -->
  <rect x="40" y="52" width="220" height="60" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="150" y="78" text-anchor="middle" font-size="12.5" fill="currentColor" opacity="0.85">sequenceNumber</text>
  <text x="150" y="98" text-anchor="middle" font-size="16" fill="currentColor" font-weight="700">6123456</text>
  <!-- pad -->
  <line x1="260" y1="82" x2="318" y2="82" stroke="currentColor" stroke-width="1.5" marker-end="url(#rsn-arr)"/>
  <text x="289" y="74" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">pad 9</text>
  <rect x="320" y="52" width="200" height="60" rx="8" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="420" y="78" text-anchor="middle" font-size="12.5" fill="currentColor" opacity="0.85">left-zero-padded</text>
  <text x="420" y="98" text-anchor="middle" font-size="16" fill="currentColor" font-weight="700">006123456</text>
  <!-- split -->
  <line x1="520" y1="82" x2="578" y2="82" stroke="currentColor" stroke-width="1.5" marker-end="url(#rsn-arr)"/>
  <text x="549" y="74" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">3/3/3</text>
  <rect x="580" y="52" width="200" height="60" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="680" y="78" text-anchor="middle" font-size="12.5" fill="currentColor" opacity="0.85">path fragment</text>
  <text x="680" y="98" text-anchor="middle" font-size="16" fill="currentColor" font-weight="700">006/123/456</text>
  <!-- base url join -->
  <line x1="680" y1="112" x2="680" y2="150" stroke="currentColor" stroke-width="1.5" marker-end="url(#rsn-arr)"/>
  <text x="740" y="136" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">under base URL</text>
  <rect x="300" y="152" width="740" height="46" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="670" y="180" text-anchor="middle" font-size="12.5" fill="currentColor">…/replication/minute/006/123/456.state.txt  ·  456.osc.gz</text>
  <!-- state.txt fields -->
  <line x1="480" y1="198" x2="480" y2="234" stroke="currentColor" stroke-width="1.5" marker-end="url(#rsn-arr)"/>
  <text x="540" y="220" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">read state.txt</text>
  <rect x="300" y="236" width="440" height="120" rx="8" fill="none" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <rect x="300" y="236" width="440" height="30" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="520" y="256" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="700">456.state.txt (Java properties)</text>
  <text x="320" y="292" text-anchor="start" font-size="12.5" fill="currentColor" font-family="monospace">sequenceNumber=6123456</text>
  <text x="320" y="316" text-anchor="start" font-size="12.5" fill="currentColor" font-family="monospace">timestamp=2026-07-11T00\:00\:00Z</text>
  <text x="320" y="340" text-anchor="start" font-size="11" fill="currentColor" opacity="0.8">colons are backslash-escaped in the file</text>
  <!-- PBF anchor side box -->
  <rect x="40" y="152" width="230" height="204" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 3"/>
  <text x="155" y="176" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="700">PBF header anchor</text>
  <text x="56" y="206" text-anchor="start" font-size="10.5" fill="currentColor" opacity="0.9">osmosis_replication_</text>
  <text x="66" y="222" text-anchor="start" font-size="10.5" fill="currentColor" opacity="0.9">sequence_number</text>
  <text x="56" y="248" text-anchor="start" font-size="10.5" fill="currentColor" opacity="0.9">osmosis_replication_</text>
  <text x="66" y="264" text-anchor="start" font-size="10.5" fill="currentColor" opacity="0.9">timestamp</text>
  <text x="56" y="290" text-anchor="start" font-size="10.5" fill="currentColor" opacity="0.9">osmosis_replication_</text>
  <text x="66" y="306" text-anchor="start" font-size="10.5" fill="currentColor" opacity="0.9">base_url</text>
  <text x="155" y="336" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.8">tells you where to resume</text>
</svg>

## Prerequisites: What You Need in Place

This reference assumes the surrounding machinery of a diff-sync loop is already understood. The change files that sequence numbers name are the `.osc.gz` payloads consumed in [applying OSC change files with osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/); this page only concerns the numbering and state that decide *which* of those files to fetch and in what order. You will also want the header-reading skills from [how to decode OSM PBF headers in Python](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/how-to-decode-osm-pbf-headers-in-python/), because the replication anchor that seeds a fresh sync lives in the PBF header block rather than in any sidecar file. Finally, a working knowledge of the broader [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/) layer helps place sequence tracking in the context of a full incremental-update pipeline. Everything below is Python 3.10+ with the standard `logging` pattern.

## The `state.txt` Format

Each replication interval publishes two files per step: the compressed diff (`NNN.osc.gz`) and a plain-text state file (`NNN.state.txt`) that records what that diff represents. The state file is a Java `.properties` document — the format Osmosis and the replication tooling emit — and it carries exactly two fields that matter to a sync loop, plus a comment line holding the file's own generation time.

```text
#Sat Jul 11 00:00:02 UTC 2026
sequenceNumber=6123456
timestamp=2026-07-11T00\:00\:00Z
```

Two encoding details bite the unwary. First, the `timestamp` is an ISO 8601 instant in UTC, but because the file follows Java properties escaping, the colons in the time portion are prefixed with backslashes (`00\:00\:00`). A naive line-split-on-`=` parser leaves those backslashes in place and every downstream `datetime.fromisoformat` call then raises. Second, the leading `#` line is a human-readable comment describing when the *file* was written, which is a second or two after the `timestamp` value it documents — never parse the comment as authoritative; the `timestamp=` field is the semantic instant the diff brings the data up to.

The `timestamp` field answers "what wall-clock moment is this data current as of," and the `sequenceNumber` answers "what is the ordinal name of this step." The two are strictly monotonic together: a higher sequence number always corresponds to a later or equal timestamp. That monotonicity is the invariant every gap check and checkpoint relies on.

## The Replication Directory Layout

OSM publishes diffs at three cadences under `planet.openstreetmap.org/replication/` — `minute/`, `hour/`, and `day/` — and each cadence has its own independent sequence counter. Within a cadence, the sequence number is not used as a flat filename; it is exploded into a three-level directory tree so that no single directory ever holds millions of entries. The rule is fixed: left-pad the integer to nine digits, then cut it into three groups of three.

A sequence like `6123456` becomes the padded string `006123456`, which splits into `006`, `123`, `456`, giving the path `006/123/456`. Under the minutely stream that resolves to two URLs:

```text
https://planet.openstreetmap.org/replication/minute/006/123/456.state.txt
https://planet.openstreetmap.org/replication/minute/006/123/456.osc.gz
```

There is also a single top-level `state.txt` at the root of each cadence directory (`…/minute/state.txt`) that always reflects the newest published sequence — that is the file you poll to discover how far upstream has advanced. The per-sequence state files are the historical record; the top-level one is the live cursor.

| Field | Value / rule | Why it matters |
|---|---|---|
| Cadence directories | `minute/`, `hour/`, `day/` | Each has an independent counter; never mix them |
| Padding width | 9 digits, left zero-fill | Sequences below 100000000 need leading zeros to split cleanly |
| Split pattern | 3 / 3 / 3 → `AAA/BBB/CCC` | The last group is the file stem; the first two are directories |
| Per-step files | `CCC.state.txt`, `CCC.osc.gz` | State sidecar plus gzip-compressed OsmChange payload |
| Root cursor | `<cadence>/state.txt` | Live pointer to the newest sequence upstream has published |
| `sequenceNumber` | non-negative monotonic integer | Strictly increasing; the ordinal name of the diff |
| `timestamp` | ISO 8601 UTC, `\:`-escaped | The instant the data is current as of after applying this diff |

## The PBF Replication Anchor

A freshly downloaded extract — a Geofabrik regional `.osm.pbf` or a planet dump — is a snapshot, not a stream, so it needs to tell a sync loop where in the replication timeline it sits. It does this through three optional key-value entries in the PBF `HeaderBlock`, written by whatever tool cut the extract:

- `osmosis_replication_sequence_number` — the sequence the snapshot was current as of. Start applying diffs from the *next* sequence.
- `osmosis_replication_timestamp` — the ISO 8601 instant matching that sequence, the same semantics as the `timestamp` field in `state.txt`.
- `osmosis_replication_base_url` — the replication stream this snapshot descends from, e.g. `https://download.geofabrik.de/europe/monaco-updates` or the planet minutely URL. This tells you *which* stream's counter the sequence number refers to, which matters because a Geofabrik regional extract has its own per-region replication feed with its own numbering, distinct from the planet feed.

Reading these three values is the correct way to seed a pipeline from a base extract; the mechanics of pulling them out of the header live in [decoding OSM PBF headers in Python](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/how-to-decode-osm-pbf-headers-in-python/). If a header is missing the sequence anchor entirely — some third-party extracts strip it — you fall back to deriving a starting sequence from the header timestamp, which is exactly the lookup covered in [finding the replication sequence for a timestamp](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/finding-the-replication-sequence-for-a-timestamp/).

## Step-by-Step: Computing the URL Path in Python

The path derivation is pure arithmetic on the integer, so it is worth having a single tested function rather than string-formatting URLs inline. The steps:

1. **Validate the sequence.** Reject negatives and non-integers before formatting; a malformed sequence produces a URL that 404s and the failure is easier to read at the source.
2. **Zero-pad to nine digits.** `f"{seq:09d}"` guarantees the three-group split is always well-formed even for small sequences.
3. **Slice into thirds.** Characters 0–3, 3–6, 6–9 become the two directory levels and the file stem.
4. **Join under the cadence base URL.** Append `.state.txt` or `.osc.gz` to the stem.

```python
import logging
from urllib.parse import urljoin

logger = logging.getLogger("osm.replication.paths")

MINUTE_BASE = "https://planet.openstreetmap.org/replication/minute/"


def sequence_to_fragment(seq: int) -> str:
    """Map a replication sequence number to its 3/3/3 path fragment.

    6123456 -> '006/123/456'. Raises ValueError on invalid input so a bad
    sequence fails at the source rather than as an opaque 404 later.
    """
    if not isinstance(seq, int) or seq < 0:
        raise ValueError(f"sequence must be a non-negative int, got {seq!r}")
    padded = f"{seq:09d}"
    return f"{padded[0:3]}/{padded[3:6]}/{padded[6:9]}"


def sequence_urls(seq: int, base_url: str = MINUTE_BASE) -> dict[str, str]:
    """Return the state.txt and osc.gz URLs for a sequence under a base URL."""
    fragment = sequence_to_fragment(seq)
    base = base_url if base_url.endswith("/") else base_url + "/"
    return {
        "state": urljoin(base, f"{fragment}.state.txt"),
        "change": urljoin(base, f"{fragment}.osc.gz"),
    }


if __name__ == "__main__":
    urls = sequence_urls(6_123_456)
    logger.info("state url: %s", urls["state"])
    logger.info("change url: %s", urls["change"])
```

Parsing a fetched `state.txt` back into the two fields is the inverse operation, and it must undo the properties escaping:

```python
from datetime import datetime, timezone


def parse_state_txt(text: str) -> dict[str, object]:
    """Parse a replication state.txt into {'sequence': int, 'timestamp': datetime}."""
    fields: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue          # skip the human-readable comment line
        key, sep, value = line.partition("=")
        if sep:
            fields[key.strip()] = value.strip().replace("\\:", ":")

    ts = datetime.fromisoformat(fields["timestamp"].replace("Z", "+00:00"))
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return {"sequence": int(fields["sequenceNumber"]), "timestamp": ts}
```

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Map an OSM replication sequence number to its state.txt URL",
  "description": "Derive the replication directory path and object URLs from a sequence number, then parse the fetched state.txt back into a sequence and timestamp.",
  "step": [
    { "@type": "HowToStep", "name": "Validate the sequence", "text": "Reject negative or non-integer sequences before formatting so a bad value fails at the source instead of as an opaque 404." },
    { "@type": "HowToStep", "name": "Zero-pad to nine digits", "text": "Format the integer with %09d so the three-group split is well-formed even for small sequences." },
    { "@type": "HowToStep", "name": "Slice into thirds", "text": "Take characters 0-3, 3-6 and 6-9 as the two directory levels and the file stem, joined with slashes." },
    { "@type": "HowToStep", "name": "Join under the cadence base URL", "text": "Append the fragment to the minute, hour, or day base URL and add .state.txt or .osc.gz to the stem." },
    { "@type": "HowToStep", "name": "Parse the fetched state.txt", "text": "Skip the comment line, split each property on the first equals sign, unescape backslash-colons, and read sequenceNumber and timestamp." }
  ]
}
</script>

## Validation & Error-Handling Matrix

Sequence and state handling fails in characteristic ways. Each row is a real fault seen in production sync loops, with how to catch and fix it.

| Error condition | Root cause | Detection | Remediation |
|---|---|---|---|
| 404 on `NNN.state.txt` | Sequence not yet published, or wrong cadence base URL | HTTP 404 on a sequence ≤ the root cursor | Confirm cadence; poll the root `state.txt` before requesting a step |
| `fromisoformat` raises | Backslash-escaped colons left in the `timestamp` | Exception on parse | Replace `\:` with `:` before parsing the field |
| Sequence goes backwards | Two cadences mixed, or stale cached state | New sequence ≤ last applied | Pin one cadence; reject non-increasing sequences at checkpoint |
| Header has no sequence anchor | Third-party extract stripped `osmosis_*` keys | Key absent in `HeaderBlock` | Derive a start sequence from the header timestamp instead |
| Wrong stream applied to extract | `base_url` ignored; planet diffs on a regional extract | Object ids present in diff absent locally | Read `osmosis_replication_base_url`; match the extract's own feed |
| Comment line parsed as data | Splitting every line on `=` | `#Sat Jul…` yields a junk key | Skip lines starting with `#` |
| Off-by-one on resume | Applied position stored as "next" vs "last done" | Diff re-applied or skipped after restart | Store the last *successfully applied* sequence; fetch `last + 1` |

## Performance & Scale Considerations

The cost of sequence tracking is dominated not by the arithmetic but by the network round-trips to discover and fetch state. Polling the root cursor is a single small request; only fetch per-step `state.txt` files when you actually need the timestamp of a specific historical step, because the cursor plus arithmetic already tells you every intermediate path. When catching up a badly stale extract that is thousands of sequences behind, avoid fetching each step's `state.txt` — compute the path fragments directly and request only the `.osc.gz` payloads in order, reserving `state.txt` reads for the endpoints of the range. The minutely stream advances roughly 1,440 sequences per day, so a week-stale extract is around 10,000 diffs; at that scale the difference between one request per step and two is a multi-hour swing.

Because the path fragment is a deterministic pure function of the integer, it caches trivially and needs no coordination across workers. If you parallelize the *download* of a large catch-up range, keep the *apply* strictly sequential in ascending sequence order — the diffs are not commutative, and applying `456` before `455` corrupts the object version chain. Download concurrently, apply serially.

## Failure Modes & Gotchas

- **Cadence counters are independent.** The minutely sequence `6123456` and the daily sequence `6123456` name completely different points in time. Store the cadence alongside every sequence you persist.
- **Nine-digit padding is not future-proof forever, but it is now.** The minutely counter passed six million years into the stream; the split assumes ≤ nine significant digits. Do not hard-code an eight-digit split copied from an old tutorial.
- **The top-level `state.txt` can briefly lag its directory.** During publication the root cursor and the newest per-step file update within a small window; if a computed URL 404s on a sequence equal to the cursor, retry with a short backoff rather than treating it as a permanent gap.
- **Timestamps are UTC, always.** Never localize a replication timestamp for comparison; a timezone-naive `datetime` compared against an aware one raises, and the fix is to attach `timezone.utc`, not to strip it.
- **Regional feeds renumber from their own origin.** A Geofabrik extract's sequence is meaningless against the planet feed and vice versa. The `base_url` header is the authority on which counter applies.
- **A missed diff is silent.** Nothing in the protocol tells you a step was skipped; only your own last-applied bookkeeping detects it. Recovering from that condition is the subject of [recovering from a replication sequence gap](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/recovering-from-a-replication-sequence-gap/).

## Integration Points: Robust Checkpointing

The output of this stage is a durable record of the last sequence you have *fully* applied, written so that a crash between fetching and committing a diff never leaves an ambiguous position. The rule is to advance the checkpoint only after the diff is committed to the target store, and to write it atomically so a torn write cannot corrupt it.

```python
import json
import logging
import os
import tempfile
from pathlib import Path

logger = logging.getLogger("osm.replication.checkpoint")


def write_checkpoint(path: Path, sequence: int, timestamp: str, cadence: str) -> None:
    """Atomically persist the last fully-applied replication position.

    Write to a temp file in the same directory, fsync, then os.replace so a
    reader never sees a half-written checkpoint even across a power loss.
    """
    payload = {"sequence": sequence, "timestamp": timestamp, "cadence": cadence}
    directory = path.parent
    fd, tmp = tempfile.mkstemp(dir=directory, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)   # atomic on POSIX; overwrites the old checkpoint
        logger.info("checkpoint advanced to %s sequence %d", cadence, sequence)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def read_checkpoint(path: Path) -> dict | None:
    """Return the last applied position, or None on a fresh pipeline."""
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))
```

On startup the loop reads the checkpoint, computes `last + 1`, and derives that sequence's URL with `sequence_to_fragment`; on a fresh pipeline it instead reads the PBF replication anchor to seed the first sequence. That checkpoint is precisely the value the catch-up procedure in [catching up a stale OSM extract with pyosmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/catching-up-a-stale-osm-extract-with-pyosmium/) consumes and advances on every applied step.

## Sequence & State Topics in Depth

Two focused guides extend the mechanics above into the tasks that most often go wrong:

- [Finding the Replication Sequence for a Timestamp](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/finding-the-replication-sequence-for-a-timestamp/) — given a wall-clock datetime (or a PBF that lacks a sequence anchor), resolve the sequence number to start applying diffs from, with a pyosmium helper and a manual binary-search fallback.
- [Recovering from a Replication Sequence Gap](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/recovering-from-a-replication-sequence-gap/) — detect that a diff was missed or applied out of order by comparing the local checkpoint against upstream, then replay the missing range safely or reset from a fresh base.

## Frequently Asked Questions

<details>
<summary>Where does the state.txt file live for a given sequence number?</summary>

Left-pad the sequence to nine digits and split it into three groups of three. Sequence 6123456 becomes 006123456, which splits to 006/123/456, so under the minutely stream the file is at replication/minute/006/123/456.state.txt with the matching change file at 006/123/456.osc.gz. The first two groups are directories and the last is the filename stem.
</details>

<details>
<summary>What is the difference between the timestamp and sequenceNumber fields?</summary>

The sequenceNumber is the monotonic ordinal name of the diff step, and the timestamp is the ISO 8601 UTC instant the data is current as of once that diff is applied. They increase together: a higher sequence always maps to a later or equal timestamp. The sequence tells you which file to fetch; the timestamp tells you what moment in time it represents.
</details>

<details>
<summary>How does a freshly downloaded PBF know where to resume replication?</summary>

The PBF HeaderBlock can carry three optional keys: osmosis_replication_sequence_number, osmosis_replication_timestamp, and osmosis_replication_base_url. The sequence is the point the snapshot was cut at, so you start applying from the next sequence, and the base_url names which replication stream that number belongs to. If those keys are absent, derive a start sequence from the header timestamp instead.
</details>

<details>
<summary>Why does parsing the timestamp raise a ValueError?</summary>

The state.txt is a Java properties file, so the colons in the time portion are backslash-escaped, appearing as 00\:00\:00Z. A parser that splits on the equals sign but leaves the backslashes in place hands datetime.fromisoformat an invalid string. Replace the escaped colons with plain colons before parsing, and skip the leading comment line.
</details>

<details>
<summary>Can I mix minutely, hourly, and daily sequence numbers?</summary>

No. Each cadence maintains an independent counter, so the same integer names different moments in the minute, hour, and day streams. Always store the cadence alongside a persisted sequence, pin a pipeline to one cadence, and never resolve a sequence against a base URL from a different cadence.
</details>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Where does the state.txt file live for a given sequence number?",
      "acceptedAnswer": { "@type": "Answer", "text": "Left-pad the sequence to nine digits and split it into three groups of three. Sequence 6123456 becomes 006123456, which splits to 006/123/456, so under the minutely stream the file is at replication/minute/006/123/456.state.txt with the matching change file at 006/123/456.osc.gz. The first two groups are directories and the last is the filename stem." }
    },
    {
      "@type": "Question",
      "name": "What is the difference between the timestamp and sequenceNumber fields?",
      "acceptedAnswer": { "@type": "Answer", "text": "The sequenceNumber is the monotonic ordinal name of the diff step, and the timestamp is the ISO 8601 UTC instant the data is current as of once that diff is applied. They increase together: a higher sequence always maps to a later or equal timestamp. The sequence tells you which file to fetch; the timestamp tells you what moment in time it represents." }
    },
    {
      "@type": "Question",
      "name": "How does a freshly downloaded PBF know where to resume replication?",
      "acceptedAnswer": { "@type": "Answer", "text": "The PBF HeaderBlock can carry three optional keys: osmosis_replication_sequence_number, osmosis_replication_timestamp, and osmosis_replication_base_url. The sequence is the point the snapshot was cut at, so you start applying from the next sequence, and the base_url names which replication stream that number belongs to. If those keys are absent, derive a start sequence from the header timestamp instead." }
    },
    {
      "@type": "Question",
      "name": "Why does parsing the timestamp raise a ValueError?",
      "acceptedAnswer": { "@type": "Answer", "text": "The state.txt is a Java properties file, so the colons in the time portion are backslash-escaped, appearing as 00:00:00Z with backslashes. A parser that splits on the equals sign but leaves the backslashes in place hands the ISO parser an invalid string. Replace the escaped colons with plain colons before parsing, and skip the leading comment line." }
    },
    {
      "@type": "Question",
      "name": "Can I mix minutely, hourly, and daily sequence numbers?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. Each cadence maintains an independent counter, so the same integer names different moments in the minute, hour, and day streams. Always store the cadence alongside a persisted sequence, pin a pipeline to one cadence, and never resolve a sequence against a base URL from a different cadence." }
    }
  ]
}
</script>

## Related

- [Applying OSC Change Files with Osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/) — consuming the `.osc.gz` payloads that sequence numbers name.
- [Catching Up a Stale OSM Extract with Pyosmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/catching-up-a-stale-osm-extract-with-pyosmium/) — the loop that reads and advances the checkpoint defined here.
- [How to Decode OSM PBF Headers in Python](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/how-to-decode-osm-pbf-headers-in-python/) — extracting the replication anchor from the header block.
- [Extracting Metadata from OSM Planet Files](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/extracting-metadata-from-osm-planet-files/) — where the header replication keys sit among other planet metadata.
- [Finding the Replication Sequence for a Timestamp](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/finding-the-replication-sequence-for-a-timestamp/) — resolving a start sequence when only a datetime is known.
- [Recovering from a Replication Sequence Gap](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/recovering-from-a-replication-sequence-gap/) — detecting and repairing a missed or out-of-order diff.

This guide is part of the [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/) section — return there for the full incremental-update pipeline from base extract to continuously synced database.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Replication Sequence Numbers & State Tracking",
  "description": "How OSM replication sequence numbers map to state.txt files and directory paths, how PBF headers carry a replication anchor, and how to checkpoint a diff-sync pipeline robustly in Python.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "OSM Replication & Diff Sync",
  "about": ["OSM replication sequence numbers", "state.txt format", "diff-sync checkpointing"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Replication & Diff Sync", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/" },
    { "@type": "ListItem", "position": 3, "name": "Replication Sequence Numbers & State Tracking", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/" }
  ]
}
</script>
