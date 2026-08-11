---
title: "Reconstructing OSM Features at a Past Date"
description: "Materialize an OpenStreetMap map exactly as it stood at a past timestamp from a .osh.pbf: the osmium time-filter one-liner plus a two-pass pyosmium fold that keeps the latest visible version at or before T."
pageTitle: "Reconstruct OSM Features at a Past Date from .osh.pbf"
pageDescription: "Cut a point-in-time OSM snapshot from a full-history file with osmium time-filter and a pyosmium two-pass fold that retains the newest visible version with timestamp at or before T."
slug: reconstructing-osm-features-at-a-past-date
type: article
breadcrumb: "Features at a Past Date"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# Reconstructing OSM Features at a Past Date

Given a full-history `.osh.pbf`, produce the map exactly as it existed at a chosen instant T — every node, way, and relation in the version it held then, and nothing that had been deleted by then.

## Prerequisites

Check each item; a missing one is the usual reason a "historical" snapshot still contains present-day edits.

- [ ] A full-history source file (`*.osh.pbf`) whose header sets `HistoricalInformation` — see [Full-History .osh.pbf Processing](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/) for how the flag and version chains work.
- [ ] `osmium` command-line tool ≥ 1.14 on `PATH` for the `time-filter` subcommand.
- [ ] `pyosmium` ≥ 3.6 installed (`pip install osmium`) for the two-pass Python approach.
- [ ] Python 3.10+ for the `dict[tuple[str, int], ...]` typing used below.
- [ ] The target timestamp T fixed in UTC with an explicit `Z` suffix, e.g. `2023-01-01T00:00:00Z`.
- [ ] Enough disk for a second output file roughly the size of one current-state extract of the same region.

## Conceptual minimum

A point-in-time snapshot is a per-object reduction, not a filter over the file as a whole. For each distinct `(type, id)`, walk that object's version chain, keep only versions whose `timestamp` is at or before T, and take the one with the highest `version` number among them. If that surviving version is a deletion — its `visible` flag is `false` — the object did not exist at T and is dropped entirely; otherwise it is emitted in exactly that version. This is the same fold introduced in the [full-history processing](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/) overview, applied once per object and then written back out. The reason `version` rather than `timestamp` decides the winner is that timestamps have one-second resolution and two rapid edits can share one, whereas the version counter is strictly monotonic and never ties.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 238" role="img" aria-labelledby="asof-pitfall-t asof-pitfall-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="asof-pitfall-t">Three ways an as-of query goes wrong and what each produces</title>
  <desc id="asof-pitfall-d">A grid of three mistakes against the wrong answer each produces. Taking the newest version regardless of the cut-off returns today state, not the requested date. Filtering by timestamp but forgetting the visible flag resurrects deleted objects. Reconstructing a way at the cut-off but resolving its node coordinates from the current snapshot produces a geometry that never existed, mixing 2019 topology with 2026 positions.</desc>
  <rect x="0" y="0" width="880" height="238" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three as-of mistakes, three plausible wrong answers</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">what the query does</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">what you get back</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">ignore the cut-off</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">max(version) per id</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">current state, not historical</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">ignore visible=false</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">newest version ≤ T only</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">deleted objects come back</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">mix eras in one geometry</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">way at T, nodes from today</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">a shape that never existed</text>
  <text x="440" y="220" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">The correct reduction is: newest version at or before T, dropped if that version is invisible, with node positions resolved at the same T.</text>
</svg>
<figcaption>The third one is the dangerous one, because it produces a plausible-looking geometry rather than an obvious error. Reconstructing a way as of a date means reconstructing its nodes as of the same date.</figcaption>
</figure>

The one subtlety beyond that rule is consistency between primitives. A way at T references node ids, and those nodes have their own histories described by the [node, way, and relation data model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/); a faithful snapshot must pair the way version live at T with the node versions live at T, or the geometry will be reconstructed from present-day coordinates. Both approaches below preserve that consistency by selecting the live version of every primitive against the same cutoff.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 240" role="img" aria-label="Decision flow for reconstructing one object at time T. Start from an object's version chain, discard every version whose timestamp is after T, then take the version with the highest version number among those that remain. If that surviving version has visible equal to false the object is dropped because it was deleted by T; otherwise the object is emitted in that surviving version." style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit">
  <title>Per-object reduction: pick the newest visible version at or before T</title>
  <desc>A left-to-right decision flow: the object's version chain enters, versions after T are discarded, the highest remaining version is selected, and a visible check either emits the object or drops it as deleted.</desc>
  <defs>
    <marker id="rpd-arr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker>
  </defs>
  <rect x="0" y="0" width="900" height="240" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="450" y="26" text-anchor="middle" font-size="14.5" fill="currentColor" font-weight="700">One object at T: newest surviving version, then a visible check</text>
  <g transform="translate(0,-60)">
  <!-- version chain -->
  <rect x="24" y="110" width="150" height="72" rx="7" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="99" y="140" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="700">version chain</text>
  <text x="99" y="158" text-anchor="middle" font-size="11" fill="currentColor">v1 … vN</text>
  <text x="99" y="173" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">one (type, id)</text>
  <!-- filter -->
  <rect x="214" y="110" width="160" height="72" rx="7" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.5"/>
  <text x="294" y="140" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="700">drop timestamp</text>
  <text x="294" y="158" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="700">&gt; T</text>
  <text x="294" y="174" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">keep past + present</text>
  <!-- max version -->
  <rect x="414" y="110" width="160" height="72" rx="7" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.5"/>
  <text x="494" y="140" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="700">take max</text>
  <text x="494" y="158" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="700">version</text>
  <text x="494" y="174" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">the survivor</text>
  <!-- visible check diamond-ish -->
  <rect x="614" y="110" width="150" height="72" rx="7" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="689" y="144" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="700">visible?</text>
  <text x="689" y="164" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">tombstone check</text>
  <!-- outcomes -->
  <rect x="700" y="222" width="176" height="54" rx="7" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="788" y="246" text-anchor="middle" font-size="12" fill="currentColor" font-weight="700">emit this version</text>
  <text x="788" y="263" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">visible=true</text>
  <rect x="500" y="222" width="176" height="54" rx="7" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 3"/>
  <text x="588" y="246" text-anchor="middle" font-size="12" fill="currentColor" font-weight="700">drop object</text>
  <text x="588" y="263" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">deleted by T</text>
  <!-- arrows -->
  <line x1="174" y1="146" x2="212" y2="146" stroke="currentColor" stroke-width="1.5" marker-end="url(#rpd-arr)"/>
  <line x1="374" y1="146" x2="412" y2="146" stroke="currentColor" stroke-width="1.5" marker-end="url(#rpd-arr)"/>
  <line x1="574" y1="146" x2="612" y2="146" stroke="currentColor" stroke-width="1.5" marker-end="url(#rpd-arr)"/>
  <path d="M700,168 V222" fill="none" stroke="var(--osm-ok,#15803d)" stroke-width="1.5" marker-end="url(#rpd-arr)"/>
  <text x="716" y="204" text-anchor="start" font-size="10" fill="currentColor" opacity="0.85">yes</text>
  <path d="M660,178 Q640,210 620,220" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 3" marker-end="url(#rpd-arr)"/>
  <text x="612" y="200" text-anchor="end" font-size="10" fill="currentColor" opacity="0.85">no</text>
  </g>
</svg>

## Runnable solution

The fast path is one command. `osmium time-filter` streams the history file once and emits the state at the given instant:

```bash
# Snapshot the map as it stood at midnight UTC on 2023-01-01.
osmium time-filter history.osh.pbf 2023-01-01T00:00:00Z -o snapshot.osm.pbf

# Verify the result carries no history and reports its object counts.
osmium fileinfo -e snapshot.osm.pbf | grep -E "Multiple versions|Number of"
```

When you need the reduction inside a Python pipeline — to fold custom logic in, or to avoid shelling out — the two-pass approach below is the pyosmium equivalent. The first pass records, per `(type, id)`, the version number live at T and whether it is visible; the second pass streams the file again and writes exactly those live, visible versions.

```python
from __future__ import annotations

import logging
from datetime import datetime, timezone

import osmium

logger = logging.getLogger("osm.reconstruct")


class LiveVersionScanner(osmium.SimpleHandler):
    """Pass 1: find the version live at the cutoff for every object."""

    def __init__(self, cutoff: datetime) -> None:
        super().__init__()
        self.cutoff = cutoff
        # (type, id) -> (winning version number, is that version visible)
        self.live: dict[tuple[str, int], tuple[int, bool]] = {}

    def _scan(self, kind: str, obj: osmium.osm.OSMObject) -> None:
        if obj.timestamp > self.cutoff:
            return  # a future edit; it cannot win the snapshot
        key = (kind, obj.id)
        current = self.live.get(key)
        if current is None or obj.version > current[0]:
            self.live[key] = (obj.version, obj.visible)

    def node(self, n: osmium.osm.Node) -> None:
        self._scan("node", n)

    def way(self, w: osmium.osm.Way) -> None:
        self._scan("way", w)

    def relation(self, r: osmium.osm.Relation) -> None:
        self._scan("relation", r)


class SnapshotWriter(osmium.SimpleHandler):
    """Pass 2: write the live, visible version of each object."""

    def __init__(self, live: dict[tuple[str, int], tuple[int, bool]],
                 writer: osmium.SimpleWriter) -> None:
        super().__init__()
        self.live = live
        self.writer = writer
        self.written = 0

    def _emit(self, kind: str, obj: osmium.osm.OSMObject) -> None:
        target = self.live.get((kind, obj.id))
        if target is None:
            return
        version, visible = target
        if obj.version == version and visible:
            if kind == "node":
                self.writer.add_node(obj)
            elif kind == "way":
                self.writer.add_way(obj)
            else:
                self.writer.add_relation(obj)
            self.written += 1

    def node(self, n: osmium.osm.Node) -> None:
        self._emit("node", n)

    def way(self, w: osmium.osm.Way) -> None:
        self._emit("way", w)

    def relation(self, r: osmium.osm.Relation) -> None:
        self._emit("relation", r)


def reconstruct(src: str, dst: str, cutoff: datetime) -> int:
    """Materialize the state of *src* at *cutoff* into *dst*; return objects written."""
    scanner = LiveVersionScanner(cutoff)
    scanner.apply_file(src)
    logger.info("scanned %d distinct objects", len(scanner.live))

    writer = osmium.SimpleWriter(dst)
    emitter = SnapshotWriter(scanner.live, writer)
    try:
        emitter.apply_file(src)
    finally:
        writer.close()  # flush and finalize the output PBF
    logger.info("wrote %d live objects to %s", emitter.written, dst)
    return emitter.written


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    T = datetime(2023, 1, 1, tzinfo=timezone.utc)
    reconstruct("history.osh.pbf", "snapshot.osm.pbf", T)
```

## Step-by-step walkthrough

1. **Fix the cutoff in UTC.** `datetime(2023, 1, 1, tzinfo=timezone.utc)` builds a timezone-aware instant. pyosmium exposes `obj.timestamp` as tz-aware UTC, so a naive datetime would raise on comparison — the `tzinfo` is not optional.
2. **Pass 1 records only the winner.** `LiveVersionScanner` skips any version dated after T and, for the rest, keeps the highest version number per `(type, id)`. Because versions arrive in ascending order within each object, the last one it accepts is the survivor, and it stores that version's `visible` flag alongside it.
3. **Pass 2 emits by exact match.** `SnapshotWriter` re-reads the file and writes an object only when its `version` equals the recorded winner *and* that winner is visible. A tombstone winner (`visible=false`) matches no output, so deleted objects vanish from the snapshot.
4. **Two passes, not one.** The file is streamed twice because you cannot know an object's final surviving version until you have seen its whole chain, and buffering every version in memory would defeat the point on a large history. The scan keeps only two integers per object, so its footprint is a fraction of the file.
5. **The writer is closed in `finally`.** `SimpleWriter.close()` flushes the final block; skipping it on an exception leaves a truncated, unreadable PBF.

## Verification

- **Header carries no history.** `osmium fileinfo -e snapshot.osm.pbf` should report `Multiple versions of objects: no` — the output is a plain current-state file, not another history.
- **Counts are plausible.** The snapshot's object count should be lower than the history's distinct-id count by roughly the number of objects deleted before T. A count *equal* to the distinct-id count means the `visible=false` filter never fired.
- **Spot-check a known deletion.** Pick an id you know was deleted before T and confirm it is absent: `osmium getid snapshot.osm.pbf n123456` should return nothing.
- **Log lines agree.** The `wrote N live objects` line should match `osmium fileinfo` object totals, confirming pass 2 emitted exactly the scanned survivors.
- **Cross-check the CLI.** Run `osmium time-filter` on the same T and compare object counts; large divergence points to a timezone or tie-breaking bug in the Python fold.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="asof-verify-t asof-verify-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="asof-verify-t">Checks that confirm an as-of reconstruction is genuinely historical</title>
  <desc id="asof-verify-d">A left-to-right chain of four verification steps. Pick an object with a known edit history and assert its tag set matches the version that was current at the cut-off. Assert that an object deleted before the cut-off is absent from the output. Assert that an object created after the cut-off is also absent. Finally re-run with a cut-off of now and diff against the ordinary snapshot; a non-empty diff means the reduction is wrong somewhere.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="avf" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four assertions, ending with the one that catches everything</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">known object at T</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">tags match that version</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">hand-checked once</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#avf)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">deleted before T</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">must be absent</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">catches visible= bugs</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#avf)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">created after T</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">must be absent</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">catches cut-off bugs</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#avf)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">reconstruct at now</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">diff vs the snapshot</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">must be empty</text>
  <text x="440" y="158" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Keep the first three as unit tests with a small fixture file; run the fourth against a city extract in CI.</text>
</svg>
<figcaption>The last check is the strongest and the cheapest: reconstructing as of the present must reproduce the snapshot exactly. Any difference is a bug in the reduction, not in the data.</figcaption>
</figure>

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| `TypeError: can't compare offset-naive and offset-aware` | Cutoff built without `tzinfo` | Use `datetime(..., tzinfo=timezone.utc)`. |
| Deleted objects still in the snapshot | `visible` flag ignored when emitting | Emit only when the winning version has `visible=true`. |
| Snapshot identical to the head state | Cutoff set to now, or `timestamp > T` filter inverted | Verify T and skip versions strictly after it. |
| Way present but geometry looks current | Mixed a live way with head-state node coordinates | Select live node versions against the same cutoff. |
| Truncated / unreadable output PBF | `SimpleWriter.close()` never called | Close the writer in a `finally` block. |
| Ties resolved arbitrarily at same second | Compared timestamps instead of versions | Break ties on `version`, the monotonic counter. |

## Specification reference

> The `osmium time-filter` command "copies all objects that are valid at the given point in time" from a history file to a snapshot output; an object is valid at T when its newest version with a timestamp at or before T is visible. See the [osmium-tool manual](https://osmcode.org/osmium-tool/manual.html) for the command reference, and [Planet.osm/full](https://wiki.openstreetmap.org/wiki/Planet.osm/full) on the OSM Wiki for how full-history planet files are produced and distributed.

## Related

- [Full-History .osh.pbf Processing](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/) — the format, the version chains, and the fold this page implements end to end.
- [Extracting Changeset Metadata from History Files](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/extracting-changeset-metadata-from-history-files/) — the provenance-oriented sibling that reads the same versions for audit data.
- [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — why a consistent snapshot must pair way versions with the node versions live at T.
- [Applying .osc Change Files with osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/) — moving a current extract forward through diffs, the inverse of rewinding one.
- [How to Decode OSM PBF Headers in Python](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/how-to-decode-osm-pbf-headers-in-python/) — confirming a file is historical before you reconstruct from it.

Up one level: [Full-History .osh.pbf Processing](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/).

## Frequently Asked Questions

<details>
<summary>Does the snapshot include objects deleted before T?</summary>

No. For each object the reduction takes the newest version with a timestamp at or before T and checks its visible flag. If that surviving version is a deletion, the object did not exist at T and is left out. Only objects whose latest pre-T version is visible appear in the snapshot.
</details>

<details>
<summary>Why does the pyosmium approach read the file twice?</summary>

You cannot know which version of an object survives until you have seen its entire chain, and buffering every version of every object would consume as much memory as the file itself. The first pass keeps just two integers per object — the winning version number and its visibility — and the second pass streams the file again to write only those exact versions, keeping the footprint small.
</details>

<details>
<summary>Should I prefer osmium time-filter or the Python code?</summary>

Use osmium time-filter for a plain snapshot; it is a compiled single-pass tool and is faster and simpler. Choose the pyosmium two-pass version when you need to fold custom logic into the reduction — filtering by tag, emitting to a non-PBF sink, or computing something per version as you go — that the command line cannot express.
</details>

<details>
<summary>What time zone should the cutoff use?</summary>

Always UTC. OSM timestamps are stored in UTC, pyosmium returns timezone-aware UTC datetimes, and osmium time-filter expects an ISO-8601 instant with a Z suffix such as 2023-01-01T00:00:00Z. Supplying a local time or a naive datetime shifts the cut or raises a comparison error.
</details>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Reconstructing OSM Features at a Past Date",
  "description": "Materialize an OpenStreetMap map exactly as it stood at a past timestamp from a .osh.pbf: the osmium time-filter one-liner plus a two-pass pyosmium fold that keeps the latest visible version at or before T.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "OSM Replication & Diff Sync",
  "about": ["OSM point-in-time snapshot", "osmium time-filter", "pyosmium history reconstruction"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Replication & Diff Sync", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/" },
    { "@type": "ListItem", "position": 3, "name": "Full-History Processing", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/" },
    { "@type": "ListItem", "position": 4, "name": "Features at a Past Date", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/reconstructing-osm-features-at-a-past-date/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Reconstruct OSM features at a past date",
  "description": "Cut a point-in-time OSM snapshot from a full-history file using osmium time-filter or a two-pass pyosmium fold that keeps the newest visible version at or before T.",
  "step": [
    { "@type": "HowToStep", "name": "Fix the cutoff in UTC", "text": "Choose the target instant T as a timezone-aware UTC datetime, matching the Z-suffixed ISO-8601 form osmium expects." },
    { "@type": "HowToStep", "name": "Run the CLI for the fast path", "text": "Execute osmium time-filter on the history file with the target timestamp to stream out the valid state in a single pass." },
    { "@type": "HowToStep", "name": "Scan for the live version", "text": "In pass one, record per object the highest version number whose timestamp is at or before T, along with that version's visible flag." },
    { "@type": "HowToStep", "name": "Emit the survivors", "text": "In pass two, re-read the file and write each object only when its version equals the recorded winner and that winner is visible." },
    { "@type": "HowToStep", "name": "Verify the snapshot", "text": "Confirm the output header reports no multiple versions and that objects deleted before T are absent." }
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
      "name": "Does the snapshot include objects deleted before T?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. For each object the reduction takes the newest version with a timestamp at or before T and checks its visible flag. If that surviving version is a deletion, the object did not exist at T and is left out. Only objects whose latest pre-T version is visible appear in the snapshot." }
    },
    {
      "@type": "Question",
      "name": "Why does the pyosmium approach read the file twice?",
      "acceptedAnswer": { "@type": "Answer", "text": "You cannot know which version of an object survives until you have seen its entire chain, and buffering every version of every object would consume as much memory as the file itself. The first pass keeps just two integers per object, the winning version number and its visibility, and the second pass streams the file again to write only those exact versions." }
    },
    {
      "@type": "Question",
      "name": "Should I prefer osmium time-filter or the Python code?",
      "acceptedAnswer": { "@type": "Answer", "text": "Use osmium time-filter for a plain snapshot; it is a compiled single-pass tool and is faster and simpler. Choose the pyosmium two-pass version when you need to fold custom logic into the reduction, such as filtering by tag or emitting to a non-PBF sink, that the command line cannot express." }
    },
    {
      "@type": "Question",
      "name": "What time zone should the cutoff use?",
      "acceptedAnswer": { "@type": "Answer", "text": "Always UTC. OSM timestamps are stored in UTC, pyosmium returns timezone-aware UTC datetimes, and osmium time-filter expects an ISO-8601 instant with a Z suffix such as 2023-01-01T00:00:00Z. Supplying a local time or a naive datetime shifts the cut or raises a comparison error." }
    }
  ]
}
</script>
