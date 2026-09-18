---
title: "OSM Conflation & Data Enrichment"
description: "Matching OSM features against external datasets and deciding what to do with the matches: candidate generation, multi-signal scoring, import preparation, attribute enrichment, and the audit that must precede any upload."
pageTitle: "OSM Conflation & Enrichment: Matching, Scoring & Auditing"
pageDescription: "Engineer OSM conflation properly — generate candidates spatially, score on several independent signals, classify rather than threshold, prepare imports safely, and audit before anything is uploaded."
slug: osm-conflation-and-enrichment
type: overview
breadcrumb: "Conflation & Enrichment"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# OSM Conflation & Data Enrichment

<figure class="diagram-wrap">
<svg viewBox="0 0 880 290" role="img" aria-labelledby="oce1-t oce1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="oce1-t">The stages of a conflation run and what each one narrows</title>
  <desc id="oce1-d">An external dataset and an OSM extract both enter a candidate generation stage, which uses a spatial index to produce a small set of plausible pairings for each external record. A scoring stage evaluates each candidate pair on several independent signals — distance, name similarity, category agreement and any shared identifier — and combines them. A classification stage sorts pairs into confident matches, records needing review, and records with no match at all. Only the first and third groups proceed automatically; the middle group goes to a human.</desc>
  <defs><marker id="oce1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="290" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three stages, and only the last one makes a decision</text>
  <rect x="26" y="86" width="240" height="56" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="146" y="110" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">external data</text>
  <text x="146" y="128" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">records to match</text>
  <rect x="26" y="158" width="240" height="56" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="146" y="182" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">OSM extract</text>
  <text x="146" y="200" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">features to match against</text>
  <rect x="320" y="50" width="240" height="56" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="74" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">candidates</text>
  <text x="440" y="92" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">spatially plausible pairs</text>
  <rect x="320" y="122" width="240" height="56" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="146" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">score</text>
  <text x="440" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">several signals</text>
  <rect x="320" y="194" width="240" height="56" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="218" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">classify</text>
  <text x="440" y="236" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">match, review, none</text>
  <rect x="614" y="122" width="240" height="56" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="734" y="146" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">outcome</text>
  <text x="734" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">enrich, import or park</text>
  <line x1="266" y1="114" x2="293" y2="114" stroke="currentColor" stroke-width="1.4"/>
  <line x1="266" y1="186" x2="293" y2="186" stroke="currentColor" stroke-width="1.4"/>
  <line x1="293" y1="78" x2="293" y2="222" stroke="currentColor" stroke-width="1.4"/>
  <line x1="293" y1="78" x2="317" y2="78" stroke="currentColor" stroke-width="1.4" marker-end="url(#oce1-a)"/>
  <line x1="293" y1="150" x2="317" y2="150" stroke="currentColor" stroke-width="1.4" marker-end="url(#oce1-a)"/>
  <line x1="293" y1="222" x2="317" y2="222" stroke="currentColor" stroke-width="1.4" marker-end="url(#oce1-a)"/>
  <line x1="560" y1="78" x2="587" y2="78" stroke="currentColor" stroke-width="1.4"/>
  <line x1="560" y1="150" x2="587" y2="150" stroke="currentColor" stroke-width="1.4"/>
  <line x1="560" y1="222" x2="587" y2="222" stroke="currentColor" stroke-width="1.4"/>
  <line x1="587" y1="78" x2="587" y2="222" stroke="currentColor" stroke-width="1.4"/>
  <line x1="587" y1="150" x2="611" y2="150" stroke="currentColor" stroke-width="1.4" marker-end="url(#oce1-a)"/>
  <text x="868" y="274" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Nothing in this pipeline should ever produce a single confidence number; the output is three groups with three different destinations.</text>
</svg>
<figcaption>Collapsing the middle group into the other two is what turns a careful conflation into an automated mistake.</figcaption>
</figure>

Every previous section on this site treats OpenStreetMap as the data. This one treats it as one of two datasets that have to be reconciled — because a great deal of real work involves an authoritative external source (a company's own asset register, a national address file, a regulator's list of licensed premises) and a need to know which OSM features correspond to which records.

That reconciliation is called conflation, and it is genuinely hard in a way that is easy to underestimate. It serves GIS analysts joining datasets, mapping engineers preparing imports, and ETL developers enriching OSM features with attributes from elsewhere. What unites them is a single discipline: **a match is a claim about the world, and claims need evidence and review, not a threshold.**

## Why Conflation Is Hard

The difficulty is not technical. Spatial joins are a solved problem, and string similarity has been studied for decades. The difficulty is that the two datasets disagree about what a thing *is*.

**Granularity differs.** An external register may hold one record for a hospital that OSM maps as a site relation, eight buildings, four entrances and a named point. Which of those is "the match"? All of them, and none of them, depending on what the match is for.

**Position differs.** OSM positions are traced from imagery and survey; an external register's coordinate may be a geocoded address, a rooftop centroid, or a postcode centroid a kilometre away. A distance threshold that works for one source is meaningless for another.

**Names differ.** Abbreviations, legal versus trading names, transliteration, punctuation, and the ordinary variation of a place called "St Mary's" in one dataset and "Saint Marys Church" in the other.

**Both change.** Matches decay. A feature retagged, split, replaced by a relation, or deleted breaks a stored match silently — which is why the identity questions in [OSM Feature Identity & ID Stability](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/) apply directly here.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 239" role="img" aria-labelledby="oce2-t oce2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="oce2-t">Four ways the two datasets disagree, and what each one breaks</title>
  <desc id="oce2-d">Four panels. A granularity mismatch happens when one dataset holds a single record where the other holds many features, breaking any assumption that matching is one to one. A positional mismatch happens when the external coordinate is a geocode or a postcode centroid rather than a surveyed position, breaking distance thresholds. A naming mismatch happens through abbreviation, legal versus trading names and transliteration, breaking exact string comparison. A temporal mismatch happens because both datasets change independently, breaking stored matches silently over time.</desc>
  <rect x="0" y="0" width="880" height="239" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four disagreements, four broken assumptions</text>
  <rect x="26" y="52" width="188" height="153" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="120" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Granularity</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">One record, many features</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Or many records, one</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Breaks 1-to-1 matching</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Decide what a match is</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Before writing code</text>
  <rect x="240" y="52" width="188" height="153" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="333" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Position</text>
  <text x="254" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Geocode versus survey</text>
  <text x="254" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Rooftop or postcode</text>
  <text x="254" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Breaks distance limits</text>
  <text x="254" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Calibrate per source</text>
  <text x="254" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Never one radius</text>
  <rect x="453" y="52" width="188" height="153" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="547" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Naming</text>
  <text x="467" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Abbreviations, casing</text>
  <text x="467" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Legal versus trading</text>
  <text x="467" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Breaks exact compare</text>
  <text x="467" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Normalise, then fuzzy</text>
  <text x="467" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Keep the original</text>
  <rect x="666" y="52" width="188" height="153" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="760" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Time</text>
  <text x="680" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Both datasets change</text>
  <text x="680" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Features split and merge</text>
  <text x="680" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Breaks stored matches</text>
  <text x="680" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Re-validate on schedule</text>
  <text x="680" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Store the match date</text>
  <text x="868" y="223" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Only the naming problem has a library solution; the other three are decisions somebody has to make and write down.</text>
</svg>
<figcaption>Most conflation projects fail on the first panel, having implicitly assumed a one-to-one correspondence that never existed.</figcaption>
</figure>

## The Pipeline: Candidates, Scores, Classes

Every workable conflation has the same three stages, and separating them is what makes the result reviewable.

**Candidate generation** narrows the search from "every OSM feature" to "a handful of plausible ones" using a spatial index — the structures compared in [Spatial Index Selection: R-tree vs H3 vs Quadkey](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/). It should be generous: a candidate wrongly excluded here can never be matched later, while a surplus candidate merely costs a score computation. A nearest-neighbour join with a radius comfortably larger than the expected positional error is the standard approach, covered in [Nearest-Neighbour Matching with GeoPandas sjoin_nearest](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/nearest-neighbour-matching-with-geopandas-sjoin-nearest/).

**Scoring** evaluates each candidate pair on several *independent* signals. Distance, name similarity, category agreement, and any shared external identifier are the usual four. Independence matters: four signals that all derive from position tell you one thing four times. The combination should stay interpretable, which usually means keeping the component scores alongside the total rather than collapsing them — [Scoring Conflation Candidates with Multiple Signals](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/scoring-conflation-candidates-with-multiple-signals/) develops this.

**Classification** turns scores into one of three outcomes: confident match, needs review, no match. Three outcomes, not two, because the middle group is where the value is — it is both the set a human can usefully work through and the set that would otherwise be silently wrong.

## Enrichment Versus Import: Two Very Different Jobs

What you do with a match depends entirely on which direction data flows, and the two directions have almost nothing in common operationally.

**Enrichment** brings external attributes into *your own* copy of OSM data. Nothing is uploaded, nothing affects the public map, and a wrong match costs you a wrong attribute in your own warehouse. The bar is "good enough for the consumer", and the work is covered in [Attribute Enrichment from Authoritative Sources](https://www.osm-data-processing.org/osm-conflation-and-enrichment/attribute-enrichment-from-authoritative-sources/).

**Import** puts external data *into OpenStreetMap*. It affects everybody, it is subject to community review, and it requires the source to be licence-compatible before a single line of code is written. The bar is far higher, the process is social as much as technical, and [Preparing an OSM Import](https://www.osm-data-processing.org/osm-conflation-and-enrichment/preparing-an-osm-import/) treats it accordingly.

Confusing the two is the single most common way a conflation project goes wrong, because tooling built for enrichment — permissive thresholds, no audit trail, no revert plan — gets pointed at an upload.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 342" role="img" aria-labelledby="oce3-t oce3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="oce3-t">How the requirements differ between enriching your own data and importing into OSM</title>
  <desc id="oce3-d">A grid of five requirements against the two directions. Licence compatibility is a concern only for your own use when enriching, and is an absolute prerequisite when importing. Match quality needs to be good enough for the consumer when enriching, and needs to be near certain when importing. Review is internal when enriching and involves the community when importing. Reversibility means rerunning the pipeline when enriching and means a revert changeset when importing. The blast radius of a mistake is your own warehouse when enriching and the public map when importing.</desc>
  <rect x="0" y="0" width="880" height="342" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Same matching, completely different obligations</text>
  <rect x="216" y="48" width="319" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="376" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Enrichment</text>
  <rect x="535" y="48" width="319" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="694" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Import</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Licence check</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">your use only</text>
  <text x="694" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">absolute prerequisite</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Match quality bar</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">good enough</text>
  <text x="694" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">near certain</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Review</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">internal</text>
  <text x="694" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">the community</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Reversibility</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">rerun the pipeline</text>
  <text x="694" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a revert changeset</text>
  <text x="30" y="289" font-size="11.5" font-weight="600" fill="currentColor">Blast radius</text>
  <line x1="26" y1="308" x2="854" y2="308" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">your warehouse</text>
  <text x="694" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">the public map</text>
  <text x="868" y="326" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Tooling built for the left column and pointed at the right is how well-intentioned imports end up being reverted.</text>
</svg>
<figcaption>The matching code can be shared between the two; nothing else about them should be.</figcaption>
</figure>

## Cardinality: Deciding What "a Match" Means

Before any matcher is written, somebody has to answer a question that sounds pedantic and turns out to govern the entire design: when one dataset holds a record and the other holds several features, which correspondence counts as the match?

Four answers are common and each is defensible for some purpose. **One to one** insists every record matches at most one feature and every feature is claimed at most once; it is the cleanest to reason about and the least often true. **One to many** lets a record match several features, which is right when a site is mapped as many buildings and the external record describes the site. **Many to one** lets several records match one feature, which is right when a building contains several businesses and OSM maps only the building. **Many to many** admits both at once and is occasionally the honest answer for complex sites, at the cost of an output schema nobody enjoys consuming.

The choice has three consequences that arrive later and are expensive to change. It decides the **output schema**, because a one-to-many result cannot be expressed as a column on the external record. It decides **what a duplicate means** during deduplication: under one-to-one a second record matching an already-claimed feature is a conflict, and under many-to-one it is ordinary. And it decides **how precision is measured**, because the denominator differs — a one-to-many result with four correct features and one wrong one is not straightforwardly 80 percent correct in the way a one-to-one result is.

Writing the answer down, in the same document as the licence decision and the rollout plan, is what keeps a conflation project from quietly changing its mind halfway through and producing an output nobody can interpret. The question is also the most useful thing to ask somebody describing a conflation problem: the answer usually reveals whether they have thought about their data or about their code.

## Licence Compatibility Comes First

For an import, this is the gate before everything else. Adding data to OpenStreetMap requires that the source permits it — an explicit compatible licence, a waiver from the rights holder, or public-domain status. "Freely available on a website" is not permission, and a dataset that cannot be legally imported cannot be imported however good the match quality is.

For enrichment the question is different but not absent: combining OSM data with an external dataset in your own systems may produce a derived database, which has share-alike implications explored in [Deciding if a Derived Database Triggers Share-Alike](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/deciding-if-a-derived-database-triggers-share-alike/). Establish the answer before building, because the architecture that follows depends on it.

## Validation and Error Handling

| Condition | Root cause | Detection | Remediation |
| --- | --- | --- | --- |
| Many-to-one matches | One-to-one assumed where granularity differs | Several records match one feature | Decide the cardinality rule explicitly, then enforce it |
| Good scores, wrong matches | Signals not independent | All signals derive from position | Add a genuinely independent signal such as category |
| Recall collapses in one region | Candidate radius too small for that source | Match rate varies sharply by area | Calibrate the radius per source and per region |
| Matches decay over time | OSM features split, merged or deleted | Stored matches stop resolving | Re-validate on a schedule; store the match date |
| Review queue never shrinks | Middle band far too wide | Most pairs classified as needing review | Tighten by improving signals, not by moving thresholds |
| Import reverted by the community | No discussion, no audit trail | A revert changeset referencing yours | Follow the import process before writing code |
| Enrichment leaks into OSM | Enrichment tooling pointed at an upload | External attributes appear in changesets | Keep the two pipelines separately configured |

## Measuring Whether It Works

Conflation without measurement is guesswork, and the measurement is well-defined: take a sample, have a human label it, and compute precision and recall against those labels. Precision is the fraction of proposed matches that are correct; recall is the fraction of true matches that were proposed.

The two trade against each other, and which matters more depends on the job. For an import, precision dominates — a wrong match creates bad data in the public map, while a missed match simply leaves the feature unmapped. For an internal enrichment feeding an analysis, recall may matter more, because a missing attribute is a gap and a slightly wrong one may be tolerable.

The practice that makes this work is a **labelled golden sample** maintained over time: a few hundred pairs, labelled once, re-scored on every change to the matcher. That turns "the new scoring looks better" into a number. [Measuring Conflation Precision and Recall](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/measuring-conflation-precision-and-recall/) covers the sampling and the arithmetic.

## Auditing and Rollback

Whatever the direction, a conflation run must be auditable and reversible.

**Auditable** means every proposed change can be traced to the pair that produced it and the scores that justified it. When somebody asks why a feature was given a particular attribute, the answer should be a row, not an investigation.

**Reversible** means there is a plan for undoing the run. For enrichment that is usually rebuilding from source. For an import it is a revert changeset, which is easy if the upload was structured as small, single-purpose changesets and extremely painful if it was not — the argument made in [The OSM Editing API & Changeset Upload](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/). [Auditing a Conflation Run Before Upload](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/auditing-a-conflation-run-before-upload/) and [Rolling Back a Bad OSM Import](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/rolling-back-a-bad-osm-import/) cover both halves.

## Where Conflation Fits in a Pipeline

Conflation is rarely a standalone project. It sits between an ingestion stage that produced two normalized datasets and a consuming stage that needs them joined, and its position determines two design constraints worth naming.

**It runs after normalization on both sides.** Matching raw OSM tags against a raw external schema means every casing variant, unit suffix and punctuation difference becomes a mismatch the scorer has to absorb. Running the normalization from [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/) first, and its equivalent on the external side, removes an entire class of false negatives before the matcher sees anything.

**It produces an artefact, not a side effect.** The output of a conflation run is a table of pairs with scores, outcomes and a timestamp — not a set of updates applied in place. Materialising that table is what makes the run auditable, re-runnable against a changed matcher without re-fetching anything, and comparable against the previous run to see what moved. A pipeline that applies matches directly to a target has no way to answer "what changed and why" a week later.

Both constraints point the same way: keep conflation as a distinct stage with a distinct output, rather than folding it into either the ingestion that feeds it or the update that consumes it.

## Performance and Scale

Conflation cost is dominated by candidate generation, which is a spatial join, and by scoring, which is linear in the number of candidate pairs. The practical levers are therefore about pair count.

**Index once, reuse.** Build one spatial index over the OSM side and query it for every external record, rather than rebuilding per batch.

**Bound the candidate set.** A radius and a cap on candidates per record keeps the pair count linear in the external dataset rather than quadratic in dense areas.

**Order the signals by cost.** Distance is nearly free and is already computed by the join. Name similarity is more expensive. Any signal requiring a network call belongs behind everything else and probably belongs out of the loop entirely.

**Partition spatially.** Conflation parallelises cleanly by area, because candidate pairs never cross a partition boundary provided the partitions overlap by the candidate radius. That overlap is the only coordination the partitioning needs, which makes the work embarrassingly parallel at whatever granularity your infrastructure happens to prefer.

## Topics in This Section

- [Matching OSM Features to External Datasets](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/) — candidate generation, name similarity and multi-signal scoring.
- [Preparing an OSM Import](https://www.osm-data-processing.org/osm-conflation-and-enrichment/preparing-an-osm-import/) — licence checks, format conversion, deduplication and the community process.
- [Attribute Enrichment from Authoritative Sources](https://www.osm-data-processing.org/osm-conflation-and-enrichment/attribute-enrichment-from-authoritative-sources/) — bringing external attributes into your own copy without corrupting it.
- [Conflation QA & Rollback](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/) — auditing a run, measuring precision and recall, and undoing a bad one.

## Frequently Asked Questions

<details>
<summary>Why not just match on nearest neighbour within a radius?</summary>

Because distance alone cannot distinguish a correct match from a nearby different thing, and OSM is dense enough that something is almost always nearby. A pharmacy fifteen metres from your record may be the one you meant or may be the shop next door. Distance is a good candidate generator and a weak discriminator; the discrimination has to come from independent signals such as name similarity and category agreement.
</details>

<details>
<summary>Should conflation produce a single confidence score?</summary>

It should produce a classification with the component scores retained. A single number collapses independent evidence into something nobody can interrogate: two pairs scoring 0.8 may have got there in completely different ways, one through a strong name match at moderate distance and one through proximity alone. Keeping the components lets a reviewer see why, and lets you find which signal is misbehaving when quality drops.
</details>

<details>
<summary>Can I import any dataset I have access to?</summary>

No. Importing into OpenStreetMap requires the source to be licence-compatible — explicitly permitted, waived by the rights holder, or public domain. Availability is not permission, and neither is an absence of an explicit prohibition. Establish this before any technical work, because a dataset that cannot legally be imported cannot be imported no matter how good the match quality turns out to be.
</details>

<details>
<summary>How do I handle one record matching several OSM features?</summary>

By deciding what a match means for your purpose before you write the matcher. A hospital as one administrative record and eight OSM buildings is not a failure of matching; it is a question about which object carries the attribute. Common answers are matching to the site relation where one exists, matching to the largest building, or accepting a one-to-many relationship explicitly in the output schema. What does not work is assuming one-to-one and letting the code pick arbitrarily.
</details>

<details>
<summary>How often should stored matches be re-validated?</summary>

On a schedule tied to how fast both datasets change, and always after a significant edit in the area. OSM features are split, merged, replaced by relations and deleted routinely, and every one of those breaks a stored match without producing an error. Storing the match date alongside the match, and re-resolving anything older than your chosen interval, converts silent decay into scheduled maintenance.
</details>

## Related

- [Querying OSM: Overpass, Nominatim & APIs](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/) — geocoding is often the first step of a conflation.
- [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/) — the rule catalogue every conflation output should pass.
- [OSM Feature Identity & ID Stability](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/) — why stored matches decay and what to store instead.
- [Spatial Index Selection: R-tree vs H3 vs Quadkey](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/) — the index behind candidate generation.
- [OSM Licensing & ODbL Compliance](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/) — the gate before any import and the question behind every enrichment.
- [The OSM Editing API & Changeset Upload](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/) — how a reviewed import actually reaches the map.

Up one level: [OSM Data Processing & QA Pipelines](https://www.osm-data-processing.org/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "OSM Conflation & Data Enrichment",
  "description": "Matching OSM features against external datasets and deciding what to do with the matches: candidate generation, multi-signal scoring, import preparation, attribute enrichment, and the audit that must precede any upload.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Conflation & Data Enrichment",
  "about": ["OSM conflation", "feature matching", "data enrichment"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Conflation & Data Enrichment", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Run an OSM conflation that can be reviewed and reversed",
  "description": "Establish licence compatibility, generate candidates generously with a spatial index, score on independent signals, classify into three groups, audit every proposed change, and measure precision and recall against a labelled sample.",
  "step": [
    { "@type": "HowToStep", "name": "Settle the licence question", "text": "Establish whether the external source may be imported, or what share-alike implications enrichment creates, before any technical work begins." },
    { "@type": "HowToStep", "name": "Decide what a match means", "text": "Write down the cardinality rule for cases where one dataset holds a single record and the other holds many features." },
    { "@type": "HowToStep", "name": "Generate candidates generously", "text": "Use a spatial index with a radius comfortably larger than the expected positional error, since an excluded candidate can never be recovered." },
    { "@type": "HowToStep", "name": "Score on independent signals", "text": "Combine distance, name similarity, category agreement and any shared identifier, keeping the component scores alongside the total." },
    { "@type": "HowToStep", "name": "Classify into three groups", "text": "Separate confident matches, records needing review, and records with no match, and route each to a different destination." },
    { "@type": "HowToStep", "name": "Audit every change", "text": "Record which pair and which scores produced each proposed change so any result can be traced to a row." },
    { "@type": "HowToStep", "name": "Measure against a golden sample", "text": "Maintain a human-labelled sample and compute precision and recall on every change to the matcher." }
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
      "name": "Why not just match OSM features on nearest neighbour within a radius?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because distance alone cannot distinguish a correct match from a nearby different thing, and OSM is dense enough that something is almost always nearby. A pharmacy fifteen metres from your record may be the one you meant or the shop next door. Distance is a good candidate generator and a weak discriminator; discrimination has to come from independent signals." }
    },
    {
      "@type": "Question",
      "name": "Should conflation produce a single confidence score?",
      "acceptedAnswer": { "@type": "Answer", "text": "It should produce a classification with the component scores retained. A single number collapses independent evidence into something nobody can interrogate: two pairs scoring the same may have got there in completely different ways. Keeping the components lets a reviewer see why, and lets you find which signal is misbehaving when quality drops." }
    },
    {
      "@type": "Question",
      "name": "Can I import any dataset I have access to into OSM?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. Importing into OpenStreetMap requires the source to be licence-compatible — explicitly permitted, waived by the rights holder, or public domain. Availability is not permission, and neither is an absence of an explicit prohibition. Establish this before any technical work begins." }
    },
    {
      "@type": "Question",
      "name": "How do I handle one record matching several OSM features?",
      "acceptedAnswer": { "@type": "Answer", "text": "By deciding what a match means for your purpose before you write the matcher. A hospital as one record and eight OSM buildings is a question about which object carries the attribute. Common answers are matching to the site relation, to the largest building, or accepting a one-to-many relationship explicitly in the output schema." }
    },
    {
      "@type": "Question",
      "name": "How often should stored OSM matches be re-validated?",
      "acceptedAnswer": { "@type": "Answer", "text": "On a schedule tied to how fast both datasets change, and always after a significant edit in the area. OSM features are split, merged, replaced by relations and deleted routinely, and every one of those breaks a stored match without producing an error. Storing the match date and re-resolving anything older than your chosen interval converts silent decay into scheduled maintenance." }
    }
  ]
}
</script>
