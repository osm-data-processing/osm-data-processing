---
title: "Continuous QA for OSM Pipelines"
description: "Run OSM validation as part of every pipeline execution rather than as an occasional audit: what to check, where to check it, which thresholds should stop a build, and how to keep the gate from being ignored."
pageTitle: "Running OSM Data Validation Continuously in a Pipeline"
pageDescription: "Turn OSM quality checks into a gate that runs on every build, with thresholds derived from observed data, a report somebody reads, and a failure mode people trust enough not to override."
slug: continuous-qa-for-osm-pipelines
type: guide
breadcrumb: "Continuous QA"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Continuous QA for OSM Pipelines

Validation that runs when somebody remembers is not validation; it is an occasional audit that tells you a problem has existed for an unknown length of time. The alternative is a gate that runs on every execution, knows what normal looks like, and stops the pipeline when the output stops resembling it.

The technical parts of this are straightforward — the rules from [Writing Custom OSM Validation Rules in Python](https://www.osm-data-processing.org/osm-data-quality-validation/writing-custom-osm-validation-rules-in-python/) run perfectly well in a CI job. What makes continuous QA hard is everything around them: choosing thresholds that survive ordinary variation, deciding which failures should stop a deployment, and producing a result that a person reading it at eight in the morning can act on rather than dismiss. A gate people override every week is worse than no gate, because it consumes attention while providing no protection.

This topic covers the shape of that system. It assumes the rule-authoring material in this section and the pipeline structures in [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/).

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="cqa1-t cqa1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cqa1-t">Three places validation can run, and what each one can still prevent</title>
  <desc id="cqa1-d">Three panels. Validation on a pull request runs against a sample or a fixture and catches logic errors in the pipeline code before they are merged, but it cannot see production data volumes or real upstream changes. Validation after a build, before publication, runs against the full output and can still stop a bad dataset from reaching consumers, which is the only position where a gate genuinely gates. Validation after publication runs against live data and catches what the earlier stages missed, but by then consumers are already reading it and the remedy is a rollback rather than a prevention.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Where a check sits decides what it can prevent</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">On a pull request</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Sample or fixture data</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Catches code logic errors</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Blind to real volumes</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Cheap and fast</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Before publication</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Full production output</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Can still stop the release</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">The only real gate</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Costs build minutes</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">After publication</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Live data, real usage</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Catches what slipped</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Consumers already read it</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Remedy is rollback</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">All three are worth having, but only the middle one prevents anything, and it is the one most often skipped for build-time reasons.</text>
</svg>
<figcaption>A check that runs after publication is monitoring. Only a check before it is a gate.</figcaption>
</figure>

## The Problem This Topic Solves

An OSM pipeline's output degrades in ways that no exception reports. A parser update silently drops a tag that thirty thousand features depended on. An upstream extract arrives truncated and the pipeline processes it happily, producing a third of the usual rows. A normalisation rule that was correct for one region produces nonsense in another the first time that region is included. None of these throw; all of them produce a dataset that loads, queries and looks entirely plausible.

The only defence is to state what the output should look like and check it, every time. That statement has two halves: **absolute invariants** that must always hold — no null geometries, every identifier unique, coordinates within the world — and **relative expectations** derived from the last known-good run, which is where the interesting failures live. A drop from 4.1 million to 2.7 million buildings violates no invariant and is obviously wrong.

The reason this is not simply solved is that relative expectations are noisy. OSM genuinely changes; extracts genuinely vary; a mapping party genuinely adds forty thousand features in a weekend. A threshold tight enough to catch a truncated extract is loose enough to be tripped by a good week of mapping, and resolving that tension is most of the design work.

## Prerequisites

- [ ] A pipeline that runs on a schedule or a trigger, and produces a versioned output.
- [ ] Validation rules that run headlessly and exit with a meaningful status.
- [ ] A record of previous runs' metrics, since relative checks need history.
- [ ] Agreement on who is woken up when the gate fails, which is a prerequisite and not a detail.

## What to Check, and in What Order

Checks are worth ordering by cost and by how early they can fail, because a cheap check that catches a truncated input should never run after an expensive one.

**Input checks** run first and cost nothing. Does the extract exist, is its size within the expected range, does its checksum differ from last time, does its internal timestamp advance? A truncated or stale input is the single most common upstream failure and it is detectable before any processing.

**Structural checks** run on the output and assert invariants. Every geometry valid, every identifier unique, no coordinates outside the world, no required column null. These are cheap, they never produce false positives, and they should fail hard with no threshold at all.

**Statistical checks** compare the output against history. Feature counts by type, tag coverage rates, geometry-area distributions, null rates per column. These are where truncated extracts and dropped tags are caught, and where thresholds have to be chosen rather than asserted.

**Semantic checks** run last because they are expensive. Routing graph connectivity, boundary closure, address completeness against a reference. They catch the problems that matter most to consumers and they cost enough that they are often sampled rather than run exhaustively.

A useful discipline is that **each layer must pass before the next runs**. Statistical checks against an output that failed structural checks produce noise, and a report full of consequential failures buries the one that caused them.

## Choosing Thresholds That Survive an Ordinary Day

The temptation is to pick round numbers — alert on a ten percent change — and the result is a gate that fires on ordinary variation in small categories and never fires on a catastrophic change in large ones. Thresholds should come from the data.

The workable approach is to record each metric on every successful run, and derive the threshold from the observed distribution: a band of several standard deviations around a rolling median, or a percentile range from the last few weeks. This adapts to how variable each metric actually is, which differs by orders of magnitude between "number of buildings in Germany" and "number of ferry routes in a small region".

Two refinements matter. **Absolute floors** catch the case where a metric's history is itself wrong — after a series of degraded runs, a rolling band happily accepts continued degradation. A hard floor that says "never fewer than two million buildings" is crude and catches exactly that. **Directional asymmetry** reflects that in most OSM pipelines a sudden drop is far more likely to be a defect than a sudden rise, so the band should usually be tighter downward than upward.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 292" role="img" aria-labelledby="cqa2-t cqa2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cqa2-t">The four check layers in execution order, with where each fails</title>
  <desc id="cqa2-d">A timeline of four marks. Input checks run first, cost almost nothing, and catch a truncated, stale or duplicate extract before any processing happens. Structural checks run next against the output, assert invariants that admit no threshold, and fail hard on an invalid geometry or a duplicate identifier. Statistical checks compare the output against recorded history and catch dropped tags and partial data, which is where thresholds must be chosen from observed variation. Semantic checks run last because they are the most expensive, covering connectivity and completeness, and are often sampled rather than run exhaustively.</desc>
  <defs><marker id="cqa2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="292" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Cheapest first, most expensive last</text>
  <line x1="26" y1="150" x2="848" y2="150" stroke="currentColor" stroke-width="1.8" marker-end="url(#cqa2-a)"/>
  <rect x="35" y="52" width="189" height="66" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="130" y="76" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">Input</text>
  <text x="130" y="94" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">free, runs first</text>
  <text x="130" y="110" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">truncated or stale</text>
  <line x1="130" y1="118" x2="130" y2="143" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="130" cy="150" r="5" fill="var(--osm-accent,#0369a1)"/>
  <rect x="242" y="176" width="189" height="66" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="336" y="200" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">Structural</text>
  <text x="336" y="218" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">invariants, no threshold</text>
  <text x="336" y="234" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">invalid or duplicate</text>
  <line x1="336" y1="176" x2="336" y2="157" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="336" cy="150" r="5" fill="var(--osm-ok,#15803d)"/>
  <rect x="449" y="52" width="189" height="66" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="544" y="76" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">Statistical</text>
  <text x="544" y="94" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">compared to history</text>
  <text x="544" y="110" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">dropped tags, partials</text>
  <line x1="544" y1="118" x2="544" y2="143" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="544" cy="150" r="5" fill="var(--osm-warn,#a16207)"/>
  <rect x="656" y="176" width="189" height="66" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="750" y="200" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">Semantic</text>
  <text x="750" y="218" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">expensive, often sampled</text>
  <text x="750" y="234" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">connectivity, coverage</text>
  <line x1="750" y1="176" x2="750" y2="157" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="750" cy="150" r="5" fill="var(--osm-alt,#6d28d9)"/>
  <text x="868" y="276" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Each layer must pass before the next runs, or a single structural failure fills the report with consequences that hide it.</text>
</svg>
<figcaption>Ordering by cost also orders by specificity: the cheapest checks give the clearest diagnoses.</figcaption>
</figure>

## Making the Gate Trustworthy

A gate is only useful if people believe it, and belief is built from two properties.

**It must be actionable.** A failure that says "statistical check failed" sends somebody on a hunt. A failure that says "building count in the Bavaria extract fell 34 percent against a 14-day median of 4.1 million, first observed in run 8821" tells them where to look and roughly what happened. The cost of producing the second message is a few lines in the check; the cost of not producing it is measured in the hours it takes somebody to re-derive it.

**It must be rare.** A gate that fires weekly gets overridden weekly, and the override becomes reflexive long before the failure that mattered arrives. If a check fires often, the correct response is to fix the check — widen the band, split the metric, exclude the volatile category — not to train people to ignore it.

The related decision is **what a failure should do**. Blocking publication is right for structural failures and for statistical failures on critical metrics. For everything else, publishing with a recorded warning is usually better, because a pipeline that refuses to publish over a minor anomaly teaches people to bypass it. The distinction should be explicit in the check definition rather than implied by severity labels nobody reads.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="cqa3-t cqa3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cqa3-t">Four failure classes that raise no exception, and what catches each</title>
  <desc id="cqa3-d">A grid of four silent failures against the check layer that detects them and the signal that layer sees. A truncated upstream extract is caught by input checks, which see a file size well below the recorded range. A parser regression that drops a tag is caught by statistical checks, which see a null rate jumping for one column while row counts hold steady. A normalisation rule wrong for a newly included region is caught by statistical checks segmented by region, which see the anomaly confined to one area. Topology damage from a geometry change is caught by semantic checks, which see routing connectivity fall while every feature remains individually valid.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Silent failures and what sees them</text>
  <rect x="206" y="48" width="324" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="368" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Caught by</text>
  <rect x="530" y="48" width="324" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="692" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">The signal</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Truncated extract</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">input checks</text>
  <text x="692" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">size below the range</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Dropped tag</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">statistical checks</text>
  <text x="692" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">null rate jumps, rows flat</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Rule wrong in a region</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">segmented statistics</text>
  <text x="692" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">anomaly in one area</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Topology damage</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">semantic checks</text>
  <text x="692" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">connectivity falls</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Every row produces an output that loads, queries and looks plausible, which is why none of them reaches anybody as an error.</text>
</svg>
<figcaption>The third row is the argument for segmenting metrics rather than aggregating them globally.</figcaption>
</figure>

## Validation and Error Handling

| Check | What it catches | Response |
| --- | --- | --- |
| Input size and checksum | Truncated, stale or unchanged extract | Fail before processing; no build minutes wasted |
| Geometry validity and identifier uniqueness | Structural corruption in the output | Block publication; no threshold applies |
| Feature counts against a rolling band | Dropped tags, partial data, parser regressions | Block on critical metrics, warn on the rest |
| Null-rate per column | A normalisation rule that stopped matching | Warn, and block above an absolute ceiling |
| Routing connectivity sample | Topology damage from a geometry change | Block; consumers cannot work around it |
| Check runtime trend | A gate slowly becoming too slow to run | Reassess sampling before it gets skipped |

## Performance and Scale

The practical constraint on continuous QA is that a gate people wait for gets skipped. If validation adds forty minutes to a twenty-minute build, somebody will propose running it nightly instead, and the gate stops being a gate.

Three techniques keep it affordable. **Sampling** applies to semantic checks, where validating a random ten thousand features gives a statistically sound estimate of a rate at a fraction of the cost — with the caveat that sampling detects rates, not individual catastrophes, so a rare but critical condition still needs an exhaustive check. **Incremental checking** validates only what changed, which pairs naturally with the affected-set work in [Incremental Updates for Derived Datasets](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/). **Metric reuse** avoids a separate scan per check by computing every count, rate and distribution in a single pass over the output and evaluating all thresholds against those aggregates afterwards.

That last one is the largest available saving and the most commonly missed. Twenty checks each scanning a continental dataset is twenty scans; one scan producing a metrics document that twenty checks then evaluate is one.

## Failure Modes and Gotchas

**A gate with no history.** Relative checks need recorded metrics from previous runs, and a pipeline that does not store them can only assert invariants. Storing metrics is cheap and it is the prerequisite for everything statistical.

**History poisoned by bad runs.** A rolling band computed over runs that included a degradation quietly accepts that degradation as normal. Only record metrics from runs that passed, and keep an absolute floor as a backstop.

**Thresholds on metrics nobody chose.** It is easy to generate checks for every column automatically and end up with three hundred checks, most of which nobody understands, several of which fire regularly. A dozen chosen metrics that somebody can explain beat three hundred generated ones.

**Blocking on the wrong things.** A gate that blocks on cosmetic anomalies gets bypassed, and the bypass path then covers real failures too.

**No owner.** A failing gate with no named owner becomes a red mark people route around. This is an organisational failure mode and it destroys technically perfect systems routinely.

## Integration Points

Continuous QA sits at the end of the pipeline and touches everything before it. It consumes the rules from [Writing Custom OSM Validation Rules in Python](https://www.osm-data-processing.org/osm-data-quality-validation/writing-custom-osm-validation-rules-in-python/) and the topology checks in [Routing Graph Topology QA](https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/). Its input checks overlap with the replication monitoring in [Replication Monitoring & Lag Alerting](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-monitoring-and-lag-alerting/), and the two should share thresholds rather than disagree about what stale means.

Downstream, the gate's decision is what [Incremental Updates for Derived Datasets](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/) and every export consumer depends on, which is the argument for placing it before publication rather than after.

## Guides in This Topic

- [Running OSM Validation in GitHub Actions](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/running-osm-validation-in-github-actions/) — the mechanics of a check that runs on every change, with caching and artifacts.
- [Setting Quality Thresholds That Fail a Build](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/setting-quality-thresholds-that-fail-a-build/) — deriving bands from observed data rather than picking round numbers.
- [Generating an OSM Data Quality Report](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/generating-an-osm-data-quality-report/) — turning check output into something somebody reads and acts on.

## Frequently Asked Questions

<details>
<summary>Should quality checks run against the source data or the output?</summary>

Both, for different reasons. Checking the source catches upstream problems before you spend an hour processing them, and it distinguishes "the extract was bad" from "our pipeline broke", which is the first question anybody asks. Checking the output is what actually protects consumers, because a pipeline can damage perfectly good input. The input checks are cheap enough that there is no reason to choose.
</details>

<details>
<summary>How do you validate data you have no reference for?</summary>

Against itself over time, which is what the statistical layer does. You may have no authoritative count of buildings in a region, but you have last week's count, and a thirty percent move is informative without any external truth. Where an external reference does exist — a national address file, an official boundary set — it is worth using, but the absence of one is not a reason to skip validation.
</details>

<details>
<summary>What belongs in the gate versus in monitoring?</summary>

The gate answers "should this output be published", and it must be fast enough to run inline and decisive enough to act on. Monitoring answers "is the system behaving", runs continuously, and tolerates signals that are informative without being decisive. Trend detection belongs in monitoring; a single run's pass or fail belongs in the gate. Confusing the two produces either a gate too slow to run or monitoring too coarse to be useful.
</details>

<details>
<summary>How many checks is the right number?</summary>

Few enough that somebody can explain every one of them, which in practice means somewhere between ten and thirty for a typical pipeline. The failure mode of too few is obvious; the failure mode of too many is that the report becomes unreadable and the regularly firing checks train people to skim it. Each check should have a name, an owner and a sentence explaining what its failure means.
</details>

<details>
<summary>Should a failing gate block a deployment or just warn?</summary>

Block for structural failures and for statistical failures on metrics the business actually depends on; warn for everything else. The decision belongs in the check's definition, stated explicitly, rather than being inferred from a severity label. A gate that blocks on everything gets a bypass mechanism, and that bypass will eventually be used on the failure that mattered.
</details>

## Related

- [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/) — the parent section.
- [Writing Custom OSM Validation Rules in Python](https://www.osm-data-processing.org/osm-data-quality-validation/writing-custom-osm-validation-rules-in-python/) — the rules this runs.
- [Routing Graph Topology QA](https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/) — the most expensive semantic layer.
- [Tag & Attribute Consistency Checks](https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/) — where many statistical metrics come from.
- [Replication Monitoring & Lag Alerting](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-monitoring-and-lag-alerting/) — the freshness half of the same question.
- [Quarantining Bad OSM Features to a Dead-Letter Store](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/quarantining-bad-osm-features-to-a-dead-letter-store/) — where a gate's volume threshold reads from.

Up one level: [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Continuous QA for OSM Pipelines",
  "description": "Run OSM validation as part of every pipeline execution rather than as an occasional audit: what to check, where to check it, which thresholds should stop a build, and how to keep the gate from being ignored.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Data Quality & Validation",
  "about": ["continuous validation", "quality gates", "pipeline QA"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Quality & Validation", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/" },
    { "@type": "ListItem", "position": 3, "name": "Continuous QA for OSM Pipelines", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Run OSM quality validation continuously",
  "description": "Order checks by cost from input through structural and statistical to semantic, derive thresholds from recorded history rather than round numbers, and make the gate actionable and rare enough to be trusted.",
  "step": [
    { "@type": "HowToStep", "name": "Check the input first", "text": "Verify extract size, checksum and timestamp before spending any processing time." },
    { "@type": "HowToStep", "name": "Assert structural invariants", "text": "Fail hard on invalid geometry, duplicate identifiers or out-of-range coordinates, with no threshold." },
    { "@type": "HowToStep", "name": "Compare against history", "text": "Record metrics from passing runs and evaluate each against a band derived from their observed distribution." },
    { "@type": "HowToStep", "name": "Add absolute floors", "text": "Back the rolling band with a hard minimum so a series of degraded runs cannot normalise the degradation." },
    { "@type": "HowToStep", "name": "Run semantic checks last", "text": "Sample expensive connectivity and completeness checks, reserving exhaustive runs for critical conditions." },
    { "@type": "HowToStep", "name": "Compute metrics in one pass", "text": "Produce all counts and rates in a single scan and evaluate every threshold against that document." },
    { "@type": "HowToStep", "name": "State blocking explicitly", "text": "Declare per check whether a failure blocks publication or records a warning, rather than inferring it from severity." }
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
      "name": "Should OSM quality checks run against the source data or the output?",
      "acceptedAnswer": { "@type": "Answer", "text": "Both. Checking the source catches upstream problems before an hour of processing and distinguishes a bad extract from a broken pipeline, which is the first question anybody asks. Checking the output is what protects consumers, since a pipeline can damage good input. Input checks are cheap enough that there is no reason to choose." }
    },
    {
      "@type": "Question",
      "name": "How do you validate OSM data you have no reference for?",
      "acceptedAnswer": { "@type": "Answer", "text": "Against itself over time. You may have no authoritative building count for a region, but you have last week's count, and a thirty percent move is informative without external truth. Where a reference exists it is worth using, but its absence is not a reason to skip validation." }
    },
    {
      "@type": "Question",
      "name": "What belongs in a quality gate versus in monitoring?",
      "acceptedAnswer": { "@type": "Answer", "text": "The gate answers whether this output should be published and must be fast and decisive. Monitoring answers whether the system is behaving, runs continuously and tolerates signals that are informative without being decisive. Trend detection belongs in monitoring; a single run's pass or fail belongs in the gate." }
    },
    {
      "@type": "Question",
      "name": "How many quality checks should a pipeline have?",
      "acceptedAnswer": { "@type": "Answer", "text": "Few enough that somebody can explain every one, typically ten to thirty. Too many makes the report unreadable and trains people to skim past regularly firing checks. Each check should have a name, an owner and a sentence saying what its failure means." }
    },
    {
      "@type": "Question",
      "name": "Should a failing quality gate block a deployment or only warn?",
      "acceptedAnswer": { "@type": "Answer", "text": "Block for structural failures and statistical failures on metrics the business depends on; warn otherwise. The decision belongs explicitly in the check definition. A gate that blocks on everything acquires a bypass, and that bypass will eventually be used on the failure that mattered." }
    }
  ]
}
</script>
