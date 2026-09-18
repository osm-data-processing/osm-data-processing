---
title: "Matching OSM Features to External Datasets"
description: "Candidate generation, name normalisation and multi-signal scoring for conflation: how to find plausible pairings cheaply, evaluate them on independent evidence, and classify rather than threshold."
pageTitle: "Matching OSM Features to an External Dataset"
pageDescription: "Build a conflation matcher: generous spatial candidate generation, normalised name comparison, independent scoring signals, and a three-way classification that routes uncertainty to a reviewer."
slug: matching-osm-features-to-external-datasets
type: guide
breadcrumb: "Matching Features"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Matching OSM Features to External Datasets

The matcher is where conflation is won or lost, and almost every bad matcher has the same shape: a distance threshold, a fuzzy name comparison, and a single number that decides. It performs well on the easy cases everybody tests with, and fails silently on exactly the cases that matter.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="mfe1-t mfe1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="mfe1-t">The four stages of a matcher and what each one is allowed to discard</title>
  <desc id="mfe1-d">Four stages. Normalisation cleans names and categories on both sides without discarding anything, keeping the originals. Candidate generation uses a spatial index to reduce the search from every feature to a handful per record, and must be generous because a candidate discarded here can never be recovered. Scoring evaluates each candidate pair on independent signals and discards nothing. Classification is the only stage that decides, sorting pairs into confident matches, review cases and non-matches.</desc>
  <defs><marker id="mfe1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Only the last stage is allowed to decide</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">normalise</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">clean both sides</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">keep the originals</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#mfe1-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">generate</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">spatial, generous</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">discards permanently</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#mfe1-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">score</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">independent signals</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">discards nothing</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#mfe1-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">classify</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">three-way outcome</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">the only decision</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The second stage is the only one that loses information irreversibly, which is why it should always err towards too many candidates.</text>
</svg>
<figcaption>Separating scoring from deciding is what makes a matcher tunable without re-running the expensive stages.</figcaption>
</figure>

## The Problem This Topic Solves

You have an external dataset of places — assets, premises, addresses, facilities — and you need to know which OSM feature each record corresponds to. The result feeds either an enrichment or an import, and both depend entirely on the matches being right.

The failure scenario is a matcher that looks excellent in testing. It is developed against a hundred records in a town the developer knows, tuned until every one matches, and run over fifty thousand records nationally. The match rate is 82 percent, which sounds good. Nobody notices that in dense city centres the matcher is picking the nearest of six plausible candidates essentially at random, or that in rural areas where the external coordinate is a postcode centroid it matches almost nothing. Both failures are invisible in an aggregate percentage.

## Prerequisites

Understand the section's framing in [OSM Conflation & Data Enrichment](https://www.osm-data-processing.org/osm-conflation-and-enrichment/), particularly the three-way classification. Know your spatial index options from [Spatial Index Selection: R-tree vs H3 vs Quadkey](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/). And have OSM tags normalised already — matching against raw values means every casing variant is a separate category.

## Normalisation: What to Clean and What to Keep

Normalisation prepares both sides for comparison and must be **non-destructive**: the cleaned value is used for comparison, the original is kept for display and review.

For names, the useful operations are Unicode normalisation, case folding, punctuation removal, whitespace collapsing, and — carefully — the removal of a small set of legal and generic suffixes. "Careful" matters: stripping "Ltd" is usually safe, stripping "Church" is not, because for a church it is the entire distinguishing content of the name.

For categories, both sides need mapping onto a shared vocabulary. An external dataset's "PHARMACY" and OSM's `amenity=pharmacy` should both become one token. Where no shared vocabulary exists, the category signal simply cannot be used, and pretending otherwise produces a signal that is noise.

## Candidate Generation: Be Generous

Candidate generation is the only stage that discards information permanently. A correct pairing not proposed here can never be recovered, however good the scoring is.

The radius should come from the **positional characteristics of the external source**, not from a round number. A surveyed asset register might need 25 metres; a geocoded address file might need 150; a postcode-centroid file might need 500 or might be unusable for point matching at all. Measuring that distribution from a labelled sample is a day's work that determines everything downstream.

A cap on candidates per record keeps the pair count bounded in dense areas. Ten is usually generous; if a record legitimately has more than ten plausible candidates, that record is a review case regardless of what the scoring says.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 288" role="img" aria-labelledby="mfe2-t mfe2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="mfe2-t">Typical positional error by external source type, which sets the candidate radius</title>
  <desc id="mfe2-d">Five source types with the radius that covers most of their positional error. A surveyed asset register with recorded coordinates needs about twenty five metres. A rooftop-level geocode needs about eighty metres. A street-interpolated geocode needs about one hundred and fifty metres. A locality or settlement centroid needs several hundred metres. A postcode centroid can be a kilometre or more and is often unusable for point matching at all.</desc>
  <rect x="0" y="0" width="880" height="288" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">The radius comes from the source, not from a round number</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">Surveyed coordinates</text>
  <rect x="276" y="60" width="10" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 25 m</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">Rooftop geocode</text>
  <rect x="276" y="100" width="31" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 80 m</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">Street interpolation</text>
  <rect x="276" y="140" width="57" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 150 m</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">Locality centroid</text>
  <rect x="276" y="180" width="153" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 400 m</text>
  <text x="26" y="234" font-size="11.5" font-weight="600" fill="currentColor">Postcode centroid</text>
  <rect x="276" y="220" width="458" height="18" rx="4" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="854" y="234" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">1 km or more</text>
  <text x="868" y="272" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">A source at the bottom of this table cannot be point-matched reliably at all; it can only constrain a match made on other evidence.</text>
</svg>
<figcaption>Using one radius across sources means over-matching the accurate ones and missing everything in the inaccurate ones.</figcaption>
</figure>

### A Note on Blocking Keys

Where a spatial index is unavailable or the geometry is unreliable, the classical alternative to a spatial candidate stage is **blocking**: grouping both datasets by a cheap key and comparing only within a group. A postcode, a settlement name, or the first few characters of a normalised street name all work.

Blocking trades recall for speed in a very specific way: any true pair whose two sides fall in different blocks can never be found. That makes the key choice critical — a postcode block is useless if one dataset's postcodes are missing or wrong, which is exactly the situation that made the geometry unreliable in the first place. Where both a spatial index and a usable blocking key exist, running both and taking the union of candidates costs little and recovers pairs that either alone would miss.

## Scoring on Independent Signals

Four signals cover most real conflation, and their value comes from being independent.

**Distance** is already computed by the candidate join and costs nothing. It is a weak discriminator — something is always nearby — but a strong disqualifier at the far end of the radius.

**Name similarity** is usually the strongest signal where names exist. Token-based measures handle word reordering better than character-based ones for place names; character-based ones handle typos better. Using both and keeping them separate is more informative than blending them.

**Category agreement** is genuinely independent of position and name, which makes it disproportionately valuable. A pharmacy matching a pharmacy is meaningful evidence even at a moderate distance with a middling name score.

**Shared identifier** — a `ref:*` tag, an operator's own code, a Wikidata link — is the strongest signal of all when present, and should short-circuit the rest. [Linking OSM Features to Wikidata Identifiers](https://www.osm-data-processing.org/osm-conflation-and-enrichment/attribute-enrichment-from-authoritative-sources/linking-osm-features-to-wikidata-identifiers/) covers establishing such links deliberately.

The combination should be a weighted sum with the components retained, not a single opaque number — the argument developed in [Scoring Conflation Candidates with Multiple Signals](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/scoring-conflation-candidates-with-multiple-signals/).

## Classification: Three Groups, Not Two

The output is three groups.

**Confident** pairs have a high combined score *and* no close runner-up. That second condition is what most matchers omit: a pair scoring 0.9 with a runner-up at 0.88 is not confident, it is ambiguous, and the gap between the best and second-best candidate is often more informative than the best score itself.

**Review** covers everything in the middle, plus every ambiguous case regardless of score. This group should be small enough that a human can work through it and large enough that it contains the genuinely uncertain cases.

**No match** covers records with no candidate scoring above a floor. These are not failures — an external record with no OSM counterpart is a normal and common outcome, and treating it as a failure pushes the matcher towards accepting bad pairs.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 306" role="img" aria-labelledby="mfe3-t mfe3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="mfe3-t">Turning a scored candidate set into one of three outcomes</title>
  <desc id="mfe3-d">A decision node taking the best score and the gap to the runner-up, with three outcomes. A high best score with a clear gap to the second-best candidate is a confident match and proceeds automatically. A high score with a close runner-up, or a middling score of any kind, is ambiguous and goes to a reviewer regardless of the absolute value. A best score below the floor means no candidate is plausible and the record is recorded as unmatched, which is a legitimate result rather than a failure.</desc>
  <defs><marker id="mfe3-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="306" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Best score and runner-up gap, together</text>
  <rect x="26" y="117" width="250" height="88" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.6"/>
  <text x="151" y="145" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">How good, and how clear?</text>
  <text x="151" y="167" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Two numbers, not one</text>
  <text x="151" y="185" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">The gap is the tie-break</text>
  <line x1="276" y1="161" x2="314" y2="161" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="314" y2="239" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="353" y2="83" stroke="currentColor" stroke-width="1.4" marker-end="url(#mfe3-a)"/>
  <rect x="356" y="52" width="498" height="62" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="370" y="77" font-size="12" font-weight="700" fill="currentColor">Confident match</text>
  <text x="370" y="97" font-size="10.5" fill="currentColor" opacity="0.88">High score and a clear gap to the second-best</text>
  <line x1="314" y1="161" x2="353" y2="161" stroke="currentColor" stroke-width="1.4" marker-end="url(#mfe3-a)"/>
  <rect x="356" y="130" width="498" height="62" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="370" y="155" font-size="12" font-weight="700" fill="currentColor">Needs review</text>
  <text x="370" y="175" font-size="10.5" fill="currentColor" opacity="0.88">Middling score, or a close runner-up at any score</text>
  <line x1="314" y1="239" x2="353" y2="239" stroke="currentColor" stroke-width="1.4" marker-end="url(#mfe3-a)"/>
  <rect x="356" y="208" width="498" height="62" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="370" y="233" font-size="12" font-weight="700" fill="currentColor">No match</text>
  <text x="370" y="253" font-size="10.5" fill="currentColor" opacity="0.88">Nothing above the floor; a normal, expected outcome</text>
  <text x="868" y="290" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">A matcher that looks only at the best score sends its densest-area mistakes straight through as confident matches.</text>
</svg>
<figcaption>Two numbers instead of one is the entire difference between a reviewable matcher and an opaque one.</figcaption>
</figure>

## Validation and Error-Handling Matrix

| Condition | Root cause | Detection | Remediation |
| --- | --- | --- | --- |
| High match rate, poor precision | Nearest candidate accepted without discrimination | Manual sample shows wrong matches | Require a gap between best and second-best |
| Almost no matches in rural areas | Radius calibrated on urban data | Match rate varies sharply by density | Calibrate the radius per source and region |
| Name signal contributes nothing | Names absent on one side | Score distribution identical with and without it | Drop the signal rather than letting it add noise |
| Category signal is noise | No shared vocabulary between sources | Agreement rate near chance | Build an explicit mapping, or drop the signal |
| Review queue unmanageable | Middle band too wide | Most pairs land in review | Improve signals; do not just move thresholds |
| Matches differ between runs | Unstable tie-breaking | Same input, different output | Sort candidates deterministically before selecting |
| One record matched to many features | Cardinality rule not enforced | Duplicate feature identifiers in output | Enforce the agreed cardinality explicitly |

## Performance and Scale

The pair count governs everything. With \\(n\\) external records and an average of \\(k\\) candidates each, scoring is \\(O(nk)\\), and \\(k\\) is controlled entirely by the radius and the cap.

Build the spatial index once over the OSM side and query it per record; rebuilding per batch is the most common accidental quadratic in a conflation pipeline. Order the signal computations by cost, with distance first — it is already available — and anything requiring a network call outside the loop entirely.

Conflation partitions cleanly by area, provided partitions overlap by at least the candidate radius so a record near a boundary can still see its match. That makes it embarrassingly parallel at whatever granularity your infrastructure prefers.

## Failure Modes and Gotchas

- **Aggregate match rate hides everything.** Report it by region, by density and by source type, or it will mislead you.
- **A missing counterpart is not a failure.** Many external records have no OSM feature; a matcher that must match everything will match them wrongly.
- **Signals must be independent.** Three signals derived from position are one signal counted three times.
- **The runner-up matters.** The gap to the second-best candidate is often a better confidence indicator than the best score.
- **Suffix stripping is dangerous.** Removing a generic word that happens to be the distinguishing part of a name destroys the signal.
- **Ties must break deterministically.** Otherwise two runs over identical input produce different matches and nothing is reproducible.
- **Matches decay.** Store the date and the OSM version alongside every match, per [OSM Feature Identity & ID Stability](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/).

## Integration Points

Upstream, both datasets need normalising — OSM through [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/), and the external side through equivalent cleaning. Where the external source has addresses rather than coordinates, geocoding comes first, using [Nominatim Geocoding Pipelines](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/) — and the place rank it returns is itself a useful input to the candidate radius.

Downstream, confident matches feed either enrichment or import preparation, and every match feeds the audit described in [Conflation QA & Rollback](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/).

## Guides in This Topic

- [Fuzzy Name Matching for OSM POI Conflation](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/fuzzy-name-matching-for-osm-poi-conflation/) — normalisation and similarity measures that behave on real place names.
- [Nearest-Neighbour Matching with GeoPandas sjoin_nearest](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/nearest-neighbour-matching-with-geopandas-sjoin-nearest/) — generous, bounded candidate generation at scale.
- [Scoring Conflation Candidates with Multiple Signals](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/scoring-conflation-candidates-with-multiple-signals/) — combining evidence while keeping it interpretable.

## Frequently Asked Questions

<details>
<summary>What radius should I use for candidate generation?</summary>

One derived from the positional characteristics of the external source, measured rather than assumed. A surveyed register with recorded coordinates needs tens of metres; a street-interpolated geocode needs a couple of hundred; a postcode centroid may not be point-matchable at all. Take a labelled sample, measure the distance distribution between true matches, and set the radius to cover the great majority of it — then cap the candidates per record so dense areas stay bounded.
</details>

<details>
<summary>Why does the runner-up score matter?</summary>

Because it distinguishes a confident match from an ambiguous one. A pair scoring highly with nothing else close is strong evidence; the same score with a near-identical alternative means the matcher is choosing between two plausible answers and has no basis for preferring one. Requiring a meaningful gap between the best and second-best candidate catches exactly the dense-area failures that an absolute threshold lets through.
</details>

<details>
<summary>Should every external record end up matched?</summary>

No, and a matcher built on that assumption will produce bad matches to satisfy it. External datasets routinely contain records with no OSM counterpart: things not yet mapped, things that closed, things outside the extract. Treating no-match as a legitimate and expected outcome keeps the thresholds honest, and the no-match rate is itself a useful signal about the two datasets' coverage.
</details>

<details>
<summary>How do I know whether a signal is contributing anything?</summary>

Compare score distributions for known matches and known non-matches with and without that signal, using a labelled sample. A signal that shifts the two distributions apart is contributing; one that shifts them equally is adding noise that makes the total harder to interpret. Category agreement is worth this check in particular, because it depends on a shared vocabulary that may not actually exist between your sources.
</details>

<details>
<summary>Can I reuse one matcher across several external datasets?</summary>

The structure, yes; the parameters, no. Candidate radius, which signals are available, and how much weight each deserves all depend on the source's positional accuracy, whether it has names, and whether its categories map onto anything. Keep the pipeline shared and the configuration per source, and calibrate each new source against its own labelled sample before running it at scale.
</details>

## Related

- [OSM Conflation & Data Enrichment](https://www.osm-data-processing.org/osm-conflation-and-enrichment/) — the parent section and the three-way classification model.
- [Conflation QA & Rollback](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/) — measuring whether this matcher actually works.
- [Spatial Index Selection: R-tree vs H3 vs Quadkey](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/) — the index behind candidate generation.
- [Nominatim Geocoding Pipelines](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/) — turning addresses into the coordinates this stage needs.
- [OSM Feature Identity & ID Stability](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/) — what to store so a match survives an edit.
- [Validating OSM Address Tags Against a Reference](https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/validating-osm-address-tags-against-a-reference/) — the quality check that often uses these matches.

Up one level: [OSM Conflation & Data Enrichment](https://www.osm-data-processing.org/osm-conflation-and-enrichment/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Matching OSM Features to External Datasets",
  "description": "Candidate generation, name normalisation and multi-signal scoring for conflation: how to find plausible pairings cheaply, evaluate them on independent evidence, and classify rather than threshold.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Conflation & Data Enrichment",
  "about": ["feature matching", "candidate generation", "multi-signal scoring"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Conflation & Data Enrichment", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/" },
    { "@type": "ListItem", "position": 3, "name": "Matching OSM Features to External Datasets", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Build a conflation matcher for OSM and an external dataset",
  "description": "Normalise both sides non-destructively, generate candidates with a source-calibrated radius, score on independent signals, and classify into confident, review and no-match groups.",
  "step": [
    { "@type": "HowToStep", "name": "Normalise without discarding", "text": "Clean names and categories for comparison while keeping the original values for display and review." },
    { "@type": "HowToStep", "name": "Calibrate the candidate radius", "text": "Measure the distance distribution between known matches for this source and set the radius to cover most of it." },
    { "@type": "HowToStep", "name": "Generate candidates generously", "text": "Query a spatial index for every record within the radius, capping candidates per record so dense areas stay bounded." },
    { "@type": "HowToStep", "name": "Score on independent evidence", "text": "Evaluate distance, name similarity, category agreement and any shared identifier separately, retaining each component." },
    { "@type": "HowToStep", "name": "Require a gap to the runner-up", "text": "Treat a high score with a close second-best candidate as ambiguous rather than confident." },
    { "@type": "HowToStep", "name": "Classify three ways", "text": "Route confident pairs onward, send the middle band to review, and record no-match as a legitimate outcome." }
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
      "name": "What radius should I use for conflation candidate generation?",
      "acceptedAnswer": { "@type": "Answer", "text": "One derived from the positional characteristics of the external source, measured rather than assumed. A surveyed register needs tens of metres; a street-interpolated geocode needs a couple of hundred; a postcode centroid may not be point-matchable at all. Take a labelled sample, measure the distance distribution between true matches, and cap candidates per record." }
    },
    {
      "@type": "Question",
      "name": "Why does the runner-up score matter in conflation?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because it distinguishes a confident match from an ambiguous one. A pair scoring highly with nothing else close is strong evidence; the same score with a near-identical alternative means the matcher is choosing between two plausible answers. Requiring a meaningful gap catches exactly the dense-area failures an absolute threshold lets through." }
    },
    {
      "@type": "Question",
      "name": "Should every external record end up matched to an OSM feature?",
      "acceptedAnswer": { "@type": "Answer", "text": "No, and a matcher built on that assumption will produce bad matches to satisfy it. External datasets routinely contain records with no OSM counterpart. Treating no-match as a legitimate and expected outcome keeps the thresholds honest, and the no-match rate is itself a useful signal about coverage." }
    },
    {
      "@type": "Question",
      "name": "How do I know whether a matching signal is contributing anything?",
      "acceptedAnswer": { "@type": "Answer", "text": "Compare score distributions for known matches and known non-matches with and without that signal, using a labelled sample. A signal that shifts the two distributions apart is contributing; one that shifts them equally is adding noise. Category agreement is worth this check in particular, because it depends on a shared vocabulary that may not exist." }
    },
    {
      "@type": "Question",
      "name": "Can I reuse one matcher across several external datasets?",
      "acceptedAnswer": { "@type": "Answer", "text": "The structure, yes; the parameters, no. Candidate radius, which signals are available, and how much weight each deserves all depend on the source. Keep the pipeline shared and the configuration per source, and calibrate each new source against its own labelled sample before running it at scale." }
    }
  ]
}
</script>
