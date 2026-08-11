---
title: "Full-History .osh.pbf Processing"
description: "Process OpenStreetMap full-history .osh.pbf files: the HistoricalInformation flag, multiple versions per element, the visible deletion marker, and streaming every version with pyosmium keyed on (type, id, version)."
pageTitle: "Full-History .osh.pbf Processing with pyosmium"
pageDescription: "Read OSM full-history .osh.pbf: HistoricalInformation flag, per-element version chains, the visible flag, and reconstructing a snapshot at time T with pyosmium and osmium time-filter."
slug: full-history-osh-pbf-processing
type: guide
breadcrumb: "Full-History Processing"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# Full-History .osh.pbf Processing

A standard `.osm.pbf` extract answers one question — what does the map look like *now* — and it discards everything the map used to be. The moment your work needs the past tense, that file is the wrong input, and the failure is quiet rather than loud: a contributor-activity report built from a current-state planet silently under-counts every element that was later deleted or reverted, a temporal join against a 2021 land-use layer matches against 2026 geometry, and an audit of "who touched this building" returns exactly one row because only the newest version survives. The full-history format, distributed as `.osh.pbf` (the `h` marks *history*), fixes this by keeping every version of every node, way, and relation ever committed, along with the changeset, editor, and timestamp that produced each one. This guide sits inside the broader [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/) section, and where the replication pages care about moving the present forward one diff at a time, this one is about reading the whole timeline at rest.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 340" role="img" aria-label="Version timeline for a single OSM element in a full-history file. Five versions run left to right along a time axis: version one created in 2019, version two a geometry edit in 2020, version three a tag edit in 2021 all with visible set to true, version four a deletion in 2022 with visible set to false, and version five a recreation in 2023 with visible true again. A dashed vertical snapshot cut at time T in late 2021 falls between version three and version four, so the state materialized at T is version three, the newest visible version whose timestamp is at or before T." style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit">
  <title>Version timeline of one OSM element with a snapshot cut at time T</title>
  <desc>Five version cards sit above a horizontal time axis. Versions one through three are visible edits; version four is a deletion with visible=false; version five recreates the element. A dashed vertical line marks the snapshot instant T between version three and version four, and version three is highlighted as the version that is live at T.</desc>
  <defs>
    <marker id="fhpbf-arr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker>
  </defs>
  <rect x="0" y="0" width="1000" height="340" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="500" y="24" text-anchor="middle" font-size="15" fill="currentColor" font-weight="700">One element, many versions — the snapshot at T is the newest visible version so far</text>
  <!-- v1 -->
  <rect x="40" y="46" width="150" height="60" rx="7" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="115" y="68" text-anchor="middle" font-size="13" fill="currentColor" font-weight="700">v1 · created</text>
  <text x="115" y="86" text-anchor="middle" font-size="11" fill="currentColor">visible=true</text>
  <text x="115" y="100" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">2019-03</text>
  <!-- v2 -->
  <rect x="210" y="46" width="150" height="60" rx="7" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="285" y="68" text-anchor="middle" font-size="13" fill="currentColor" font-weight="700">v2 · geom edit</text>
  <text x="285" y="86" text-anchor="middle" font-size="11" fill="currentColor">visible=true</text>
  <text x="285" y="100" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">2020-07</text>
  <!-- v3 highlighted -->
  <rect x="380" y="42" width="150" height="68" rx="7" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="2.4"/>
  <text x="455" y="66" text-anchor="middle" font-size="13" fill="currentColor" font-weight="700">v3 · tag edit</text>
  <text x="455" y="84" text-anchor="middle" font-size="11" fill="currentColor">visible=true</text>
  <text x="455" y="98" text-anchor="middle" font-size="10.5" fill="currentColor" font-weight="700">live at T</text>
  <!-- v4 deletion -->
  <rect x="550" y="46" width="150" height="60" rx="7" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="625" y="68" text-anchor="middle" font-size="13" fill="currentColor" font-weight="700">v4 · deleted</text>
  <text x="625" y="86" text-anchor="middle" font-size="11" fill="currentColor">visible=false</text>
  <text x="625" y="100" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">2022-08</text>
  <!-- v5 recreate -->
  <rect x="720" y="46" width="150" height="60" rx="7" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="795" y="68" text-anchor="middle" font-size="13" fill="currentColor" font-weight="700">v5 · recreated</text>
  <text x="795" y="86" text-anchor="middle" font-size="11" fill="currentColor">visible=true</text>
  <text x="795" y="100" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">2023-04</text>
  <!-- axis -->
  <line x1="40" y1="250" x2="940" y2="250" stroke="currentColor" stroke-width="1.5" marker-end="url(#fhpbf-arr)"/>
  <text x="936" y="272" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">time →</text>
  <!-- drop lines + ticks -->
  <line x1="115" y1="106" x2="115" y2="250" stroke="currentColor" stroke-width="1" opacity="0.4"/>
  <line x1="285" y1="106" x2="285" y2="250" stroke="currentColor" stroke-width="1" opacity="0.4"/>
  <line x1="455" y1="110" x2="455" y2="250" stroke="var(--osm-ok,#15803d)" stroke-width="1.4"/>
  <line x1="625" y1="106" x2="625" y2="250" stroke="currentColor" stroke-width="1" opacity="0.4"/>
  <line x1="795" y1="106" x2="795" y2="250" stroke="currentColor" stroke-width="1" opacity="0.4"/>
  <!-- snapshot cut -->
  <line x1="510" y1="40" x2="510" y2="266" stroke="var(--osm-ok,#15803d)" stroke-width="2" stroke-dasharray="6 4"/>
  <text x="510" y="300" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="700">snapshot cut at T</text>
  <text x="510" y="318" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">keep newest visible, timestamp ≤ T</text>
  <text x="500" y="332" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.7">→ result: v3 (v4 deletion and v5 recreation are in the future)</text>
</svg>

## Prerequisites: What You Need in Place First

Full-history processing rests on the same primitives as any OSM workflow, seen through a temporal lens. You need a working grasp of the [node, way, and relation data model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/), because in a history file each of those primitives is no longer a single object but a *chain* of versions sharing one id, and a way's geometry can shift under it when its member nodes are edited independently. You need to be able to read a PBF header's required-features list, since that is where a file declares itself historical — the walkthrough in [how to decode OSM PBF headers in Python](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/how-to-decode-osm-pbf-headers-in-python/) shows exactly how to pull the `required_features` array that carries the `HistoricalInformation` flag. Finally, a modern `pyosmium` (osmium ≥ 3.6) and the `osmium` command-line tool (libosmium ≥ 1.14) must both be installed; the CLI path in this guide relies on the `time-filter` subcommand, and the Python path relies on the version-aware object attributes that older bindings did not expose.

## The .osh.pbf Format: Fields and Rules

A full-history file is byte-compatible with an ordinary `.osm.pbf` at the framing level — the same protobuf blob-and-block structure — but it differs in two contractual ways. First, its header's `required_features` list contains the string `HistoricalInformation`, which is a hard signal to any reader that it must expect multiple objects with the same `(type, id)` and must not assume the last one wins. A consumer that ignores this flag and folds the file into a current-state map will overwrite earlier versions with later ones and quietly lose the history it was handed. Second, every object carries its full version metadata, and deletions are represented not by omission but by an explicit tombstone: a version whose `visible` attribute is `false`.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="osh-chain-t osh-chain-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="osh-chain-t">One object identifier and the version chain a history file stores for it</title>
  <desc id="osh-chain-d">A timeline for way 41 883 002. Version one is created in 2013 and visible. Version two in 2017 retags it and is visible. Version three in 2021 changes its geometry and is visible. Version four in 2024 deletes it, carrying visible false and no tags. A snapshot reader must keep only the newest version at or before its cut-off, and must drop the object entirely if that version is invisible.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="osh" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">way 41 883 002 as a history file stores it: four records, one identifier</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">v1 · 2013-04-11</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">created</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">visible=true · 8 tags</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#osh)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">v2 · 2017-09-02</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">retagged</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">visible=true · 11 tags</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#osh)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">v3 · 2021-01-30</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">geometry edited</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">visible=true · 11 tags</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#osh)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">v4 · 2024-06-18</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">deleted</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">visible=false · no tags</text>
  <text x="868" y="158" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Ask for the state on 2019-01-01 and the answer is v2. Ask for today and the answer is that the object does not exist — which only v4 can tell you.</text>
</svg>
<figcaption>A history file is not a bigger snapshot — it is a different shape. Every object appears once per edit, in ascending version order, and the deleted tombstone is a real record you must read rather than an absence you can infer.</figcaption>
</figure>

The per-version metadata block is the whole point of the format. Every node, way, and relation version exposes the following fields.

| Field | Type | Meaning | Notes |
|---|---|---|---|
| `id` | int64 | Stable object identity across all versions | Shared by the entire version chain |
| `version` | int32 | Monotonic edit counter, starting at 1 | `(type, id, version)` is the unique temporal key |
| `visible` | bool | `true` for a live version, `false` for a deletion | Only present when `HistoricalInformation` is set |
| `timestamp` | datetime (UTC) | Instant the version was committed | The ordering axis for any snapshot cut |
| `changeset` | int64 | Changeset that introduced this version | Join key for changeset-level provenance |
| `uid` | int32 | Numeric user id of the editor | Stable even if the display name changes |
| `user` | string | Display name at commit time | May be redacted or absent in some exports |

Three rules follow directly from that table and govern every correct history consumer. Versions of one object are strictly ordered by `version`, and `version` is a better sort key than `timestamp` because two rapid edits can share a second-resolution timestamp while their version numbers never collide. A `visible=false` version terminates the object's life at its timestamp — but not necessarily forever, since a later `visible=true` version can resurrect the same id, exactly as `v5` does in the diagram above. And the value of any snapshot at instant T is, per object, the single highest-`version` record whose `timestamp` is ≤ T; if that record has `visible=false`, the object simply does not exist at T. That last sentence is the entire algorithm — everything else is making it fast and memory-bounded over a planet-sized file.

## Step-by-Step: Streaming Every Version

The processing pattern is a single sequential pass that hands you each version in file order, from which you either accumulate per-object chains or fold directly toward a snapshot. It uses Python 3.10+ type hints and the project's logger convention.

1. **Confirm the file is historical.** Read the header before parsing a byte of payload and assert that it advertises multiple object versions. This is a cheap guard that turns a silent correctness bug — treating a history file as current-state, or vice versa — into a loud failure at startup.
2. **Stream all versions with a handler.** A `SimpleHandler` dispatches its `node`, `way`, and `relation` callbacks once *per version*, in `(type, id, version)` order within each type block. Capture `version`, `visible`, `timestamp`, `changeset`, and `uid` on each call.
3. **Key temporal state on `(type, id, version)`.** Never key on `id` alone; that is the collision that collapses a history back into a snapshot. The composite key is unique across the whole file and lets you index, deduplicate, and diff versions without ambiguity.
4. **Fold toward the target.** For a point-in-time snapshot, retain per `(type, id)` only the newest version with `timestamp ≤ T` and drop the object entirely if that survivor is a deletion — the reduction the child guides implement end to end.

```python
import logging
from datetime import datetime

import osmium

logger = logging.getLogger("osm.history.reader")


def assert_history_file(path: str) -> None:
    """Fail fast unless the PBF header advertises HistoricalInformation."""
    header = osmium.io.Reader(path).header()
    if not header.has_multiple_object_versions():
        raise ValueError(
            f"{path} is not a full-history file; its header does not set "
            "HistoricalInformation. Use a .osh.pbf source."
        )
    logger.info("confirmed full-history input: %s", path)


class VersionCollector(osmium.SimpleHandler):
    """Stream every version of every element, keyed on (type, id, version)."""

    def __init__(self) -> None:
        super().__init__()
        # (type, id, version) -> flat metadata record
        self.versions: dict[tuple[str, int, int], dict[str, object]] = {}

    def _record(self, kind: str, obj: osmium.osm.OSMObject) -> None:
        key = (kind, obj.id, obj.version)
        self.versions[key] = {
            "type": kind,
            "id": obj.id,
            "version": obj.version,
            "visible": obj.visible,
            "timestamp": obj.timestamp,  # tz-aware UTC datetime
            "changeset": obj.changeset,
            "uid": obj.uid,
            "user": obj.user,
        }

    def node(self, n: osmium.osm.Node) -> None:
        self._record("node", n)

    def way(self, w: osmium.osm.Way) -> None:
        self._record("way", w)

    def relation(self, r: osmium.osm.Relation) -> None:
        self._record("relation", r)


def load_versions(path: str) -> dict[tuple[str, int, int], dict[str, object]]:
    assert_history_file(path)
    collector = VersionCollector()
    collector.apply_file(path)  # no locations= needed for metadata-only work
    logger.info("collected %d element versions", len(collector.versions))
    return collector.versions
```

Holding every version in a dictionary is fine for a city or small-region history but will not survive a continental `.osh.pbf`; the accumulation above is the readable form, and the performance section below explains how to keep only what a given output actually needs.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Process an OSM full-history .osh.pbf file",
  "description": "Confirm a PBF is historical, stream every element version with pyosmium keyed on (type, id, version), and fold the version chains toward a point-in-time snapshot.",
  "step": [
    { "@type": "HowToStep", "name": "Confirm the file is historical", "text": "Read the PBF header and assert has_multiple_object_versions is true, so a history file is never silently treated as current state." },
    { "@type": "HowToStep", "name": "Stream every version", "text": "Use a SimpleHandler whose node, way, and relation callbacks fire once per version, capturing version, visible, timestamp, changeset, and uid on each call." },
    { "@type": "HowToStep", "name": "Key on (type, id, version)", "text": "Index temporal state on the composite key rather than id alone so versions never collide and the history does not collapse into a snapshot." },
    { "@type": "HowToStep", "name": "Fold toward the target time", "text": "For a snapshot at T, keep per object the newest version with timestamp at or before T and drop the object if that survivor has visible set to false." },
    { "@type": "HowToStep", "name": "Prefer the CLI for pure snapshots", "text": "For a plain point-in-time extract, run osmium time-filter, which streams the file once and applies the same rule far faster than a Python accumulation." }
  ]
}
</script>

## Validation & Error-Handling Matrix

History processing has its own failure catalogue, distinct from current-state parsing. Each row below is a defect that produces wrong answers rather than a crash, which is what makes them dangerous.

| Error condition | Root cause | Detection | Remediation |
|---|---|---|---|
| History collapses to one version per id | State keyed on `id` instead of `(type, id, version)` | Version count equals distinct-id count | Key every dict and index on the composite triple |
| Deleted objects appear in a snapshot | `visible=false` versions not filtered | Object present at T but its live version is a tombstone | Drop objects whose latest `timestamp ≤ T` version is invisible |
| `has_multiple_object_versions()` is false | A current-state `.osm.pbf` was passed by mistake | Header guard raises at startup | Source a true `.osh.pbf`; do not synthesize history |
| Ties resolved wrongly at same second | Sorting by `timestamp` alone across rapid edits | Two versions share a timestamp | Sort by `version`, using `timestamp` only for the ≤ T cut |
| Way geometry wrong at past date | Reused current node coordinates for an old way | Vertices sit at present-day positions | Resolve node locations at T, not at head |
| `user` is empty but `uid` is set | Display name redacted or stripped in export | Attribution table has blank names | Aggregate on `uid`; treat `user` as a best-effort label |
| Memory climbs to OOM on planet history | Whole version map held in RAM | RSS grows linearly with file size | Stream-and-fold; retain only per-object survivors |

## Performance & Scale Considerations

A full-history planet is several times larger than a current-state planet — tens of billions of object versions — so the accumulate-everything shape shown above is a teaching form, not a production one. The governing discipline is *fold as you stream*: never keep two versions of an object once you know which one you need. For a snapshot at T, that means holding a single dictionary keyed on `(type, id)` and, on each incoming version, overwriting the stored record only when the new version's `timestamp` is ≤ T and its `version` exceeds the stored one. Because a history file emits versions of a given object in ascending `version` order, you can even drop a stored record the instant you see a version past T, which bounds resident memory to roughly the count of objects alive at T rather than the count of all versions ever.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 366" role="img" aria-labelledby="osh-size-t osh-size-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="osh-size-t">How much larger a full-history file is than the equivalent snapshot</title>
  <desc id="osh-size-d">A bar chart comparing snapshot and full-history sizes. The planet snapshot is 80 gigabytes against a full-history planet of 780 gigabytes, roughly ten times. A country snapshot is 1.2 gigabytes against 14 gigabytes of history, about twelve times. A city snapshot is 42 megabytes against 610 megabytes, about fifteen times. Smaller and older-mapped areas have a higher ratio because edit count does not scale with object count.</desc>
  <rect x="0" y="0" width="880" height="366" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">History is roughly an order of magnitude larger — but the ratio varies by area</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">file size, snapshot against full history</text>
  <line x1="250" y1="68" x2="250" y2="312" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">planet snapshot</text>
  <rect x="250" y="74" width="48" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="308" y="89" font-size="11" fill="currentColor" opacity="0.9">80 GB</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">planet full history</text>
  <rect x="250" y="116" width="470" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="730" y="131" font-size="11" fill="currentColor" opacity="0.9">780 GB · 9.8×</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">country snapshot</text>
  <rect x="250" y="158" width="6" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="266" y="173" font-size="11" fill="currentColor" opacity="0.9">1.2 GB</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">country full history</text>
  <rect x="250" y="200" width="8" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="268" y="215" font-size="11" fill="currentColor" opacity="0.9">14 GB · 11.7×</text>
  <text x="240" y="257" text-anchor="end" font-size="11.5" fill="currentColor">city snapshot</text>
  <rect x="250" y="242" width="6" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="266" y="257" font-size="11" fill="currentColor" opacity="0.9">42 MB</text>
  <text x="240" y="299" text-anchor="end" font-size="11.5" fill="currentColor">city full history</text>
  <rect x="250" y="284" width="6" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="266" y="299" font-size="11" fill="currentColor" opacity="0.9">610 MB · 14.5×</text>
  <text x="868" y="348" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Plan disk from the history size and streaming from the version count — a city file with fifteen versions per object is CPU-bound long before it is disk-bound.</text>
</svg>
<figcaption>The multiplier is not constant: a densely edited European city carries far more versions per object than a recently mapped rural region, so sizing from the planet ratio under-provisions exactly the extracts you are most likely to process.</figcaption>
</figure>

Two levers dominate throughput. First, choose the CLI when the CLI suffices: `osmium time-filter` is a compiled single-pass streamer and will out-run any Python accumulation for a straight point-in-time cut, so reserve the pyosmium path for analyses that genuinely need per-version logic, such as provenance or version-to-version diffing. Second, restrict the object types you dispatch on — if you only need node history, omit the `way` and `relation` callbacks so libosmium can skip decoding those blocks. For very large jobs, the same block-independence that makes current-state PBF parallelizable applies here, but partition on object-id ranges rather than geography, because a way's history and its nodes' histories must land on the same worker to reconstruct geometry.

## Failure Modes & Gotchas

- **Resurrection is legal.** An id can be deleted and later recreated with a higher version, as `v5` shows. Any code that stops processing an object at its first `visible=false` will miss the resurrection and report the object as permanently gone.
- **Timestamp resolution is one second.** Two edits inside the same second share a timestamp. `version` is the tie-breaker; treat `timestamp` as a coarse filter and `version` as the authoritative order.
- **Geometry drifts under a stable id.** A way keeps its id across versions, but its member node references — and those nodes' own coordinates — change independently. Reconstructing a way at T requires the node versions live at T, not the way's own version alone.
- **Redaction leaves holes.** Post-license-change redactions and account deletions can strip `user` or blank a version's payload. Aggregate contributor analytics on the numeric `uid`, which is stable, not on the display name.
- **The header flag is a contract, not a hint.** Passing a current-state file to history logic (or the reverse) is a silent data error. The `has_multiple_object_versions()` guard is cheap; run it every time.

## Integration Points: Feeding the Next Stage

A history reader rarely stands alone — its output feeds either a point-in-time export or an audit table. The wiring below folds a stream directly into a snapshot dictionary, the exact reduction the reconstruction guide expands on, and keeps memory proportional to the live object count rather than the version count:

```python
import logging
from datetime import datetime

import osmium

logger = logging.getLogger("osm.history.snapshot")


class SnapshotFolder(osmium.SimpleHandler):
    """Fold a history stream to the live state at instant T."""

    def __init__(self, cutoff: datetime) -> None:
        super().__init__()
        self.cutoff = cutoff
        # (type, id) -> (version, visible) of the newest version <= cutoff
        self._latest: dict[tuple[str, int], tuple[int, bool]] = {}

    def _fold(self, kind: str, obj: osmium.osm.OSMObject) -> None:
        if obj.timestamp > self.cutoff:
            return  # future edit; irrelevant to this snapshot
        key = (kind, obj.id)
        prev = self._latest.get(key)
        if prev is None or obj.version > prev[0]:
            self._latest[key] = (obj.version, obj.visible)

    def node(self, n: osmium.osm.Node) -> None:
        self._fold("node", n)

    def live_ids(self) -> set[tuple[str, int]]:
        """Objects that exist at the cutoff (latest visible version wins)."""
        return {k for k, (_, visible) in self._latest.items() if visible}
```

Downstream, that snapshot flows into whatever the current-state stages expect — spatial indexing, tag normalization, or a PostGIS load — while the sibling workflow in [applying .osc change files with osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/) covers the inverse motion of pushing a current extract *forward* through diffs rather than rewinding a history file backward.

## Explore Full-History Processing in Depth

This section anchors two focused guides that take the format above into concrete tasks:

- [Reconstructing OSM Features at a Past Date](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/reconstructing-osm-features-at-a-past-date/) — materialize the map exactly as it stood at a chosen timestamp, with both the `osmium time-filter` one-liner and a pyosmium fold that keeps the latest visible version at or before T.
- [Extracting Changeset Metadata from History Files](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/extracting-changeset-metadata-from-history-files/) — pull per-version provenance (changeset id, uid, user, timestamp) into a table for auditing and contributor analysis, with the metadata-availability caveats spelled out.

## Frequently Asked Questions

<details>
<summary>What does the HistoricalInformation flag actually do?</summary>

It is a string in the PBF header's required_features list that declares the file may contain multiple versions of the same object and may contain deletions marked with visible=false. A conforming reader must expect repeated (type, id) pairs and must not assume the last one wins. Checking it via has_multiple_object_versions() lets your pipeline refuse a current-state file before it silently produces wrong results.
</details>

<details>
<summary>Why key on (type, id, version) instead of just id?</summary>

Because id is shared by every version of an object, keying on id alone overwrites earlier versions with later ones and collapses the history back into a single-version snapshot. The triple of type, id, and version is unique across the entire file, so it lets you store, deduplicate, and diff versions without losing any of them. Type is part of the key because a node, a way, and a relation can all carry the same numeric id.
</details>

<details>
<summary>How are deletions represented in a full-history file?</summary>

A deletion is an explicit version whose visible attribute is false, not a missing record. That tombstone terminates the object's life at its timestamp, but a later version with visible=true can recreate the same id. To decide whether an object exists at time T, take its newest version with a timestamp at or before T and check that version's visible flag.
</details>

<details>
<summary>Should I use osmium time-filter or pyosmium?</summary>

Use osmium time-filter for a plain point-in-time snapshot: it is a compiled single-pass tool and is much faster than a Python accumulation. Reach for pyosmium when you need per-version logic that the CLI cannot express, such as extracting changeset provenance, diffing consecutive versions, or applying custom rules while folding. Many pipelines use both — the CLI to cut a snapshot and pyosmium to analyze the versions around it.
</details>

<details>
<summary>Why is version a better sort key than timestamp?</summary>

Timestamps have one-second resolution, so two edits committed in the same second share a timestamp and cannot be ordered by it. The version counter is strictly monotonic per object and never ties, so it is the authoritative ordering. Use timestamp only for the coarse "is this version at or before T" filter, then break any ties by version.
</details>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What does the HistoricalInformation flag actually do?",
      "acceptedAnswer": { "@type": "Answer", "text": "It is a string in the PBF header's required_features list that declares the file may contain multiple versions of the same object and deletions marked with visible=false. A conforming reader must expect repeated type and id pairs and must not assume the last one wins. Checking it via has_multiple_object_versions lets your pipeline refuse a current-state file before it silently produces wrong results." }
    },
    {
      "@type": "Question",
      "name": "Why key on (type, id, version) instead of just id?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because id is shared by every version of an object, keying on id alone overwrites earlier versions with later ones and collapses the history back into a single-version snapshot. The triple of type, id, and version is unique across the entire file, so it lets you store, deduplicate, and diff versions without losing any of them. Type is part of the key because a node, a way, and a relation can all carry the same numeric id." }
    },
    {
      "@type": "Question",
      "name": "How are deletions represented in a full-history file?",
      "acceptedAnswer": { "@type": "Answer", "text": "A deletion is an explicit version whose visible attribute is false, not a missing record. That tombstone terminates the object's life at its timestamp, but a later version with visible=true can recreate the same id. To decide whether an object exists at time T, take its newest version with a timestamp at or before T and check that version's visible flag." }
    },
    {
      "@type": "Question",
      "name": "Should I use osmium time-filter or pyosmium?",
      "acceptedAnswer": { "@type": "Answer", "text": "Use osmium time-filter for a plain point-in-time snapshot: it is a compiled single-pass tool and is much faster than a Python accumulation. Reach for pyosmium when you need per-version logic the CLI cannot express, such as extracting changeset provenance, diffing consecutive versions, or applying custom rules while folding. Many pipelines use both." }
    },
    {
      "@type": "Question",
      "name": "Why is version a better sort key than timestamp?",
      "acceptedAnswer": { "@type": "Answer", "text": "Timestamps have one-second resolution, so two edits committed in the same second share a timestamp and cannot be ordered by it. The version counter is strictly monotonic per object and never ties, so it is the authoritative ordering. Use timestamp only for the coarse filter of whether a version is at or before T, then break any ties by version." }
    }
  ]
}
</script>

## Related

- [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/) — the parent section covering diffs, sequence numbers, and keeping an extract current.
- [Applying .osc Change Files with osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/) — the forward-in-time counterpart that advances a current extract through change files.
- [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — the primitives that become version chains in a history file.
- [How to Decode OSM PBF Headers in Python](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/how-to-decode-osm-pbf-headers-in-python/) — reading the required_features list that carries the HistoricalInformation flag.
- [Reconstructing OSM Features at a Past Date](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/reconstructing-osm-features-at-a-past-date/) — the snapshot-at-T procedure in full.
- [Extracting Changeset Metadata from History Files](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/extracting-changeset-metadata-from-history-files/) — per-version provenance for auditing and attribution.

This guide is part of the [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/) section — return there for the full path from raw diffs to a continuously updated OSM database.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Full-History .osh.pbf Processing",
  "description": "Process OpenStreetMap full-history .osh.pbf files: the HistoricalInformation flag, multiple versions per element, the visible deletion marker, and streaming every version with pyosmium keyed on (type, id, version).",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "OSM Replication & Diff Sync",
  "about": ["OSM full-history format", "pyosmium version streaming", "point-in-time snapshot reconstruction"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Replication & Diff Sync", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/" },
    { "@type": "ListItem", "position": 3, "name": "Full-History Processing", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/" }
  ]
}
</script>
