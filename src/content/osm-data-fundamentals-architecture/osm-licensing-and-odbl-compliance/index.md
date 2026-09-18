---
title: "OSM Licensing & ODbL Compliance"
description: "What the Open Database Licence actually requires of a data pipeline: attribution, the produced work versus derived database distinction, share-alike triggers, and automating compliance rather than remembering it."
pageTitle: "OSM Licensing & ODbL Compliance for Data Pipelines"
pageDescription: "Work out what the ODbL requires of your OSM pipeline — attribution placement, produced works versus derived databases, when share-alike bites, and how to automate the obligations."
slug: osm-licensing-and-odbl-compliance
type: guide
breadcrumb: "Licensing & ODbL"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# OSM Licensing & ODbL Compliance

Licensing is the one part of an OSM pipeline where being approximately right is not a defensible position, and where the cost of getting it wrong arrives years later, in a conversation nobody wanted to have. It is also, once the vocabulary is clear, far less complicated than its reputation suggests.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 306" role="img" aria-labelledby="olc1-t olc1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="olc1-t">The one distinction the licence turns on</title>
  <desc id="olc1-d">A decision node asking what is actually being distributed, with three outcomes. Distributing a map image, a report, a rendered tile or any other visual or textual product is a produced work, which requires attribution and nothing more. Distributing data that somebody else could query or extract is a database, which requires attribution and, if it is derived rather than merely collective, share-alike. Distributing nothing at all, because the data is only used internally, carries no distribution obligation although attribution on any public output still applies.</desc>
  <defs><marker id="olc1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="306" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">What are you actually distributing?</text>
  <rect x="26" y="117" width="250" height="88" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.6"/>
  <text x="151" y="145" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">A picture, or the data?</text>
  <text x="151" y="167" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Everything follows from this</text>
  <text x="151" y="185" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Answer it before anything else</text>
  <line x1="276" y1="161" x2="314" y2="161" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="314" y2="239" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="353" y2="83" stroke="currentColor" stroke-width="1.4" marker-end="url(#olc1-a)"/>
  <rect x="356" y="52" width="498" height="62" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="370" y="77" font-size="12" font-weight="700" fill="currentColor">A produced work</text>
  <text x="370" y="97" font-size="10.5" fill="currentColor" opacity="0.88">Images, reports, rendered tiles: attribution only</text>
  <line x1="314" y1="161" x2="353" y2="161" stroke="currentColor" stroke-width="1.4" marker-end="url(#olc1-a)"/>
  <rect x="356" y="130" width="498" height="62" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="370" y="155" font-size="12" font-weight="700" fill="currentColor">A database</text>
  <text x="370" y="175" font-size="10.5" fill="currentColor" opacity="0.88">Data others can query: attribution plus share-alike if derived</text>
  <line x1="314" y1="239" x2="353" y2="239" stroke="currentColor" stroke-width="1.4" marker-end="url(#olc1-a)"/>
  <rect x="356" y="208" width="498" height="62" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="370" y="233" font-size="12" font-weight="700" fill="currentColor">Nothing externally</text>
  <text x="370" y="253" font-size="10.5" fill="currentColor" opacity="0.88">Internal use only: no distribution obligation arises</text>
  <text x="868" y="290" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Almost every licensing question resolves once this is answered, and almost every licensing mistake comes from never asking it.</text>
</svg>
<figcaption>A rendered map is a produced work; the tiles behind it may well be a database. The same pipeline can produce both.</figcaption>
</figure>

## The Problem This Topic Solves

You are building something with OpenStreetMap data and need to know what you owe in return. The answer affects architecture — whether you can combine OSM with a proprietary dataset, what you can publish, how attribution reaches users — so it is much cheaper settled at the start than discovered at launch.

The failure scenario is a product built on an assumption nobody wrote down. A team combines OSM with a licensed commercial dataset, publishes an API that serves the result, and discovers at launch review that the output is a derived database subject to share-alike, which the commercial licence forbids them from satisfying. The engineering is fine. The problem is that the question was never asked, and the architecture that would have avoided it — keeping the two datasets separable — was not built.

## The Vocabulary That Matters

Three terms carry all the weight, and confusing them is the source of most misunderstanding.

**A produced work** is something *made from* the database that is not itself a database: a rendered map image, a printed atlas, a report, a visualisation. Distributing one requires attribution. It does not trigger share-alike.

**A derived database** is a database *made from* the OSM database — an extract, a filtered subset, a transformed schema, a routing graph, in most readings a vector tile set. Distributing one requires attribution *and* share-alike: the derived database must itself be offered under the same licence.

**A collective database** is OSM data placed *alongside* other data without the two being combined. A directory holding an OSM extract and a separate proprietary file is collective; the proprietary file does not become subject to share-alike merely by sitting next to the extract.

The line between derived and collective is where real architectural decisions live, and it is the subject of [Deciding if a Derived Database Triggers Share-Alike](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/deciding-if-a-derived-database-triggers-share-alike/).

<figure class="diagram-wrap">
<svg viewBox="0 0 880 250" role="img" aria-labelledby="olc2-t olc2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="olc2-t">What each kind of output owes, and what it does not</title>
  <desc id="olc2-d">A grid of three output kinds against three obligations. A produced work such as a rendered map or a report owes attribution, owes no share-alike, and may be distributed under any terms. A derived database such as an extract, a routing graph or a tile set owes attribution, owes share-alike, and must itself be offered under the same licence. A collective database, where OSM data sits alongside other data without being combined, owes attribution for the OSM part only, owes no share-alike on the other part, and leaves the other part's terms untouched.</desc>
  <rect x="0" y="0" width="880" height="250" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three kinds of output, three different bills</text>
  <rect x="216" y="48" width="213" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="322" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Attribution</text>
  <rect x="429" y="48" width="213" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="535" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Share-alike</text>
  <rect x="641" y="48" width="213" height="30" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="748" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Other data</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Produced work</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="322" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">yes</text>
  <text x="535" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">no</text>
  <text x="748" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">unaffected</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Derived database</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="322" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">yes</text>
  <text x="535" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">yes</text>
  <text x="748" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">becomes subject</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Collective database</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="322" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">for the OSM part</text>
  <text x="535" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">no</text>
  <text x="748" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">unaffected</text>
  <text x="868" y="234" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The middle row's third column is the one that catches product teams: combining proprietary data into a derived database pulls it in too.</text>
</svg>
<figcaption>Keeping a combination collective rather than derived is an architectural choice, and it has to be made early.</figcaption>
</figure>

## Attribution: Where, Not Whether

Attribution is the obligation that applies to almost everything, and the questions people actually have are about placement rather than principle.

The requirement is that users of your work are made aware the data comes from OpenStreetMap and its contributors. For an interactive map, that means visible attribution on the map itself — a corner credit, not a link buried three pages away. For a printed product, it means in the legend or the credits. For a data download, it means in the accompanying documentation and, ideally, in the data itself.

Two practical points recur. **A link is expected where the medium allows one**, pointing at the project's copyright page. And **attribution should survive the pipeline**: a tile archive whose metadata carries the credit, a GeoParquet file with the source in its schema metadata, a database with a provenance table. [Automating ODbL Attribution in Derived Products](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/automating-odbl-attribution-in-derived-products/) makes that mechanical rather than a thing somebody must remember.

## Share-Alike and the Architecture It Implies

Share-alike bites when you distribute a derived database. The obligation is to offer that database under the same licence, which for a pure OSM derivative is usually unproblematic — the output was going to be open anyway.

It becomes an architectural question when a second dataset is involved. If combining OSM with a proprietary source produces a single derived database that you then distribute, the whole thing falls under share-alike, and a licence forbidding that makes the combination undistributable.

Three architectures avoid the collision, and all three have to be chosen deliberately.

**Keep them separable.** Distribute the OSM-derived part and the proprietary part as distinct databases, joined by the consumer. This is the collective-database route, and it works when the consumer can reasonably do the join.

**Distribute only produced works.** A rendered map, a report or an image made from the combination is a produced work, and share-alike does not reach it. This is why a great many commercial products render rather than publish data.

**Do not distribute at all.** Internal use creates no distribution obligation. Many pipelines that worry about this turn out to be entirely internal, and the question simply does not arise.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 239" role="img" aria-labelledby="olc3-t olc3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="olc3-t">Three architectures that avoid a share-alike collision with a second dataset</title>
  <desc id="olc3-d">Three panels. Keeping the datasets separable means distributing the OSM-derived part and the other part as distinct databases that the consumer joins, which keeps the combination collective rather than derived. Distributing only produced works means publishing images, reports or rendered output rather than the data itself, which carries attribution but not share-alike. Not distributing means the combination stays internal, so no distribution obligation arises at all, though attribution still applies to anything published.</desc>
  <rect x="0" y="0" width="880" height="239" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three ways out, all chosen before building</text>
  <rect x="26" y="52" width="259" height="153" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Keep separable</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Two distinct databases</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Consumer does the join</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Collective, not derived</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Works if the join is easy</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Hard to retrofit</text>
  <rect x="311" y="52" width="259" height="153" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Produced works only</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Images, reports, renders</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Attribution, no share-alike</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Data never leaves</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Why many products render</text>
  <text x="325" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Limits what you can offer</text>
  <rect x="595" y="52" width="259" height="153" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Do not distribute</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Internal use only</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">No distribution obligation</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Attribution still on outputs</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Often already the case</text>
  <text x="609" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Internal becomes external</text>
  <text x="868" y="223" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">All three are architectural rather than legal manoeuvres, which is why the question belongs in the design review and not the launch review.</text>
</svg>
<figcaption>The third option is more often available than teams assume, and the first is the only one that is expensive to adopt late.</figcaption>
</figure>

## Validation and Error Handling

| Condition | Root cause | Detection | Remediation |
| --- | --- | --- | --- |
| Attribution absent from a product | Nobody owned the requirement | A user or reviewer points it out | Automate attribution into the build, not the checklist |
| Proprietary data pulled into share-alike | Combined into one derived database | Legal review at launch | Keep the datasets separable, or distribute produced works |
| Provenance lost mid-pipeline | Source not carried through transformations | Cannot say which extract a result came from | Record source and date at ingestion and propagate |
| Attribution stripped by a consumer | Credit only in documentation | Downstream copies carry no credit | Embed the credit in the data's own metadata |
| Unclear whether output is a database | The distinction never examined | Nobody can answer the question | Settle produced work versus database explicitly |
| Import blocked on source licence | Assumed availability meant permission | Community or foundation objection | Establish permission in writing before importing |
| Compliance decays over releases | A one-off review, never re-run | New outputs ship without attribution | Check attribution in the build as a gate |

## Questions Worth Settling Early

Four questions come up on almost every OSM project, and each is far cheaper answered at design time than at launch.

**Who is the distributor?** If your organisation serves data to customers, you are distributing. If you provide software that customers point at their own OSM data, they are. The distinction decides whose obligation it is, and it is worth being explicit rather than assuming.

**Is a customer-facing API a distribution?** Generally yes, if the response contains extractable feature data. An endpoint returning geometry and attributes is distributing a database to whoever calls it, whatever the commercial framing around it.

**What about screenshots and documentation?** Any published depiction of the data is a produced work and carries the attribution obligation. That includes the map image in a sales deck, which is the single most commonly uncredited artefact in most organisations.

**Does an internal tool that anyone can access count?** Access within an organisation is not distribution, but the boundary of "the organisation" is worth checking: contractors, partner companies and a customer-facing support tool are each somewhere on the spectrum, and the answer follows from who can actually retrieve the data rather than from whose logo is on the interface.

## Automating Compliance

Compliance that depends on somebody remembering will eventually fail, usually at the least convenient moment. Three mechanisms make it structural instead.

**Attribution as a build artefact.** The credit string is generated from the pipeline's own provenance record and written into every output format's metadata — tile archive metadata, Parquet schema metadata, a database table, a documentation header. Nothing ships without it because nothing can.

**Provenance as a first-class column.** Every record carries, or is joinable to, the source extract and its date. This satisfies the licence, and it is independently the most useful debugging aid an OSM pipeline has — the point argued in [Recording OSM Data Provenance in a Pipeline](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/recording-osm-data-provenance-in-a-pipeline/).

**A gate in the build.** A check that fails when an output lacks attribution costs almost nothing and turns a recurring review into a one-time implementation.

## Performance and Scale

Compliance has essentially no runtime cost — a credit string and a provenance column are negligible next to geometry — but it has a real *architectural* cost if retrofitted. Adding provenance to a pipeline that never carried it means re-deriving every output to learn where it came from, which for a warehouse of any size is a project rather than a change.

The practical consequence is that this is a day-one decision. Carrying the source and date from the moment an extract is read costs one column and one string; adding them two years later costs a migration and a period during which nobody can answer questions about older data.

## Guides in This Topic

- [Automating ODbL Attribution in Derived Products](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/automating-odbl-attribution-in-derived-products/) — generating and embedding the credit in every output format the pipeline produces.
- [Deciding if a Derived Database Triggers Share-Alike](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/deciding-if-a-derived-database-triggers-share-alike/) — working through the produced work, derived and collective distinction on a real output.
- [Recording OSM Data Provenance in a Pipeline](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/recording-osm-data-provenance-in-a-pipeline/) — carrying source, version and date through every transformation.

## Frequently Asked Questions

<details>
<summary>Is a rendered map image subject to share-alike?</summary>

No. A rendered map is a produced work — something made from the database that is not itself a database — and produced works carry an attribution obligation but not share-alike. That is why many commercial products render rather than publish data: the image can be distributed under whatever terms they choose, provided the credit is visible. The tiles behind the image are a different question, because a vector tile set is data somebody could extract from.
</details>

<details>
<summary>Where does attribution have to appear?</summary>

Somewhere users of the work will actually see it, which depends on the medium. An interactive map needs a visible credit on the map itself rather than a link several pages away; a printed product needs it in the legend or credits; a data download needs it in the accompanying documentation and, better, in the data's own metadata. Embedding it in the data is what keeps it attached when somebody copies the file elsewhere.
</details>

<details>
<summary>Does combining OSM with proprietary data make the proprietary data open?</summary>

It can, which is exactly why the architecture matters. If the combination produces a single derived database that you then distribute, share-alike applies to the whole of it. Keeping the two separable — distributed as distinct databases the consumer joins — avoids that, as does distributing only produced works, as does not distributing at all. The choice has to be made before the pipeline is built, because retrofitting separability is expensive.
</details>

<details>
<summary>Do I owe anything if the pipeline is entirely internal?</summary>

Distribution is what triggers the obligations, so a pipeline whose outputs never leave your organisation creates no share-alike duty. Attribution still applies to anything you do publish, including screenshots in a public document or a map shown to customers. It is also worth noting that "internal" has a habit of becoming external later, and a pipeline that carried provenance from the start is the one that can answer the question when it does.
</details>

<details>
<summary>Is a vector tile set a produced work or a database?</summary>

Generally a database, because a tile set contains structured features with attributes that a consumer can query and extract rather than merely look at. A rendered raster image of the same map is a produced work. The distinction is not about the file format but about whether what you distribute lets somebody get the data back out, and a vector tile set very clearly does.
</details>

## Related

- [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/) — the parent section and the data model these obligations attach to.
- [OSM Conflation & Data Enrichment](https://www.osm-data-processing.org/osm-conflation-and-enrichment/) — where combining datasets makes the derived-database question urgent.
- [Preparing an OSM Import](https://www.osm-data-processing.org/osm-conflation-and-enrichment/preparing-an-osm-import/) — the permission question in the other direction.
- [OSM Vector Tiles & Rendering Pipelines](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/) — a common output whose classification people get wrong.
- [OSM Extract Providers & Automated Downloads](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/) — where provenance recording naturally begins.
- [Exporting OSM to GeoParquet & PostGIS](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/) — sinks whose metadata should carry the credit.

Up one level: [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "OSM Licensing & ODbL Compliance",
  "description": "What the Open Database Licence actually requires of a data pipeline: attribution, the produced work versus derived database distinction, share-alike triggers, and automating compliance rather than remembering it.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Data Fundamentals & Architecture",
  "about": ["ODbL compliance", "attribution requirements", "share-alike"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Fundamentals & Architecture", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/" },
    { "@type": "ListItem", "position": 3, "name": "OSM Licensing & ODbL Compliance", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Make an OSM pipeline licence-compliant by construction",
  "description": "Classify each output as a produced work, a derived database or a collective database, choose an architecture that avoids a share-alike collision, and automate attribution and provenance into the build.",
  "step": [
    { "@type": "HowToStep", "name": "Classify every output", "text": "Decide for each thing you distribute whether it is a produced work, a derived database or a collective database, since the obligations differ." },
    { "@type": "HowToStep", "name": "Settle the combination architecture", "text": "Where a second dataset is involved, choose between keeping the databases separable, distributing only produced works, or not distributing." },
    { "@type": "HowToStep", "name": "Record provenance at ingestion", "text": "Capture the source, the file and its date the moment an extract is read, and carry them through every transformation." },
    { "@type": "HowToStep", "name": "Generate attribution from provenance", "text": "Build the credit string from the recorded provenance rather than hard-coding it, so it stays accurate as sources change." },
    { "@type": "HowToStep", "name": "Embed the credit in every format", "text": "Write attribution into tile archive metadata, file schema metadata, database tables and documentation headers." },
    { "@type": "HowToStep", "name": "Gate the build", "text": "Fail the build when an output lacks attribution, turning a recurring review into a one-time implementation." }
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
      "name": "Is a rendered OSM map image subject to share-alike?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. A rendered map is a produced work — something made from the database that is not itself a database — and produced works carry an attribution obligation but not share-alike. The tiles behind the image are a different question, because a vector tile set is data somebody could extract from." }
    },
    {
      "@type": "Question",
      "name": "Where does OSM attribution have to appear?",
      "acceptedAnswer": { "@type": "Answer", "text": "Somewhere users of the work will actually see it, which depends on the medium. An interactive map needs a visible credit on the map itself; a printed product needs it in the legend or credits; a data download needs it in the documentation and, better, in the data's own metadata. Embedding it in the data keeps it attached when the file is copied elsewhere." }
    },
    {
      "@type": "Question",
      "name": "Does combining OSM with proprietary data make the proprietary data open?",
      "acceptedAnswer": { "@type": "Answer", "text": "It can, which is why the architecture matters. If the combination produces a single derived database that you distribute, share-alike applies to the whole of it. Keeping the two separable, distributing only produced works, or not distributing at all each avoids that — but the choice has to be made before the pipeline is built." }
    },
    {
      "@type": "Question",
      "name": "Do I owe anything if my OSM pipeline is entirely internal?",
      "acceptedAnswer": { "@type": "Answer", "text": "Distribution is what triggers the obligations, so outputs that never leave your organisation create no share-alike duty. Attribution still applies to anything you do publish, including screenshots and maps shown to customers. Internal also has a habit of becoming external later, and a pipeline that carried provenance from the start can answer the question when it does." }
    },
    {
      "@type": "Question",
      "name": "Is a vector tile set a produced work or a database?",
      "acceptedAnswer": { "@type": "Answer", "text": "Generally a database, because a tile set contains structured features with attributes a consumer can query and extract rather than merely look at. A rendered raster image of the same map is a produced work. The distinction is about whether what you distribute lets somebody get the data back out." }
    }
  ]
}
</script>
