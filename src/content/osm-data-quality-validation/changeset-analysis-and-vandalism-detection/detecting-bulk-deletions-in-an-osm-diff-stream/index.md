---
title: "Detecting Bulk Deletions in an OSM Diff Stream"
description: "Catch changesets removing thousands of objects across the many diffs they span: a sliding window keyed by changeset, paired absolute and share thresholds, and bounded eviction."
pageTitle: "Detect Bulk Deletions in an OSM Diff Stream"
pageDescription: "A streaming bulk-deletion detector for OSM diffs — per-changeset accumulation, absolute and share thresholds together, sampled ids, and eviction that keeps memory bounded."
slug: "detecting-bulk-deletions-in-an-osm-diff-stream"
type: "article"
breadcrumb: "Detecting Bulk Deletions"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Detecting Bulk Deletions in an OSM Diff Stream

Catch the single highest-value signal in changeset analysis on its own: a changeset removing thousands of objects, detected across the many diffs it spans.

## Prerequisites

- [ ] A minutely or hourly diff stream, as in [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/)
- [ ] Python 3.10+ with `osmium` (pyosmium 3.6+)
- [ ] Somewhere to hold a sliding window — memory is fine for a country stream
- [ ] A destination for detections: a queue, a chat channel, a ticket

## Conceptual minimum

Deletion is the one OSM operation that is inherently destructive and inherently rare. Ordinary mapping adds and corrects; a changeset dominated by deletions is doing something unusual by construction, which is why it outperforms every other single signal in [Changeset Analysis & Vandalism Detection](https://www.osm-data-processing.org/osm-data-quality-validation/changeset-analysis-and-vandalism-detection/).

Unusual is not the same as malicious.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 251" role="img" aria-labelledby="del-kinds-t del-kinds-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="del-kinds-t">Three kinds of mass deletion and how each appears in the diff stream</title>
  <desc id="del-kinds-d">Three panels. A redaction or licence removal shows thousands of deletes from one account, often a documented campaign, geographically clustered by source, legitimate and expected. An accidental bulk delete makes a whole layer disappear in one editor session, often followed by a self-revert, within a tight time window and one area. A deliberate mass removal spreads deletes across regions over unrelated objects, frequently from a young account, with no comment or a misleading one.</desc>
  <rect x="0" y="0" width="880" height="251" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three shapes of mass deletion, and how each reads in a diff</text>
  <rect x="26" y="52" width="258" height="157" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Redaction / licence removal</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Thousands of deletes, one account</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Often a documented campaign</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Geographically clustered by source</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Legitimate and expected</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Recognise it, do not flag it</text>
  <rect x="310" y="52" width="258" height="157" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="439" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Accidental bulk delete</text>
  <text x="324" y="104" font-size="10.5" fill="currentColor" opacity="0.92">A whole layer disappears</text>
  <text x="324" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Usually one editor session</text>
  <text x="324" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Often followed by a self-revert</text>
  <text x="324" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Tight time window, one area</text>
  <text x="324" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Worth a quick word, not an alarm</text>
  <rect x="594" y="52" width="258" height="157" rx="8" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.5"/>
  <text x="723" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Deliberate mass removal</text>
  <text x="608" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Deletes spread across regions</text>
  <text x="608" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Objects unrelated to each other</text>
  <text x="608" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Frequently a young account</text>
  <text x="608" y="167" font-size="10.5" fill="currentColor" opacity="0.92">No comment, or a misleading one</text>
  <text x="608" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Surface immediately</text>
  <text x="440" y="235" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">The deletion count alone cannot separate these. Spread, account age and the comment are what turn a count into a judgement.</text>
</svg>
<figcaption>A deletion count is the trigger. Spread, account age and the comment are what decide which of the three you are looking at.</figcaption>
</figure>

Two mechanical points shape the implementation. First, a deletion in an OsmChange document is an element with `visible="false"` carrying only its stub — no tags, no geometry, no member list. If you want to know *what* disappeared, you must look it up in your own copy before applying the diff, which the semantics in [Applying .osc Change Files with osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/) make unavoidable.

Second, a large changeset is spread across many diffs.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="del-window-t del-window-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="del-window-t">Why bulk deletion detection needs a sliding window</title>
  <desc id="del-window-d">A four-stage chain. Each diff is scanned once to count deletions per changeset, taking microseconds. A window store holds the last sixty minutes keyed by changeset and is bounded by flushing. A threshold applies both an absolute count and a share, never one alone. Detection is emitted once per changeset rather than once per diff.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="dw" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">A sliding window, because a mass deletion is not one diff</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">each diff</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">count deletes per changeset</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">one pass, microseconds</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#dw)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">window store</text>
  <text x="331" y="107" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.85">last 60 minutes, per changeset</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">bounded by flush</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#dw)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">threshold</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">absolute AND share</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">both, never either</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#dw)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">emit once</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">dedupe on changeset id</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">not once per diff</text>
  <text x="440" y="158" text-anchor="middle" font-size="10.0" fill="currentColor" opacity="0.85">A changeset deleting forty thousand objects arrives spread over dozens of minutely diffs. Evaluating each diff alone sees forty innocuous ones.</text>
</svg>
<figcaption>The unit of a mass deletion is the changeset, and a changeset is spread across many diffs. Per-diff evaluation sees only fragments.</figcaption>
</figure>

## Runnable solution

```python
#!/usr/bin/env python3
"""Detect bulk deletions across a sliding window of OSM diffs."""
from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import osmium

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

ABSOLUTE_THRESHOLD = 1_000     # deletions in the window
SHARE_THRESHOLD = 0.40         # deletions as a fraction of the changeset's operations
MIN_OPERATIONS = 50            # below this, a share is noise
WINDOW = timedelta(hours=1)    # how long a changeset stays open in the accumulator


@dataclass
class Window:
    """Per-changeset accumulator, flushed once the changeset goes quiet."""
    changeset: int
    user: str = ""
    deleted_nodes: int = 0
    deleted_ways: int = 0
    deleted_relations: int = 0
    other_ops: int = 0
    deleted_ids: list[tuple[str, int]] = field(default_factory=list)
    last_seen: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def deletions(self) -> int:
        return self.deleted_nodes + self.deleted_ways + self.deleted_relations

    @property
    def operations(self) -> int:
        return self.deletions + self.other_ops

    @property
    def share(self) -> float:
        return self.deletions / self.operations if self.operations else 0.0


class DeletionWatcher(osmium.SimpleHandler):
    """Accumulate deletions per changeset across successive diffs."""

    #: keep this many ids per changeset for the report — enough to investigate,
    #: bounded so a 400 000-object redaction does not become a 400 000-entry list
    SAMPLE_IDS = 20

    def __init__(self) -> None:
        super().__init__()
        self.windows: dict[int, Window] = {}
        self.reported: set[int] = set()

    def _record(self, obj, kind: str) -> None:
        w = self.windows.get(obj.changeset)
        if w is None:
            w = self.windows[obj.changeset] = Window(changeset=obj.changeset)
        w.user = obj.user or w.user
        w.last_seen = datetime.now(timezone.utc)
        if obj.visible:
            w.other_ops += 1
            return
        setattr(w, f"deleted_{kind}", getattr(w, f"deleted_{kind}") + 1)
        if len(w.deleted_ids) < self.SAMPLE_IDS:
            w.deleted_ids.append((kind[0], obj.id))

    def node(self, n) -> None:
        self._record(n, "nodes")

    def way(self, w) -> None:
        self._record(w, "ways")

    def relation(self, r) -> None:
        self._record(r, "relations")

    def detections(self) -> list[Window]:
        """Changesets that have crossed the threshold and not yet been reported."""
        out: list[Window] = []
        for cs_id, w in self.windows.items():
            if cs_id in self.reported:
                continue
            big = w.deletions >= ABSOLUTE_THRESHOLD
            skewed = w.operations >= MIN_OPERATIONS and w.share >= SHARE_THRESHOLD
            if big and skewed:
                out.append(w)
                self.reported.add(cs_id)
        return out

    def evict(self, now: datetime | None = None) -> int:
        """Drop changesets that have gone quiet, so the accumulator stays bounded."""
        now = now or datetime.now(timezone.utc)
        stale = [cid for cid, w in self.windows.items() if now - w.last_seen > WINDOW]
        for cid in stale:
            del self.windows[cid]
        self.reported -= set(stale)
        return len(stale)


def scan(diff_paths: list[str]) -> list[Window]:
    watcher = DeletionWatcher()
    found: list[Window] = []
    for path in diff_paths:
        watcher.apply_file(path)
        for w in watcher.detections():
            logger.warning(
                "bulk deletion: changeset %d by %s — %d deletions (%.0f%% of %d ops); sample %s",
                w.changeset, w.user, w.deletions, w.share * 100, w.operations,
                w.deleted_ids[:5],
            )
            found.append(w)
        evicted = watcher.evict()
        if evicted:
            logger.debug("evicted %d quiet changeset(s)", evicted)
    return found
```

## Step-by-step walkthrough

`_record` keys everything on `obj.changeset` rather than on the file being read. That is what makes the window work: a changeset appearing in forty consecutive diffs accumulates into one `Window`, and the threshold is evaluated against the total.

Deletion is detected with `obj.visible` rather than by looking at which OsmChange block the object came from. pyosmium presents a deleted object as invisible, and the block structure is not exposed — which is fortunate, because it is also the semantically correct test.

`deleted_ids` is capped at twenty. A reviewer needs a handful of identifiers to look at, and a redaction touching four hundred thousand objects should not turn into a four-hundred-thousand-entry list held in memory and written to a queue.

`detections` requires **both** conditions. An absolute count alone flags every large import; a share alone flags a five-object changeset that deleted three. Requiring both is what produces the twenty-odd items a month the distribution predicts.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="del-dist-t del-dist-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="del-dist-t">Distribution of changesets by deletion count over one month</title>
  <desc id="del-dist-d">A bar chart of one month of a country stream. 46 200 changesets delete between one and nine objects, ordinary corrective mapping. 3 100 delete between ten and ninety-nine, retagging and small cleanups. 214 delete between one hundred and 999, imports and area cleanups. 18 delete between one thousand and 9 999 and all are worth a look. Three delete ten thousand or more: two redactions and one accident.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Where the threshold has to sit</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">one month of a country stream: changesets by deletion count</text>
  <line x1="250" y1="68" x2="250" y2="270" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">1–9 deletes</text>
  <rect x="250" y="74" width="470" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="868" y="89" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">46 200 · ordinary corrective mapping</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">10–99</text>
  <rect x="250" y="116" width="32" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="292" y="131" font-size="11" fill="currentColor" opacity="0.9">3 100 · retagging, small cleanups</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">100–999</text>
  <rect x="250" y="158" width="6" height="21" rx="3" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="266" y="173" font-size="11" fill="currentColor" opacity="0.9">214 · imports, area cleanups</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">1 000–9 999</text>
  <rect x="250" y="200" width="6" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="266" y="215" font-size="11" fill="currentColor" opacity="0.9">18 · all worth a look</text>
  <text x="240" y="257" text-anchor="end" font-size="11.5" fill="currentColor">10 000+</text>
  <rect x="250" y="242" width="6" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="266" y="257" font-size="11" fill="currentColor" opacity="0.9">3 · two redactions, one accident</text>
  <text x="440" y="306" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">A threshold at a thousand deletions produces twenty-one items a month on a country stream — a queue a person can actually read.</text>
</svg>
<figcaption>Deletions are Zipfian like everything else in OSM. That is what makes an absolute threshold workable — the interesting band is tiny.</figcaption>
</figure>

`evict` is what keeps this a streaming job rather than a slowly growing memory leak. Changesets stay open in OSM for up to a day, but one that has not been seen for an hour is almost certainly finished; the trade is that a very slow changeset gets reported twice, which the `reported` set makes harmless within a window.

## Verification

Build a fixture from a real diff rather than a synthetic one, because the interesting property is how deletions distribute across files:

```bash
# Grab an hour of minutely diffs and count deletions per changeset by hand.
for seq in $(seq 6123400 6123459); do
  p=$(printf "%09d" $seq | sed 's|\(...\)\(...\)\(...\)|\1/\2/\3|')
  curl -sO "https://planet.osm.org/replication/minute/${p}.osc.gz"
done
zcat *.osc.gz | grep -oP '(?<=<delete>)' | wc -l
```

Then assert the two threshold conditions independently:

```python
def test_large_import_is_not_flagged():
    w = Window(changeset=1, deleted_nodes=1_200, other_ops=95_000)
    assert w.deletions >= ABSOLUTE_THRESHOLD          # absolute passes
    assert w.share < SHARE_THRESHOLD                  # share does not
    # therefore not a detection

def test_small_deletion_burst_is_not_flagged():
    w = Window(changeset=2, deleted_ways=40, other_ops=2)
    assert w.share > SHARE_THRESHOLD
    assert w.deletions < ABSOLUTE_THRESHOLD

def test_mass_removal_is_flagged():
    w = Window(changeset=3, deleted_ways=8_000, other_ops=120)
    assert w.deletions >= ABSOLUTE_THRESHOLD and w.share >= SHARE_THRESHOLD
```

Run the scanner over a week of archived diffs and count detections. On a country stream, more than about ten a week means the thresholds are too low for your area.

## Common errors and fixes

| Symptom | Root cause | Fix |
|---|---|---|
| Nothing is ever detected | Threshold evaluated per diff | Accumulate per changeset across diffs |
| Every import is flagged | Absolute threshold only | Require the share condition too |
| Memory grows over days | Window never evicted | Evict changesets quiet for an hour |
| The same changeset reported forty times | No dedupe | Track reported changeset ids |
| Deletion count always zero | Checked the block type, not `visible` | Test `obj.visible` |
| Report has no useful detail | Only counts kept | Keep a bounded sample of deleted ids |

## Frequently Asked Questions

<details>
<summary>Should this alert, or feed a queue?</summary>

Alert, but to a channel rather than a pager. Bulk deletion is time-sensitive in a way most quality signals are not — if it turns out to be vandalism, the sooner someone in the local community knows, the less rebuilding there is. Twenty items a month on a country stream is a rate a chat channel absorbs comfortably.
</details>

<details>
<summary>How do I tell a redaction from vandalism?</summary>

The changeset comment, the account, and the spread. Redactions and licence removals are announced, run from recognisable accounts, and cluster by data source rather than by geography. Fetch the comment as described in [Fetching OSM Changeset Metadata from the API](https://www.osm-data-processing.org/osm-data-quality-validation/changeset-analysis-and-vandalism-detection/fetching-osm-changeset-metadata-from-the-api/) and put it in the report — it usually answers the question outright.
</details>

<details>
<summary>Can I recover what was deleted?</summary>

Not from the diff, which carries only stubs. From your own database before the diff is applied, yes — which is the argument for running this detector *ahead* of the apply step rather than after it. From upstream, a full-history file holds every version including the last one before deletion, at the cost of processing a much larger file.
</details>

<details>
<summary>What about deletions spread over many small changesets?</summary>

This detector will not see them, by design — each changeset is below both thresholds. Catching that pattern means grouping by user over a longer window instead of by changeset, which is a different and noisier detector. It is worth building only if you have seen the pattern; most mass removals are one changeset because that is how editors work.
</details>

## Reporting a detection usefully

The report a reviewer receives decides whether the detection leads anywhere. Four fields make it actionable: the changeset identifier as a link to the OSM website, the deletion count and share, the geographic extent as a bounding box or a place name, and a handful of deleted object identifiers to spot-check. That is enough for someone to open the changeset, look at what went, and decide within a minute.

What to leave out is equally worth deciding. A full list of deleted identifiers is unusable at scale and expensive to carry; the raw diff excerpt is not readable; and a computed suspicion score adds nothing when the deletion count is already the reason the item is in front of them.

Where the pipeline runs ahead of the apply step, add one more field that nothing else can supply: a short summary of what the deleted objects *were*, taken from your own copy before it is updated. "3 400 buildings in one district" is a different report from "3 400 nodes with no tags", and only a detector positioned before the apply can tell the difference.

## Specification reference

> In an OsmChange document a `<delete>` block contains element stubs carrying `id`, `version`, `changeset`, `timestamp` and `visible="false"`, with no tags, geometry or members. pyosmium exposes these through the normal handler callbacks with `obj.visible` false; the originating block is not surfaced.

## Related

- [Changeset Analysis & Vandalism Detection](https://www.osm-data-processing.org/osm-data-quality-validation/changeset-analysis-and-vandalism-detection/) — the topic this detector belongs to.
- [Scoring OSM Changesets for Suspicious Edits](https://www.osm-data-processing.org/osm-data-quality-validation/changeset-analysis-and-vandalism-detection/scoring-osm-changesets-for-suspicious-edits/) — the full scorer this signal dominates.
- [Fetching OSM Changeset Metadata from the API](https://www.osm-data-processing.org/osm-data-quality-validation/changeset-analysis-and-vandalism-detection/fetching-osm-changeset-metadata-from-the-api/) — the comment that usually explains a detection.
- [Applying .osc Change Files with osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/) — why a delete block carries no payload.
- [Full-History .osh.pbf Processing](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/) — recovering what a deletion removed.

Up one level: [Changeset Analysis & Vandalism Detection](https://www.osm-data-processing.org/osm-data-quality-validation/changeset-analysis-and-vandalism-detection/).
