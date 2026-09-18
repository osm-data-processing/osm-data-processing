---
title: "Pinning a Reproducible OSM Snapshot by Sequence Number"
description: "Name an exact OSM state with a sequence number so an analysis run months later reads the same data, and store the pin where the result that depends on it can be traced back to it."
pageTitle: "Reproducible OSM Snapshots from Replication Sequences"
pageDescription: "Use a replication sequence number as the identifier of an OSM state, reconstruct that state deterministically, and record the pin alongside every derived result."
slug: pinning-a-reproducible-osm-snapshot-by-sequence-number
type: article
breadcrumb: "Pinning a Snapshot"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Pinning a Reproducible OSM Snapshot by Sequence Number

"The data as of last Tuesday" is not a reproducible input, because the extract you downloaded last Tuesday has been replaced and the planet has moved on. A replication sequence number is, and it costs nothing to record.

## Prerequisites

- [ ] Python 3.10+ and `osmium-tool` on the path.
- [ ] The state model in [Replication Sequence Numbers & State Tracking](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/).
- [ ] A base extract whose own sequence number is known, which not every provider publishes.
- [ ] Storage for the diffs between the base and the pin, or for the materialised snapshot.
- [ ] Somewhere to record the pin that outlives the run, such as the output's own metadata.

## Conceptual minimum

A replication stream is an ordered sequence of change files, each numbered, each carrying a timestamp. A sequence number therefore names a state: the base planet plus every diff up to and including that number. Two runs that reconstruct from the same base to the same sequence see identical data, which is the entire property reproducibility needs.

Three things make this work in practice.

**The base must be identified too.** A sequence number is meaningless without the state it is counted from. Providers that publish an extract alongside its `state.txt` make this easy; providers that do not force you to record the file's own checksum instead, which pins the bytes rather than the position.

**Timestamps are not identifiers.** A replication timestamp tells you approximately when a diff was cut, and diffs are not evenly spaced. Resolving "2026-09-01T00:00:00Z" to a sequence requires a search through the stream's state files, and the result is the first sequence at or after that moment — a derived answer worth computing once and then recording as a number.

**Retention is finite.** Minutely replication history is not kept forever. A pin that names a sequence whose diffs have been expired is not reconstructible, which means a long-lived pin needs either a materialised snapshot or a base close enough to the pin that the intervening diffs still exist.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="prs1-t prs1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="prs1-t">Three ways of naming an OSM state, and what each guarantees</title>
  <desc id="prs1-d">Three panels. Naming a state by date is what people say and it guarantees nothing, because diffs are unevenly spaced, the phrase resolves differently depending on when it is interpreted, and the extract that was current on that date has since been replaced. Naming it by file checksum pins exact bytes and is perfectly reproducible as long as that file still exists somewhere, but it says nothing about position in the stream and cannot be advanced. Naming it by base plus sequence number pins a position, reconstructs deterministically, and can be advanced or compared, but only while the intervening diffs remain within the provider's retention window.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Date, checksum, or sequence</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">By date</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">What people actually say</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Diffs unevenly spaced</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Resolves differently later</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Guarantees nothing</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">By checksum</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Pins exact bytes</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Perfectly reproducible</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">No position in the stream</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Cannot be advanced</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Base plus sequence</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Pins a stream position</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Deterministic rebuild</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Comparable and advanceable</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Needs diffs retained</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The third is the right default, and the second is what a long-lived pin degrades into once retention expires the diffs behind it.</text>
</svg>
<figcaption>Recording both a base checksum and a sequence costs two strings and covers all three cases.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import hashlib
import json
import logging
import subprocess
import urllib.request
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.replication.pin")

BASE_URL = "https://planet.openstreetmap.org/replication/minute"


@dataclass(frozen=True)
class Pin:
    """Everything needed to rebuild a state, and nothing that varies."""
    base_file: str
    base_sha256: str
    base_sequence: int
    sequence: int
    sequence_timestamp: str
    replication_url: str

    def as_json(self) -> str:
        return json.dumps(asdict(self), indent=1, sort_keys=True)


def sequence_path(sequence: int) -> str:
    text = f"{sequence:09d}"
    return f"{text[0:3]}/{text[3:6]}/{text[6:9]}"


def state_for(sequence: int, base_url: str = BASE_URL) -> dict[str, str]:
    url = f"{base_url}/{sequence_path(sequence)}.state.txt"
    with urllib.request.urlopen(url, timeout=30) as response:
        body = response.read().decode("utf-8")
    state: dict[str, str] = {}
    for line in body.splitlines():
        if line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        state[key.strip()] = value.strip().replace("\\:", ":")
    return state


def latest_sequence(base_url: str = BASE_URL) -> int:
    with urllib.request.urlopen(f"{base_url}/state.txt", timeout=30) as response:
        body = response.read().decode("utf-8")
    for line in body.splitlines():
        if line.startswith("sequenceNumber="):
            return int(line.split("=", 1)[1])
    raise RuntimeError("no sequenceNumber in state.txt")


def resolve_timestamp(moment: datetime, base_url: str = BASE_URL) -> int:
    """Binary search the stream for the first sequence at or after a moment.

    Diffs are not evenly spaced, so this is a search rather than arithmetic.
    Compute it ONCE and record the integer; never re-resolve at read time.
    """
    moment = moment.astimezone(timezone.utc)
    low, high = 1, latest_sequence(base_url)
    answer = high
    while low <= high:
        mid = (low + high) // 2
        try:
            stamp = datetime.fromisoformat(state_for(mid, base_url)["timestamp"])
        except Exception:                       # expired or missing state file
            low = mid + 1
            continue
        if stamp >= moment:
            answer, high = mid, mid - 1
        else:
            low = mid + 1
    logger.info("%s resolves to sequence %d", moment.isoformat(), answer)
    return answer


def sha256(path: Path, chunk: int = 1 << 20) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(chunk):
            digest.update(block)
    return digest.hexdigest()


def make_pin(base: Path, base_sequence: int, sequence: int,
             base_url: str = BASE_URL) -> Pin:
    state = state_for(sequence, base_url)
    return Pin(base_file=base.name, base_sha256=sha256(base),
               base_sequence=base_sequence, sequence=sequence,
               sequence_timestamp=state["timestamp"], replication_url=base_url)


def materialise(pin: Pin, base: Path, out: Path) -> Path:
    """Rebuild the pinned state. Deterministic given the same pin."""
    if sha256(base) != pin.base_sha256:
        raise SystemExit(f"base file does not match pin: {base}")
    subprocess.run(
        ["osmium", "up-to-date", "--server", pin.replication_url,
         "--ending-sequence-id", str(pin.sequence),
         "-o", str(out), "--overwrite", str(base)],
        check=True)
    (out.with_suffix(out.suffix + ".pin.json")).write_text(
        pin.as_json(), encoding="utf-8")
    logger.info("materialised sequence %d to %s", pin.sequence, out)
    return out


if __name__ == "__main__":
    logger.info("resolve once, record the integer, rebuild from base plus pin")
```

## Step-by-step walkthrough

1. **Record the base file's checksum, not just its name.** Filenames are reused; `europe-latest.osm.pbf` names a different file every day.
2. **Record the base's own sequence.** Without it the pin says where to stop but not where to start, and an `osmium up-to-date` run from the wrong base silently produces a different state.
3. **Resolve a date to a sequence exactly once.** The search costs a handful of requests and the answer is an integer; re-resolving at read time reintroduces the ambiguity the pin was meant to remove.
4. **Use the replication URL as part of the pin.** Minutely, hourly and daily streams have independent numbering, and a sequence from one is meaningless against another.
5. **Store the pin beside the output.** A pin in a runbook belongs to nobody; a pin in the output's metadata travels with the thing that depends on it.
6. **Verify the base before applying.** A mismatched checksum is a failure, not a warning, because everything downstream of it will be subtly wrong rather than obviously broken.
7. **Materialise long-lived pins.** Once the diffs behind a sequence are expired, only a stored snapshot can still reconstruct it.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 292" role="img" aria-labelledby="prs2-t prs2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="prs2-t">Retention, and when a pin stops being reconstructible</title>
  <desc id="prs2-d">A timeline of four marks. At the moment the pin is created, everything needed to rebuild it exists and reconstruction is a routine command. A few weeks later the minutely diffs behind it begin to be expired by the provider, and reconstruction becomes possible only through a coarser hourly or daily stream with correspondingly less precision. Months later the base extract itself has been replaced at its published location, so the checksum recorded in the pin no longer matches anything downloadable. At that point only a materialised snapshot stored by you can still reproduce the state.</desc>
  <defs><marker id="prs2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="292" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">How long a pin stays reconstructible</text>
  <line x1="26" y1="150" x2="848" y2="150" stroke="currentColor" stroke-width="1.8" marker-end="url(#prs2-a)"/>
  <rect x="35" y="52" width="189" height="66" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="130" y="76" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">At creation</text>
  <text x="130" y="94" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">everything present</text>
  <text x="130" y="110" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">a routine command</text>
  <line x1="130" y1="118" x2="130" y2="143" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="130" cy="150" r="5" fill="var(--osm-accent,#0369a1)"/>
  <rect x="242" y="176" width="189" height="66" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="336" y="200" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">Weeks later</text>
  <text x="336" y="218" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">minutely diffs expiring</text>
  <text x="336" y="234" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">coarser streams only</text>
  <line x1="336" y1="176" x2="336" y2="157" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="336" cy="150" r="5" fill="var(--osm-ok,#15803d)"/>
  <rect x="449" y="52" width="189" height="66" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="544" y="76" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">Months later</text>
  <text x="544" y="94" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">base file replaced</text>
  <text x="544" y="110" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">checksum matches nothing</text>
  <line x1="544" y1="118" x2="544" y2="143" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="544" cy="150" r="5" fill="var(--osm-warn,#a16207)"/>
  <rect x="656" y="176" width="189" height="66" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="750" y="200" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">After that</text>
  <text x="750" y="218" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">only your snapshot</text>
  <text x="750" y="234" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">nothing upstream helps</text>
  <line x1="750" y1="176" x2="750" y2="157" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="750" cy="150" r="5" fill="var(--osm-alt,#6d28d9)"/>
  <text x="868" y="276" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">A pin that must survive a year is a snapshot you have to store, and deciding that at creation time is far cheaper than discovering it later.</text>
</svg>
<figcaption>The pin stays valid as an identifier throughout; what expires is the ability to rebuild from upstream.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 342" role="img" aria-labelledby="prs3-t prs3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="prs3-t">What each field of the pin is for, and what breaks without it</title>
  <desc id="prs3-d">A grid of five recorded fields against their role in reconstruction and the failure that follows omitting them. The base filename alone identifies nothing, since providers reuse names daily. The base checksum pins the exact starting bytes, and without it a rebuild from a different extract succeeds while producing different data. The base sequence says where the rebuild starts, and without it the apply may begin mid-stream. The target sequence names the state, and a date in its place resolves differently later. The replication URL distinguishes the minutely, hourly and daily streams, whose numbering is independent.</desc>
  <rect x="0" y="0" width="880" height="342" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Five fields, five silent failures</text>
  <rect x="194" y="48" width="330" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="359" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Role</text>
  <rect x="524" y="48" width="330" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="689" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Failure without it</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Base filename</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="359" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">human readability</text>
  <text x="689" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">names are reused daily</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Base checksum</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="359" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">pins starting bytes</text>
  <text x="689" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">different data, no error</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Base sequence</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="359" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">where rebuild starts</text>
  <text x="689" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">apply begins mid-stream</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Target sequence</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="359" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">names the state</text>
  <text x="689" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a date drifts over time</text>
  <text x="30" y="289" font-size="11.5" font-weight="600" fill="currentColor">Replication URL</text>
  <line x1="26" y1="308" x2="854" y2="308" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="359" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">which stream</text>
  <text x="689" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">numbering is independent</text>
  <text x="868" y="326" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Every failure in the last column is silent: the rebuild succeeds and the data is wrong, so the checks belong in code, not a runbook.</text>
</svg>
<figcaption>The whole pin is under two hundred bytes and each field removes one way of being quietly wrong.</figcaption>
</figure>

## Verification

- **Two rebuilds agree.** Materialise the same pin twice into different files and compare checksums of the sorted output.
- **A wrong base is rejected.** Point the rebuild at a different extract and confirm it fails rather than proceeding.
- **The resolved sequence is stable.** Re-resolve the same timestamp and confirm the same integer comes back.
- **Feature counts match expectation.** Compare against the counts recorded when the pin was created.
- **The pin travels.** Confirm the output carries its pin file and that a consumer can find it without asking you.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Reruns produce different results | State named by date, not sequence | Record the resolved sequence integer |
| Rebuild fails months later | Diffs expired from retention | Materialise and store the snapshot |
| Wrong data from the right sequence | Base file differed from the original | Record and verify the base checksum |
| Sequence appears out of range | Pin taken from a different stream | Record the replication URL in the pin |
| Cannot trace a result to its input | Pin kept outside the output | Write the pin beside the output file |
| Rebuild silently starts mid-stream | Base sequence not recorded | Store the base's own sequence number |
| Timestamp resolves differently over time | Re-resolving at read time | Resolve once at pin creation and freeze it |

## Specification reference

> Each replication directory contains `state.txt` files giving `sequenceNumber` and `timestamp` for the corresponding change file, with the path derived by splitting the zero-padded nine-digit sequence into three-digit components. The `timestamp` value escapes colons with backslashes. Minutely, hourly and daily replication directories maintain independent sequence numbering. See the OpenStreetMap replication documentation and `osmium up-to-date`.

## Frequently Asked Questions

<details>
<summary>Why not just archive the extract instead of pinning a sequence?</summary>

Archiving works and costs storage proportional to how many pins you keep, which for a planet file is tens of gigabytes each. A sequence pin costs two strings and an integer, and reconstructs on demand while the diffs survive. The right answer is usually both: pin everything, and materialise only the pins that must outlive retention — a published result, a regulatory submission, a paper's dataset.
</details>

<details>
<summary>How precise is a sequence pin against a timestamp?</summary>

To within one diff interval, which for the minutely stream is about a minute and for the daily stream is a day. That precision is almost always more than enough, because the question being asked is "the same data as last time", not "the data at exactly this instant". The risk is not precision but ambiguity, and recording the integer removes that entirely.
</details>

<details>
<summary>Do regional extract providers publish usable sequence numbers?</summary>

The major ones do, alongside their extracts, and the number refers to the upstream planet stream rather than a provider-specific one — which is what makes `osmium up-to-date` work against a regional file. Providers that publish extracts without state files leave you pinning by checksum only, which is reproducible but not advanceable, and that is worth knowing before choosing a provider for work that needs reproducibility.
</details>

<details>
<summary>Should the pin include the tooling version?</summary>

Yes, if the output depends on it, which it usually does. The same input processed by different `osmium` or library versions can produce different geometry in edge cases, so a pin that reproduces the input but not the environment reproduces less than it appears to. Recording the tool versions alongside the sequence is the same two-string cost and closes the gap.
</details>

## Related

- [Replication Sequence Numbers & State Tracking](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/) — the parent topic.
- [Applying .osc Change Files with Osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/) — the mechanism a rebuild uses.
- [Recording OSM Data Provenance in a Pipeline](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/recording-osm-data-provenance-in-a-pipeline/) — where the pin belongs in the wider record.
- [Full-History .osh.pbf Processing](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/) — reconstructing arbitrary past states rather than pinned ones.
- [Incremental Updates for Derived Datasets](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/) — why each derived dataset carries its own pin.

Up one level: [Replication Sequence Numbers & State Tracking](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Pinning a Reproducible OSM Snapshot by Sequence Number",
  "description": "Name an exact OSM state with a sequence number so an analysis run months later reads the same data, and store the pin where the result that depends on it can be traced back to it.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Replication & Diff Sync",
  "about": ["reproducibility", "replication sequence", "data pinning"]
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
    { "@type": "ListItem", "position": 4, "name": "Pinning a Reproducible OSM Snapshot by Sequence Number", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/pinning-a-reproducible-osm-snapshot-by-sequence-number/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Pin a reproducible OSM snapshot by replication sequence",
  "description": "Record a base extract's checksum and sequence together with a target sequence and replication stream, rebuild deterministically from those, and store the pin alongside the output that depends on it.",
  "step": [
    { "@type": "HowToStep", "name": "Checksum the base extract", "text": "Record the base file's SHA-256, since filenames are reused for different content every day." },
    { "@type": "HowToStep", "name": "Record the base sequence", "text": "Store where the rebuild starts, not only where it stops." },
    { "@type": "HowToStep", "name": "Resolve a date once", "text": "Binary-search the replication state files for the target moment and freeze the resulting integer." },
    { "@type": "HowToStep", "name": "Record the replication URL", "text": "Minutely, hourly and daily streams number independently, so the stream is part of the identifier." },
    { "@type": "HowToStep", "name": "Verify the base before applying", "text": "Fail on a checksum mismatch rather than producing a subtly different state." },
    { "@type": "HowToStep", "name": "Rebuild with osmium up-to-date", "text": "Apply diffs from the base to the pinned ending sequence to materialise the state." },
    { "@type": "HowToStep", "name": "Store the pin beside the output", "text": "Write the pin as metadata next to the result, and materialise snapshots for pins that must outlive retention." }
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
      "name": "Why pin a sequence rather than archive the whole extract?",
      "acceptedAnswer": { "@type": "Answer", "text": "Archiving works but costs tens of gigabytes per pin for a planet file. A sequence pin costs two strings and an integer and rebuilds on demand while diffs survive. Usually do both: pin everything, and materialise only the pins that must outlive retention." }
    },
    {
      "@type": "Question",
      "name": "How precise is a sequence pin compared with a timestamp?",
      "acceptedAnswer": { "@type": "Answer", "text": "To within one diff interval — about a minute for the minutely stream. That is almost always enough, because the question is 'the same data as last time' rather than 'exactly this instant'. The risk removed is ambiguity, not imprecision." }
    },
    {
      "@type": "Question",
      "name": "Do regional OSM extract providers publish usable sequence numbers?",
      "acceptedAnswer": { "@type": "Answer", "text": "The major ones do, and the number refers to the upstream planet stream, which is what lets osmium up-to-date work against a regional file. Providers without state files leave you pinning by checksum only — reproducible but not advanceable." }
    },
    {
      "@type": "Question",
      "name": "Should a snapshot pin include tooling versions?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes, when the output depends on them, which it usually does. The same input processed by different osmium or library versions can differ in geometry edge cases, so a pin that reproduces the input but not the environment reproduces less than it appears to." }
    }
  ]
}
</script>
