---
title: "Measuring Conflation Precision and Recall"
description: "Design a stratified labelled sample, compute precision and recall with honest confidence intervals, and break the numbers down so the slices that fail are visible."
pageTitle: "Precision and Recall for an OSM Conflation Matcher"
pageDescription: "Draw a stratified sample, label it once, compute precision and recall with Wilson intervals, and report per density and feature class so an aggregate figure cannot hide a failing slice."
slug: measuring-conflation-precision-and-recall
type: article
breadcrumb: "Precision & Recall"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Measuring Conflation Precision and Recall

Two numbers, an afternoon of labelling, and a habit of re-scoring — that is the whole of conflation quality measurement, and it is the difference between a matcher you can defend and one you merely hope about.

## Prerequisites

- [ ] Conflation output with scores and outcomes, from [Scoring Conflation Candidates with Multiple Signals](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/scoring-conflation-candidates-with-multiple-signals/).
- [ ] Somebody who can judge a pair correctly, with access to imagery and the source dataset.
- [ ] Python 3.10+; nothing beyond the standard library is needed.
- [ ] Strata defined in advance: density bands, feature classes, regions.
- [ ] Somewhere durable to keep the labels, because their value is entirely in being reused.

## Conceptual minimum

**Precision** is correct matches divided by proposed matches. **Recall** is correct matches divided by true matches that exist. Computing precision is easy: sample the proposals and judge them. Computing recall is harder, because it needs the denominator — pairs that *should* have matched, including ones the matcher never proposed.

That asymmetry drives the sampling design. A **precision sample** is drawn from the matcher's output. A **recall sample** must be drawn from the external records, then each one investigated to determine whether a true counterpart exists at all, which is slower per item and cannot be avoided if recall is to mean anything.

The second idea is **stratification**. A uniform sample of a national dataset is dominated by easy rural cases, and the resulting figure is a flattering average over slices that behave nothing alike. Sampling within strata — by density, by feature class — and reporting per stratum is what makes the numbers informative.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 239" role="img" aria-labelledby="mcp1-t mcp1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="mcp1-t">Why the two metrics need two different samples</title>
  <desc id="mcp1-d">Three panels. A precision sample is drawn from the matches the system proposed and asks of each whether it is correct, which is quick to judge because both sides are in front of the labeller. A recall sample is drawn from the external records regardless of outcome and asks whether a true counterpart exists in OSM at all, which requires searching and is several times slower per item. The stratification panel explains that both samples must be drawn within strata, because a uniform draw is dominated by the easy cases and produces an average that describes no real slice.</desc>
  <rect x="0" y="0" width="880" height="239" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Two metrics, two samples, one stratification</text>
  <rect x="26" y="52" width="259" height="153" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Precision sample</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Drawn from proposals</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Is this match correct?</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Both sides in front of you</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Fast to judge</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Sample a few hundred</text>
  <rect x="311" y="52" width="259" height="153" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Recall sample</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Drawn from all records</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Does a counterpart exist?</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Requires searching OSM</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Several times slower</text>
  <text x="325" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Sample fewer, stratified</text>
  <rect x="595" y="52" width="259" height="153" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Stratification</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Both samples, within strata</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Density and feature class</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Uniform favours easy cases</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Report per stratum</text>
  <text x="609" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Never only the aggregate</text>
  <text x="868" y="223" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Teams measure precision and skip recall because the sampling is harder, and then cannot say what their matcher is missing.</text>
</svg>
<figcaption>Recall is the expensive number and the one that reveals whether the candidate radius was ever right.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
import math
import random
from collections import defaultdict
from dataclasses import dataclass

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.conflate.metrics")


@dataclass(frozen=True)
class Labelled:
    record_id: str
    stratum: str
    proposed: bool          # did the matcher propose a match for this record?
    correct: bool | None    # was the proposal right? None when none was made
    truth_exists: bool      # does a true counterpart exist in OSM at all?


def wilson(successes: int, total: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson score interval: honest at small n, unlike the naive one.

    A naive interval around 19/20 extends above 1.0, which is not a
    probability; Wilson stays inside the unit interval and is the right
    default for the sample sizes hand labelling can afford.
    """
    if total == 0:
        return (0.0, 0.0)
    p = successes / total
    denom = 1 + z * z / total
    centre = (p + z * z / (2 * total)) / denom
    spread = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denom
    return (max(0.0, centre - spread), min(1.0, centre + spread))


def stratified_sample(records: list[dict], per_stratum: int,
                      stratum_key: str = "stratum",
                      seed: int = 20260917) -> list[dict]:
    """Draw an equal number from each stratum, reproducibly."""
    by_stratum: dict[str, list[dict]] = defaultdict(list)
    for record in records:
        by_stratum[record[stratum_key]].append(record)

    rng = random.Random(seed)       # fixed seed: the sample must be re-drawable
    sample: list[dict] = []
    for stratum, members in sorted(by_stratum.items()):
        take = min(per_stratum, len(members))
        if take < per_stratum:
            logger.warning("stratum %s has only %d record(s)", stratum, len(members))
        sample.extend(rng.sample(members, take))
    logger.info("drew %d record(s) across %d stratum(s)",
                len(sample), len(by_stratum))
    return sample


def metrics(labels: list[Labelled]) -> dict[str, dict[str, float]]:
    """Precision and recall overall and per stratum, with intervals."""
    buckets: dict[str, list[Labelled]] = defaultdict(list)
    for label in labels:
        buckets["ALL"].append(label)
        buckets[label.stratum].append(label)

    out: dict[str, dict[str, float]] = {}
    for name, group in sorted(buckets.items()):
        proposed = [l for l in group if l.proposed]
        correct = [l for l in proposed if l.correct]
        truths = [l for l in group if l.truth_exists]
        found = [l for l in truths if l.proposed and l.correct]

        precision = len(correct) / len(proposed) if proposed else 0.0
        recall = len(found) / len(truths) if truths else 0.0
        p_lo, p_hi = wilson(len(correct), len(proposed))
        r_lo, r_hi = wilson(len(found), len(truths))
        f1 = (2 * precision * recall / (precision + recall)
              if precision + recall else 0.0)

        out[name] = {
            "precision": precision, "precision_lo": p_lo, "precision_hi": p_hi,
            "recall": recall, "recall_lo": r_lo, "recall_hi": r_hi,
            "f1": f1, "n_proposed": len(proposed), "n_truths": len(truths),
        }
        logger.info("%-16s precision %.2f [%.2f-%.2f]  recall %.2f [%.2f-%.2f] "
                    "(n=%d/%d)", name, precision, p_lo, p_hi,
                    recall, r_lo, r_hi, len(proposed), len(truths))
    return out


def regression_check(current: dict, baseline: dict, tolerance: float = 0.03) -> bool:
    """Fail when any stratum's precision fell, not just the aggregate."""
    ok = True
    for stratum, values in current.items():
        before = baseline.get(stratum)
        if before is None:
            continue
        drop = before["precision"] - values["precision"]
        if drop > tolerance:
            logger.error("%s precision fell %.3f (%.2f -> %.2f)", stratum, drop,
                         before["precision"], values["precision"])
            ok = False
    return ok


if __name__ == "__main__":
    logger.info("label once, re-score on every matcher change")
```

## Step-by-step walkthrough

1. **Fix the random seed.** A sample that cannot be redrawn identically is a sample whose labels cannot be reused, which defeats the whole point of labelling.
2. **Sample equally per stratum, not proportionally.** Proportional sampling reproduces the dataset's imbalance and leaves the interesting strata with too few items to say anything about.
3. **Warn on thin strata.** A stratum with fewer records than the target sample size will produce a wide interval, and knowing that in advance prevents over-reading its number.
4. **Record three facts per label.** Whether a match was proposed, whether it was correct, and whether a true counterpart exists. Precision needs the first two; recall needs the first and third.
5. **Use a Wilson interval.** At the sample sizes hand labelling affords, the naive interval extends outside the unit range and understates uncertainty near the extremes. Wilson does neither.
6. **Report the interval, not just the point.** "Precision 0.94" from twenty items means something very different from the same figure from four hundred, and the interval is what makes that visible.
7. **Regression-check per stratum.** An aggregate that holds steady while one stratum falls sharply is the normal shape of a quality regression, and only a per-stratum check catches it.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 288" role="img" aria-labelledby="mcp2-t mcp2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="mcp2-t">How the confidence interval narrows as the labelled sample grows</title>
  <desc id="mcp2-d">Five sample sizes with the width of the Wilson interval around a precision of ninety percent. At twenty labelled items the interval spans roughly thirty percentage points, which is too wide to distinguish good from mediocre. At fifty it spans about eighteen. At one hundred it spans about twelve. At three hundred it spans about seven. At one thousand it spans about four. A note observes that three hundred per stratum is the usual sweet spot between labelling effort and a usable interval.</desc>
  <rect x="0" y="0" width="880" height="288" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Interval width around 90% precision, by sample size</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">20 labelled</text>
  <rect x="216" y="60" width="518" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 30 points</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">50 labelled</text>
  <rect x="216" y="100" width="311" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 18 points</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">100 labelled</text>
  <rect x="216" y="140" width="207" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 12 points</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">300 labelled</text>
  <rect x="216" y="180" width="121" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 7 points</text>
  <text x="26" y="234" font-size="11.5" font-weight="600" fill="currentColor">1000 labelled</text>
  <rect x="216" y="220" width="69" height="18" rx="4" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="854" y="234" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 4 points</text>
  <text x="868" y="272" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Below about fifty items per stratum the interval is wider than the differences you are trying to detect between matcher versions.</text>
</svg>
<figcaption>Three hundred per stratum is where labelling effort and interval width stop trading well against each other.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="mcp3-t mcp3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="mcp3-t">What a labelled sample is worth once it exists</title>
  <desc id="mcp3-d">Four uses of one labelled sample, in increasing order of value. Scoring it once establishes where the matcher currently stands. Re-scoring on each change turns every matcher edit into a measured improvement or regression rather than an opinion. Calibrating thresholds against it replaces guessed cut-offs with ones chosen to hit a stated precision. Regression-checking every stratum turns a silent quality drift into a failed check that names the slice that moved.</desc>
  <defs><marker id="mcp3-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">One afternoon of labelling, four returns</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">score once</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">where you stand</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">a number, not a hope</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#mcp3-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">re-score</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">per matcher change</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">improvement or regression</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#mcp3-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">calibrate</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">thresholds from evidence</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">hit a stated precision</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#mcp3-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">regress-check</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">every stratum</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">names the slice</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Only the first of these needs the labelling effort; the other three are free once the labels exist and are kept.</text>
</svg>
<figcaption>Teams that label once and never re-score have paid the whole cost and collected a quarter of the benefit.</figcaption>
</figure>

## Verification

- **The sample redraws identically.** Run the sampler twice with the same seed and confirm the two samples are the same.
- **Strata are balanced.** Every stratum should have the target count, or a warning explaining why not.
- **Intervals stay inside the unit range.** A reported upper bound above one means the naive interval is being used.
- **Precision and recall move in opposite directions.** Tighten a threshold and confirm precision rises while recall falls; if both move together, something is wrong with the labels.
- **The regression check catches a planted drop.** Degrade one stratum deliberately and confirm the check fails.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Flattering precision, real complaints | Uniform sample dominated by easy cases | Stratify and sample equally per stratum |
| Labels cannot be reused | Sample drawn without a fixed seed | Seed the sampler and record the seed |
| Recall cannot be computed | Only proposals labelled | Label records regardless of outcome for the denominator |
| Confidence bound above one | Naive interval used | Use a Wilson score interval |
| Regression missed | Only the aggregate compared | Compare every stratum against its own baseline |
| Numbers drift over releases | Sample scored once and never again | Re-score on every matcher change |
| Both metrics move together | Labels inconsistent between sessions | Write down the labelling rule and apply it uniformly |

## Specification reference

> The Wilson score interval for a binomial proportion is centred on a shrunken estimate and remains within the unit interval for all sample sizes, unlike the normal-approximation interval which can extend beyond it and understates uncertainty for proportions near zero or one. It is the recommended default for the small samples typical of hand-labelled evaluation sets. See any standard treatment of binomial proportion confidence intervals for the derivation and the comparison against alternatives.

## Frequently Asked Questions

<details>
<summary>Why sample equally per stratum rather than proportionally?</summary>

Because a proportional sample reproduces the dataset's imbalance, and the strata you most need to measure — dense urban areas, unnamed feature classes — are usually the small ones. Sampling equally gives each stratum enough items for a usable interval, at the cost of the overall figure no longer being a population estimate. That is the right trade, because the per-stratum numbers are the useful ones anyway.
</details>

<details>
<summary>How do I measure recall without labelling everything?</summary>

By sampling from the external records rather than from the matcher's output, and determining for each sampled record whether a true OSM counterpart exists at all. That gives the denominator recall needs. It is several times slower per item than precision labelling, because it involves searching rather than judging, which is why the recall sample is usually smaller and more heavily stratified.
</details>

<details>
<summary>Is an F1 score useful here?</summary>

As a single summary for tracking over time, yes; as a basis for decisions, rarely. It weights precision and recall equally, and conflation almost never does — an import wants precision heavily favoured, an enrichment often the reverse. Report it if it helps somebody see a trend, but make the decision on whichever of the two numbers actually matters for the destination.
</details>

<details>
<summary>How often should the sample be re-scored?</summary>

On every change to the matcher, which with stored labels costs minutes. The value of a labelled sample is entirely in reuse: labelling once and scoring once tells you where you were, while labelling once and scoring on every change tells you whether each change helped. Add the per-stratum regression check to the same run and quality drift becomes a failed check rather than a complaint months later.
</details>

## Related

- [Conflation QA & Rollback](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/) — the parent topic and where these metrics are reported.
- [Scoring Conflation Candidates with Multiple Signals](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/scoring-conflation-candidates-with-multiple-signals/) — the thresholds these numbers calibrate.
- [Auditing a Conflation Run Before Upload](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/auditing-a-conflation-run-before-upload/) — the evidence pack these metrics go into.
- [Setting Quality Thresholds That Fail a Build](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/setting-quality-thresholds-that-fail-a-build/) — turning the regression check into a gate.
- [Matching OSM Features to External Datasets](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/) — the matcher under measurement.

Up one level: [Conflation QA & Rollback](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Measuring Conflation Precision and Recall",
  "description": "Design a stratified labelled sample, compute precision and recall with honest confidence intervals, and break the numbers down so the slices that fail are visible.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Conflation & Data Enrichment",
  "about": ["precision and recall", "stratified sampling", "Wilson interval"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Conflation & Data Enrichment", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/" },
    { "@type": "ListItem", "position": 3, "name": "Conflation QA & Rollback", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/" },
    { "@type": "ListItem", "position": 4, "name": "Measuring Conflation Precision and Recall", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/measuring-conflation-precision-and-recall/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Measure a conflation matcher's precision and recall",
  "description": "Draw a seeded stratified sample, label proposals and records separately for the two metrics, compute Wilson intervals, report per stratum, and regression-check every slice on each matcher change.",
  "step": [
    { "@type": "HowToStep", "name": "Define the strata", "text": "Choose density bands, feature classes and regions before sampling, since these are the slices the numbers must be reported over." },
    { "@type": "HowToStep", "name": "Draw a seeded sample", "text": "Sample equally within each stratum using a fixed seed so the sample and its labels can be reused." },
    { "@type": "HowToStep", "name": "Label for both metrics", "text": "Record whether a match was proposed, whether it was correct, and whether a true counterpart exists at all." },
    { "@type": "HowToStep", "name": "Compute Wilson intervals", "text": "Report each proportion with a Wilson score interval, which stays inside the unit range at small sample sizes." },
    { "@type": "HowToStep", "name": "Report per stratum", "text": "Publish precision and recall for every stratum alongside the aggregate, since the aggregate averages unlike slices." },
    { "@type": "HowToStep", "name": "Regression-check each slice", "text": "Compare every stratum against its own baseline and fail on a drop, rather than watching only the overall figure." }
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
      "name": "Why sample equally per stratum rather than proportionally?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because a proportional sample reproduces the dataset's imbalance, and the strata you most need to measure are usually the small ones. Sampling equally gives each stratum enough items for a usable interval, at the cost of the overall figure no longer being a population estimate — which is the right trade, because the per-stratum numbers are the useful ones." }
    },
    {
      "@type": "Question",
      "name": "How do I measure conflation recall without labelling everything?",
      "acceptedAnswer": { "@type": "Answer", "text": "By sampling from the external records rather than from the matcher's output, and determining for each sampled record whether a true OSM counterpart exists at all. That gives the denominator recall needs. It is several times slower per item than precision labelling, which is why the recall sample is usually smaller and more heavily stratified." }
    },
    {
      "@type": "Question",
      "name": "Is an F1 score useful for conflation?",
      "acceptedAnswer": { "@type": "Answer", "text": "As a single summary for tracking over time, yes; as a basis for decisions, rarely. It weights precision and recall equally, and conflation almost never does — an import wants precision heavily favoured, an enrichment often the reverse. Make the decision on whichever number actually matters for the destination." }
    },
    {
      "@type": "Question",
      "name": "How often should a conflation sample be re-scored?",
      "acceptedAnswer": { "@type": "Answer", "text": "On every change to the matcher, which with stored labels costs minutes. Labelling once and scoring once tells you where you were; labelling once and scoring on every change tells you whether each change helped. Add a per-stratum regression check and quality drift becomes a failed check rather than a complaint months later." }
    }
  ]
}
</script>
