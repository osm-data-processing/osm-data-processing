---
title: "Monitoring an Area for Suspicious OSM Edits"
description: "Watch a region you depend on for edits worth a human look: large deletions, sweeping retags and first-time editors touching critical features, ranked so the queue stays short."
pageTitle: "Watching an OSM Area for Edits That Need Review"
pageDescription: "Poll the changeset stream for a bounding box, score each changeset on deletion volume, feature importance and editor history, and produce a ranked queue rather than an alert per edit."
slug: monitoring-an-area-for-suspicious-osm-edits
type: article
breadcrumb: "Area Edit Monitoring"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Monitoring an Area for Suspicious OSM Edits

If your product depends on one city being right, you want to know within the hour when somebody deletes half of it — and you want that signal without an alert for each of the two thousand ordinary edits that also happened.

## Prerequisites

- [ ] Python 3.10+ with `requests`, and access to the changeset replication stream.
- [ ] The scoring framing in [Changeset Analysis & Vandalism Detection](https://www.osm-data-processing.org/osm-data-quality-validation/changeset-analysis-and-vandalism-detection/).
- [ ] A bounding box or boundary defining the area you care about.
- [ ] A person who will look at the queue, because this produces candidates and not verdicts.
- [ ] A polite polling interval; the changeset stream is a shared community resource.

## Conceptual minimum

The stream gives changeset metadata — bounding box, user, editor, comment, counts of created, modified and deleted elements — on a minutely cadence. The work is turning that into a short ranked list.

**Score, do not classify.** A binary "suspicious or not" forces a threshold nobody can defend and produces arguments about individual cases. A score sorts the queue, and the reviewer works down it until the findings stop being interesting, which is self-calibrating in a way a threshold is not.

**Most signals are weak alone and useful together.** A large deletion count is normal for an import cleanup. A new account is normal for the great majority of contributors, who are simply new. A vague changeset comment means very little. All three at once, inside a small area, on features your product depends on, is a different matter.

**Bias toward consequence, not intent.** You are not adjudicating whether somebody meant harm; you are deciding what to look at. An accidental mass delete from a misconfigured editor is as damaging as a deliberate one and considerably more common, and a scoring system aimed at consequence catches both.

The most important design constraint is that **the queue must stay short enough to be worked**. A monitor producing forty items a day gets ignored within a fortnight, and the correct response to a long queue is to raise the bar rather than to expect more attention.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="mse1-t mse1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="mse1-t">Three signals that mean little alone and a great deal together</title>
  <desc id="mse1-d">Three panels. A large deletion count is entirely normal in isolation, since import cleanups and duplicate removals routinely delete thousands of elements legitimately. A brand new account is normal in isolation too, because the overwhelming majority of new accounts belong to people who have simply started mapping. A vague or empty changeset comment is extremely common and carries almost no information by itself. Combined within a small area and touching features a product depends on, the three together are worth a human look, which is why the design scores rather than classifies.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Weak signals, combined</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Large deletion count</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Normal in isolation</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Import cleanups delete</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Duplicate removal too</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Needs context</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">A new account</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Most new accounts are fine</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">People start mapping daily</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Suspicion alone is unfair</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Needs context</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">A vague comment</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Extremely common</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Carries little alone</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Editors default it</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Needs context</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Any one of these as a trigger produces a queue nobody works through; all three together produce a handful of items a week.</text>
</svg>
<figcaption>The combination is the signal. Each part on its own describes ordinary mapping.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import gzip
import logging
import re
import urllib.request
import xml.etree.ElementTree as ET
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from datetime import datetime, timezone

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.changeset.watch")

STREAM = "https://planet.openstreetmap.org/replication/changesets"
USER_AGENT = "area-edit-monitor/1.0 (ops@example.net)"
QUEUE_TARGET = 5          # items per day; raise the bar if it overflows

VAGUE_COMMENT = re.compile(r"^\s*(|\.|update|edit|fix|test|asdf)\s*$", re.I)


@dataclass(frozen=True)
class Box:
    west: float
    south: float
    east: float
    north: float

    def overlaps(self, other: "Box") -> bool:
        return not (other.east < self.west or other.west > self.east
                    or other.north < self.south or other.south > self.north)

    @property
    def area_deg2(self) -> float:
        return max(self.east - self.west, 0) * max(self.north - self.south, 0)


@dataclass
class Changeset:
    id: int
    user: str
    uid: int
    created_at: str
    closed_at: str | None
    comment: str
    editor: str
    box: Box | None
    created: int = 0
    modified: int = 0
    deleted: int = 0


@dataclass
class Score:
    changeset: Changeset
    points: float
    reasons: list[str] = field(default_factory=list)


def fetch(sequence: int, stream: str = STREAM) -> Iterator[Changeset]:
    text = f"{sequence:09d}"
    url = f"{stream}/{text[0:3]}/{text[3:6]}/{text[6:9]}.osm.gz"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = gzip.decompress(response.read())
    for element in ET.fromstring(payload).findall("changeset"):
        tags = {t.get("k"): t.get("v") for t in element.findall("tag")}
        box = None
        if element.get("min_lon"):
            box = Box(float(element.get("min_lon")), float(element.get("min_lat")),
                      float(element.get("max_lon")), float(element.get("max_lat")))
        yield Changeset(
            id=int(element.get("id")), user=element.get("user", "?"),
            uid=int(element.get("uid", 0)), created_at=element.get("created_at"),
            closed_at=element.get("closed_at"), comment=tags.get("comment", ""),
            editor=tags.get("created_by", "unknown"), box=box,
            created=int(element.get("num_changes", 0)))


def score(changeset: Changeset, watched: Box,
          known_users: set[int], critical_hits: int = 0) -> Score:
    """Bias toward CONSEQUENCE, not intent.

    An accidental mass delete from a misconfigured editor does the same damage
    as a deliberate one and is considerably more common.
    """
    result = Score(changeset, 0.0)

    if changeset.deleted >= 500:
        result.points += 4
        result.reasons.append(f"{changeset.deleted:,} deletions")
    elif changeset.deleted >= 100:
        result.points += 2
        result.reasons.append(f"{changeset.deleted:,} deletions")

    if critical_hits:
        result.points += min(4.0, critical_hits * 0.5)
        result.reasons.append(f"touches {critical_hits} feature(s) we depend on")

    # A new account is NOT suspicious by itself; it only adds weight to a
    # changeset that already looks consequential.
    if changeset.uid not in known_users and result.points > 0:
        result.points += 1
        result.reasons.append("editor not seen in this area before")

    if VAGUE_COMMENT.match(changeset.comment) and result.points > 0:
        result.points += 0.5
        result.reasons.append("no meaningful changeset comment")

    # A wide bounding box for few changes means edits scattered far apart,
    # which is what a careless bulk operation looks like.
    if changeset.box and changeset.box.area_deg2 > watched.area_deg2 * 4:
        result.points += 1.5
        result.reasons.append("extent far larger than the watched area")

    return result


def watch(sequences: Iterable[int], watched: Box, known_users: set[int],
          floor: float = 4.0) -> list[Score]:
    queue: list[Score] = []
    for sequence in sequences:
        for changeset in fetch(sequence):
            if changeset.box is None or not watched.overlaps(changeset.box):
                continue
            scored = score(changeset, watched, known_users)
            if scored.points >= floor:
                queue.append(scored)

    queue.sort(key=lambda s: s.points, reverse=True)
    logger.info("%d changeset(s) above the floor", len(queue))
    for item in queue[:20]:
        logger.info("%5.1f  cs/%d by %s — %s", item.points, item.changeset.id,
                    item.changeset.user, "; ".join(item.reasons))
    return queue


def calibrate(queue: list[Score], days: int, target: int = QUEUE_TARGET) -> float:
    """A queue nobody works through protects nothing. Raise the bar instead
    of expecting more attention."""
    per_day = len(queue) / max(days, 1)
    if per_day <= target:
        return 0.0
    keep = sorted((s.points for s in queue), reverse=True)[:target * days]
    logger.warning("%.1f items/day against a target of %d; suggest floor %.1f",
                   per_day, target, keep[-1] if keep else 0.0)
    return keep[-1] if keep else 0.0


if __name__ == "__main__":
    logger.info("score, rank, and keep the queue short enough to be worked")
```

## Step-by-step walkthrough

1. **Filter by bounding box first.** The stream is global and the overwhelming majority of changesets are irrelevant to you, so the cheapest possible test comes first.
2. **Score rather than classify.** Ranking lets the reviewer decide where to stop, and it avoids a threshold argument about any individual changeset.
3. **Weight deletions heavily.** Deletion is the hardest edit to notice downstream and the most expensive to recover from, which makes it the highest-value signal.
4. **Let account age and comment quality act as multipliers only.** They add weight to something already consequential and should never trigger on their own — fairer, and more accurate.
5. **Treat a wide extent with few changes as a signal.** Edits scattered across a large box are what a careless bulk operation looks like from the metadata alone.
6. **Check whether critical features were touched.** This requires resolving the changeset's elements against your own dependency list, and it is the single most informative signal available.
7. **Calibrate the floor from volume.** If the queue exceeds what somebody will actually review, raise the bar; expecting more attention has never once worked.
8. **Identify yourself in the user agent.** The stream is a shared resource, and an anonymous poller is a poor neighbour.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="mse2-t mse2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="mse2-t">From a global stream to a queue somebody works through</title>
  <desc id="mse2-d">Four steps. The minutely changeset stream carries every changeset worldwide, which is far too many to consider individually. A bounding-box test discards everything not overlapping the watched area, which is the cheapest filter and removes the overwhelming majority. Each survivor is scored on deletion volume, whether it touched features the product depends on, the editor's history in this area, comment quality and extent, producing a number rather than a verdict. The scored items above a floor are ranked and presented as a queue, with the floor recalibrated whenever the daily volume exceeds what a reviewer will actually work through.</desc>
  <defs><marker id="mse2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Filter, score, rank, calibrate</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">global stream</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">every changeset</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">far too many</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#mse2-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">box filter</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">cheapest test first</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">most discarded</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#mse2-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">score</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">a number, not a verdict</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">weak signals combined</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#mse2-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">rank and calibrate</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">reviewer stops when bored</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">floor follows volume</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The last step is the one that keeps the system alive: a queue that outgrows its reviewer is abandoned rather than triaged.</text>
</svg>
<figcaption>Nothing here decides anything. It decides what a person looks at first.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 342" role="img" aria-labelledby="mse3-t mse3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="mse3-t">What each signal contributes, and why none of them triggers alone</title>
  <desc id="mse3-d">A grid of five scoring signals against the weight each carries and the reason it cannot stand on its own. Deletion volume carries the most weight because deletion is the hardest edit to notice downstream, but large legitimate deletions happen during import cleanups. Critical-feature overlap carries heavy weight and requires resolving elements against your own dependency list. An unfamiliar editor carries light weight and only ever acts as a multiplier, because the great majority of new accounts belong to people who have simply started mapping. A vague comment carries the lightest weight because editors default it. An extent far larger than the changes justify carries moderate weight as the signature of a careless bulk operation.</desc>
  <rect x="0" y="0" width="880" height="342" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Five signals and their weights</text>
  <rect x="212" y="48" width="321" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="372" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Weight</text>
  <rect x="533" y="48" width="321" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="694" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Why not alone</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Deletion volume</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="372" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">heaviest</text>
  <text x="694" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">import cleanups delete</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Critical features hit</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="372" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">heavy</text>
  <text x="694" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">needs your own list</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Unfamiliar editor</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="372" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">light, multiplier only</text>
  <text x="694" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">most new accounts are fine</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Vague comment</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="372" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">lightest</text>
  <text x="694" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">editors default it</text>
  <text x="30" y="289" font-size="11.5" font-weight="600" fill="currentColor">Extent versus changes</text>
  <line x1="26" y1="308" x2="854" y2="308" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="372" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">moderate</text>
  <text x="694" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">large areas are edited</text>
  <text x="868" y="326" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Scoring on consequence rather than intent is what makes the third row a multiplier instead of a trigger — fairer, and more accurate.</text>
</svg>
<figcaption>Every weight here is a judgement, which is why the floor is calibrated from volume rather than argued about.</figcaption>
</figure>

## Verification

- **A synthetic mass delete ranks first.** Replay a historical large-deletion changeset and confirm it tops the queue.
- **Ordinary mapping does not appear.** Run a week of real data over a quiet area and confirm the queue is near empty.
- **New accounts alone do not score.** Confirm a small edit by a first-time editor produces nothing.
- **The box filter is tight.** Confirm changesets adjacent to but outside the area are excluded.
- **Calibration responds.** Feed a noisy period and confirm the suggested floor rises.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Queue too long to review | Floor set below what anyone will work | Calibrate the floor from observed volume |
| New contributors constantly flagged | Account age used as a standalone trigger | Make it a multiplier on an already-scoring changeset |
| Genuine vandalism missed | Only deletions scored | Add critical-feature overlap and extent signals |
| Irrelevant changesets reviewed | Bounding box too generous | Tighten the box, or test against the actual boundary |
| Monitor stops without notice | No heartbeat on the poller | Alert on the stream sequence failing to advance |
| Requests throttled | No identifying user agent | Identify the client and poll politely |
| Arguments about individual items | Binary classification | Score and rank; let the reviewer decide where to stop |

## Specification reference

> The changeset replication stream publishes minutely `.osm.gz` files containing changeset metadata: identifier, user, timestamps, the bounding box of the changes, the number of changes and the changeset's tags, including `comment` and `created_by`. The bounding box is present only for changesets that modified at least one element with a location. Element-level detail is not included and must be retrieved separately. See the OpenStreetMap changeset replication documentation and the changeset API.

## Frequently Asked Questions

<details>
<summary>Should the monitor revert anything automatically?</summary>

No. Automated reverts are how a false positive becomes an edit war, and the community norms around reverting exist for good reasons — a revert is itself an edit, attributed to you, that another mapper will have to review. The monitor's output is a queue for a person who can look at the changeset, read the comment, check imagery and, where necessary, message the editor. That path resolves far more cases than a revert does.
</details>

<details>
<summary>How do you decide which features are critical?</summary>

From what your product actually breaks without, which is usually a much shorter list than people expect: the boundary polygons your aggregates depend on, the road classes your routing uses, the named places your search resolves. Deriving it from your own schema rather than from importance in the abstract keeps it short and keeps the scoring sharp, and it is worth revisiting whenever the schema changes.
</details>

<details>
<summary>What is a polite polling interval?</summary>

Matching the stream's own cadence is fine — a minutely file published every minute can be fetched every minute — and conditional requests using the file's ETag or last-modified time cost the server almost nothing when there is nothing new. What is not fine is polling several times a minute hoping to be first, or fetching without identifying yourself. The stream is run for everybody and the etiquette is the same as for any shared service.
</details>

<details>
<summary>Should this run against a local database instead?</summary>

If you already replicate the area, comparing before and after states gives element-level detail the changeset metadata cannot, including exactly which features changed and how. That is strictly more informative and considerably more work. The changeset stream is the low-cost version that runs without any local data, and running both — metadata for the fast signal, local diff for the detail once something is flagged — is a good arrangement.
</details>

## Related

- [Changeset Analysis & Vandalism Detection](https://www.osm-data-processing.org/osm-data-quality-validation/changeset-analysis-and-vandalism-detection/) — the parent topic.
- [Generating an OSM Data Quality Report](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/generating-an-osm-data-quality-report/) — presenting the queue so it gets worked.
- [Continuous QA for OSM Pipelines](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/) — the gate that catches what reaches your output.
- [Replication Monitoring & Lag Alerting](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-monitoring-and-lag-alerting/) — the heartbeat pattern for this poller.
- [Incremental Updates for Derived Datasets](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/) — what a damaging edit propagates into.

Up one level: [Changeset Analysis & Vandalism Detection](https://www.osm-data-processing.org/osm-data-quality-validation/changeset-analysis-and-vandalism-detection/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Monitoring an Area for Suspicious OSM Edits",
  "description": "Watch a region you depend on for edits worth a human look: large deletions, sweeping retags and first-time editors touching critical features, ranked so the queue stays short.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Data Quality & Validation",
  "about": ["changeset monitoring", "edit review queue", "data stewardship"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Quality & Validation", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/" },
    { "@type": "ListItem", "position": 3, "name": "Changeset Analysis & Vandalism Detection", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/changeset-analysis-and-vandalism-detection/" },
    { "@type": "ListItem", "position": 4, "name": "Monitoring an Area for Suspicious OSM Edits", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/changeset-analysis-and-vandalism-detection/monitoring-an-area-for-suspicious-osm-edits/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Monitor an OSM area for edits worth reviewing",
  "description": "Filter the changeset replication stream by bounding box, score each changeset on deletion volume, critical-feature overlap, editor history and extent, and calibrate the floor so the ranked queue stays workable.",
  "step": [
    { "@type": "HowToStep", "name": "Filter by bounding box first", "text": "Discard changesets not overlapping the watched area before any other work, since most of the global stream is irrelevant." },
    { "@type": "HowToStep", "name": "Score rather than classify", "text": "Produce a number so the queue can be ranked and the reviewer decides where to stop." },
    { "@type": "HowToStep", "name": "Weight deletions heavily", "text": "Deletion is hardest to notice downstream and most expensive to recover from." },
    { "@type": "HowToStep", "name": "Use editor history as a multiplier", "text": "Let an unfamiliar account add weight only to a changeset that already scores, never trigger on its own." },
    { "@type": "HowToStep", "name": "Score extent against change count", "text": "Treat a wide bounding box with few changes as the signature of a careless bulk operation." },
    { "@type": "HowToStep", "name": "Check critical feature overlap", "text": "Resolve the changeset against the features your product depends on, which is the most informative signal." },
    { "@type": "HowToStep", "name": "Calibrate the floor from volume", "text": "Raise the bar whenever the queue exceeds what a reviewer will actually work through." }
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
      "name": "Should an OSM edit monitor revert anything automatically?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. Automated reverts turn a false positive into an edit war, and a revert is itself an edit attributed to you that another mapper must review. The output belongs in a queue for a person who can read the comment, check imagery and message the editor, which resolves far more cases." }
    },
    {
      "@type": "Question",
      "name": "How do you decide which OSM features are critical to monitor?",
      "acceptedAnswer": { "@type": "Answer", "text": "From what your product breaks without, which is a shorter list than expected: the boundaries your aggregates use, the road classes your routing needs, the named places your search resolves. Deriving it from your own schema keeps it short and the scoring sharp." }
    },
    {
      "@type": "Question",
      "name": "What is a polite polling interval for the changeset stream?",
      "acceptedAnswer": { "@type": "Answer", "text": "Matching the stream's own cadence is fine, and conditional requests using ETag or last-modified cost the server almost nothing when nothing is new. Polling several times a minute hoping to be first, or fetching without identifying yourself, is not." }
    },
    {
      "@type": "Question",
      "name": "Should edit monitoring run against a local OSM database instead?",
      "acceptedAnswer": { "@type": "Answer", "text": "If you already replicate the area, comparing before and after gives element-level detail the metadata cannot, at considerably more cost. Running both — metadata for the fast signal, local diff for detail once something is flagged — is a good arrangement." }
    }
  ]
}
</script>
