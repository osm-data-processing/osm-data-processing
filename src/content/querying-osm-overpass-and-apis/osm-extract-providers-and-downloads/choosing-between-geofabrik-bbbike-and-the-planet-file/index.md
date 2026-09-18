---
title: "Choosing Between Geofabrik, BBBike and the Planet File"
description: "Match an OSM data source to your region, cadence and replication needs: administrative extracts, custom city cuts, and the full planet, with the costs each one hides."
pageTitle: "Geofabrik vs BBBike vs Planet: Choosing an OSM Source"
pageDescription: "Decide between administrative regional extracts, custom bounding-box cuts and the full planet file by comparing coverage fit, boundary behaviour, replication availability and total storage cost."
slug: choosing-between-geofabrik-bbbike-and-the-planet-file
type: article
breadcrumb: "Choosing a Source"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Choosing Between Geofabrik, BBBike and the Planet File

Pick the OSM source whose shape actually matches your area of interest, rather than the one whose download page you found first — because the mismatch is paid for every single day the pipeline runs.

## Prerequisites

- [ ] A precise statement of your area of interest, as a bounding box or a boundary, not as a country name.
- [ ] A decision about freshness: how old may the data be before your consumers are misled?
- [ ] Knowledge of whether you need replication, from [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/).
- [ ] A rough storage and processing budget, because the planet file changes both by an order of magnitude.
- [ ] The integrity discipline from [Automating Geofabrik Extract Downloads with Checksums](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/automating-geofabrik-extract-downloads-with-checksums/), whichever source you choose.

## Conceptual minimum

The three source kinds differ along one axis that dominates everything else: **who decides the boundary**.

With an **administrative extract provider**, the boundary is a country, state or region cut along real administrative edges, published on a fixed schedule. You take what is offered. The great advantage is that these providers publish per-region replication directories, which means you can keep a local copy current with small daily diffs instead of re-downloading gigabytes.

With a **custom cut service**, you specify a bounding box or a city and receive a file matching it. The fit is excellent and the file is small. The cost is that such cuts are generally one-off products: there is no replication directory for an arbitrary rectangle you invented, so staying current means re-requesting and re-downloading.

With the **planet file**, you take everything and cut it yourself. The boundary decision becomes entirely yours, including the strategy at the edge, and you inherit the canonical replication stream. You also inherit the storage, the processing time, and the operational responsibility for a cutting pipeline.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 306" role="img" aria-labelledby="cgb1-t cgb1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cgb1-t">Choosing an OSM source from the shape of the area you actually need</title>
  <desc id="cgb1-d">A decision node about how the area of interest relates to administrative boundaries, with three outcomes. If the area matches a published administrative region, an administrative extract provider gives the best fit with per-region replication included. If the area is a single city or an arbitrary rectangle used once, a custom cut service gives a small well-fitted file at the cost of having no replication path. If the area spans several countries or the boundary strategy matters, taking the planet file and cutting it yourself is the only approach that gives full control.</desc>
  <defs><marker id="cgb1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="306" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Where does your area of interest actually sit?</text>
  <rect x="26" y="117" width="250" height="88" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.6"/>
  <text x="151" y="145" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">How does your area map to borders?</text>
  <text x="151" y="167" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Answer before comparing providers</text>
  <text x="151" y="185" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">The fit decides everything else</text>
  <line x1="276" y1="161" x2="314" y2="161" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="314" y2="239" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="353" y2="83" stroke="currentColor" stroke-width="1.4" marker-end="url(#cgb1-a)"/>
  <rect x="356" y="52" width="498" height="62" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="370" y="77" font-size="12" font-weight="700" fill="currentColor">Administrative extract</text>
  <text x="370" y="97" font-size="10.5" fill="currentColor" opacity="0.88">Area matches a published country, state or region</text>
  <line x1="314" y1="161" x2="353" y2="161" stroke="currentColor" stroke-width="1.4" marker-end="url(#cgb1-a)"/>
  <rect x="356" y="130" width="498" height="62" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="370" y="155" font-size="12" font-weight="700" fill="currentColor">Custom cut service</text>
  <text x="370" y="175" font-size="10.5" fill="currentColor" opacity="0.88">One city or one rectangle, used once, no replication needed</text>
  <line x1="314" y1="239" x2="353" y2="239" stroke="currentColor" stroke-width="1.4" marker-end="url(#cgb1-a)"/>
  <rect x="356" y="208" width="498" height="62" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="370" y="233" font-size="12" font-weight="700" fill="currentColor">Planet, cut yourself</text>
  <text x="370" y="253" font-size="10.5" fill="currentColor" opacity="0.88">Several countries, or edge behaviour must be controlled</text>
  <text x="868" y="290" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Choosing the middle branch for a recurring job is the most common mistake: a perfect fit with no replication path costs more every week.</text>
</svg>
<figcaption>The question is about geometry, not about provider features — the feature differences follow from the geometry answer.</figcaption>
</figure>

## The Comparison That Matters

<figure class="diagram-wrap">
<svg viewBox="0 0 880 342" role="img" aria-labelledby="cgb2-t cgb2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cgb2-t">The three source kinds compared on the five properties that drive real cost</title>
  <desc id="cgb2-d">A grid of five properties against the three source kinds. Coverage fit is moderate for administrative extracts, excellent for custom cuts and perfect for a self-cut planet. Replication is available per region for administrative extracts, absent for custom cuts and canonical for the planet. Storage is moderate, small and very large respectively. Setup effort is minimal, minimal and substantial. Boundary control is none, limited to a rectangle, and complete.</desc>
  <rect x="0" y="0" width="880" height="342" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Five properties, and no source wins three of them</text>
  <rect x="206" y="48" width="216" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="314" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Administrative</text>
  <rect x="422" y="48" width="216" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="530" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Custom cut</text>
  <rect x="638" y="48" width="216" height="30" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="746" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Planet</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Coverage fit</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="314" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">moderate</text>
  <text x="530" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">excellent</text>
  <text x="746" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">perfect</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Replication</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="314" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">per region</text>
  <text x="530" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">none</text>
  <text x="746" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">canonical</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Storage</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="314" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">moderate</text>
  <text x="530" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">small</text>
  <text x="746" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">very large</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Setup effort</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="314" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">minimal</text>
  <text x="530" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">minimal</text>
  <text x="746" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">substantial</text>
  <text x="30" y="289" font-size="11.5" font-weight="600" fill="currentColor">Boundary control</text>
  <line x1="26" y1="308" x2="854" y2="308" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="314" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">none</text>
  <text x="530" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a rectangle</text>
  <text x="746" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">complete</text>
  <text x="868" y="326" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The second row is the one that compounds: everything else is a one-off cost, and replication is a daily one.</text>
</svg>
<figcaption>Read this table top to bottom for a one-off analysis and bottom to top for a pipeline that will still be running next year.</figcaption>
</figure>

Three observations follow that are easy to miss.

**Surplus data is cheap; missing data is not.** Taking a country extract when you need a city means filtering out ninety percent of it, which costs one extra pass with `osmium tags-filter` and a few minutes. Taking a city cut and later discovering your area of interest extends past its edge means going back to the drawing board. When the fit is uncertain, take the larger region.

**Replication availability outranks file size.** A slightly larger file you can update with a two-megabyte daily diff is cheaper within a week than a perfectly-sized file you must re-download. This is the single most common sizing mistake.

**The planet file's cost is mostly not storage.** It is the cutting pipeline you now own: the boundary files, the strategy choice, the scheduled run, and the failure modes of all three. That is a real ongoing commitment, justified when you need several regions or when edge behaviour genuinely matters, and hard to justify for one country.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 248" role="img" aria-labelledby="cgb3-t cgb3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cgb3-t">Cumulative bytes transferred over one month for a single country, by source strategy</title>
  <desc id="cgb3-d">Four strategies compared on total transfer over thirty days for one country-sized area. Re-downloading a custom cut every day transfers the most despite the file being the smallest, because the whole file moves each time. Re-downloading an administrative extract daily transfers more per file but the same order of magnitude. Downloading an administrative extract once and applying daily replication diffs transfers a small fraction. Downloading the planet once and cutting locally transfers the most on day one and almost nothing afterwards.</desc>
  <rect x="0" y="0" width="880" height="248" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Thirty days of transfer, not one download</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">Daily custom cut</text>
  <rect x="296" y="60" width="263" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">30 full copies</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">Daily administrative extract</text>
  <rect x="296" y="100" width="438" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">30 copies</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">Extract once, then diffs</text>
  <rect x="296" y="140" width="22" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">1 copy + diffs</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">Planet once, cut locally</text>
  <rect x="296" y="180" width="96" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">planet + diffs</text>
  <text x="868" y="232" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Comparing single download sizes makes the second row look worst; comparing a month of operation makes it the second best available option.</text>
</svg>
<figcaption>The planet bar is dominated entirely by day one, which is why it flattens for any pipeline expected to run for a year.</figcaption>
</figure>

## Boundary Behaviour Is a Real Difference

Every cut has to decide what happens to a way that crosses the boundary, and the options produce visibly different data. A **complete-ways** strategy includes every way that touches the region in full, along with the nodes outside the boundary needed to draw it — bigger file, clean geometry at the edge. A **simple** strategy takes only what is strictly inside, leaving ways truncated and referencing nodes that are not in the file.

For an analysis of land use inside a city, a truncated edge is irrelevant. For a routing graph, it is the difference between roads that connect to the outside world and a network with a ragged fringe of dead ends. The strategies and their consequences are worked through in [Choosing Complete Ways vs Smart in osmium extract](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/choosing-complete-ways-vs-smart-in-osmium-extract/); the point here is that **a published extract has already made this choice for you**, and you should know which one before building a routing graph from it.

## Verification

- **The area of interest fits inside the extract with margin.** Compare your boundary against the extract's declared bounding box; touching the edge is not good enough for routing.
- **A replication directory exists for the region.** Check it before committing; discovering its absence after building an update pipeline is expensive.
- **The edge behaves as expected.** Take a road that crosses the boundary and confirm it has usable geometry rather than dangling references.
- **The storage estimate includes the derived outputs.** The extract itself is usually the smallest artefact in the pipeline.
- **A second region is cheap to add.** If adding one more country means re-thinking the whole approach, the source choice is too tight.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Re-downloading gigabytes daily | Source has no replication directory | Switch to a provider that publishes per-region diffs |
| Roads dead-end at the region edge | Simple cut strategy in the published extract | Take the surrounding region, or cut with complete ways |
| Area of interest grew past the file | Cut sized to today's requirement exactly | Take the next region up; surplus is cheap to filter |
| Planet pipeline stalls on storage | Sized on the planet file, not the working set | Budget for the extract plus every derived artefact |
| Two regions with inconsistent edges | Each cut independently with different strategies | Cut all regions from one planet with one strategy |
| Update job never becomes cheaper | Replication never adopted after the first download | Wire the diff stream once the extract is in place |

## Specification reference

> Regional extract providers publish files cut from the planet along administrative boundaries, accompanied by boundary polygon files and, for many regions, replication directories carrying the same hourly or daily diff format as the main replication stream. Custom extract services produce one-off files for a user-specified area and generally do not publish replication for them. See the [OSM planet and extract documentation](https://wiki.openstreetmap.org/wiki/Planet.osm) for the sources and their update cadences.

## Frequently Asked Questions

<details>
<summary>Should I take a city extract or the surrounding country?</summary>

Take the country unless storage is genuinely tight. The surplus costs one filtering pass that runs in minutes and, more importantly, the administrative extract usually comes with a replication directory while the city cut does not. The cheaper-looking option that has to be re-downloaded in full every day is more expensive within a week, and it leaves you with no upgrade path when the area of interest grows.
</details>

<details>
<summary>When is the planet file genuinely the right choice?</summary>

When you need several regions and want their edges to be consistent, when the boundary strategy matters enough that you need to control it yourself, or when your area of interest does not correspond to any administrative unit anybody publishes. It is a real commitment — storage, processing time and a cutting pipeline you now maintain — so for a single country it is rarely worth it.
</details>

<details>
<summary>Does the boundary strategy really affect my results?</summary>

It depends entirely on what you are computing. For an analysis bounded to the inside of a region, truncated edges are irrelevant. For anything that traverses the network — routing, connectivity, catchment analysis — a cut that leaves ways without their outside nodes produces a graph with a ragged fringe of artificial dead ends, and every measurement near the boundary is wrong in a way that is hard to notice.
</details>

<details>
<summary>Can I mix sources for different regions?</summary>

You can, but their edges will not agree. Two regions cut by different services with different strategies will disagree about which features belong to the overlap, and a feature present in both may have different geometry in each. If the regions are analysed independently that is harmless; if they are merged, cut them all from one source with one strategy instead.
</details>

## Related

- [OSM Extract Providers & Automated Downloads](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/) — the parent topic and the integrity discipline every source needs.
- [Splitting a Planet File into Regional Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/splitting-a-planet-file-into-regional-extracts/) — running your own cutting pipeline.
- [Choosing Complete Ways vs Smart in osmium extract](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/choosing-complete-ways-vs-smart-in-osmium-extract/) — the boundary strategies a published extract has already chosen.
- [Building a Minutely Update Pipeline](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/) — the replication path that makes provider choice matter.
- [Mirroring OSM Downloads Behind a Local Cache](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/mirroring-osm-downloads-behind-a-local-cache/) — sharing whichever source you chose across a fleet.

Up one level: [OSM Extract Providers & Automated Downloads](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Choosing Between Geofabrik, BBBike and the Planet File",
  "description": "Match an OSM data source to your region, cadence and replication needs: administrative extracts, custom city cuts, and the full planet, with the costs each one hides.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Querying OSM: Overpass, Nominatim & APIs",
  "about": ["OSM extract selection", "planet file", "regional coverage"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Querying OSM: Overpass, Nominatim & APIs", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/" },
    { "@type": "ListItem", "position": 3, "name": "OSM Extract Providers & Automated Downloads", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/" },
    { "@type": "ListItem", "position": 4, "name": "Choosing Between Geofabrik, BBBike and the Planet File", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/choosing-between-geofabrik-bbbike-and-the-planet-file/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Choose an OSM data source for a pipeline",
  "description": "Decide between an administrative regional extract, a custom cut and the full planet by comparing coverage fit, replication availability, storage cost, setup effort and boundary control.",
  "step": [
    { "@type": "HowToStep", "name": "State the area precisely", "text": "Express the area of interest as a boundary or bounding box rather than a place name, so fit can be measured rather than assumed." },
    { "@type": "HowToStep", "name": "Check replication first", "text": "Establish whether a replication directory exists for the candidate source, because that decides the daily cost for the life of the pipeline." },
    { "@type": "HowToStep", "name": "Prefer surplus to a tight fit", "text": "Take the next region up when the fit is uncertain, since filtering surplus is one cheap pass and re-sourcing is not." },
    { "@type": "HowToStep", "name": "Establish the boundary behaviour", "text": "Find out which cut strategy the published extract used and verify a road crossing the edge has usable geometry." },
    { "@type": "HowToStep", "name": "Budget beyond the file", "text": "Size storage for the extract plus every derived artefact, which usually dominates the extract itself." },
    { "@type": "HowToStep", "name": "Cut the planet only for control", "text": "Choose the planet file when several regions must share one boundary strategy or no published extract matches the area." }
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
      "name": "Should I take a city extract or the surrounding country?",
      "acceptedAnswer": { "@type": "Answer", "text": "Take the country unless storage is genuinely tight. The surplus costs one filtering pass that runs in minutes and, more importantly, the administrative extract usually comes with a replication directory while the city cut does not. The cheaper-looking option that has to be re-downloaded in full every day is more expensive within a week." }
    },
    {
      "@type": "Question",
      "name": "When is the planet file genuinely the right choice?",
      "acceptedAnswer": { "@type": "Answer", "text": "When you need several regions and want their edges to be consistent, when the boundary strategy matters enough that you need to control it yourself, or when your area of interest does not correspond to any administrative unit anybody publishes. It is a real commitment in storage, processing time and pipeline maintenance, so for a single country it is rarely worth it." }
    },
    {
      "@type": "Question",
      "name": "Does the extract boundary strategy really affect my results?",
      "acceptedAnswer": { "@type": "Answer", "text": "It depends entirely on what you are computing. For an analysis bounded to the inside of a region, truncated edges are irrelevant. For anything that traverses the network, a cut that leaves ways without their outside nodes produces a graph with a ragged fringe of artificial dead ends, and every measurement near the boundary is wrong in a way that is hard to notice." }
    },
    {
      "@type": "Question",
      "name": "Can I mix OSM extract sources for different regions?",
      "acceptedAnswer": { "@type": "Answer", "text": "You can, but their edges will not agree. Two regions cut by different services with different strategies will disagree about which features belong to the overlap, and a feature present in both may have different geometry in each. If the regions are merged rather than analysed independently, cut them all from one source with one strategy." }
    }
  ]
}
</script>
