---
title: "Changeset Analysis & Vandalism Detection"
description: "Score OpenStreetMap changesets for suspicious edits from the diff stream: which signals matter, how to combine them into an explainable score, and why the output must be a review queue rather than an automated revert."
pageTitle: "OSM Changeset Analysis and Vandalism Detection"
pageDescription: "Build a changeset-scoring pipeline over the OSM diff stream — size, deletion share, spread, account age and tag churn — with thresholds tuned to a review queue a human will actually work."
slug: changeset-analysis-and-vandalism-detection
type: guide
breadcrumb: "Changeset Analysis & Vandalism"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Changeset Analysis & Vandalism Detection

The validation work covered elsewhere in [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/) asks whether an object is well-formed. This topic asks a different question: whether an *edit* looks like one a careful mapper would make. The two are independent. A changeset that deletes four thousand buildings across three countries produces perfectly valid geometry and perfectly consistent tags, and every rule engine on this site will pass it without comment.

Detecting that class of problem means looking at the diff stream rather than at the data, and treating the changeset — not the object — as the unit of analysis. It also means being clear-eyed about what the pipeline is for. Most edits that trip these signals are not vandalism; they are imports, mechanical edits, licence-driven removals and bulk retagging, all legitimate and all indistinguishable from malice by any arithmetic. The output of this pipeline is a ranked queue for a person to look at, and building it any other way produces a system that reverts good work.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="vand-flow-t vand-flow-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="vand-flow-t">From the diff stream to a ranked review queue</title>
  <desc id="vand-flow-d">A four-stage chain. The diff stream delivers edits as .osc.gz files each minute. A feature stage computes per-changeset size, geographic spread and account age using arithmetic only. A scoring stage combines them into a weighted, explainable score rather than a single opaque number. The result is a triage queue ranked for a human, with nothing automatically reverted.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="cvd" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Signals are cheap; the judgement is not</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">diff stream</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">the edits, as they land</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">osc.gz per minute</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#cvd)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">per-changeset features</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">size · spread · account age</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">arithmetic only</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#cvd)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">score</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">weighted, explainable</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">never a single opaque number</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#cvd)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">triage queue</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">ranked for a human</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">nothing auto-reverted</text>
  <text x="440" y="158" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">The output of this pipeline is a ranked queue, not a verdict. Automated reverting of OSM edits is a community decision, not a pipeline one.</text>
</svg>
<figcaption>Every stage before the last is mechanical. The last is deliberately not: the pipeline ranks, and a person decides.</figcaption>
</figure>

## Prerequisite concepts

This topic sits on the replication machinery. The edits arrive as OsmChange documents from the stream described in [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/), and the per-object metadata each operation carries — changeset identifier, user, version, timestamp — is what makes changeset-level grouping possible at all. The fields the diff does *not* carry, notably the changeset comment and the editor string, come from the changeset API, a split covered in [Extracting Changeset Metadata from History Files](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/extracting-changeset-metadata-from-history-files/).

## The signals worth computing

<figure class="diagram-wrap">
<svg viewBox="0 0 880 358" role="img" aria-labelledby="vand-signals-t vand-signals-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="vand-signals-t">Six changeset signals and the bands that separate routine from suspicious</title>
  <desc id="vand-signals-d">A grid of six signals with three bands each. Objects touched: one to two hundred is routine, two hundred to five thousand is worth a look, above five thousand is high suspicion. Deletions as a share of the changeset: under five percent routine, five to forty percent worth a look, above forty percent suspicious. Geographic spread: one town routine, one country worth a look, multiple continents suspicious. Account age at the time of the edit: over a year routine, one to thirty days worth a look, under a day suspicious. Editor used: JOSM or iD routine, an unknown string or none declared worth a look. Tag churn on a single object: one to two versions routine, three to ten worth a look, more than ten in an hour suspicious.</desc>
  <rect x="0" y="0" width="880" height="358" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">The same signal means different things at different scales</text>
  <text x="317" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">likely routine</text>
  <text x="531" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">worth a look</text>
  <text x="745" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">high suspicion</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">objects touched</text>
  <rect x="213" y="84" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="317" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">1–200</text>
  <rect x="427" y="84" width="208" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="531" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">200–5 000</text>
  <rect x="641" y="84" width="208" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="745" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">over 5 000</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">deletions as a share</text>
  <rect x="213" y="124" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="317" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">under 5%</text>
  <rect x="427" y="124" width="208" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="531" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">5–40%</text>
  <rect x="641" y="124" width="208" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="745" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">over 40%</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">geographic spread</text>
  <rect x="213" y="164" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="317" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">one town</text>
  <rect x="427" y="164" width="208" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="531" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">one country</text>
  <rect x="641" y="164" width="208" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="745" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">multiple continents</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">account age at edit</text>
  <rect x="213" y="204" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="317" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">over 1 year</text>
  <rect x="427" y="204" width="208" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="531" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">1–30 days</text>
  <rect x="641" y="204" width="208" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="745" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">under 1 day</text>
  <text x="198" y="264" text-anchor="end" font-size="11.5" fill="currentColor">editor used</text>
  <rect x="213" y="244" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="317" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">JOSM, iD</text>
  <rect x="427" y="244" width="208" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="531" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">an unknown string</text>
  <rect x="641" y="244" width="208" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="745" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">none declared</text>
  <text x="198" y="304" text-anchor="end" font-size="11.5" fill="currentColor">tag churn on one object</text>
  <rect x="213" y="284" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="317" y="304" text-anchor="middle" font-size="10.5" fill="currentColor">1–2 versions</text>
  <rect x="427" y="284" width="208" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="531" y="304" text-anchor="middle" font-size="10.5" fill="currentColor">3–10</text>
  <rect x="641" y="284" width="208" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="745" y="304" text-anchor="middle" font-size="10.5" fill="currentColor">over 10 in an hour</text>
  <text x="440" y="340" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.85">No single row is evidence. A large, wide, deletion-heavy changeset from a day-old account is — and that conjunction is what a score exists to express.</text>
</svg>
<figcaption>Large imports trip four of these six rows and are entirely legitimate. That is exactly why the output is a queue rather than a revert.</figcaption>
</figure>

Six signals do most of the work, and all six are arithmetic over a grouped diff.

**Size** — the count of objects touched. Cheap, and by itself almost meaningless: routine imports are enormous and a malicious edit can be three objects.

**Deletion share** — the proportion of operations that are deletions. This is the strongest single signal, because ordinary mapping is overwhelmingly additive and corrective. A changeset that is eighty percent deletions is doing something unusual whether or not it is malicious.

**Geographic spread** — the diagonal of the changeset bounding box, or better, the number of distinct H3 cells touched at a coarse resolution, using the cell scheme from [Spatial Index Selection](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/). A human editing in one session works in one place; an edit spanning continents is either a bot or a script.

**Account age at edit time** — the interval between account creation and the changeset. New accounts making large edits are worth attention, and this signal is also the one most likely to be unfair: new mappers exist and are welcome. Weight it low.

**Editor string** — `created_by` on the changeset. Absent or unrecognised values correlate with scripted edits. This is a weak signal and a noisy one; treat it as a tiebreaker.

**Tag churn** — the number of versions an object accumulates within a short window. Repeated rewriting of the same object is characteristic of an edit war rather than of vandalism, and it is worth surfacing separately because the response is different.

## Computing them from a diff

```python
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime

import h3
import osmium

logger = logging.getLogger(__name__)


@dataclass
class ChangesetStats:
    """Everything the score needs, accumulated in one pass over the diff."""
    changeset: int
    user: str = ""
    created: int = 0
    modified: int = 0
    deleted: int = 0
    cells: set[str] = field(default_factory=set)
    first_seen: datetime | None = None
    last_seen: datetime | None = None

    @property
    def touched(self) -> int:
        return self.created + self.modified + self.deleted

    @property
    def deletion_share(self) -> float:
        return self.deleted / self.touched if self.touched else 0.0


class ChangesetCollector(osmium.SimpleHandler):
    """Group an OsmChange stream by changeset, accumulating scoring features."""

    def __init__(self, cell_resolution: int = 3) -> None:
        super().__init__()
        self.resolution = cell_resolution
        self.stats: dict[int, ChangesetStats] = defaultdict(
            lambda: ChangesetStats(changeset=0)
        )

    def _record(self, obj, lat: float | None = None, lon: float | None = None) -> None:
        st = self.stats[obj.changeset]
        st.changeset = obj.changeset
        st.user = obj.user or st.user
        if not obj.visible:
            st.deleted += 1
        elif obj.version == 1:
            st.created += 1
        else:
            st.modified += 1
        if lat is not None and lon is not None:
            st.cells.add(h3.latlng_to_cell(lat, lon, self.resolution))
        ts = obj.timestamp
        st.first_seen = min(st.first_seen or ts, ts)
        st.last_seen = max(st.last_seen or ts, ts)

    def node(self, n) -> None:
        loc = n.location if n.visible and n.location.valid() else None
        self._record(n, loc.lat if loc else None, loc.lon if loc else None)

    def way(self, w) -> None:
        self._record(w)

    def relation(self, r) -> None:
        self._record(r)
```

Two details are load-bearing. Deletions are identified by `visible` being false rather than by the operation block, because a `<delete>` block carries only the stub — the semantics set out in [Applying .osc Change Files with osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/). And spread is measured in coarse H3 cells rather than as a bounding-box diagonal, because a bounding box around two edits on opposite sides of a country reports a huge area for two objects, whereas a cell count reports two.

## Scoring, and why it must be explainable

```python
WEIGHTS = {
    "large": 2.0,          # over 5 000 objects
    "deletion_heavy": 3.0,  # over 40% deletions
    "wide": 2.0,           # more than 12 coarse cells
    "very_new_account": 1.5,
    "unknown_editor": 0.5,
}

def score(st: ChangesetStats, account_age_days: float, editor: str | None) -> tuple[float, list[str]]:
    """Return a score and the list of reasons that produced it."""
    reasons: list[str] = []
    total = 0.0
    if st.touched > 5_000:
        reasons.append(f"large: {st.touched} objects"); total += WEIGHTS["large"]
    if st.deletion_share > 0.40:
        reasons.append(f"deletion-heavy: {st.deletion_share:.0%}"); total += WEIGHTS["deletion_heavy"]
    if len(st.cells) > 12:
        reasons.append(f"wide: {len(st.cells)} cells"); total += WEIGHTS["wide"]
    if account_age_days < 1:
        reasons.append("account under a day old"); total += WEIGHTS["very_new_account"]
    if not editor:
        reasons.append("no editor declared"); total += WEIGHTS["unknown_editor"]
    return total, reasons
```

Returning the reasons alongside the number is not a nicety. A reviewer opening a queue item needs to know in one second why it is there, and a score with no explanation gets treated as noise. It is also the only way to tune: when the queue fills with false positives, the reason list tells you which weight to move.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="vand-funnel-t vand-funnel-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="vand-funnel-t">How a week of changesets distributes across score bands</title>
  <desc id="vand-funnel-d">A bar chart of 41 200 changesets from one week of a country diff stream. 39 100 score zero and are never surfaced. 1 840 score one or two, tripping a single weak signal, and are counted but not queued. 218 score three to five and are worth a look, roughly 31 a day. 34 score six or more and are reviewed the same day. Of those, six are confirmed problematic after human review.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">What a scored queue actually contains</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">one week of a country diff stream, 41 200 changesets</text>
  <line x1="250" y1="68" x2="250" y2="270" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">scored 0 — no signal tripped</text>
  <rect x="250" y="74" width="470" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="730" y="89" font-size="11" fill="currentColor" opacity="0.9">39 100 · never surfaced</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">scored 1–2 — one weak signal</text>
  <rect x="250" y="116" width="22" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="282" y="131" font-size="11" fill="currentColor" opacity="0.9">1 840 · counted, not queued</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">scored 3–5 — worth a look</text>
  <rect x="250" y="158" width="6" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="266" y="173" font-size="11" fill="currentColor" opacity="0.9">218 · ~31/day for a human</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">scored 6+ — high suspicion</text>
  <rect x="250" y="200" width="6" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="266" y="215" font-size="11" fill="currentColor" opacity="0.9">34 · reviewed same day</text>
  <text x="240" y="257" text-anchor="end" font-size="11.5" fill="currentColor">confirmed problematic</text>
  <rect x="250" y="242" width="6" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="266" y="257" font-size="11" fill="currentColor" opacity="0.9">6 · after human review</text>
  <text x="440" y="306" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.85">The ratio that matters is the last two rows: thirty-four flagged, six real. A review queue with that hit rate gets worked; one at one in a hundred does not.</text>
</svg>
<figcaption>Tune the thresholds against the last row. A queue whose confirmed rate falls below roughly one in ten stops being read, and an unread queue detects nothing.</figcaption>
</figure>

## Validation and error-handling matrix

| Condition | Root cause | Detection | Action |
|---|---|---|---|
| Queue full of legitimate imports | Size weighted too heavily | Reason lists dominated by "large" | Lower the size weight; add an import allowlist |
| Deletion share always zero | `visible` not checked; block type used instead | No changeset ever flags on deletions | Read `visible`, not the operation block |
| Spread always 1 cell | Ways and relations have no location | Only node-only changesets score on spread | Resolve way geometry, or accept node-only spread |
| Every changeset scores 0 | Account age or editor unavailable, treated as safe | Two reasons never appear | Treat unknown as unknown, not as clean |
| Same changeset queued repeatedly | Changesets span multiple diffs | Duplicate queue entries | Key the queue on changeset id, upsert |
| Queue ignored by reviewers | Confirmed rate too low | Items ageing without action | Raise thresholds until the hit rate recovers |

The fifth row is a structural property of the stream rather than a bug: a large changeset is applied across many minutely diffs, so its statistics arrive in pieces. Accumulate into a store keyed by changeset identifier and score on a delay of an hour or so, rather than scoring each diff independently.

## Performance and scale considerations

The grouping pass is cheap — one pass over the diff, a dictionary keyed by changeset, and a small set of H3 cells per group. On a minutely diff it is microseconds of work against an HTTP fetch. The cost lives in two other places.

The first is changeset metadata. Account age and the editor string are not in the diff, so they require an API call per changeset. At a few hundred distinct changesets a minute that is a lot of calls, and the fix is a cache: account creation dates never change, and changeset metadata is immutable once the changeset closes. A local table keyed by user identifier removes almost all of the traffic.

The second is the accumulation store if it is unbounded. Changesets stay open for up to a day, so an in-memory dictionary that never evicts grows all day. Flush and score groups whose last-seen timestamp is more than an hour old, the same bounded-accumulator pattern as in [Bounded LRU Node Cache for OSM Streaming](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/bounded-lru-node-cache-for-osm-streaming/).

## Failure modes and gotchas

The failure with real-world consequences is treating the score as a verdict. Automated reverting is a socially governed action in OpenStreetMap, it has an established process, and a pipeline that reverts on a threshold will eventually revert an import a local community spent months coordinating. Rank, explain, and hand to a person.

A quieter failure is scoring on a stream you have already filtered. If your diff-sync applies a geographic clip before scoring, every changeset looks narrow, because you deleted the evidence of spread. Score the unfiltered stream and filter afterwards.

Third, be careful with account age as a signal in isolation. It is the signal most likely to systematically flag new contributors, whose edits are usually small, local and correct. Weighted low and combined with size and deletion share it adds information; used alone it produces a queue of newcomers.

## Calibrating the weights

Weights chosen by intuition produce a queue that is either empty or unreadable, and the only way to find out which is to run them against edits whose outcome is already known. A full-history file makes that possible: replay a year of changesets, score each one with a candidate weighting, and compare the top of the resulting queue against the changesets that were in fact reverted. Reverts are recorded in OSM as ordinary changesets whose comments follow recognisable conventions, so the ground truth is available without any manual labelling.

The metric to optimise is not accuracy, which is meaningless when the positive class is a fraction of a percent of the population. It is the confirmed rate within the number of items a reviewer will actually open in a day. If a reviewer works thirty items, the question is how many of the top thirty by score were genuinely problematic, and a weighting that scores twelve of them correctly is far more useful than one with better overall separation and three.

That framing has a consequence for thresholds. The score threshold should be set from reviewer capacity rather than from the score distribution: measure how many items a day get worked, set the cut-off so the queue holds about that many, and let the weights determine which ones they are. A queue that grows faster than it is worked is a queue that gets abandoned, and every signal in it stops mattering.

Recalibrate on a schedule rather than on incident. Tagging conventions shift, import campaigns start and finish, and a weighting tuned on last year's edits drifts. A quarterly replay against the previous quarter's history, comparing the queue that would have been produced against what actually needed attention, is enough to catch the drift while it is still small.

One further note on fairness. Every signal here is a proxy, and proxies encode assumptions about how mapping is done. Account age assumes established contributors are more trustworthy, which is usually true in aggregate and routinely wrong in the individual case — a new account may belong to an experienced mapper starting fresh, or to a local expert invited by a community group. Editor strings assume familiar tools mean familiar practice, which under-weights regional editors popular outside Europe and North America. Geographic spread assumes a session happens in one place, which is false for anyone doing armchair mapping from imagery.

None of that makes the signals useless; it makes them signals rather than judgements, and it is another reason the output is a queue. A reviewer looking at a flagged changeset can see immediately that a new account made a large local edit with an unfamiliar editor and recognise a mapping party rather than an attack. A threshold cannot.

## In this section

- [Scoring OSM Changesets for Suspicious Edits](https://www.osm-data-processing.org/osm-data-quality-validation/changeset-analysis-and-vandalism-detection/scoring-osm-changesets-for-suspicious-edits/) — the complete scorer, weights and reason lists included.
- [Detecting Bulk Deletions in an OSM Diff Stream](https://www.osm-data-processing.org/osm-data-quality-validation/changeset-analysis-and-vandalism-detection/detecting-bulk-deletions-in-an-osm-diff-stream/) — the single highest-value check, on its own.
- [Fetching OSM Changeset Metadata from the API](https://www.osm-data-processing.org/osm-data-quality-validation/changeset-analysis-and-vandalism-detection/fetching-osm-changeset-metadata-from-the-api/) — the comment, editor and account fields the diff does not carry, with caching.

## Frequently Asked Questions

<details>
<summary>Should the pipeline revert anything automatically?</summary>

No. Reverting in OpenStreetMap is a community process with established conventions, and the signals here cannot distinguish a malicious mass deletion from a coordinated licence removal or a planned import cleanup. Produce a ranked, explained queue. If a reviewer decides a revert is warranted, they perform it through the normal channels.
</details>

<details>
<summary>What is the single most useful signal?</summary>

Deletion share. Ordinary mapping is overwhelmingly additive, so a changeset dominated by deletions is unusual by construction, and unlike raw size it does not flag every import. Combined with geographic spread it identifies the shape of edit that most warrants a look.
</details>

<details>
<summary>How do I avoid flagging legitimate imports?</summary>

Maintain an allowlist of accounts and editor strings known to perform coordinated imports in your area of interest, and subtract from the score rather than skipping the changeset entirely. Subtracting keeps the changeset visible if it also trips unrelated signals, which is what you want when an import account behaves unusually.
</details>

<details>
<summary>Can this run on a full-history file instead of the diff stream?</summary>

Yes, and it is the right way to backfill or to tune weights, because a history file lets you replay months of changesets and measure how a weighting would have performed. The streaming path is for detection; the history path is for calibration. The reduction is the one described in [Reconstructing OSM Features at a Past Date](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/reconstructing-osm-features-at-a-past-date/).
</details>

## Related

- [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/) — the section this topic belongs to.
- [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/) — the stream these signals are computed over.
- [Full-History .osh.pbf Processing](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/) — the calibration path for tuning weights against the past.
- [Authoring OSM Validation Rules](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/) — object-level checks, which this deliberately is not.
- [Spatial Index Selection: R-tree, H3 or Quadkey](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/) — the cell scheme the spread signal uses.
- [Applying .osc Change Files with osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/) — the operation semantics the deletion signal depends on.

Up one level: [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Should an OSM vandalism-detection pipeline revert edits automatically?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. Reverting in OpenStreetMap is a community process with established conventions, and these signals cannot distinguish a malicious mass deletion from a coordinated licence removal or a planned import cleanup. Produce a ranked, explained queue and let a reviewer act through the normal channels." }
    },
    {
      "@type": "Question",
      "name": "What is the most useful signal for detecting suspicious OSM changesets?",
      "acceptedAnswer": { "@type": "Answer", "text": "Deletion share. Ordinary mapping is overwhelmingly additive, so a changeset dominated by deletions is unusual by construction, and unlike raw size it does not flag every import. Combined with geographic spread it identifies the shape of edit that most warrants review." }
    },
    {
      "@type": "Question",
      "name": "How do I avoid flagging legitimate OSM imports as vandalism?",
      "acceptedAnswer": { "@type": "Answer", "text": "Maintain an allowlist of accounts and editor strings known to perform coordinated imports in your area, and subtract from the score rather than skipping the changeset. Subtracting keeps the changeset visible if it also trips unrelated signals, which is what you want when an import account behaves unusually." }
    },
    {
      "@type": "Question",
      "name": "Can changeset scoring run on a full-history file instead of the diff stream?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes, and it is the right way to backfill or tune weights, because a history file lets you replay months of changesets and measure how a weighting would have performed. The streaming path is for detection; the history path is for calibration." }
    }
  ]
}
</script>
