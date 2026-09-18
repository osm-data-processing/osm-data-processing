---
title: "OSM Feature Identity & ID Stability"
description: "What an OSM identifier does and does not guarantee: type scoping, version semantics, the ways features split, merge and get replaced, and how to build a key that survives all of it."
pageTitle: "OSM Feature Identity: What an ID Actually Guarantees"
pageDescription: "Understand OSM identifier semantics — type scoping, version increments, splits, merges, retagging and deletion — and build surrogate keys and stored references that survive ordinary map editing."
slug: osm-feature-identity-and-id-stability
type: guide
breadcrumb: "Feature Identity"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# OSM Feature Identity & ID Stability

An OpenStreetMap identifier is a name for a database object, not for a thing in the world. Most pipelines assume otherwise, and the assumption holds until somebody splits a road.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="ofi1-t ofi1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="ofi1-t">Four ordinary edits and what each one does to a stored identifier</title>
  <desc id="ofi1-d">Four panels. A retag leaves the identifier unchanged and increments the version, so a stored reference still resolves and the feature is still the same thing. A split keeps the original identifier on one part and creates new ones for the others, so a stored reference resolves to a fragment of what it named. A merge deletes one identifier and keeps another, so half of any stored references stop resolving. A replacement, such as a way becoming a multipolygon relation, retires the identifier entirely and a stored reference resolves to nothing.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four edits, four different fates for a stored reference</text>
  <rect x="26" y="52" width="188" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="120" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Retag</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Id unchanged</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Version increments</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Reference still resolves</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Still the same thing</text>
  <rect x="240" y="52" width="188" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="333" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Split</text>
  <text x="254" y="104" font-size="10.5" fill="currentColor" opacity="0.92">One part keeps the id</text>
  <text x="254" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Others get new ones</text>
  <text x="254" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Resolves to a fragment</text>
  <text x="254" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Silently wrong</text>
  <rect x="453" y="52" width="188" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="547" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Merge</text>
  <text x="467" y="104" font-size="10.5" fill="currentColor" opacity="0.92">One id is deleted</text>
  <text x="467" y="125" font-size="10.5" fill="currentColor" opacity="0.92">The other survives</text>
  <text x="467" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Half the references break</text>
  <text x="467" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Loudly, at least</text>
  <rect x="666" y="52" width="188" height="132" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="760" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Replacement</text>
  <text x="680" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Way becomes a relation</text>
  <text x="680" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Old id retired</text>
  <text x="680" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Resolves to nothing</text>
  <text x="680" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Or worse, to reuse</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Only the first panel leaves a stored reference meaning what it meant, and the second is the dangerous one because nothing errors.</text>
</svg>
<figcaption>A split is the common case and the silent one: the identifier still resolves, to a shorter road than the one you stored.</figcaption>
</figure>

## The Problem This Topic Solves

Your pipeline stores references to OSM features — a conflation match, a cached geocode, a curated list of interesting objects, an enrichment join key — and needs them to still be right next month. Whether they are depends entirely on what an identifier guarantees, which is less than most people assume.

The failure scenario is quiet. A team stores way identifiers for a curated set of cycle routes. Six months later a mapper splits several of those ways at junctions, which is routine and correct mapping. Every stored identifier still resolves, so nothing errors — but each now names a fragment of the route it used to name, and the pipeline's length statistics quietly drop by forty percent. Nobody notices until somebody compares against an external figure.

## What an Identifier Actually Guarantees

Four properties, and it is worth being precise about each.

**Identifiers are scoped by type.** A node, a way and a relation can all carry the identifier 12345, and they are three unrelated objects. The unique key is the pair, which is why every table in this section carries a composite key rather than a bare number.

**Identifiers are not reused after deletion.** A deleted object's identifier is retired, so a stored reference to a deleted feature resolves to nothing rather than to something else. That is a genuinely useful guarantee and it is why deletion is the *least* dangerous of the four edits above.

**Versions increment on every edit.** The version number tells you the object changed; it does not tell you how or whether the change matters to you. A version bump from a typo fix and one from a complete retagging look identical.

**Nothing guarantees the object still means the same thing.** An identifier names a database row. What that row represents can change entirely — a building becoming a shop, a road being re-purposed, a boundary being redrawn — with no signal beyond a version increment.

## The Four Edits That Break Assumptions

**Retagging** is benign for identity: the identifier and the geometry are unchanged, and only the meaning may have moved. A stored reference still names the same object.

**Splitting** is the dangerous one. When a way is split, one part conventionally keeps the original identifier and the others are new objects. A stored reference still resolves, silently, to a shorter feature. Nothing errors; statistics simply change.

**Merging** deletes one identifier and keeps another. Stored references to the deleted one stop resolving, which at least fails loudly.

**Replacement** happens when a feature's representation changes form — a closed way becoming a multipolygon relation is the common case. The old identifier is deleted and a new object of a different type appears. A stored reference resolves to nothing, and a pipeline that only looked at ways never sees the replacement.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="ofi2-t ofi2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="ofi2-t">How each edit affects the three things a pipeline might rely on</title>
  <desc id="ofi2-d">A grid of four edit kinds against whether the identifier still resolves, whether the geometry still describes the same extent, and whether a stored reference is still correct. Retagging leaves all three intact except that the meaning may have changed. Splitting leaves the identifier resolving but the geometry covering less, so the reference is wrong without erroring. Merging breaks resolution for one of the two identifiers, which fails loudly. Replacement breaks resolution entirely and changes the object type as well.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three things to rely on, and how each edit treats them</text>
  <rect x="186" y="48" width="223" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="297" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Resolves?</text>
  <rect x="409" y="48" width="223" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="520" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Same extent?</text>
  <rect x="631" y="48" width="223" height="30" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="743" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Still correct?</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Retag</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="297" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">yes</text>
  <text x="520" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">yes</text>
  <text x="743" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">meaning may differ</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Split</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="297" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">yes</text>
  <text x="520" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">no, shorter</text>
  <text x="743" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">no, and silent</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Merge</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="297" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">one of two</text>
  <text x="520" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">no, longer</text>
  <text x="743" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">no, but loud</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Replacement</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="297" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">no</text>
  <text x="520" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">n/a</text>
  <text x="743" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">no, and loud</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The split row is the only one where every check a naive pipeline performs passes while the answer is wrong.</text>
</svg>
<figcaption>Designing for the split case covers the others; designing for deletion alone covers almost nothing.</figcaption>
</figure>

## Where Identity Assumptions Hide

Identity assumptions rarely announce themselves. They sit inside code that reads perfectly well and only becomes wrong when the map moves. Four places are worth auditing in any existing pipeline.

**Join keys.** Any join on a bare numeric identifier is assuming uniqueness that does not hold across element types. The symptom is a result set larger than expected, which looks like a legitimate many-to-many relationship rather than like a bug.

**Cached geometry.** A stored polygon or line keyed on an identifier is assuming the geometry has not changed. That assumption is usually fine for a building and routinely wrong for a road, and nothing in the cache indicates which kind it holds.

**Curated lists.** A hand-assembled set of interesting features — the routes a product covers, the sites a report describes — is the highest-value and most fragile identity assumption in most pipelines, because it was built by a human who will not be watching it.

**Aggregate comparisons across time.** Any figure compared against the same figure last quarter assumes the underlying features are the same features. A split changes the count without changing anything on the ground, and a comparison that does not account for that reports a change that did not happen.

The common thread is that none of these produce an error. Each produces a plausible number, which is why the audit has to be deliberate rather than driven by incidents — by the time an incident occurs, the wrong numbers have usually been reported for months.

## Building Something That Survives

Three techniques, in increasing order of effort and robustness.

**Store the version alongside the identifier.** A stored reference becomes a pair, and re-resolving compares the current version against the stored one. That does not tell you what changed, but it tells you *that* something did, which turns a silent drift into a review item. It is the cheapest possible improvement and it catches the split case, because the surviving part's version increments.

**Store enough to re-verify.** A coordinate, a name, a length — whatever the reference was for. Re-resolving then checks not just that the object exists but that it still looks like what you stored. A route whose length halved is a re-verification failure even though the identifier resolved.

**Prefer an external identifier where one exists.** A `ref:*` tag, an operator's code or a knowledge-base link survives splits and replacements, because it describes the thing rather than the database row. [Linking OSM Features to Wikidata Identifiers](https://www.osm-data-processing.org/osm-conflation-and-enrichment/attribute-enrichment-from-authoritative-sources/linking-osm-features-to-wikidata-identifiers/) covers establishing those deliberately, and they are the only references in this section that are genuinely durable.

For internal purposes, a **surrogate key** — a stable identifier your pipeline mints and maps to OSM objects — decouples your data model from the map's churn entirely. [Building Stable Surrogate Keys for OSM Features](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/building-stable-surrogate-keys-for-osm-features/) develops it.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="ofi3-t ofi3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="ofi3-t">Four levels of reference durability, from fragile to genuinely stable</title>
  <desc id="ofi3-d">Four approaches in increasing order of robustness. Storing a bare numeric identifier is the most fragile, colliding across element types and silently resolving to a fragment after a split. Adding the element type removes the collision but leaves everything else. Adding the version turns silent drift into a detectable change, because any edit increments it. Adding a verifiable attribute such as length or a coordinate catches the split case specifically. An external identifier is the only form that survives splits and representation changes without any re-resolution at all.</desc>
  <defs><marker id="ofi3-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Each level catches one more failure</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">bare id</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">collides across types</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">most fragile</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#ofi3-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">type plus id</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">collision fixed</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">split still silent</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#ofi3-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">plus version</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">change detectable</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">not what changed</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#ofi3-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">plus attribute</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">split detectable</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">re-verify on resolve</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">An external identifier sits beyond the fourth step: it names the thing rather than the row and needs no re-resolution at all.</text>
</svg>
<figcaption>Most pipelines stop at the second step, which fixes the loud failure and leaves the silent one entirely intact.</figcaption>
</figure>

### What to Store, Concretely

A stored reference that survives ordinary editing carries five fields, and each earns its place.

The **element type** and **identifier** together form the key. The **version** at capture time makes any later change detectable. A **verifiable attribute** — whichever property the reference exists to describe — makes a split or a retagging detectable rather than merely a change. And the **capture date** explains drift when somebody asks why a figure moved, because it establishes what the map looked like when the reference was made.

That is five small columns. The temptation to store only the identifier is strong precisely because it works: everything resolves, nothing errors, and the cost appears months later as a number nobody can explain.

## Validation and Error Handling

| Condition | Root cause | Detection | Remediation |
| --- | --- | --- | --- |
| Statistics drop with no code change | Ways split upstream | Aggregate measures fall; ids still resolve | Store versions and re-verify attributes |
| Joins produce duplicates | Joined on a bare numeric identifier | Same number across element types | Key on the type and identifier pair |
| Reference resolves to nothing | Object deleted or replaced | Not-found on re-resolution | Expected; route to review rather than dropping |
| A way became a relation | Representation changed form | Identifier gone, similar feature nearby | Search by attributes, not only by identifier |
| Stale meaning, current identifier | Retagged into something else | Attributes no longer match what was stored | Re-verify stored attributes, not just existence |
| Nothing ever re-checked | References stored and never revisited | Quality decays invisibly | Re-resolve on a schedule tied to edit rates |
| History unavailable for a fix | Only current state retained | Cannot see what the object used to be | Consult a history file for the prior state |

## Re-Resolution as a Scheduled Job

References decay, and the only reliable response is to re-resolve them on a schedule. Two design points make that affordable.

**Batch by area, not by record.** Re-resolving a thousand scattered identifiers is a thousand requests; re-resolving everything in one region is one extract read. For any volume, the file-based route from [Choosing Between Overpass and a Local Extract](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/choosing-between-overpass-and-a-local-extract/) is the right one.

**Drive the schedule from edit rates.** An area with heavy mapping activity needs re-resolution far more often than a stable one, and the replication stream already tells you which is which. Using the diff stream to mark regions as dirty — the pattern in [Incremental Updates for Derived Datasets](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/) — turns a blanket weekly sweep into targeted work.

## Guides in This Topic

- [Tracking an OSM Feature Across Versions](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/tracking-an-osm-feature-across-versions/) — following an object through its edit history and classifying what each version changed.
- [Building Stable Surrogate Keys for OSM Features](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/building-stable-surrogate-keys-for-osm-features/) — minting your own identifiers and mapping them to a moving map.
- [Handling Deleted and Redacted OSM Objects](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/handling-deleted-and-redacted-osm-objects/) — the difference between a deletion and a redaction, and why it matters downstream.

## Frequently Asked Questions

<details>
<summary>Are OSM identifiers unique on their own?</summary>

No. They are scoped by element type, so a node, a way and a relation can each carry the same number while being entirely unrelated objects. The unique key is the pair of type and identifier, and joining on the bare number produces phantom duplicates that are easy to miss because they look like genuine multiple matches rather than like an error.
</details>

<details>
<summary>Are identifiers reused after an object is deleted?</summary>

No, and this is one of the few genuinely strong guarantees available. A deleted object's identifier is retired, so a stored reference to it resolves to nothing rather than to some unrelated feature that inherited the number. That makes deletion the least dangerous of the ways a stored reference can go wrong, because it fails loudly and unambiguously.
</details>

<details>
<summary>What happens to my stored reference when a way is split?</summary>

It keeps resolving, to a shorter way. Conventionally one part retains the original identifier and the other parts become new objects, so nothing errors and nothing indicates that the feature you stored is now a fragment. This is the most damaging identity failure precisely because every check a naive pipeline performs passes. Storing the version and an attribute such as length, and re-verifying both, is what catches it.
</details>

<details>
<summary>Does a version increment tell me what changed?</summary>

Only that something did. A version bump from a corrected spelling and one from a complete retagging are indistinguishable from the number alone. Comparing versions is still worthwhile because it converts silent drift into a review item, but deciding whether the change matters requires either comparing the stored attributes against the current ones or fetching the previous version and diffing them.
</details>

<details>
<summary>Is there any genuinely durable reference to an OSM feature?</summary>

An external identifier, where one exists — a published reference code, an operator's own identifier, a knowledge-base link. Those describe the thing in the world rather than the database row, so they survive splits, merges and representation changes that retire an OSM identifier. Establishing such links deliberately is more work up front and is the only approach that does not require periodic re-resolution.
</details>

## Related

- [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/) — the parent section and the element model identifiers name.
- [Node, Way & Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — what each identifier type refers to.
- [OSM Conflation & Data Enrichment](https://www.osm-data-processing.org/osm-conflation-and-enrichment/) — where stored references decay most visibly.
- [Full History .osh.pbf Processing](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/) — the data that lets you see what an object used to be.
- [Reconstructing OSM Features at a Past Date](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/reconstructing-osm-features-at-a-past-date/) — recovering a prior state when a reference breaks.
- [The OSM Editing API & Changeset Upload](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/) — where version semantics become a concurrency mechanism.

Up one level: [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "OSM Feature Identity & ID Stability",
  "description": "What an OSM identifier does and does not guarantee: type scoping, version semantics, the ways features split, merge and get replaced, and how to build a key that survives all of it.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Data Fundamentals & Architecture",
  "about": ["OSM identifiers", "version semantics", "reference stability"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Fundamentals & Architecture", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/" },
    { "@type": "ListItem", "position": 3, "name": "OSM Feature Identity & ID Stability", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Store OSM feature references that survive ordinary editing",
  "description": "Key on element type and identifier together, store the version and a verifiable attribute, prefer external identifiers where they exist, and re-resolve on a schedule driven by edit activity.",
  "step": [
    { "@type": "HowToStep", "name": "Key on type and identifier", "text": "Use the pair as the unique key, since identifiers are scoped by element type and collide across types." },
    { "@type": "HowToStep", "name": "Store the version", "text": "Record the version alongside the identifier so a later comparison reveals that the object changed." },
    { "@type": "HowToStep", "name": "Store something verifiable", "text": "Keep a coordinate, a name or a length so re-resolution can confirm the object still looks like what was stored." },
    { "@type": "HowToStep", "name": "Prefer external identifiers", "text": "Use a published reference or knowledge-base link where one exists, since it describes the thing rather than the database row." },
    { "@type": "HowToStep", "name": "Re-resolve in batches by area", "text": "Refresh references by reading a regional extract rather than by making one request per stored reference." },
    { "@type": "HowToStep", "name": "Schedule from edit activity", "text": "Use the replication stream to mark regions dirty so re-resolution targets areas that actually changed." }
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
      "name": "Are OSM identifiers unique on their own?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. They are scoped by element type, so a node, a way and a relation can each carry the same number while being entirely unrelated objects. The unique key is the pair of type and identifier, and joining on the bare number produces phantom duplicates that look like genuine multiple matches rather than like an error." }
    },
    {
      "@type": "Question",
      "name": "Are OSM identifiers reused after an object is deleted?",
      "acceptedAnswer": { "@type": "Answer", "text": "No, and this is one of the few genuinely strong guarantees available. A deleted object's identifier is retired, so a stored reference resolves to nothing rather than to some unrelated feature. That makes deletion the least dangerous way a stored reference can go wrong, because it fails loudly." }
    },
    {
      "@type": "Question",
      "name": "What happens to a stored reference when an OSM way is split?",
      "acceptedAnswer": { "@type": "Answer", "text": "It keeps resolving, to a shorter way. Conventionally one part retains the original identifier and the others become new objects, so nothing errors and nothing indicates the feature is now a fragment. Storing the version and an attribute such as length, and re-verifying both, is what catches it." }
    },
    {
      "@type": "Question",
      "name": "Does an OSM version increment tell me what changed?",
      "acceptedAnswer": { "@type": "Answer", "text": "Only that something did. A bump from a corrected spelling and one from a complete retagging are indistinguishable from the number alone. Comparing versions converts silent drift into a review item, but deciding whether the change matters requires comparing stored attributes against current ones or diffing against the previous version." }
    },
    {
      "@type": "Question",
      "name": "Is there any genuinely durable reference to an OSM feature?",
      "acceptedAnswer": { "@type": "Answer", "text": "An external identifier, where one exists — a published reference code, an operator's identifier, a knowledge-base link. Those describe the thing in the world rather than the database row, so they survive splits, merges and representation changes. Establishing such links is more work up front and is the only approach that avoids periodic re-resolution." }
    }
  ]
}
</script>
