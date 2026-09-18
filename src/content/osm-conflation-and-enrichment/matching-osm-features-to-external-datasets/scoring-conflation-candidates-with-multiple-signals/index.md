---
title: "Scoring Conflation Candidates with Multiple Signals"
description: "Combine distance, name, category and identifier evidence into a decision that stays interpretable: per-signal scores retained, a runner-up gap, and a three-way classification with an explicit abstain."
pageTitle: "Combining Conflation Signals Without Losing the Evidence"
pageDescription: "Score conflation candidates on independent signals, handle missing evidence by renormalising rather than defaulting to zero, use the runner-up gap, and classify into match, review and no-match."
slug: scoring-conflation-candidates-with-multiple-signals
type: article
breadcrumb: "Scoring Candidates"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Scoring Conflation Candidates with Multiple Signals

Turn four separate pieces of evidence about a candidate pair into a decision a reviewer can argue with — which means keeping the evidence, not replacing it with a number.

## Prerequisites

- [ ] Candidate pairs with distances, from [Nearest-Neighbour Matching with GeoPandas sjoin_nearest](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/nearest-neighbour-matching-with-geopandas-sjoin-nearest/).
- [ ] A name comparator, from [Fuzzy Name Matching for OSM POI Conflation](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/fuzzy-name-matching-for-osm-poi-conflation/).
- [ ] A category mapping between the two datasets, or an honest admission that none exists.
- [ ] A labelled sample of true and false pairs, for calibration.
- [ ] Python 3.10+; nothing beyond the standard library is required for the scorer itself.

## Conceptual minimum

Four signals carry most conflation evidence, and their usefulness depends on being **independent** and on **missingness being handled honestly**.

A signal is missing when the evidence simply is not there: an OSM feature with no name, an external record with no category, a pair where the two names are in different scripts. The wrong response is to score it zero, because zero means "strong evidence against" and missing means "no evidence either way". The right response is to **renormalise over the signals that are present**, so a pair evidenced by distance and category alone is judged on those two rather than penalised for lacking a name.

The second idea is that **the best score alone is not a decision**. A pair scoring 0.85 with the next candidate at 0.30 is a different situation from one scoring 0.85 with the next at 0.83, and only the first is confident. The gap is a second number, and using both is what separates a matcher that works in dense areas from one that does not.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="scc1-t scc1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="scc1-t">The four signals, what they evidence and how they fail</title>
  <desc id="scc1-d">A grid of four signals against what each one actually evidences, its typical weight, and its characteristic failure. Distance evidences plausibility, carries modest weight, and fails by being uninformative in dense areas where something is always nearby. Name similarity evidences identity, carries the largest weight where names exist, and fails when either side has no name. Category agreement evidences kind, carries moderate weight, and fails when no shared vocabulary exists. A shared identifier evidences identity almost conclusively, dominates when present, and fails only by being absent.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four signals, four different things they prove</text>
  <rect x="196" y="48" width="219" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="306" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Evidences</text>
  <rect x="415" y="48" width="219" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="525" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Weight</text>
  <rect x="635" y="48" width="219" height="30" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="744" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Fails when</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Distance</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="306" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">plausibility</text>
  <text x="525" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">modest</text>
  <text x="744" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">area is dense</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Name similarity</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="306" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">identity</text>
  <text x="525" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">largest</text>
  <text x="744" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a name is absent</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Category</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="306" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">kind of thing</text>
  <text x="525" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">moderate</text>
  <text x="744" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">no shared vocabulary</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Shared identifier</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="306" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">identity</text>
  <text x="525" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">dominant</text>
  <text x="744" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">simply absent</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Only the bottom signal is close to conclusive on its own, which is why establishing identifier links pays for itself repeatedly.</text>
</svg>
<figcaption>Reading the middle column as fixed weights is the mistake: they should be calibrated per source against a labelled sample.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from enum import Enum

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.conflate.score")


class Outcome(str, Enum):
    MATCH = "match"
    REVIEW = "review"
    NO_MATCH = "no_match"


@dataclass(frozen=True)
class Signals:
    """Each field is a score in 0..1, or None when there is NO evidence.

    None is not zero: zero means 'the evidence argues against', None means
    'no evidence either way'. Conflating the two penalises features for
    lacking a tag, which is not the same as contradicting one.
    """
    distance: float | None = None
    name: float | None = None
    category: float | None = None
    identifier: float | None = None


WEIGHTS: dict[str, float] = {
    "distance": 0.20, "name": 0.45, "category": 0.20, "identifier": 0.15,
}
MATCH_FLOOR = 0.78
REVIEW_FLOOR = 0.45
MIN_GAP = 0.15
MIN_EVIDENCE_WEIGHT = 0.5      # refuse to decide on too little evidence


@dataclass(frozen=True)
class Scored:
    total: float
    present_weight: float
    signals: Signals
    components: dict[str, float] = field(default_factory=dict)


def distance_score(metres: float, radius_m: float) -> float:
    """1 at zero separation, decaying smoothly to 0 at the candidate radius."""
    if metres >= radius_m:
        return 0.0
    # A cosine taper is gentler near zero than a linear ramp, which matters
    # because positional error is concentrated near the true position.
    return 0.5 * (1.0 + math.cos(math.pi * metres / radius_m))


def combine(signals: Signals) -> Scored:
    """Weighted mean over the signals that are PRESENT, renormalised."""
    components: dict[str, float] = {}
    total = 0.0
    present = 0.0
    for name, weight in WEIGHTS.items():
        value = getattr(signals, name)
        if value is None:
            continue
        components[name] = value
        total += weight * value
        present += weight
    if present == 0.0:
        return Scored(0.0, 0.0, signals, components)
    return Scored(total / present, present, signals, components)


def classify(ranked: list[Scored]) -> tuple[Outcome, str]:
    """Decide from the best score, the runner-up gap and the evidence weight."""
    if not ranked:
        return Outcome.NO_MATCH, "no candidates"

    best = ranked[0]
    runner_up = ranked[1].total if len(ranked) > 1 else 0.0
    gap = best.total - runner_up

    if best.identifier_match():
        return Outcome.MATCH, "shared identifier"
    if best.present_weight < MIN_EVIDENCE_WEIGHT:
        return Outcome.REVIEW, f"only {best.present_weight:.2f} of evidence present"
    if best.total < REVIEW_FLOOR:
        return Outcome.NO_MATCH, f"best score {best.total:.2f} below the floor"
    if best.total >= MATCH_FLOOR and gap >= MIN_GAP:
        return Outcome.MATCH, f"score {best.total:.2f}, gap {gap:.2f}"
    if best.total >= MATCH_FLOOR:
        return Outcome.REVIEW, f"score {best.total:.2f} but gap only {gap:.2f}"
    return Outcome.REVIEW, f"score {best.total:.2f} in the middle band"


def _identifier_match(self: Scored) -> bool:
    return self.signals.identifier is not None and self.signals.identifier >= 0.99


Scored.identifier_match = _identifier_match     # small helper, kept out of the data


def score_record(candidates: list[Signals]) -> tuple[Outcome, str, list[Scored]]:
    ranked = sorted((combine(s) for s in candidates),
                    key=lambda s: (-s.total, -s.present_weight))
    outcome, reason = classify(ranked)
    logger.info("%s: %s (components %s)", outcome.value, reason,
                ranked[0].components if ranked else {})
    return outcome, reason, ranked


if __name__ == "__main__":
    near = Signals(distance=distance_score(18.0, 120.0), name=0.91,
                   category=1.0)
    far = Signals(distance=distance_score(95.0, 120.0), name=0.44,
                  category=0.0)
    score_record([near, far])
```

## Step-by-step walkthrough

1. **Model absent evidence as `None`.** The distinction between "no name on this feature" and "the names disagree completely" is the single most important modelling decision in the scorer, and collapsing it is why matchers under-match sparsely tagged features.
2. **Renormalise over present signals.** Dividing by the weight actually available means a pair with two of four signals is judged on those two at full strength rather than scoring at most half.
3. **Track how much evidence was present.** A high score computed from one weak signal is not the same as the same score from three; the evidence weight makes that visible and drives an explicit abstain.
4. **Taper distance smoothly.** A cosine taper is close to flat near zero, which reflects that positional error clusters near the true position, and falls to zero exactly at the candidate radius so no candidate outside it can contribute.
5. **Short-circuit on a shared identifier.** A matching reference code or Wikidata link is near-conclusive and should not be diluted by a mediocre name score.
6. **Abstain on thin evidence.** Below a minimum evidence weight the scorer routes to review regardless of the number, because the number is not meaningful.
7. **Require a gap as well as a score.** A high score with a close runner-up is ambiguity, not confidence, and it is exactly the dense-area case that ruins precision.
8. **Return the components and a reason.** The reason string is what a reviewer reads first, and the components are what they check when the reason surprises them.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 384" role="img" aria-labelledby="scc2-t scc2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="scc2-t">The order the classifier asks its questions in</title>
  <desc id="scc2-d">A decision node listing four checks applied in order, with the outcome each produces. A shared identifier match short-circuits immediately to a confident match. Insufficient present evidence routes to review regardless of the computed score, because the score is not meaningful. A best score below the review floor gives a no-match. A score above the match floor gives a confident match only when the gap to the runner-up is also large enough; otherwise it too goes to review.</desc>
  <defs><marker id="scc2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="384" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four checks, applied in this order</text>
  <rect x="26" y="156" width="250" height="88" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.6"/>
  <text x="151" y="184" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">What does the evidence support?</text>
  <text x="151" y="206" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Order matters here</text>
  <text x="151" y="224" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Identifier wins outright</text>
  <line x1="276" y1="200" x2="314" y2="200" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="314" y2="317" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="353" y2="83" stroke="currentColor" stroke-width="1.4" marker-end="url(#scc2-a)"/>
  <rect x="356" y="52" width="498" height="62" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="370" y="77" font-size="12" font-weight="700" fill="currentColor">Identifier match</text>
  <text x="370" y="97" font-size="10.5" fill="currentColor" opacity="0.88">Short-circuits everything else; near-conclusive on its own</text>
  <line x1="314" y1="161" x2="353" y2="161" stroke="currentColor" stroke-width="1.4" marker-end="url(#scc2-a)"/>
  <rect x="356" y="130" width="498" height="62" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="370" y="155" font-size="12" font-weight="700" fill="currentColor">Too little evidence</text>
  <text x="370" y="175" font-size="10.5" fill="currentColor" opacity="0.88">Review regardless of score; the number is not meaningful</text>
  <line x1="314" y1="239" x2="353" y2="239" stroke="currentColor" stroke-width="1.4" marker-end="url(#scc2-a)"/>
  <rect x="356" y="208" width="498" height="62" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="370" y="233" font-size="12" font-weight="700" fill="currentColor">Below the floor</text>
  <text x="370" y="253" font-size="10.5" fill="currentColor" opacity="0.88">No match; a legitimate and common outcome</text>
  <line x1="314" y1="317" x2="353" y2="317" stroke="currentColor" stroke-width="1.4" marker-end="url(#scc2-a)"/>
  <rect x="356" y="286" width="498" height="62" rx="8" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.5"/>
  <text x="370" y="311" font-size="12" font-weight="700" fill="currentColor">High score, small gap</text>
  <text x="370" y="331" font-size="10.5" fill="currentColor" opacity="0.88">Review; ambiguity is not confidence</text>
  <text x="868" y="368" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Reversing the first two checks would send identifier matches on sparsely tagged features to review for no reason.</text>
</svg>
<figcaption>Every branch here ends somewhere explicit, which is what stops uncertainty from defaulting quietly into a match.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 288" role="img" aria-labelledby="scc3-t scc3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="scc3-t">How renormalising over present signals changes the score for partially evidenced pairs</title>
  <desc id="scc3-d">Five candidate pairs with the same underlying quality but different amounts of evidence available, scored two ways. A pair with all four signals scores the same under both approaches. A pair missing its category scores well under renormalisation and noticeably lower when the missing signal is treated as zero. A pair with only distance and name drops further under the zero treatment. A pair with only a name score collapses under the zero treatment while renormalisation still reports a high but low-confidence score. A note says the second approach is why sparsely tagged regions under-match.</desc>
  <rect x="0" y="0" width="880" height="288" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Same pair, two ways of handling missing evidence</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">All four signals</text>
  <rect x="256" y="60" width="462" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">0.88 either way</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">No category: renormalised</text>
  <rect x="256" y="100" width="452" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">0.86</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">No category: zeroed</text>
  <rect x="256" y="140" width="362" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">0.69</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">Name only: renormalised</text>
  <rect x="256" y="180" width="478" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">0.91, low evidence</text>
  <text x="26" y="234" font-size="11.5" font-weight="600" fill="currentColor">Name only: zeroed</text>
  <rect x="256" y="220" width="215" height="18" rx="4" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="854" y="234" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">0.41</text>
  <text x="868" y="272" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The zeroed variant rejects a perfectly good name match because the feature happened to carry no category tag.</text>
</svg>
<figcaption>Renormalising keeps the score honest; the evidence weight, carried alongside, is what stops it becoming overconfident.</figcaption>
</figure>

## Verification

- **Missing signals do not penalise.** Score a pair with a perfect name and no category; it should score close to a pair with a perfect name and a matching category, not half of it.
- **The taper reaches zero at the radius.** A candidate at exactly the radius must contribute nothing.
- **Thin evidence abstains.** A pair evidenced only by distance should route to review however close it is.
- **The gap check fires.** Construct two candidates scoring 0.86 and 0.84; the classifier must say review, not match.
- **Calibration holds on the sample.** Run the labelled sample through and confirm precision and recall match what the thresholds intend, per [Measuring Conflation Precision and Recall](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/measuring-conflation-precision-and-recall/).

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Unnamed features never match | Missing name scored as zero | Model absent evidence as none and renormalise |
| Scores cluster near the weights' midpoint | Missing signals dragging every total down | Divide by the present weight, not the total weight |
| Wrong matches in dense areas | Only the best score consulted | Require a minimum gap to the runner-up |
| A single signal decides everything | Weights never calibrated | Fit weights against a labelled sample per source |
| Confident matches on one weak signal | No evidence-weight floor | Abstain below a minimum present weight |
| Identifier matches sent to review | Checks applied in the wrong order | Short-circuit on a shared identifier first |
| Reviewers cannot tell why | Only the total returned | Return the components and a human-readable reason |

## Specification reference

> Weighted scoring over partially observed evidence is conventionally handled by renormalising the weights over the observed subset, so that an unobserved signal neither contributes nor penalises. This differs from imputing a neutral or zero value, which biases the result towards the imputed value. The distinction matters in OpenStreetMap conflation because tag presence varies enormously between regions and feature classes; see [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) for why absence is so common.

## Frequently Asked Questions

<details>
<summary>Why is a missing signal not the same as a zero score?</summary>

Because zero means the evidence argues against a match and missing means there is no evidence either way. An OSM feature with no name tag has not disagreed with your external record's name; it has simply said nothing. Scoring that as zero penalises sparsely tagged features — which are disproportionately the ones in areas where mapping is thinner — and systematically under-matches exactly where you most need the match.
</details>

<details>
<summary>How should I choose the weights?</summary>

Fit them against a labelled sample for each source rather than adopting a set from elsewhere. The relative value of name similarity and category agreement depends entirely on whether the external dataset has good names and whether its categories map onto OSM tagging at all. A few hundred labelled pairs is enough to see which signals separate true from false pairs, and that separation is what the weights should reflect.
</details>

<details>
<summary>Why require a gap to the runner-up?</summary>

Because a high score with a near-identical alternative means the matcher is choosing between two equally plausible answers on no real basis. That situation is common in dense areas — a row of similar shops, a campus of similar buildings — and it is precisely where an absolute threshold alone produces confident wrong answers. The gap turns those cases into review items instead.
</details>

<details>
<summary>Should the scorer ever abstain?</summary>

Yes, and explicitly. When too little evidence is present the computed number is not meaningful however high it is, and pretending otherwise is how a matcher produces confident matches from a single weak signal. An explicit abstain, routed to review with a reason naming the missing evidence, is both more honest and more useful than a number nobody can interpret.
</details>

## Related

- [Matching OSM Features to External Datasets](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/) — the parent topic and the three-way classification.
- [Fuzzy Name Matching for OSM POI Conflation](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/fuzzy-name-matching-for-osm-poi-conflation/) — producing the strongest signal here.
- [Measuring Conflation Precision and Recall](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/measuring-conflation-precision-and-recall/) — calibrating these thresholds against evidence.
- [Linking OSM Features to Wikidata Identifiers](https://www.osm-data-processing.org/osm-conflation-and-enrichment/attribute-enrichment-from-authoritative-sources/linking-osm-features-to-wikidata-identifiers/) — establishing the identifier signal deliberately.
- [Authoring OSM Validation Rules](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/) — the same false-positive discipline applied to rules.

Up one level: [Matching OSM Features to External Datasets](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Scoring Conflation Candidates with Multiple Signals",
  "description": "Combine distance, name, category and identifier evidence into a decision that stays interpretable: per-signal scores retained, a runner-up gap, and a three-way classification with an explicit abstain.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Conflation & Data Enrichment",
  "about": ["multi-signal scoring", "missing evidence", "match classification"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Conflation & Data Enrichment", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/" },
    { "@type": "ListItem", "position": 3, "name": "Matching OSM Features to External Datasets", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/" },
    { "@type": "ListItem", "position": 4, "name": "Scoring Conflation Candidates with Multiple Signals", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/scoring-conflation-candidates-with-multiple-signals/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Combine conflation signals into an interpretable decision",
  "description": "Model absent evidence distinctly from contradicting evidence, renormalise weights over present signals, taper distance smoothly, short-circuit on shared identifiers, and require a runner-up gap before declaring a match.",
  "step": [
    { "@type": "HowToStep", "name": "Distinguish absent from contradicting", "text": "Represent a signal with no evidence as absent rather than as a zero score, since zero argues against a match." },
    { "@type": "HowToStep", "name": "Renormalise over present signals", "text": "Divide the weighted sum by the weight actually available so a pair is judged on the evidence it has." },
    { "@type": "HowToStep", "name": "Track the evidence weight", "text": "Record how much of the total weight was observed, and abstain to review below a minimum." },
    { "@type": "HowToStep", "name": "Taper distance smoothly", "text": "Score separation with a curve that is flat near zero and reaches zero exactly at the candidate radius." },
    { "@type": "HowToStep", "name": "Short-circuit on identifiers", "text": "Treat a matching reference or external identifier as near-conclusive before any other check runs." },
    { "@type": "HowToStep", "name": "Require a runner-up gap", "text": "Declare a confident match only when the best score clears the floor and exceeds the second-best by a margin." },
    { "@type": "HowToStep", "name": "Return components and a reason", "text": "Emit the per-signal scores and a human-readable explanation alongside the outcome." }
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
      "name": "Why is a missing conflation signal not the same as a zero score?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because zero means the evidence argues against a match and missing means there is no evidence either way. An OSM feature with no name tag has not disagreed with your record's name; it has said nothing. Scoring that as zero penalises sparsely tagged features and systematically under-matches exactly where you most need the match." }
    },
    {
      "@type": "Question",
      "name": "How should I choose conflation signal weights?",
      "acceptedAnswer": { "@type": "Answer", "text": "Fit them against a labelled sample for each source rather than adopting a set from elsewhere. The relative value of name similarity and category agreement depends entirely on whether the external dataset has good names and whether its categories map onto OSM tagging. A few hundred labelled pairs is enough to see which signals separate true from false pairs." }
    },
    {
      "@type": "Question",
      "name": "Why require a gap to the runner-up candidate?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because a high score with a near-identical alternative means the matcher is choosing between two equally plausible answers on no real basis. That situation is common in dense areas, and it is precisely where an absolute threshold alone produces confident wrong answers. The gap turns those cases into review items instead." }
    },
    {
      "@type": "Question",
      "name": "Should a conflation scorer ever abstain?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes, and explicitly. When too little evidence is present the computed number is not meaningful however high it is, and pretending otherwise is how a matcher produces confident matches from a single weak signal. An explicit abstain routed to review, with a reason naming the missing evidence, is both more honest and more useful." }
    }
  ]
}
</script>
