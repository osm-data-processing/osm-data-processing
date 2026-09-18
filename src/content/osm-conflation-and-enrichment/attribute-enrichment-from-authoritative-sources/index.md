---
title: "Attribute Enrichment from Authoritative Sources"
description: "Adding external attributes to your own copy of OSM without corrupting it: a separate namespace, explicit precedence rules, provenance on every value, and re-derivation rather than in-place edits."
pageTitle: "Enriching OSM Features with External Attributes Safely"
pageDescription: "Attach authoritative external attributes to OSM features in your own warehouse: keep them in a separate namespace, declare precedence, record provenance per value, and rebuild rather than patch."
slug: attribute-enrichment-from-authoritative-sources
type: guide
breadcrumb: "Attribute Enrichment"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Attribute Enrichment from Authoritative Sources

Enrichment is the safe half of conflation: nothing is uploaded, nobody else is affected, and a mistake costs you a wrong column in your own warehouse. That safety is exactly why enrichment pipelines are built carelessly, and why the resulting datasets become impossible to reason about within a year.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="aea1-t aea1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="aea1-t">How an enriched feature is layered, and why each layer stays separate</title>
  <desc id="aea1-d">Four layers making up one enriched record. The OSM layer holds the tags exactly as the map has them, never modified. The external layer holds attributes from the authoritative source in their own namespace, so an external speed limit never overwrites the OSM one. The resolved layer holds the value a consumer should use, produced by an explicit precedence rule. The provenance layer records, per value, where it came from, when, and through which match. A note observes that collapsing these into one set of columns makes every later question unanswerable.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four layers, and only the third is what consumers read</text>
  <rect x="26" y="50" width="828" height="52" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="42" y="72" font-size="12.5" font-weight="700" fill="currentColor">OSM values</text>
  <text x="42" y="90" font-size="10.5" fill="currentColor" opacity="0.88">Exactly as the map has them</text>
  <text x="838" y="82" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">never modified</text>
  <rect x="26" y="112" width="828" height="52" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="42" y="134" font-size="12.5" font-weight="700" fill="currentColor">External values</text>
  <text x="42" y="152" font-size="10.5" fill="currentColor" opacity="0.88">Own namespace, own columns</text>
  <text x="838" y="144" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">never overwrite</text>
  <rect x="26" y="174" width="828" height="52" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="42" y="196" font-size="12.5" font-weight="700" fill="currentColor">Resolved value</text>
  <text x="42" y="214" font-size="10.5" fill="currentColor" opacity="0.88">Produced by a precedence rule</text>
  <text x="838" y="206" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">what consumers read</text>
  <rect x="26" y="236" width="828" height="52" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="42" y="258" font-size="12.5" font-weight="700" fill="currentColor">Provenance</text>
  <text x="42" y="276" font-size="10.5" fill="currentColor" opacity="0.88">Source, date and match per value</text>
  <text x="838" y="268" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">answers every later question</text>
  <text x="868" y="308" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Collapsing the first two layers into one is convenient on day one and makes the dataset unexplainable by month three.</text>
</svg>
<figcaption>Keeping the layers apart costs storage that is free and preserves the ability to change the precedence rule later.</figcaption>
</figure>

## The Problem This Topic Solves

You have OSM data and an authoritative external source that knows something the map does not — verified opening hours, an operator's official capacity, a regulator's licence status, a survey's speed limits. You want your own copy of the data to carry both.

The failure scenario is a warehouse nobody trusts. External values were written into the same columns as OSM values, because that was simplest. Six months later a consumer asks whether a particular speed limit came from the map or from the reference dataset, and there is no way to tell. A second consumer wants OSM's value because the reference is known to be stale in one region, and it is gone. The pipeline is re-run and the values change, and nobody can say whether that is because the map improved or because the matcher did.

## Prerequisites

Have a working matcher from [Matching OSM Features to External Datasets](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/) and an understanding of the licence position from [Deciding if a Derived Database Triggers Share-Alike](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/deciding-if-a-derived-database-triggers-share-alike/) — combining OSM with an external source may produce a derived database, and the answer shapes what you may publish.

## Namespace Separation Is the Whole Design

The single decision that determines whether an enriched dataset stays comprehensible is keeping external values in their own namespace. An external speed limit becomes `ref_maxspeed`, not `maxspeed`; an external opening-hours string becomes `ref_opening_hours`.

Three things follow from that, and each one is why the discipline pays.

**Disagreement becomes visible.** When both columns exist, a query comparing them is trivial, and the disagreement rate between OSM and an authoritative source is one of the most useful quality signals available — it finds both stale reference data and OSM features that need attention.

**Precedence becomes a decision rather than an accident.** With one column, whichever write happened last wins. With two, a resolved value is produced by a rule you wrote down and can change without re-running anything upstream.

**Re-derivation becomes possible.** Because nothing was overwritten, changing the precedence rule is a recomputation over stored columns rather than a full re-run of matching and fetching.

## Precedence Rules Worth Writing Down

A precedence rule answers: when both sources have a value and they disagree, which one does a consumer see? Four patterns cover most cases.

**Prefer OSM.** Reasonable when the map is surveyed and the external source is compiled centrally. A mapper who walked the street usually knows more than a national dataset.

**Prefer the external source.** Reasonable when the source is genuinely authoritative for that attribute — an operator's own record of its opening hours beats a guess from a passer-by.

**Prefer the more recent.** Requires both sides to carry a reliable timestamp, which OSM does at the object level but not per tag, so this is weaker than it looks.

**Prefer neither; expose the disagreement.** For attributes where being wrong is costly, resolving to null and flagging the conflict is more honest than picking.

The important part is that the rule is **per attribute**, not per dataset. An external source may be authoritative about licence status and useless about geometry.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="aea2-t aea2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="aea2-t">Choosing a precedence rule per attribute, with the question each one answers</title>
  <desc id="aea2-d">A grid of four precedence rules against when each applies and what it risks. Preferring OSM applies when the map is surveyed locally and risks ignoring a genuinely authoritative source. Preferring the external source applies when that source owns the fact, such as an operator's own opening hours, and risks overwriting better local knowledge. Preferring the more recent value applies when both sides carry reliable timestamps and risks being misled by OSM's object-level rather than tag-level timestamps. Exposing the disagreement applies when being wrong is costly and risks leaving consumers with no value at all.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four rules, chosen per attribute rather than per source</text>
  <rect x="216" y="48" width="319" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="376" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Applies when</text>
  <rect x="535" y="48" width="319" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="694" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Risks</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Prefer OSM</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">locally surveyed</text>
  <text x="694" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">ignoring an authority</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Prefer external</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">the source owns the fact</text>
  <text x="694" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">overwriting local knowledge</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Prefer more recent</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">both are timestamped</text>
  <text x="694" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">OSM stamps objects, not tags</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Expose the conflict</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">being wrong is costly</text>
  <text x="694" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">consumers get nothing</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Applying one rule to a whole source is the mistake: a dataset can be authoritative about one attribute and worthless about another.</text>
</svg>
<figcaption>Writing the rule per attribute also documents what you believe about the source, which is useful when it changes.</figcaption>
</figure>

## Provenance Per Value

Recording where each value came from is the difference between a dataset that can answer questions and one that cannot. The minimum is, per enriched attribute: the source, the date it was fetched, and the match that connected the record to the feature.

That last part matters more than it looks. A value is only as good as the match that delivered it, so a stored match identifier lets a later review of the matcher propagate directly into a review of the values it produced. When a matching bug is found, the affected values are a query rather than an investigation.

Provenance is also what makes the licensing position defensible — the obligations in [Recording OSM Data Provenance in a Pipeline](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/recording-osm-data-provenance-in-a-pipeline/) apply to enriched data exactly as to raw extracts, and a per-value source record satisfies them almost incidentally.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="aea3-t aea3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="aea3-t">Three questions a well-built enriched dataset can answer and a collapsed one cannot</title>
  <desc id="aea3-d">Three panels. The origin question asks where a particular value came from, which requires a per-value source record and is unanswerable once external and OSM values share a column. The alternative question asks what the other source said, which requires both values to still exist and is unanswerable after an overwrite. The change question asks why a value differs from last month, which requires stored fetch dates and match identifiers and is unanswerable when only the resolved value is kept.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three questions somebody will definitely ask</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Where from?</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Which source gave this value</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Needs per-value provenance</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Lost when columns merge</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Asked within weeks</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">What else?</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">What did the other say</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Needs both values kept</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Lost on overwrite</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Asked by the sceptic</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Why changed?</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Differs from last month</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Needs dates and match ids</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Lost when only resolved kept</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Asked after an incident</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Each answer costs a column to preserve and is impossible to reconstruct afterwards, which is why the decision belongs on day one.</text>
</svg>
<figcaption>The third question is the one that arrives during an incident, when reconstructing the answer is least affordable.</figcaption>
</figure>

## Validation and Error Handling

| Condition | Root cause | Detection | Remediation |
| --- | --- | --- | --- |
| Cannot tell a value's origin | External values written into OSM columns | Provenance query returns nothing | Separate namespaces; record source per value |
| Values change with no data change | Precedence resolved at write time | Reruns produce different outputs | Resolve at read time from stored columns |
| A stale source overrides good data | Precedence set per source, not per attribute | Disagreement concentrated in one attribute | Set precedence per attribute |
| Enrichment cannot be undone | Values written in place | No original value remains | Keep OSM values untouched; derive the resolved one |
| Bad matches silently propagate | Match identifier not stored | Affected values cannot be identified | Store the match id alongside every enriched value |
| Disagreement rate never examined | Both values present but never compared | No quality signal from the comparison | Report disagreement per attribute every run |
| Licence position unclear | Provenance absent from the output | Cannot say what is derived from what | Carry source and date through to every consumer |

## When Enrichment Is the Wrong Tool

Three situations look like enrichment problems and are not, and recognising them saves considerable effort.

**The attribute belongs in OSM.** If the external source is publishable, the information genuinely improves the map, and the licence permits it, the right destination may be OpenStreetMap itself rather than your warehouse. Enrichment keeps the value private to you; contributing it makes it available to everybody and means you no longer have to maintain the join. The decision is the one framed in [Preparing an OSM Import](https://www.osm-data-processing.org/osm-conflation-and-enrichment/preparing-an-osm-import/), and it is worth asking before building a permanent enrichment pipeline around a fact that could simply be mapped.

**The external source is the primary dataset.** Where the external data is more complete, more current and more authoritative than OSM for your purpose, enriching OSM with it has the relationship backwards. The cleaner architecture uses the external dataset as the base and attaches OSM attributes to *it*, which changes the matching direction, the cardinality question and what a no-match means. Nothing about the techniques changes; the framing does, and getting it wrong produces a dataset whose coverage is limited by whichever side happened to be called the base.

**The disagreement is the product.** Sometimes the point is not to produce a resolved value at all but to find where the two sources differ — a quality audit, a change-detection job, a survey-targeting exercise. In that case the resolved value is unnecessary and the precedence rule is a distraction; the output is the comparison itself, and treating it as an enrichment pipeline that happens to log discrepancies buries the actual deliverable in a side effect.

## Measuring Enrichment Quality

Enrichment has a quality signal that conflation alone does not: the **disagreement rate** between OSM and the external source on attributes both carry.

A very low rate suggests either that the source adds little or that the matcher is matching only the easy cases. A very high rate suggests either that the source is wrong, that the matcher is wrong, or that the two are measuring different things — an external "capacity" meaning licensed occupancy and an OSM `capacity` meaning parking spaces, for instance.

Either way the rate is worth tracking per attribute and per region over time. A sudden change almost always means something upstream moved, and it is the cheapest available alarm on an enrichment pipeline.

## Performance and Scale

Enrichment cost is dominated by the matching that precedes it, not by the attribute attachment. Two structural choices keep it manageable.

**Store matches, not enriched rows.** A match table of feature identifiers and record identifiers is small and reusable. Regenerating enriched attributes from it is a join, which is far cheaper than re-running the matcher every time a source refreshes.

**Resolve at read time.** Computing the resolved value in a view or at query time, rather than materialising it, means a precedence change costs nothing and never leaves stale resolved values behind.

Both point at the same architecture: store the evidence, derive the answer. The alternative — materialising everything at write time — is faster to query and impossible to correct.

## Guides in This Topic

- [Joining OSM Roads to a Speed Limit Reference](https://www.osm-data-processing.org/osm-conflation-and-enrichment/attribute-enrichment-from-authoritative-sources/joining-osm-roads-to-a-speed-limit-reference/) — linear-referencing a road attribute onto OSM ways without losing the segmentation.
- [Linking OSM Features to Wikidata Identifiers](https://www.osm-data-processing.org/osm-conflation-and-enrichment/attribute-enrichment-from-authoritative-sources/linking-osm-features-to-wikidata-identifiers/) — establishing a durable identifier link that makes future enrichment nearly free.

## Frequently Asked Questions

<details>
<summary>Why not write external values into the OSM tag columns?</summary>

Because it destroys three things at once: the ability to tell where a value came from, the ability to change the precedence rule later, and the ability to use the disagreement between the two as a quality signal. Storage is cheap and columns are free; the information you lose by collapsing them is not recoverable without re-running the whole pipeline, and sometimes not even then if the source has changed in the meantime.
</details>

<details>
<summary>Should precedence be set per source or per attribute?</summary>

Per attribute. A source can be authoritative about one thing and unreliable about another — an operator's own record of its opening hours is better than anything a passer-by could observe, while its idea of where the building is may be a geocoded postcode. Applying one rule to a whole source guarantees that its good attributes and its bad ones are treated identically, which is exactly what you are trying to avoid.
</details>

<details>
<summary>What is the disagreement rate good for?</summary>

It is the cheapest quality alarm an enrichment pipeline has. Tracked per attribute and per region over time, a sudden change means something moved — the source refreshed with different semantics, the matcher regressed, or the map changed substantially in one area. A persistently high rate on one attribute usually means the two sides are measuring different things and the mapping needs revisiting rather than the data being wrong.
</details>

<details>
<summary>Should the resolved value be materialised or computed on read?</summary>

Computed on read, wherever query performance allows it. Materialising means every precedence change requires a rewrite and leaves the risk of stale resolved values sitting beside fresh inputs. A view or a query-time expression over the stored OSM and external columns costs a little at read time and makes the precedence rule something you can change in one place, review, and change back.
</details>

<details>
<summary>Does enrichment have licensing implications?</summary>

It can. Combining OpenStreetMap data with an external dataset in your own systems may produce what the licence calls a derived database, and what you are then permitted to publish depends on how the two are combined and what is distributed. The question is worth settling before the architecture is fixed, because a per-value provenance record — which you want anyway — is most of what a defensible answer requires.
</details>

## Related

- [OSM Conflation & Data Enrichment](https://www.osm-data-processing.org/osm-conflation-and-enrichment/) — the parent section and the enrichment-versus-import distinction.
- [Matching OSM Features to External Datasets](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/) — producing the matches this attaches values to.
- [Recording OSM Data Provenance in a Pipeline](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/recording-osm-data-provenance-in-a-pipeline/) — the provenance obligations enrichment inherits.
- [Deciding if a Derived Database Triggers Share-Alike](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/deciding-if-a-derived-database-triggers-share-alike/) — the licence question behind combining sources.
- [Modelling OSM for Analytics Warehouses](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/) — where enriched features usually land.
- [Validating OSM Address Tags Against a Reference](https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/validating-osm-address-tags-against-a-reference/) — using the disagreement as a validation rule.

Up one level: [OSM Conflation & Data Enrichment](https://www.osm-data-processing.org/osm-conflation-and-enrichment/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Attribute Enrichment from Authoritative Sources",
  "description": "Adding external attributes to your own copy of OSM without corrupting it: a separate namespace, explicit precedence rules, provenance on every value, and re-derivation rather than in-place edits.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Conflation & Data Enrichment",
  "about": ["attribute enrichment", "value precedence", "data provenance"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Conflation & Data Enrichment", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/" },
    { "@type": "ListItem", "position": 3, "name": "Attribute Enrichment from Authoritative Sources", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/attribute-enrichment-from-authoritative-sources/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Enrich OSM features with external attributes safely",
  "description": "Keep external values in their own namespace, declare a precedence rule per attribute, record provenance per value including the match identifier, resolve at read time, and track the disagreement rate.",
  "step": [
    { "@type": "HowToStep", "name": "Separate the namespaces", "text": "Store external values in their own columns so OSM values are never overwritten and both remain queryable." },
    { "@type": "HowToStep", "name": "Declare precedence per attribute", "text": "Write down, for each attribute, whether OSM, the external source, recency or an explicit conflict wins." },
    { "@type": "HowToStep", "name": "Record provenance per value", "text": "Store the source, the fetch date and the match identifier alongside every enriched value." },
    { "@type": "HowToStep", "name": "Store matches, not results", "text": "Persist the match table and derive enriched attributes from it by join, so a source refresh does not require re-matching." },
    { "@type": "HowToStep", "name": "Resolve at read time", "text": "Compute the resolved value in a view so a precedence change costs nothing and leaves no stale values." },
    { "@type": "HowToStep", "name": "Track the disagreement rate", "text": "Report, per attribute and per region, how often the two sources disagree, and investigate sudden changes." }
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
      "name": "Why not write external values into the OSM tag columns?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because it destroys three things at once: the ability to tell where a value came from, the ability to change the precedence rule later, and the ability to use the disagreement between the two as a quality signal. Storage is cheap and columns are free; the information lost by collapsing them is not recoverable without re-running the whole pipeline." }
    },
    {
      "@type": "Question",
      "name": "Should enrichment precedence be set per source or per attribute?",
      "acceptedAnswer": { "@type": "Answer", "text": "Per attribute. A source can be authoritative about one thing and unreliable about another — an operator's own opening hours are better than anything a passer-by could observe, while its idea of where the building is may be a geocoded postcode. Applying one rule to a whole source treats its good and bad attributes identically." }
    },
    {
      "@type": "Question",
      "name": "What is the OSM-versus-source disagreement rate good for?",
      "acceptedAnswer": { "@type": "Answer", "text": "It is the cheapest quality alarm an enrichment pipeline has. Tracked per attribute and per region over time, a sudden change means something moved. A persistently high rate on one attribute usually means the two sides are measuring different things and the mapping needs revisiting rather than the data being wrong." }
    },
    {
      "@type": "Question",
      "name": "Should the resolved value be materialised or computed on read?",
      "acceptedAnswer": { "@type": "Answer", "text": "Computed on read, wherever query performance allows. Materialising means every precedence change requires a rewrite and risks stale resolved values sitting beside fresh inputs. A view over the stored OSM and external columns costs a little at read time and makes the precedence rule something you can change in one place." }
    },
    {
      "@type": "Question",
      "name": "Does enriching OSM data have licensing implications?",
      "acceptedAnswer": { "@type": "Answer", "text": "It can. Combining OpenStreetMap data with an external dataset may produce what the licence calls a derived database, and what you may publish depends on how the two are combined and what is distributed. Settle the question before the architecture is fixed, because a per-value provenance record is most of what a defensible answer requires." }
    }
  ]
}
</script>
