---
title: "Setting Quality Thresholds That Fail a Build"
description: "Derive OSM quality thresholds from the metric's own observed variation instead of picking round numbers, so the gate catches a truncated extract without firing every time a mapping party happens."
pageTitle: "Choosing OSM Quality Thresholds From Observed Data"
pageDescription: "Build a rolling band per metric from passing runs, add absolute floors and directional asymmetry, and keep the false-positive rate low enough that people still believe the gate."
slug: setting-quality-thresholds-that-fail-a-build
type: article
breadcrumb: "Quality Thresholds"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Setting Quality Thresholds That Fail a Build

A threshold picked as a round number is wrong for every metric it is applied to: too tight for the volatile ones, far too loose for the stable ones, and unable to tell you which is which.

## Prerequisites

- [ ] Metrics recorded from previous runs, per [Continuous QA for OSM Pipelines](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/).
- [ ] Python 3.10+; the code below uses `statistics` from the standard library.
- [ ] At least a couple of weeks of history before trusting any derived band.
- [ ] A decision about which metrics are critical, which is a business question rather than a statistical one.

## Conceptual minimum

A threshold answers one question: **is today's value surprising given how this metric normally behaves?** Answering it needs the metric's own history, and three properties of that history matter.

**Spread differs enormously between metrics.** A national building count moves by fractions of a percent between daily runs. A count of ferry terminals in the same extract can move by ten percent when one person maps a harbour. One threshold cannot serve both, and expressing the band in units of the metric's own observed variation — a robust measure of spread rather than a fixed percentage — is what makes a single rule work across all of them.

**The median is safer than the mean.** A single catastrophic run drags a mean badly and inflates a standard deviation, which widens the band exactly when it should not. The median and the median absolute deviation resist that, so one bad value in the window does not open the gate for the next one.

**Direction is asymmetric.** In an OSM pipeline a sudden drop is far more often a defect than a sudden rise: truncated extracts, dropped tags and failed joins all remove data. Genuine growth removes nothing. A band tighter downward than upward reflects the actual probability of a defect rather than treating both tails as equally suspicious.

Layered on top, an **absolute floor** covers the failure the rolling band cannot see. If the pipeline degrades gradually across several runs, each one is within the band relative to the last, and the band follows the degradation down. A hard minimum, set from what the dataset is actually supposed to contain, is crude and catches precisely that.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="sqt1-t sqt1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="sqt1-t">Why a fixed percentage threshold cannot work across metrics</title>
  <desc id="sqt1-d">Three panels showing the same ten percent threshold applied to three metrics. A national building count normally varies by about a quarter of a percent between runs, so a ten percent threshold only fires after a catastrophic loss and misses a genuine forty thousand feature regression entirely. A count of ferry terminals normally varies by about eight percent, so a ten percent threshold fires roughly every other week on ordinary mapping activity. A count of features carrying a rare tag normally varies by more than thirty percent, so the same threshold fires constantly and is switched off within a month.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">One threshold, three metrics, three wrong answers</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Buildings, national</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Normal move: 0.25%</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">10% fires almost never</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Misses real regressions</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Far too loose</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Ferry terminals</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Normal move: 8%</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">10% fires fortnightly</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Ordinary mapping activity</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Roughly borderline</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">A rare tag</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Normal move: 30%+</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">10% fires constantly</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Switched off in a month</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Far too tight</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The band has to be expressed in each metric's own units of variation, which is the one thing a percentage cannot do.</text>
</svg>
<figcaption>The same number is simultaneously too loose and too tight, depending on which row you read.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import json
import logging
import statistics
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.qa.thresholds")

MIN_HISTORY = 10          # below this, a derived band means nothing
DOWN_K = 4.0              # a drop is usually a defect: tighter
UP_K = 8.0                # growth rarely is: looser


@dataclass(frozen=True)
class Rule:
    metric: str
    critical: bool = False        # does a breach block publication?
    floor: float | None = None    # absolute minimum, independent of history
    ceiling: float | None = None
    down_k: float = DOWN_K
    up_k: float = UP_K


@dataclass(frozen=True)
class Verdict:
    metric: str
    value: float
    low: float | None
    high: float | None
    ok: bool
    reason: str
    blocking: bool


def robust_spread(values: Sequence[float]) -> float:
    """Median absolute deviation, scaled to compare with a standard deviation.

    Resists a single catastrophic run, which a standard deviation does not:
    one bad value widens an SD band exactly when it should be narrowing.
    """
    centre = statistics.median(values)
    deviations = [abs(v - centre) for v in values]
    return statistics.median(deviations) * 1.4826


def band(history: Sequence[float], rule: Rule) -> tuple[float, float]:
    centre = statistics.median(history)
    spread = robust_spread(history)
    if spread == 0:                       # a perfectly constant metric
        spread = max(abs(centre) * 0.001, 1.0)
    return centre - rule.down_k * spread, centre + rule.up_k * spread


def evaluate(rule: Rule, value: float, history: Sequence[float]) -> Verdict:
    if rule.floor is not None and value < rule.floor:
        return Verdict(rule.metric, value, rule.floor, None, False,
                       f"below the absolute floor of {rule.floor:,.0f}", True)
    if rule.ceiling is not None and value > rule.ceiling:
        return Verdict(rule.metric, value, None, rule.ceiling, False,
                       f"above the absolute ceiling of {rule.ceiling:,.0f}", True)

    if len(history) < MIN_HISTORY:
        return Verdict(rule.metric, value, None, None, True,
                       f"only {len(history)} run(s) of history; band not derived",
                       False)

    low, high = band(history, rule)
    if low <= value <= high:
        return Verdict(rule.metric, value, low, high, True, "within band", False)

    centre = statistics.median(history)
    move = (value - centre) / centre * 100 if centre else float("inf")
    reason = (f"{value:,.0f} is {move:+.1f}% against a median of {centre:,.0f}; "
              f"band is {low:,.0f} to {high:,.0f}")
    return Verdict(rule.metric, value, low, high, False, reason, rule.critical)


def run(rules: Iterable[Rule], current: dict[str, float],
        history_path: Path) -> int:
    history: dict[str, list[float]] = (
        json.loads(history_path.read_text(encoding="utf-8"))
        if history_path.exists() else {})

    blocking = 0
    for rule in rules:
        if rule.metric not in current:
            logger.error("%s: metric absent from this run", rule.metric)
            blocking += 1
            continue
        verdict = evaluate(rule, current[rule.metric],
                           history.get(rule.metric, []))
        level = logger.info if verdict.ok else (
            logger.error if verdict.blocking else logger.warning)
        level("%-32s %s", verdict.metric, verdict.reason)
        blocking += int(verdict.blocking)

    logger.info("%d blocking breach(es)", blocking)
    return blocking


def record(history_path: Path, current: dict[str, float],
           window: int = 30) -> None:
    """Only ever called after a PASSING run.

    Recording a degraded run teaches the band that the degradation is normal,
    and the gate then follows the pipeline down rather than stopping it.
    """
    history: dict[str, list[float]] = (
        json.loads(history_path.read_text(encoding="utf-8"))
        if history_path.exists() else {})
    for metric, value in current.items():
        series = history.setdefault(metric, [])
        series.append(value)
        del series[:-window]
    history_path.write_text(json.dumps(history, indent=1), encoding="utf-8")


RULES = [
    Rule("buildings.count", critical=True, floor=2_000_000),
    Rule("highways.count", critical=True, floor=400_000),
    Rule("addr_housenumber.coverage_pct", critical=False, floor=10.0),
    Rule("ferry_terminals.count", critical=False, down_k=6.0, up_k=10.0),
    Rule("geometry.invalid_pct", critical=True, ceiling=0.01, up_k=3.0),
]

if __name__ == "__main__":
    logger.info("bands from observed spread; floors from what must be true")
```

## Step-by-step walkthrough

1. **Use the median, not the mean.** One catastrophic run in the window should not widen the band that has to catch the next one.
2. **Use the median absolute deviation for spread.** Scaled by 1.4826 it is comparable to a standard deviation for normal data and far more stable for real data.
3. **Refuse to derive a band from thin history.** Under ten runs the derived band is arbitrary, and saying so explicitly is better than passing everything silently.
4. **Make the downward multiplier smaller than the upward one.** A drop is much more likely to be a defect, and the band should say so.
5. **Set floors from what the dataset must contain.** These are not statistical; they are the answer to "below what number is this obviously broken", and they are the only defence against gradual drift.
6. **Handle a zero spread.** A metric that has never moved gives a spread of zero and a band of a single point, which fires on the first legitimate change.
7. **Mark criticality per rule, not per severity.** Whether a breach blocks is a decision about the metric, taken once, written down.
8. **Treat an absent metric as a failure.** A check that silently passes because its input disappeared is worse than no check.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 292" role="img" aria-labelledby="sqt2-t sqt2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="sqt2-t">How a rolling band follows a gradual degradation, and what a floor does</title>
  <desc id="sqt2-d">A timeline of four marks tracking a metric across successive runs. At the first run the value is healthy at four point one million and the band sits around it. At the second the value has fallen three percent, which is within the band because the band was derived from the healthy history, so the run passes and its value is recorded. At the third the band has shifted down because the recorded history now includes the degraded value, so a further three percent fall is again within band. By the fourth run the metric has lost a quarter of its features through a series of individually unremarkable steps, and only an absolute floor set from what the dataset must contain ever fires.</desc>
  <defs><marker id="sqt2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="292" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">A band that follows the data down</text>
  <line x1="26" y1="150" x2="848" y2="150" stroke="currentColor" stroke-width="1.8" marker-end="url(#sqt2-a)"/>
  <rect x="35" y="52" width="189" height="66" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="130" y="76" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">Run 1</text>
  <text x="130" y="94" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">4.10M, healthy</text>
  <text x="130" y="110" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">band around it</text>
  <line x1="130" y1="118" x2="130" y2="143" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="130" cy="150" r="5" fill="var(--osm-accent,#0369a1)"/>
  <rect x="242" y="176" width="189" height="66" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="336" y="200" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">Run 2</text>
  <text x="336" y="218" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">3.98M, within band</text>
  <text x="336" y="234" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">passes, recorded</text>
  <line x1="336" y1="176" x2="336" y2="157" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="336" cy="150" r="5" fill="var(--osm-ok,#15803d)"/>
  <rect x="449" y="52" width="189" height="66" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="544" y="76" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">Run 3</text>
  <text x="544" y="94" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">band has shifted down</text>
  <text x="544" y="110" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">passes again</text>
  <line x1="544" y1="118" x2="544" y2="143" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="544" cy="150" r="5" fill="var(--osm-warn,#a16207)"/>
  <rect x="656" y="176" width="189" height="66" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="750" y="200" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">Run 4</text>
  <text x="750" y="218" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">3.10M cumulative</text>
  <text x="750" y="234" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">only a floor fires</text>
  <line x1="750" y1="176" x2="750" y2="157" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="750" cy="150" r="5" fill="var(--osm-alt,#6d28d9)"/>
  <text x="868" y="276" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Recording history solely from passing runs does not help here, because each of these runs passed at the time it ran.</text>
</svg>
<figcaption>The relative band and the absolute floor catch different failures; neither substitutes for the other.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 306" role="img" aria-labelledby="sqt3-t sqt3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="sqt3-t">Choosing what kind of threshold a metric needs</title>
  <desc id="sqt3-d">A decision with three branches. A metric whose value must never fall below some level regardless of history, such as a national building count, needs an absolute floor, which is the only check that survives a gradual degradation. A metric that is stationary around a stable level, such as an invalid-geometry percentage, needs a rolling band derived from its own median and spread. A metric that legitimately trends, such as total features in an actively mapped region, needs the band applied to the run-over-run change rather than the level, because the level will eventually breach an upward bound just by continuing to grow.</desc>
  <defs><marker id="sqt3-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="306" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Floor, band, or band on the change</text>
  <rect x="26" y="117" width="250" height="88" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.6"/>
  <text x="151" y="145" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">How does this metric behave?</text>
  <text x="151" y="167" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Most metrics need two of the three</text>
  <text x="151" y="185" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Only trending ones need the third</text>
  <line x1="276" y1="161" x2="314" y2="161" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="314" y2="239" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="353" y2="83" stroke="currentColor" stroke-width="1.4" marker-end="url(#sqt3-a)"/>
  <rect x="356" y="52" width="498" height="62" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="370" y="77" font-size="12" font-weight="700" fill="currentColor">Must never fall below a level</text>
  <text x="370" y="97" font-size="10.5" fill="currentColor" opacity="0.88">An absolute floor: the only check a gradual drift cannot walk downward</text>
  <line x1="314" y1="161" x2="353" y2="161" stroke="currentColor" stroke-width="1.4" marker-end="url(#sqt3-a)"/>
  <rect x="356" y="130" width="498" height="62" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="370" y="155" font-size="12" font-weight="700" fill="currentColor">Stationary around a level</text>
  <text x="370" y="175" font-size="10.5" fill="currentColor" opacity="0.88">A rolling band from its own median and robust spread</text>
  <line x1="314" y1="239" x2="353" y2="239" stroke="currentColor" stroke-width="1.4" marker-end="url(#sqt3-a)"/>
  <rect x="356" y="208" width="498" height="62" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="370" y="233" font-size="12" font-weight="700" fill="currentColor">Legitimately trending</text>
  <text x="370" y="253" font-size="10.5" fill="currentColor" opacity="0.88">Band the run-over-run change, which stays stationary when the level does not</text>
  <text x="868" y="290" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">A critical metric usually gets both a floor and a band, because they fail on different things and neither covers the other.</text>
</svg>
<figcaption>Deciding which of these a metric needs takes a minute and is the whole design of the check.</figcaption>
</figure>

## Verification

- **A synthetic drop fires.** Halve a metric in the current run and confirm the band is breached.
- **Ordinary variation does not.** Replay a fortnight of real history through the evaluator and count false positives; it should be near zero.
- **Thin history is reported, not hidden.** Run against three data points and confirm the output says the band was not derived.
- **Floors work independently.** Set a value below the floor but within the band and confirm it still fails.
- **An absent metric fails.** Remove a metric from the current run and confirm a blocking error.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Gate fires weekly on normal variation | Fixed percentage threshold | Derive the band from the metric's own spread |
| A real regression passes | Band widened by an earlier bad run | Use the median and median absolute deviation |
| Gradual degradation never caught | Relative band follows the trend | Add an absolute floor per critical metric |
| Everything passes on a new pipeline | Band derived from two data points | Require a minimum history before deriving |
| Constant metric fires on first change | Zero spread gives a single-point band | Floor the spread at a small fraction of the value |
| Growth treated as suspicious as loss | Symmetric band | Use a larger upward multiplier |
| A check silently stops running | Metric absent, evaluated as pass | Treat a missing metric as a blocking failure |

## Specification reference

> The median absolute deviation of a sample is the median of the absolute deviations from the sample median. Multiplying it by approximately 1.4826 yields a consistent estimator of the standard deviation for normally distributed data, while retaining a breakdown point of fifty percent — meaning up to half the observations may be arbitrarily corrupted without affecting the estimate. See standard references on robust statistics, and [Continuous QA for OSM Pipelines](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/) for where these thresholds are evaluated.

## Frequently Asked Questions

<details>
<summary>How much history is enough?</summary>

Ten runs makes the band meaningful and thirty makes it stable, which for a daily pipeline is a month. The more useful framing is that the window should cover the metric's natural cycle: if the data has a weekly rhythm, a window of five runs will alias against it and produce bands that are tight on quiet days and loose on busy ones. Covering several full cycles removes that.
</details>

<details>
<summary>What about metrics that legitimately trend?</summary>

A metric growing steadily — total feature count in an actively mapped region — will sit near the top of a band derived from its own past, and eventually breach the upper bound simply by continuing to grow. The fix is to band the change rather than the level: apply the same machinery to the run-over-run difference, which is stationary even when the level is not.
</details>

<details>
<summary>Should thresholds be checked into the repository?</summary>

The rules should be — the metric names, criticality, floors and multipliers are decisions, and decisions belong in review. The derived bands should not, because they change every run and would produce a commit per execution. Keeping the policy in version control and the history in a data store separates the part somebody chose from the part that is computed.
</details>

<details>
<summary>How do you set an absolute floor without guessing?</summary>

From the lowest value the metric has ever legitimately held, reduced by a comfortable margin. The floor is not trying to detect subtle problems; it is trying to catch the case where the relative band has been dragged somewhere absurd. A floor at half the historical minimum will never fire on a healthy pipeline and will fire long before a degradation becomes permanent, which is exactly the job.
</details>

## Related

- [Continuous QA for OSM Pipelines](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/) — the parent topic.
- [Running OSM Validation in GitHub Actions](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/running-osm-validation-in-github-actions/) — where these thresholds are evaluated.
- [Generating an OSM Data Quality Report](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/generating-an-osm-data-quality-report/) — presenting a breach so somebody can act on it.
- [Finding Statistical Outliers in OSM Tag Values](https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/finding-statistical-outliers-in-osm-tag-values/) — the same robust statistics applied within a single run.
- [Replication Monitoring & Lag Alerting](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-monitoring-and-lag-alerting/) — threshold selection for the freshness signals.

Up one level: [Continuous QA for OSM Pipelines](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Setting Quality Thresholds That Fail a Build",
  "description": "Derive OSM quality thresholds from the metric's own observed variation instead of picking round numbers, so the gate catches a truncated extract without firing every time a mapping party happens.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Data Quality & Validation",
  "about": ["quality thresholds", "robust statistics", "build gates"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Quality & Validation", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/" },
    { "@type": "ListItem", "position": 3, "name": "Continuous QA for OSM Pipelines", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/" },
    { "@type": "ListItem", "position": 4, "name": "Setting Quality Thresholds That Fail a Build", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/setting-quality-thresholds-that-fail-a-build/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Derive OSM quality thresholds from observed data",
  "description": "Compute a band per metric from the median and median absolute deviation of passing runs, make it asymmetric downward, back it with absolute floors, and treat a missing metric as a failure.",
  "step": [
    { "@type": "HowToStep", "name": "Centre on the median", "text": "Use the median rather than the mean so one catastrophic run does not move the centre." },
    { "@type": "HowToStep", "name": "Measure spread robustly", "text": "Use the median absolute deviation scaled by 1.4826 so a bad value cannot widen the band." },
    { "@type": "HowToStep", "name": "Require sufficient history", "text": "Refuse to derive a band from fewer than about ten runs and say so explicitly." },
    { "@type": "HowToStep", "name": "Make the band asymmetric", "text": "Use a smaller downward multiplier, since a drop is far more likely to be a defect than a rise." },
    { "@type": "HowToStep", "name": "Add absolute floors", "text": "Set a hard minimum per critical metric so a gradual degradation cannot walk the band downward." },
    { "@type": "HowToStep", "name": "Handle zero spread", "text": "Floor the spread at a small fraction of the value so a constant metric does not fire on its first change." },
    { "@type": "HowToStep", "name": "Fail on a missing metric", "text": "Treat an absent metric as blocking, since a check that stops running silently passes forever." }
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
      "name": "How much history is needed to derive a quality threshold?",
      "acceptedAnswer": { "@type": "Answer", "text": "Ten runs makes a band meaningful and thirty makes it stable. More usefully, the window should cover the metric's natural cycle: if the data has a weekly rhythm, a five-run window aliases against it and produces bands that are tight on quiet days and loose on busy ones." }
    },
    {
      "@type": "Question",
      "name": "What about OSM metrics that legitimately trend upward?",
      "acceptedAnswer": { "@type": "Answer", "text": "A steadily growing metric will sit near the top of a band derived from its past and eventually breach it simply by continuing to grow. Band the run-over-run change instead, which is stationary even when the level is not." }
    },
    {
      "@type": "Question",
      "name": "Should quality thresholds be checked into version control?",
      "acceptedAnswer": { "@type": "Answer", "text": "The rules should be — metric names, criticality, floors and multipliers are decisions and belong in review. The derived bands should not, since they change every run. Keep the policy in version control and the history in a data store." }
    },
    {
      "@type": "Question",
      "name": "How do you choose an absolute floor without guessing?",
      "acceptedAnswer": { "@type": "Answer", "text": "From the lowest value the metric has legitimately held, reduced by a comfortable margin. The floor is not trying to detect subtle problems; it catches the case where the relative band has been dragged somewhere absurd. Half the historical minimum works well." }
    }
  ]
}
</script>
