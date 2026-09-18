---
title: "Conflation QA & Rollback"
description: "Proving a conflation run is good before it ships and undoing it when it is not: labelled samples, precision and recall, an evidence pack for reviewers, and a revert path that actually works."
pageTitle: "Conflation QA: Measuring, Auditing and Reverting"
pageDescription: "Measure a conflation run with a labelled golden sample, assemble an evidence pack a reviewer can check, and structure the upload so a revert undoes exactly one decision."
slug: conflation-qa-and-rollback
type: guide
breadcrumb: "QA & Rollback"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Conflation QA & Rollback

Conflation is the one area of this site where the reviewer is often somebody who did not build the pipeline and has no reason to trust it. That shapes what quality assurance has to produce: not a green build, but evidence.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="cqr1-t cqr1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cqr1-t">The four artefacts a conflation run should produce before anything ships</title>
  <desc id="cqr1-d">Four artefacts in order. The labelled sample is a few hundred human-judged pairs, maintained over time, against which every matcher change is scored. The metrics are precision and recall computed against that sample, reported per region and per feature class rather than only in aggregate. The evidence pack is a set of representative before-and-after examples and counts that a reviewer can check without running anything. The revert plan describes how the upload is structured so that undoing one decision does not disturb the others.</desc>
  <defs><marker id="cqr1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four artefacts, none of them optional</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">labelled sample</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">a few hundred pairs</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">maintained over time</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#cqr1-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">metrics</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">precision and recall</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">per region, per class</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#cqr1-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">evidence pack</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">examples and counts</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">checkable without code</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#cqr1-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">revert plan</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">one decision per change</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">tested, not assumed</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The fourth artefact is the one teams write after they need it, which is exactly when it is most expensive to produce.</text>
</svg>
<figcaption>Each artefact answers a different reviewer question, and none of them can be reconstructed after the upload.</figcaption>
</figure>

## The Problem This Topic Solves

You have a conflation run ready and you need to know whether it is good enough to act on — and, if it turns out not to be, how to undo it. Both questions have concrete answers, and both are much easier to answer before the run than after.

The failure scenario is a run that nobody can evaluate. The matcher reports 94 percent of records matched, which sounds excellent until somebody asks what fraction of those matches are correct and there is no way to say. A sample is taken by hand, 12 percent turn out to be wrong, and the run has already been applied. Undoing it is impossible because the changes were applied in place with no record of which came from which match. Every part of that is preventable with artefacts produced before the run, not after.

## Precision and Recall, Measured Rather Than Estimated

Two numbers describe a matcher's quality, and both need a labelled sample to compute.

**Precision** is the fraction of proposed matches that are correct. It answers "when this says match, how often is it right?" — the question that matters when a wrong match creates bad data.

**Recall** is the fraction of true matches that were proposed. It answers "how much did this miss?" — the question that matters when a missing match leaves a gap.

They trade against each other, and which one to favour depends entirely on what happens downstream. For an import, precision dominates: a wrong match creates a duplicate or a bad edit in the public map, while a missed match simply leaves a feature unmapped for now. For an internal enrichment, recall may matter more, since a missing attribute is a hole in a dataset and a slightly wrong one may be tolerable.

The labelled sample that makes both computable is a few hundred pairs judged by a human, maintained over time, and re-scored on every matcher change. That is a day of work once and half an hour per change afterwards. [Measuring Conflation Precision and Recall](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/measuring-conflation-precision-and-recall/) covers the sampling design, which matters more than the arithmetic.

## Aggregate Numbers Hide the Failures That Matter

A single precision figure over a national run is almost useless, because conflation quality varies enormously with context. Three breakdowns are worth reporting every time.

**By density.** Dense urban areas are where distance stops discriminating and precision falls. A run with 96 percent precision overall may be at 99 in rural areas and 78 in city centres.

**By feature class.** Named, categorised features match well; unnamed generic ones do not. Reporting per class shows which parts of the dataset are trustworthy.

**By source region.** Where the external dataset was assembled differently in different regions — a common situation with national datasets built from municipal contributions — quality follows those boundaries.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="cqr2-t cqr2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cqr2-t">How one aggregate precision figure decomposes across contexts</title>
  <desc id="cqr2-d">A grid showing a run reporting ninety four percent precision overall broken down three ways. By density, rural areas reach ninety nine percent while dense urban areas fall to seventy eight. By feature class, named and categorised features reach ninety seven while unnamed generic ones fall to seventy one. By region, the region where the external source was well maintained reaches ninety six while the one assembled from older municipal data falls to eighty three. A note observes that all three breakdowns come from the same labelled sample at no extra cost.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">The same run, read three different ways</text>
  <rect x="206" y="48" width="324" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="368" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Best slice</text>
  <rect x="530" y="48" width="324" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="692" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Worst slice</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Overall</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">94% precision</text>
  <text x="692" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">94% precision</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">By density</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">rural: 99%</text>
  <text x="692" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">dense urban: 78%</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">By feature class</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">named: 97%</text>
  <text x="692" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">unnamed: 71%</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">By region</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">maintained: 96%</text>
  <text x="692" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">legacy data: 83%</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Every one of these breakdowns comes free from the same labelled sample; only reporting the first row is a choice.</text>
</svg>
<figcaption>The aggregate is a weighted average of slices that behave nothing like each other, which is why it explains nothing.</figcaption>
</figure>

## The Evidence Pack

A reviewer who did not build the pipeline needs something they can check without running anything. That is the evidence pack, and it has four parts.

**Counts**, broken down as above: how many records, how many matched, how many routed to review, how many left unmatched.

**Representative examples**: twenty or so before-and-after pairs sampled across the score range, including a few deliberately near the threshold, so a reviewer can see what a marginal decision looks like.

**The decision rules**: the thresholds, the precedence rules and the cardinality rule, stated in plain words rather than as code.

**The known limitations**: where the run is weakest and why. A pack that admits its weak spots is enormously more credible than one that does not, and a reviewer will find them anyway.

For an upload this pack is what accompanies the import plan; for an enrichment it is what accompanies the dataset. [Auditing a Conflation Run Before Upload](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/auditing-a-conflation-run-before-upload/) assembles one.

## Reviewing the Review Queue

The group routed to human review is a deliverable in its own right, and how it is presented determines whether it gets worked through or quietly abandoned.

**Size it for the people you have.** A queue of two hundred pairs is an afternoon; a queue of twenty thousand is a project nobody will start. If the matcher produces a queue larger than the available attention, the answer is to improve the signals rather than to raise the thresholds — raising them moves uncertain pairs into the confident bucket without making them any less uncertain.

**Order it by value, not by score.** The pairs worth a human's time first are the ones where a decision unlocks the most: a record matching a feature that many other records also touch, or a pair whose resolution would settle an ambiguity affecting a whole area. Ordering strictly by score puts the most marginal cases first, which is the least rewarding place to start.

**Show the evidence, not the number.** A reviewer deciding a pair needs the component scores, the names as they actually appear, the distance, and the runner-up — not a combined figure. Every one of those is already computed; presenting them is a formatting decision that changes review speed by a large factor.

**Feed the decisions back.** A reviewed pair is a labelled pair, and labelled pairs are exactly what the measurement in [Measuring Conflation Precision and Recall](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/measuring-conflation-precision-and-recall/) needs. A review queue whose decisions are discarded after use throws away the most expensive data the project generates.

## Rollback: Structure It Before You Need It

A revert is only as easy as the structure of what was applied.

For an **enrichment**, reverting means re-deriving from stored inputs, which works only if nothing was overwritten in place. The layered design in [Attribute Enrichment from Authoritative Sources](https://www.osm-data-processing.org/osm-conflation-and-enrichment/attribute-enrichment-from-authoritative-sources/) makes this nearly free.

For an **import**, reverting means undoing changesets — and that is easy when each changeset was small and single-purpose, and extremely painful when one changeset carried thousands of unrelated objects. The structure decision is made at upload time and cannot be changed afterwards.

Two things make a revert tractable regardless of direction. **A record of which source record produced which change**, so a partial revert is possible. And **a rehearsal**: reverting one small changeset on the development instance, before the real rollout, proves the path works. [Rolling Back a Bad OSM Import](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/rolling-back-a-bad-osm-import/) works through the real case, including what to do when other mappers have edited the affected objects since.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="cqr3-t cqr3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cqr3-t">What a revert costs under three different upload structures</title>
  <desc id="cqr3-d">Three panels. Small single-purpose changesets let a reviewer revert exactly the decision that was wrong, costing minutes and affecting only the objects involved. A few large changesets force an all-or-nothing choice, so undoing one mistake destroys every correct change uploaded alongside it. In-place changes with no record of previous values cannot be reverted at all, and recovery means reconstructing the earlier state from a historical extract if one exists.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">The revert cost is decided at upload time</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Small, single purpose</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Revert exactly one decision</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Minutes of work</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Only the objects involved</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">The structure to aim for</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">A few large changesets</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">All or nothing per changeset</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Good changes destroyed too</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Reviewer picks the lesser evil</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Avoidable by splitting</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">In place, no record</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Cannot be reverted at all</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Previous values are gone</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Reconstruct from history</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">If a history file exists</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Nothing about the third panel can be improved after the fact, which is why the structure is a design decision rather than an operational one.</text>
</svg>
<figcaption>All three take the same effort to upload; only the first takes a reasonable effort to undo.</figcaption>
</figure>

## The Signal That Something Has Drifted

A conflation pipeline that ran well six months ago and runs badly now usually gives three warnings before anybody notices, and all three are cheap to watch.

**The no-match rate moves.** A sudden rise means either the external source changed shape or the OSM side stopped being found — a projection change, a filter that started excluding a feature class, a candidate radius now wrong for a refreshed source. A sudden fall is just as suspicious, because it usually means the matcher started accepting pairs it previously rejected.

**The review queue changes size.** The band between the two thresholds should hold a roughly stable share of records. A queue that doubles without a threshold change means the score distribution moved, which means a signal changed — often a name field that started arriving empty, or a category vocabulary that was silently renamed upstream.

**The component mix changes.** Tracking which signal contributed most to each confident match, aggregated per run, is the most sensitive alarm available. A pipeline where name similarity used to carry most decisions and now leans on distance has lost a signal without losing a number, and the precision cost of that will show up weeks later in complaints rather than immediately in a metric.

None of these needs a labelled sample; all three come free from the run's own output. Recording them per run and comparing against the previous one turns a slow, invisible degradation into a line on a chart somebody can point at.

## Validation and Error Handling

| Condition | Root cause | Detection | Remediation |
| --- | --- | --- | --- |
| Quality cannot be stated | No labelled sample | No precision figure exists | Label a few hundred pairs once; maintain them |
| Good aggregate, bad in practice | Only aggregate reported | Complaints concentrate in one area | Report per density, class and region |
| Reviewer cannot evaluate | No evidence pack | Questions require running the pipeline | Publish counts, examples, rules and limitations |
| Revert impossible | Changes applied in place | No original values remain | Never overwrite; derive the resolved value |
| Partial revert impossible | One enormous changeset | Undoing one thing undoes everything | Small, single-purpose changesets |
| Revert fails on conflicts | Objects edited since the upload | Version conflicts during the revert | Re-read, and route conflicting objects to a human |
| Metrics drift unnoticed | Sample scored once, never again | Quality falls with no signal | Re-score the sample on every matcher change |

## Guides in This Topic

- [Auditing a Conflation Run Before Upload](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/auditing-a-conflation-run-before-upload/) — assembling an evidence pack a reviewer can check without running anything.
- [Rolling Back a Bad OSM Import](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/rolling-back-a-bad-osm-import/) — reverting changesets cleanly, including where others have edited since.
- [Measuring Conflation Precision and Recall](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/measuring-conflation-precision-and-recall/) — sampling design, labelling, and the arithmetic that follows.

## Frequently Asked Questions

<details>
<summary>Why is a match rate not a quality measure?</summary>

Because it counts proposals rather than correct proposals. A matcher that pairs every record with its nearest feature achieves a match rate near 100 percent and a precision that may be dreadful. The two numbers that matter are precision — of the matches proposed, how many are right — and recall — of the true matches available, how many were found. Neither can be computed without a human-labelled sample.
</details>

<details>
<summary>How large does the labelled sample need to be?</summary>

A few hundred pairs is enough for a useful precision figure and, more importantly, enough to break down by density and feature class. Stratifying matters more than raw size: a sample drawn uniformly from a national dataset is dominated by rural areas where matching is easy, and will report a flattering number that says nothing about the city centres where the failures live.
</details>

<details>
<summary>Should I optimise for precision or recall?</summary>

For what happens downstream. An import should favour precision heavily, because a wrong match puts bad data on a public map while a missed match leaves a feature unmapped for a while longer. An internal enrichment can often favour recall, because a missing attribute is a visible hole and a slightly wrong one may be acceptable. Decide explicitly and record the decision, because the thresholds follow from it.
</details>

<details>
<summary>What makes a revert hard?</summary>

Two things, both decided before the revert is needed. Changes applied in place, with no record of the previous value, cannot be undone at all. And changes grouped into a few enormous changesets cannot be undone selectively, so a reviewer who finds one problem must choose between accepting it and destroying everything else. Both are structural decisions made at upload time and neither can be fixed afterwards.
</details>

<details>
<summary>What if somebody has edited the objects since my upload?</summary>

Then the revert conflicts on those objects, and that is the correct behaviour rather than an obstacle. Somebody looked at the data and changed it, which means a blind revert would discard their work. Re-read the conflicting objects, revert the ones still in the state you created, and route the rest to a human. A revert that forces its way through conflicts is a second bad edit on top of the first.
</details>

## Related

- [OSM Conflation & Data Enrichment](https://www.osm-data-processing.org/osm-conflation-and-enrichment/) — the parent section and the pipeline this measures.
- [Matching OSM Features to External Datasets](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/) — the matcher whose thresholds these metrics calibrate.
- [Preparing an OSM Import](https://www.osm-data-processing.org/osm-conflation-and-enrichment/preparing-an-osm-import/) — where the evidence pack accompanies the plan.
- [The OSM Editing API & Changeset Upload](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/) — why changeset structure decides revertability.
- [Setting Quality Thresholds That Fail a Build](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/setting-quality-thresholds-that-fail-a-build/) — turning these metrics into an automated gate.
- [Attribute Enrichment from Authoritative Sources](https://www.osm-data-processing.org/osm-conflation-and-enrichment/attribute-enrichment-from-authoritative-sources/) — the layering that makes an enrichment revert trivial.

Up one level: [OSM Conflation & Data Enrichment](https://www.osm-data-processing.org/osm-conflation-and-enrichment/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Conflation QA & Rollback",
  "description": "Proving a conflation run is good before it ships and undoing it when it is not: labelled samples, precision and recall, an evidence pack for reviewers, and a revert path that actually works.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Conflation & Data Enrichment",
  "about": ["conflation quality", "precision and recall", "revert planning"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Conflation & Data Enrichment", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/" },
    { "@type": "ListItem", "position": 3, "name": "Conflation QA & Rollback", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Assure and reverse a conflation run",
  "description": "Maintain a stratified labelled sample, compute precision and recall broken down by context, publish an evidence pack, and structure changes so a revert undoes exactly one decision.",
  "step": [
    { "@type": "HowToStep", "name": "Build a labelled sample", "text": "Have a human judge a few hundred pairs, stratified across density and feature class, and keep the labels for reuse." },
    { "@type": "HowToStep", "name": "Compute both metrics", "text": "Report precision and recall against the sample rather than a match rate, which counts proposals and not correctness." },
    { "@type": "HowToStep", "name": "Break the numbers down", "text": "Report per density, per feature class and per source region, since the aggregate averages slices that behave differently." },
    { "@type": "HowToStep", "name": "Publish an evidence pack", "text": "Provide counts, representative examples across the score range, the decision rules in plain words, and the known weak spots." },
    { "@type": "HowToStep", "name": "Structure for revert", "text": "Keep originals rather than overwriting, and upload in small single-purpose changesets so one decision can be undone." },
    { "@type": "HowToStep", "name": "Rehearse the revert", "text": "Revert a changeset on the development instance before the real rollout, so the path is proven rather than assumed." },
    { "@type": "HowToStep", "name": "Re-score on every change", "text": "Run the labelled sample through the matcher whenever it changes, so quality drift produces a number rather than a complaint." }
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
      "name": "Why is a match rate not a conflation quality measure?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because it counts proposals rather than correct proposals. A matcher that pairs every record with its nearest feature achieves a match rate near 100 percent and a precision that may be dreadful. The two numbers that matter are precision and recall, and neither can be computed without a human-labelled sample." }
    },
    {
      "@type": "Question",
      "name": "How large does a conflation labelled sample need to be?",
      "acceptedAnswer": { "@type": "Answer", "text": "A few hundred pairs is enough for a useful precision figure and to break down by density and feature class. Stratifying matters more than raw size: a sample drawn uniformly from a national dataset is dominated by rural areas where matching is easy, and will report a flattering number that says nothing about city centres." }
    },
    {
      "@type": "Question",
      "name": "Should conflation optimise for precision or recall?",
      "acceptedAnswer": { "@type": "Answer", "text": "For what happens downstream. An import should favour precision heavily, because a wrong match puts bad data on a public map while a missed match leaves a feature unmapped. An internal enrichment can often favour recall, because a missing attribute is a visible hole. Decide explicitly and record the decision." }
    },
    {
      "@type": "Question",
      "name": "What makes a conflation revert hard?",
      "acceptedAnswer": { "@type": "Answer", "text": "Two things, both decided before the revert is needed. Changes applied in place, with no record of the previous value, cannot be undone at all. And changes grouped into a few enormous changesets cannot be undone selectively. Both are structural decisions made at upload time." }
    },
    {
      "@type": "Question",
      "name": "What if somebody edited the objects since my upload?",
      "acceptedAnswer": { "@type": "Answer", "text": "Then the revert conflicts on those objects, which is correct behaviour rather than an obstacle. Somebody looked at the data and changed it, so a blind revert would discard their work. Revert the objects still in the state you created and route the rest to a human." }
    }
  ]
}
</script>
