---
title: "Preparing an OSM Import"
description: "What has to be true before an external dataset can be uploaded to OpenStreetMap: licence compatibility, a documented plan, tag mapping, deduplication against existing data, and a staged rollout."
pageTitle: "Preparing an OSM Import: Licence, Plan, Tags & Dedupe"
pageDescription: "Work through the prerequisites of an OSM import — licence permission, a documented and discussed plan, a tag mapping, deduplication against existing features, and an area-by-area rollout."
slug: preparing-an-osm-import
type: guide
breadcrumb: "Preparing an Import"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Preparing an OSM Import

An import is the only operation on this site whose main risks are not technical. The code is straightforward; what makes imports go wrong is doing them without permission, without discussion, without deduplication, or all at once.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 292" role="img" aria-labelledby="pai1-t pai1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="pai1-t">The stages of an import, and how much of it happens before any code runs</title>
  <desc id="pai1-d">Four stages spread over time. The permission stage establishes that the source licence allows contribution, obtains a waiver if needed, and records the evidence, and happens before anything else. The plan stage documents the source, the tag mapping, the deduplication approach and the rollout, and is raised with the relevant community for discussion. The preparation stage converts and deduplicates the data and dry-runs the upload against the development instance. The rollout stage uploads area by area with pauses for feedback. Two of the four stages involve no data engineering at all.</desc>
  <defs><marker id="pai1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="292" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Two stages before anything technical begins</text>
  <line x1="26" y1="150" x2="848" y2="150" stroke="currentColor" stroke-width="1.8" marker-end="url(#pai1-a)"/>
  <rect x="35" y="52" width="189" height="66" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="130" y="76" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">permission</text>
  <text x="130" y="94" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">licence or waiver</text>
  <text x="130" y="110" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">evidence recorded</text>
  <line x1="130" y1="118" x2="130" y2="143" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="130" cy="150" r="5" fill="var(--osm-accent,#0369a1)"/>
  <rect x="242" y="176" width="189" height="66" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="336" y="200" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">plan</text>
  <text x="336" y="218" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">documented, discussed</text>
  <text x="336" y="234" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">community input</text>
  <line x1="336" y1="176" x2="336" y2="157" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="336" cy="150" r="5" fill="var(--osm-ok,#15803d)"/>
  <rect x="449" y="52" width="189" height="66" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="544" y="76" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">prepare</text>
  <text x="544" y="94" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">convert and dedupe</text>
  <text x="544" y="110" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">dry run on dev</text>
  <line x1="544" y1="118" x2="544" y2="143" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="544" cy="150" r="5" fill="var(--osm-warn,#a16207)"/>
  <rect x="656" y="176" width="189" height="66" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="750" y="200" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">roll out</text>
  <text x="750" y="218" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">area by area</text>
  <text x="750" y="234" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">pause for feedback</text>
  <line x1="750" y1="176" x2="750" y2="157" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="750" cy="150" r="5" fill="var(--osm-alt,#6d28d9)"/>
  <text x="868" y="276" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Imports that get reverted almost always skipped one of the first two stages, not the third.</text>
</svg>
<figcaption>The engineering is the easy part; the first half of this timeline is what decides whether the import survives.</figcaption>
</figure>

## The Problem This Topic Solves

You have an authoritative dataset that would genuinely improve OpenStreetMap — a municipality's building footprints, an operator's stop locations, an agency's address points — and you want to contribute it. Done well, imports have added enormous value to the map. Done badly, they create years of cleanup for local mappers and a lasting reluctance to accept the next one.

The failure scenario is well documented. A team converts a dataset, uploads it nationally over a weekend, and discovers afterwards that a third of the features already existed and are now duplicated, that the tagging used a scheme the local community abandoned years ago, and that nobody knows which changesets to revert because the upload was one enormous batch. The technical work was fine. Every one of those problems was a missing preparation step.

## Prerequisites

Understand the upload mechanics from [The OSM Editing API & Changeset Upload](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/). Know the licence framework from [OSM Licensing & ODbL Compliance](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/). And have a working matcher from [Matching OSM Features to External Datasets](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/), because deduplication is conflation by another name.

## Permission Comes First, and It Is Not a Formality

OpenStreetMap can only accept data whose rights holder permits its use under the project's licence. Three situations qualify: the data is explicitly published under a compatible licence, the rights holder has granted a waiver, or the data is genuinely in the public domain in a way the project recognises.

Several things do *not* qualify, and all of them are common misunderstandings. Free availability on a website is not permission. An absence of an explicit prohibition is not permission. A permissive-sounding open data portal whose terms require attribution in a form incompatible with the project's licence is not permission. And a dataset assembled by scraping another map is emphatically not permission — deriving from a proprietary map is the fastest way to have an import reverted and an account blocked.

Where a waiver is needed, it should be obtained in writing, recorded publicly, and referenced from the import's documentation. That record is what lets somebody in five years confirm the data belongs there.

## The Plan, and Why It Is Public

Every bulk import needs a written plan, published where the relevant community can read it, covering:

- **The source**: what it is, who publishes it, its licence status and the evidence for it.
- **The tag mapping**: every source field and what OSM tagging it becomes, including fields deliberately dropped.
- **The deduplication approach**: how existing OSM features will be detected and what happens when one is found.
- **The rollout**: which areas, in what order, with what pauses.
- **The revert plan**: how the changesets are structured so a mistake can be undone.

Publishing it is not bureaucracy. It surfaces regional tagging conventions you did not know about, finds the local mappers who will review the work, and produces the page every changeset comment can link to. A plan discussed in advance turns a suspicious bulk edit into an expected one.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 239" role="img" aria-labelledby="pai2-t pai2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="pai2-t">Three import failure modes and the preparation step that prevents each</title>
  <desc id="pai2-d">Three panels. Duplicate features result from uploading without deduplicating against what OSM already contains, leaving two objects for every real thing and a cleanup burden on local mappers. Wrong tagging results from mapping source fields to a scheme the local community does not use, producing data that is technically present but not found by any consumer. An unrevertible upload results from one enormous changeset, so a reviewer who finds one problem must choose between accepting it and destroying everything else.</desc>
  <rect x="0" y="0" width="880" height="239" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three failures, three missing preparation steps</text>
  <rect x="26" y="52" width="259" height="153" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Duplicates</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Uploaded without dedupe</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Two objects per real thing</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Cleanup falls on locals</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Prevented by: conflation</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Before any upload</text>
  <rect x="311" y="52" width="259" height="153" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Wrong tagging</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Mapped to an unused scheme</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Data present, not findable</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Consumers never see it</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Prevented by: discussion</text>
  <text x="325" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Local conventions differ</text>
  <rect x="595" y="52" width="259" height="153" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">No revert path</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">One enormous changeset</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Reviewer cannot be selective</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">All or nothing decision</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Prevented by: small batches</text>
  <text x="609" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Grouped by area</text>
  <text x="868" y="223" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">All three are cheap to prevent and expensive to fix, and all three are visible to the community long before they are visible to you.</text>
</svg>
<figcaption>Every one of these is a preparation failure rather than an execution failure.</figcaption>
</figure>

### Who Reviews, and When

A plan that names no reviewers is a plan that will be reviewed after the upload. Identify, before the rollout begins, at least one active local mapper for each area and the channel they prefer, and give them the plan with enough time to read it. The cost is a few days; the alternative is discovering a regional convention through a revert.

## Tag Mapping Is a Design Exercise

Converting source fields into OSM tags is where local knowledge matters most. Three principles help.

**Map to what is used, not to what is documented.** A tagging scheme can be documented on the wiki and effectively unused in a given country. Check what the surrounding data actually carries before committing.

**Drop what you cannot justify.** A source field with no clear OSM equivalent should not be forced into a made-up key. Dropping it, and saying so in the plan, is far better than introducing a key nobody will ever consume.

**Never import identifiers as tags without a reason.** An internal record identifier is meaningful to your organisation and noise to everybody else — unless it is a genuinely public reference that consumers will use, in which case the established `ref:*` namespace is the place for it.

The conversion itself is mechanical, and [Converting a Shapefile to OSM XML with ogr2osm](https://www.osm-data-processing.org/osm-conflation-and-enrichment/preparing-an-osm-import/converting-a-shapefile-to-osm-xml-with-ogr2osm/) covers the tooling.

## Deduplication Is Not Optional

The single most damaging import failure is uploading features that already exist. It doubles every affected object, breaks routing and rendering, and leaves a cleanup job that falls entirely on local mappers.

Deduplication is conflation run in a specific direction: for every record you intend to upload, find whether OSM already has it. The matcher from this section applies directly, with one important difference in how the output is used. Here the confident matches are the records you **do not** upload, the review cases are records that need a human before anything happens, and only the confident non-matches are candidates for creation.

A second, subtler case is a record that matches an existing feature but carries better information. That is not a creation and it may not be an update either — modifying somebody's surveyed data with an external dataset's attributes is a decision that belongs in the plan, not in the code. [Deduplicating Addresses Before an OSM Import](https://www.osm-data-processing.org/osm-conflation-and-enrichment/preparing-an-osm-import/deduplicating-addresses-before-an-osm-import/) works through the address case, which is the most common and the most error-prone.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 250" role="img" aria-labelledby="pai3-t pai3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="pai3-t">What each deduplication outcome means for an import, which is the reverse of an enrichment</title>
  <desc id="pai3-d">A grid of three matcher outcomes against what an enrichment does with them and what an import does with them. A confident match means an enrichment attaches the external attributes, while an import skips the record entirely because OSM already has it. A review case means an enrichment usually defers or drops it, while an import must route it to a human before anything happens. A no-match means an enrichment records a gap, while an import treats it as the only category eligible for creation.</desc>
  <rect x="0" y="0" width="880" height="250" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">The same outcomes mean opposite things</text>
  <rect x="196" y="48" width="329" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="360" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Enrichment does</text>
  <rect x="525" y="48" width="329" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="690" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Import does</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Confident match</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="360" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">attach attributes</text>
  <text x="690" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">skip: OSM has it</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Needs review</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="360" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">defer or drop</text>
  <text x="690" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">human before upload</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">No match</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="360" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">record a gap</text>
  <text x="690" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">the only creation case</text>
  <text x="868" y="234" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Pointing an enrichment pipeline at an import is how duplicates get created: its confident matches are exactly what must not be uploaded.</text>
</svg>
<figcaption>Reading this table the wrong way round produces two objects for every real thing, which is the classic import disaster.</figcaption>
</figure>

## Validation and Error Handling

| Condition | Root cause | Detection | Remediation |
| --- | --- | --- | --- |
| Import halted on licence grounds | Permission assumed from availability | Community or foundation query | Establish permission in writing before any work |
| Duplicate features created | No deduplication pass | Two objects per real thing after upload | Conflate against existing data; upload only non-matches |
| Tagging not consumed by anything | Scheme documented but unused locally | Consumers do not find the data | Check surrounding data before fixing the mapping |
| Import reverted wholesale | One enormous changeset | A single revert removes everything | Split by area into small, single-purpose changesets |
| Local mappers object after the fact | No plan published | Objections arrive during rollout | Publish and discuss the plan before uploading |
| Geometry rejected by the API | Invalid or unclosed rings in the source | Upload errors naming specific objects | Validate and repair geometry before conversion |
| Attribute noise in the map | Internal identifiers imported as tags | Keys nobody consumes appear everywhere | Drop what has no consumer; use `ref:*` where it does |

## Rollout: Small, Slow and Reversible

The rollout is where a good plan becomes a good import.

**Small** means changesets of a few hundred objects, each covering one coherent area. That is the unit a reviewer can evaluate and the unit a revert undoes.

**Slow** means pausing between areas. The point is not caution for its own sake; it is that objections arriving after the first area can still change the plan, whereas objections arriving after a national upload can only produce a revert.

**Reversible** means the changesets are structured so that undoing one does not disturb the others, and that the mapping from source records to changesets is recorded. [Rolling Back a Bad OSM Import](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/rolling-back-a-bad-osm-import/) covers what that takes.

Every changeset should carry a comment naming the import, linking to the published plan, and identifying a contact. A reviewer who can read what an edit was for and ask a question about it will do that; one who cannot has only the revert button.

## Performance and Scale

Import preparation is not usually compute-bound — the datasets are modest by the standards of the rest of this site — but two things do scale badly.

**Deduplication cost** grows with the product of the source size and the OSM feature density in the area, and it is the same spatial join discussed throughout this section. Index once, partition by area, and cap candidates.

**Review effort** is the real constraint. A review queue of a few hundred is workable; one of fifty thousand is not, and an import whose deduplication routes most records to review has not been prepared, it has been deferred. Improving the matcher until the review queue is human-sized is part of preparation, not an optimisation.

## Guides in This Topic

- [Converting a Shapefile to OSM XML with ogr2osm](https://www.osm-data-processing.org/osm-conflation-and-enrichment/preparing-an-osm-import/converting-a-shapefile-to-osm-xml-with-ogr2osm/) — the conversion, the translation file, and getting tagging right at source.
- [Deduplicating Addresses Before an OSM Import](https://www.osm-data-processing.org/osm-conflation-and-enrichment/preparing-an-osm-import/deduplicating-addresses-before-an-osm-import/) — detecting what OSM already has, so only genuinely new data is uploaded.

## Frequently Asked Questions

<details>
<summary>Is publicly available data automatically importable?</summary>

No. Availability and permission are different things. Importing into OpenStreetMap requires the rights holder to permit use under the project's licence, which means an explicitly compatible licence, a written waiver, or genuine public-domain status. An open data portal whose terms conflict with the project's licence does not qualify, and data derived from a proprietary map never does. Establish this in writing before any technical work begins.
</details>

<details>
<summary>Do I really need to publish a plan?</summary>

For anything bulk, yes — and it is in your own interest rather than a formality. The plan surfaces local tagging conventions you would otherwise get wrong, identifies the mappers who will review the work, and becomes the page every changeset comment links to. An import that arrives without one is indistinguishable from an unreviewed automated edit, and gets treated accordingly.
</details>

<details>
<summary>What happens when a record matches an existing OSM feature?</summary>

It is not uploaded as a new object, and what happens instead is a decision that belongs in the plan rather than in the code. Options include leaving the existing feature untouched, adding only attributes it lacks, or routing it to a human. What must not happen is overwriting surveyed data with external attributes by default: a mapper who walked the street usually knows more than a dataset compiled centrally.
</details>

<details>
<summary>How large should an import changeset be?</summary>

A few hundred objects covering one coherent area. That is small enough for a reviewer to evaluate in a sitting and small enough that a revert undoes one thing. The technical ceiling is far higher, but changesets are the unit of review and revert, so an enormous one forces a reviewer who finds a single problem to choose between accepting it and destroying everything else in the same upload.
</details>

<details>
<summary>Should I import the source's internal identifiers?</summary>

Only when they are genuinely public references that consumers will use, and then in the established reference namespace. An internal record identifier is meaningful inside your organisation and noise on the public map, and once imported it is very hard to remove. If you need to track which OSM object came from which source record, keep that mapping in your own systems, where it belongs.
</details>

## Related

- [OSM Conflation & Data Enrichment](https://www.osm-data-processing.org/osm-conflation-and-enrichment/) — the parent section and the enrichment alternative.
- [The OSM Editing API & Changeset Upload](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/) — the mechanics of the upload itself.
- [Dry-Running a Bulk Edit Against the Dev API](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/dry-running-a-bulk-edit-against-the-dev-api/) — rehearsing before the rollout.
- [OSM Licensing & ODbL Compliance](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/) — the permission question in detail.
- [Rolling Back a Bad OSM Import](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/rolling-back-a-bad-osm-import/) — the recovery this preparation is meant to avoid needing.
- [Matching OSM Features to External Datasets](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/) — the matcher deduplication depends on.

Up one level: [OSM Conflation & Data Enrichment](https://www.osm-data-processing.org/osm-conflation-and-enrichment/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Preparing an OSM Import",
  "description": "What has to be true before an external dataset can be uploaded to OpenStreetMap: licence compatibility, a documented plan, tag mapping, deduplication against existing data, and a staged rollout.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Conflation & Data Enrichment",
  "about": ["OSM imports", "licence compatibility", "import deduplication"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Conflation & Data Enrichment", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/" },
    { "@type": "ListItem", "position": 3, "name": "Preparing an OSM Import", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/preparing-an-osm-import/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Prepare an OpenStreetMap import",
  "description": "Establish licence permission in writing, publish and discuss a plan, map tags to locally used schemes, deduplicate against existing features, dry-run the upload, and roll out area by area in small changesets.",
  "step": [
    { "@type": "HowToStep", "name": "Establish permission", "text": "Confirm in writing that the rights holder permits contribution under the project's licence, and record the evidence publicly." },
    { "@type": "HowToStep", "name": "Publish a plan", "text": "Document the source, the tag mapping, the deduplication approach, the rollout and the revert plan, and raise it with the relevant community." },
    { "@type": "HowToStep", "name": "Map tags to local practice", "text": "Check what surrounding data actually carries rather than what documentation describes, and drop source fields with no justifiable equivalent." },
    { "@type": "HowToStep", "name": "Deduplicate against OSM", "text": "Run the conflation matcher in reverse, uploading only confident non-matches and routing ambiguous records to a human." },
    { "@type": "HowToStep", "name": "Dry-run the upload", "text": "Execute the whole pipeline against the development instance to prove the mechanics before touching live data." },
    { "@type": "HowToStep", "name": "Roll out area by area", "text": "Upload small single-purpose changesets covering one area at a time, pausing between them so feedback can still change the plan." }
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
      "name": "Is publicly available data automatically importable into OSM?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. Availability and permission are different things. Importing requires the rights holder to permit use under the project's licence, which means an explicitly compatible licence, a written waiver, or genuine public-domain status. An open data portal whose terms conflict with the project's licence does not qualify, and data derived from a proprietary map never does." }
    },
    {
      "@type": "Question",
      "name": "Do I really need to publish an OSM import plan?",
      "acceptedAnswer": { "@type": "Answer", "text": "For anything bulk, yes — and it is in your own interest. The plan surfaces local tagging conventions you would otherwise get wrong, identifies the mappers who will review the work, and becomes the page every changeset comment links to. An import that arrives without one is indistinguishable from an unreviewed automated edit." }
    },
    {
      "@type": "Question",
      "name": "What happens when an import record matches an existing OSM feature?",
      "acceptedAnswer": { "@type": "Answer", "text": "It is not uploaded as a new object, and what happens instead belongs in the plan rather than in the code. Options include leaving the existing feature untouched, adding only attributes it lacks, or routing it to a human. What must not happen is overwriting surveyed data with external attributes by default." }
    },
    {
      "@type": "Question",
      "name": "How large should an OSM import changeset be?",
      "acceptedAnswer": { "@type": "Answer", "text": "A few hundred objects covering one coherent area. That is small enough for a reviewer to evaluate in a sitting and small enough that a revert undoes one thing. An enormous changeset forces a reviewer who finds a single problem to choose between accepting it and destroying everything else in the same upload." }
    },
    {
      "@type": "Question",
      "name": "Should I import a source's internal identifiers as OSM tags?",
      "acceptedAnswer": { "@type": "Answer", "text": "Only when they are genuinely public references that consumers will use, and then in the established reference namespace. An internal record identifier is meaningful inside your organisation and noise on the public map, and once imported it is very hard to remove. Keep the source mapping in your own systems." }
    }
  ]
}
</script>
