---
title: "Scoring OSM Changesets for Suspicious Edits"
description: "A weighted, explainable changeset scorer: rules that return reasons, an allowlist that subtracts rather than excludes, and calibration by replaying history against known reverts."
pageTitle: "Score OSM Changesets for Suspicious Edits"
pageDescription: "Build a ranked review queue from OSM changeset statistics — six weighted rules with human-readable reasons, and a precision-at-depth replay that turns weight-setting into measurement."
slug: "scoring-osm-changesets-for-suspicious-edits"
type: "article"
breadcrumb: "Scoring Changesets"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Scoring OSM Changesets for Suspicious Edits

Turn grouped changeset statistics into a ranked, explained review queue, and calibrate the weights against edits whose outcome is already known.

## Prerequisites

- [ ] Changeset grouping over a diff stream, as in [Changeset Analysis & Vandalism Detection](https://www.osm-data-processing.org/osm-data-quality-validation/changeset-analysis-and-vandalism-detection/)
- [ ] Python 3.10+ with `h3` 4.x
- [ ] A cache of account creation dates and changeset metadata
- [ ] A full-history file, or an archive of diffs, if you intend to calibrate
- [ ] An agreed number of items a reviewer will look at per day

## Conceptual minimum

Scoring is the smallest part of this system. The signals are arithmetic over a grouped changeset, the weights are a handful of numbers, and everything interesting is in how the result is presented and how the numbers were chosen.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="score-flow-t score-flow-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="score-flow-t">From a grouped changeset to a ranked, explained queue row</title>
  <desc id="score-flow-d">A four-stage chain. A grouped changeset arrives from the diff stream carrying operation counts, cell coverage and a time window. An enrichment stage adds account age and editor string from a cached API lookup. A rule stage evaluates each rule, which returns a reason or nothing, with weights held as data. The result is a queue row carrying a score and the list of reasons that produced it.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="sc" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">The scorer is arithmetic; the queue is the product</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">grouped changeset</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">counts · cells · window</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">from the diff stream</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#sc)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">enrich</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">account age · editor</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">cached API lookup</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#sc)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">rules</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.0" fill="currentColor" opacity="0.85">each returns a reason or None</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">weights are data</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#sc)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">queue row</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">score + reason list</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">ranked, explained</text>
  <text x="440" y="158" text-anchor="middle" font-size="10.0" fill="currentColor" opacity="0.85">A rule that cannot say why it fired produces a number nobody trusts. The reason list is what makes the queue workable and the weights tunable.</text>
</svg>
<figcaption>Every stage is mechanical except the last consumer, which is a person. That is the design, not a limitation of it.</figcaption>
</figure>

Two design commitments make the difference between a queue that gets worked and one that gets ignored. Every rule returns a human-readable reason alongside its contribution, so a reviewer knows in one second why an item is in front of them. And the allowlist subtracts rather than excludes, so a known import account that suddenly starts deleting still appears.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 358" role="img" aria-labelledby="score-weights-t score-weights-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="score-weights-t">The six weights and the reasoning behind each</title>
  <desc id="score-weights-d">A grid of six rules with their weights. Deletion-heavy above forty percent scores 3.0 because mapping is additive, making it the strongest single signal. Wide coverage above twelve cells at resolution 3 scores 2.0 because a human session happens in one place. Large changesets above five thousand objects score 2.0, strong but tripped by every legitimate import. A brand-new account under a day old scores 1.5, real but unfair to newcomers alone. No declared editor scores 0.5 as a tiebreaker. An import allowlist scores minus 3.0, subtracting rather than skipping so an unusual import still surfaces.</desc>
  <rect x="0" y="0" width="880" height="358" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Weights are a claim about relative evidence</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">weight</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">why that number</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">deletion-heavy (>40%)</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">3.0</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="9.5" fill="currentColor">mapping is additive; this is the strongest single signal</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">wide (>12 cells at r3)</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">2.0</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">a human session happens in one place</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">large (>5 000 objects)</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">2.0</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">strong, but every legitimate import trips it</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">brand-new account (<1 day)</text>
  <rect x="213" y="204" width="316" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="371" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">1.5</text>
  <rect x="535" y="204" width="316" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="693" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">real, and unfair to newcomers on its own</text>
  <text x="198" y="264" text-anchor="end" font-size="11.5" fill="currentColor">no editor declared</text>
  <rect x="213" y="244" width="316" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="371" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">0.5</text>
  <rect x="535" y="244" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">weak — a tiebreaker, nothing more</text>
  <text x="198" y="304" text-anchor="end" font-size="11.5" fill="currentColor">import allowlist</text>
  <rect x="213" y="284" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="304" text-anchor="middle" font-size="10.5" fill="currentColor">−3.0</text>
  <rect x="535" y="284" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="304" text-anchor="middle" font-size="10.5" fill="currentColor">subtract, do not skip: an odd import still surfaces</text>
  <text x="440" y="340" text-anchor="middle" font-size="8.5" fill="currentColor" opacity="0.85">The negative weight is the important design choice. Skipping allowlisted accounts hides them entirely; subtracting keeps them visible when they trip unrelated signals.</text>
</svg>
<figcaption>None of these numbers is derived from theory. They come from replaying history and measuring how many of the top-ranked items were genuinely worth a look.</figcaption>
</figure>

## Runnable solution

```python
#!/usr/bin/env python3
"""Score grouped OSM changesets and emit a ranked, explained review queue."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Callable, Iterable

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Changeset:
    """Everything the scorer needs, already accumulated from the diff stream."""
    id: int
    user: str
    uid: int
    created: int
    modified: int
    deleted: int
    cells: frozenset[str]          # coarse H3 cells touched
    first_seen: datetime
    last_seen: datetime
    account_created: datetime | None
    editor: str | None

    @property
    def touched(self) -> int:
        return self.created + self.modified + self.deleted

    @property
    def deletion_share(self) -> float:
        return self.deleted / self.touched if self.touched else 0.0

    @property
    def account_age_days(self) -> float | None:
        if self.account_created is None:
            return None
        return (self.first_seen - self.account_created) / timedelta(days=1)


@dataclass(frozen=True)
class Rule:
    name: str
    weight: float
    test: Callable[[Changeset], str | None]   # returns a reason, or None


IMPORT_ACCOUNTS = frozenset({"nsw_import", "hot_bulk", "cadastre_fr"})


def _deletion_heavy(cs: Changeset) -> str | None:
    if cs.touched >= 50 and cs.deletion_share > 0.40:
        return f"{cs.deletion_share:.0%} of {cs.touched} operations are deletions"
    return None


def _wide(cs: Changeset) -> str | None:
    if len(cs.cells) > 12:
        return f"spans {len(cs.cells)} coarse cells"
    return None


def _large(cs: Changeset) -> str | None:
    if cs.touched > 5_000:
        return f"{cs.touched:,} objects touched"
    return None


def _new_account(cs: Changeset) -> str | None:
    age = cs.account_age_days
    if age is not None and age < 1:
        return f"account {age * 24:.0f} h old at edit time"
    return None


def _no_editor(cs: Changeset) -> str | None:
    return "no editor declared" if not cs.editor else None


def _known_importer(cs: Changeset) -> str | None:
    if cs.user in IMPORT_ACCOUNTS:
        return f"{cs.user} is a known import account"
    return None


RULES: tuple[Rule, ...] = (
    Rule("deletion_heavy", 3.0, _deletion_heavy),
    Rule("wide", 2.0, _wide),
    Rule("large", 2.0, _large),
    Rule("new_account", 1.5, _new_account),
    Rule("no_editor", 0.5, _no_editor),
    # Negative: an allowlisted importer is discounted, never hidden.
    Rule("known_importer", -3.0, _known_importer),
)


@dataclass
class Scored:
    changeset: Changeset
    score: float
    reasons: list[str] = field(default_factory=list)


def score(cs: Changeset, rules: Iterable[Rule] = RULES) -> Scored:
    result = Scored(changeset=cs, score=0.0)
    for rule in rules:
        reason = rule.test(cs)
        if reason is None:
            continue
        result.score += rule.weight
        sign = "+" if rule.weight > 0 else ""
        result.reasons.append(f"{sign}{rule.weight:g} {reason}")
    return result


def build_queue(changesets: Iterable[Changeset], depth: int = 100) -> list[Scored]:
    """Rank by score, keep the top `depth`, drop anything that tripped nothing."""
    scored = [score(cs) for cs in changesets]
    interesting = [s for s in scored if s.score > 0]
    interesting.sort(key=lambda s: s.score, reverse=True)
    logger.info("%d changeset(s) scored, %d above zero, queueing top %d",
                len(scored), len(interesting), min(depth, len(interesting)))
    return interesting[:depth]
```

Calibration, which is where the weights actually come from:

```python
def precision_at(queue: list[Scored], reverted_ids: set[int], depths=(10, 30, 100, 500)) -> dict[int, float]:
    """Replay metric: of the top N by score, how many were later reverted upstream?"""
    out: dict[int, float] = {}
    for n in depths:
        top = queue[:n]
        if not top:
            continue
        hits = sum(1 for s in top if s.changeset.id in reverted_ids)
        out[n] = hits / len(top)
        logger.info("precision@%d = %.1f%% (%d/%d)", n, 100 * out[n], hits, len(top))
    return out
```

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="score-precision-t score-precision-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="score-precision-t">Precision at increasing queue depths, replayed over one month</title>
  <desc id="score-precision-d">A bar chart of precision by queue depth over 178 thousand changesets from one month, of which 26 were later reverted upstream. The top ten by score contain seven reverted changesets, a precision of seventy percent. The top thirty contain sixteen, fifty-three percent. The top hundred contain twenty-two, twenty-two percent. The top five hundred contain twenty-four, five percent, so the tail adds almost nothing. A random five hundred contain none.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Precision at the top of the queue is the only metric that matters</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">one month replayed, 178 000 changesets, 26 later reverted upstream</text>
  <line x1="250" y1="68" x2="250" y2="270" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">top 10 by score</text>
  <rect x="250" y="74" width="470" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="730" y="89" font-size="11" fill="currentColor" opacity="0.9">7 of 10 were reverted</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">top 30</text>
  <rect x="250" y="116" width="356" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="616" y="131" font-size="11" fill="currentColor" opacity="0.9">16 of 30 were reverted</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">top 100</text>
  <rect x="250" y="158" width="148" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="408" y="173" font-size="11" fill="currentColor" opacity="0.9">22 of 100 were reverted</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">top 500</text>
  <rect x="250" y="200" width="34" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="294" y="215" font-size="11" fill="currentColor" opacity="0.9">24 of 500 — the tail adds almost nothing</text>
  <text x="240" y="257" text-anchor="end" font-size="11.5" fill="currentColor">random 500</text>
  <rect x="250" y="242" width="6" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="266" y="257" font-size="11" fill="currentColor" opacity="0.9">0 of 500 — the baseline</text>
  <text x="440" y="306" text-anchor="middle" font-size="10.0" fill="currentColor" opacity="0.85">Bar length is precision as a percentage. The queue is worth working down to about a hundred items a month; past that the reviewer is reading noise.</text>
</svg>
<figcaption>Set the queue cut-off where precision falls below what a reviewer will tolerate — around a hundred items a month here — and let the weights decide which hundred.</figcaption>
</figure>

## Step-by-step walkthrough

Each rule is a small function returning either `None` or a sentence. That shape is what lets the runner build the reason list for free, and it makes each rule independently testable against a fixture changeset without instantiating a scorer.

`_deletion_heavy` guards on `touched >= 50` before computing a share. Without it a three-object changeset that deletes two scores 67 percent and outranks a genuinely suspicious bulk deletion — a share over a tiny denominator is noise.

`_known_importer` returns a reason like every other rule, and its negative weight shows in the reason list as `-3.0 nsw_import is a known import account`. A reviewer seeing that alongside `+3.0 82% of 41,203 operations are deletions` has exactly the information needed, which is what excluding the account outright would have thrown away.

`build_queue` drops anything scoring zero rather than ranking it. There is no value in a queue position for a changeset that tripped nothing, and keeping them makes the depth statistics meaningless.

`precision_at` is the function that turns weight-setting from an argument into a measurement. Reverts are ordinary changesets in OSM whose comments follow recognisable conventions, so the ground truth can be harvested from a history file rather than hand-labelled — the replay approach described in [Full-History .osh.pbf Processing](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/).

## Verification

Test each rule against a fixture before testing the score:

```python
BASE = dict(id=1, user="mapper", uid=42, created=10, modified=5, deleted=0,
            cells=frozenset({"83..."}), first_seen=datetime(2026, 8, 1),
            last_seen=datetime(2026, 8, 1), account_created=datetime(2020, 1, 1),
            editor="JOSM/1.5")

def test_small_changeset_is_not_deletion_heavy():
    cs = Changeset(**{**BASE, "created": 1, "modified": 0, "deleted": 2})
    assert _deletion_heavy(cs) is None          # 67%, but only 3 objects

def test_bulk_deletion_scores_high():
    cs = Changeset(**{**BASE, "created": 0, "modified": 100, "deleted": 9_000,
                      "cells": frozenset(f"c{i}" for i in range(30))})
    result = score(cs)
    assert result.score >= 7.0
    assert any("deletions" in r for r in result.reasons)

def test_importer_is_discounted_not_hidden():
    cs = Changeset(**{**BASE, "user": "nsw_import", "created": 20_000, "modified": 0})
    result = score(cs)
    assert result.score < 0                     # large, but a known importer
    assert any("import account" in r for r in result.reasons)
```

Then run the replay over a month of history and read `precision_at`. If precision at your intended queue depth is below about one in ten, the weights are wrong; adjust the largest weight first, since it dominates the ranking.

## Common errors and fixes

| Symptom | Root cause | Fix |
|---|---|---|
| Queue is all imports | Size weighted too heavily, no allowlist | Lower the size weight; add negative-weighted accounts |
| Queue is all newcomers | `new_account` weighted like a real signal | Drop it to 1.5 or below; never let it fire alone |
| Tiny changesets outrank bulk deletions | Deletion share with no minimum denominator | Guard on a minimum object count |
| Same changeset queued repeatedly | Scoring per diff rather than per changeset | Accumulate, then score on a delay |
| Reviewers ignore the queue | Precision too low at the depth they work | Raise the cut-off until precision recovers |
| Score cannot be explained | Rules return booleans | Return reasons; the number alone is not usable |

## Frequently Asked Questions

<details>
<summary>Why not train a classifier instead of hand-weighting?</summary>

Two reasons, and neither is that models do not work. The positive class is a fraction of a percent, so a model needs careful handling to be better than the trivial one, and the labels — reverts — are themselves noisy, since plenty of bad edits are never reverted and some reverts are disputes rather than vandalism. More importantly, a reviewer needs to know why an item is in the queue, and a weighted rule list gives that for free. If you do train a model, keep the rules as the explanation layer.
</details>

<details>
<summary>How often should weights be recalibrated?</summary>

Quarterly is enough for most deployments. Tagging conventions shift slowly, import campaigns start and finish, and the effect on precision is gradual. Recalibrate immediately if you add a signal or change a threshold, because a single changed weight reorders the whole queue.
</details>

<details>
<summary>Should the score be visible to reviewers?</summary>

Show the reasons prominently and the number quietly. Reviewers calibrate on reasons — "large, deletion-heavy, new account" is immediately meaningful — while a bare 6.5 invites arguments about whether 6.5 is a lot. The number's job is to order the list.
</details>

<details>
<summary>What about edits that are wrong but not suspicious?</summary>

Different problem, different tool. A changeset that adds a hundred buildings with plausible but incorrect tags trips none of these signals and is not meant to; that is what the object-level rules in [Authoring OSM Validation Rules](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/) are for. This pipeline looks at the shape of an edit, not at the correctness of its content.
</details>

## Specification reference

> Each OSM changeset carries `id`, `uid`, `user`, `created_at`, `closed_at`, `num_changes` and an optional bounding box, plus free-form tags including `comment` and `created_by`. Per-object operation counts and geographic coverage are not part of the changeset record and must be accumulated from the diff or history stream.

## Related

- [Changeset Analysis & Vandalism Detection](https://www.osm-data-processing.org/osm-data-quality-validation/changeset-analysis-and-vandalism-detection/) — the topic this scorer belongs to.
- [Detecting Bulk Deletions in an OSM Diff Stream](https://www.osm-data-processing.org/osm-data-quality-validation/changeset-analysis-and-vandalism-detection/detecting-bulk-deletions-in-an-osm-diff-stream/) — the strongest single rule, standalone.
- [Fetching OSM Changeset Metadata from the API](https://www.osm-data-processing.org/osm-data-quality-validation/changeset-analysis-and-vandalism-detection/fetching-osm-changeset-metadata-from-the-api/) — where account age and editor come from.
- [Full-History .osh.pbf Processing](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/) — the replay that calibrates the weights.
- [Authoring OSM Validation Rules](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/) — object-level correctness, which this deliberately ignores.

Up one level: [Changeset Analysis & Vandalism Detection](https://www.osm-data-processing.org/osm-data-quality-validation/changeset-analysis-and-vandalism-detection/).
