---
title: "OSM Extract Providers & Automated Downloads"
description: "Choosing an OSM extract provider and consuming it reproducibly: coverage and cut strategy, checksum and signature verification, freshness assertions, and caching for a fleet of jobs."
pageTitle: "OSM Extract Providers: Choice, Integrity & Automation"
pageDescription: "Compare OSM extract providers on coverage, cut strategy and cadence, then automate downloads with checksum verification, freshness gates and a shared cache that survives a provider outage."
slug: osm-extract-providers-and-downloads
type: guide
breadcrumb: "Extract Providers"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# OSM Extract Providers & Automated Downloads

The cheapest, fastest and most reproducible way to get OpenStreetMap data is almost always a file somebody else has already cut for you. It is also the source most often consumed carelessly, because downloading a file feels like a solved problem in a way that querying an API does not — and the failures that follow are correspondingly quiet.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 290" role="img" aria-labelledby="epd1-t epd1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="epd1-t">How a published extract reaches a pipeline and where integrity is established</title>
  <desc id="epd1-d">The planet file is cut by a provider into regional extracts on a regular cadence, published alongside a checksum and in some cases a signature. A download step fetches both the file and its checksum. A verification step compares the computed digest against the published one and refuses to continue on a mismatch. A freshness gate compares the file's publication timestamp against the expected cadence and fails if the file is older than the pipeline tolerates. Only then does the extract reach the parser.</desc>
  <defs><marker id="epd1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="290" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Two gates stand between a download and a parser</text>
  <rect x="26" y="122" width="240" height="56" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="146" y="146" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">provider cut</text>
  <text x="146" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">planet to region</text>
  <rect x="320" y="50" width="240" height="56" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="74" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">download</text>
  <text x="440" y="92" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">file plus checksum</text>
  <rect x="320" y="122" width="240" height="56" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="146" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">verify digest</text>
  <text x="440" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">refuse on mismatch</text>
  <rect x="320" y="194" width="240" height="56" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="218" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">check freshness</text>
  <text x="440" y="236" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">refuse if stale</text>
  <rect x="614" y="122" width="240" height="56" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="734" y="146" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">parser</text>
  <text x="734" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">only verified input</text>
  <line x1="266" y1="150" x2="293" y2="150" stroke="currentColor" stroke-width="1.4"/>
  <line x1="293" y1="78" x2="293" y2="222" stroke="currentColor" stroke-width="1.4"/>
  <line x1="293" y1="78" x2="317" y2="78" stroke="currentColor" stroke-width="1.4" marker-end="url(#epd1-a)"/>
  <line x1="293" y1="150" x2="317" y2="150" stroke="currentColor" stroke-width="1.4" marker-end="url(#epd1-a)"/>
  <line x1="293" y1="222" x2="317" y2="222" stroke="currentColor" stroke-width="1.4" marker-end="url(#epd1-a)"/>
  <line x1="560" y1="78" x2="587" y2="78" stroke="currentColor" stroke-width="1.4"/>
  <line x1="560" y1="150" x2="587" y2="150" stroke="currentColor" stroke-width="1.4"/>
  <line x1="560" y1="222" x2="587" y2="222" stroke="currentColor" stroke-width="1.4"/>
  <line x1="587" y1="78" x2="587" y2="222" stroke="currentColor" stroke-width="1.4"/>
  <line x1="587" y1="150" x2="611" y2="150" stroke="currentColor" stroke-width="1.4" marker-end="url(#epd1-a)"/>
  <text x="868" y="274" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The second gate is the one nobody adds, and a mirror that silently stopped updating is the failure it exists to catch.</text>
</svg>
<figcaption>A corrupt download fails loudly at the parser; a stale one produces perfectly valid output derived from last month's map.</figcaption>
</figure>

## The Problem This Topic Solves

Your pipeline needs OSM data for a region, on a schedule, reproducibly. Extract providers publish exactly that: pre-cut regional files, refreshed daily, with checksums and — depending on the provider — replication directories that let you keep a local copy current instead of re-downloading.

The failure scenario that motivates this whole topic is not a corrupt file. It is a *stale* one. A mirror stops updating, or a scheduled download starts failing silently and the pipeline keeps using the copy it already has. Nothing errors. The parser is happy, the validation rules pass, the output looks exactly as it always does — and every number it produces describes a map from three weeks ago. A checksum does not catch this, because the file is intact. Only an explicit assertion on the file's publication date does.

## Prerequisites

Know the format landscape from [OSM XML vs PBF Comparison](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/), because providers publish both and the choice matters more than it looks. Understand cut strategies from [OSM Extract Clipping & Boundaries](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/), since a provider's choice of strategy determines what you get at the region's edge. And read the parent [Querying OSM: Overpass, Nominatim & APIs](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/) overview for why a file usually beats a query.

## What Providers Actually Differ On

Extract providers are not interchangeable, and the differences that matter are rarely the ones listed on a comparison page.

**Coverage granularity.** Some providers publish a strict administrative hierarchy — continent, country, state — while others publish city-sized cuts around arbitrary urban areas. If your area of interest is a metropolitan region that straddles two states, those two models give you very different amounts of surplus data to filter.

**Cut strategy at the boundary.** A region's edge has to do something about ways and relations that cross it. Different providers make different choices about whether to include the referenced nodes outside the boundary, whether to include partially-covered relations, and whether to clip geometry. This determines whether a road that leaves your region ends cleanly at the border or dangles with missing nodes.

**Cadence and replication.** Daily is typical for regional extracts. More important is whether the provider also publishes a *replication directory* for that region, because that is what lets you apply diffs rather than re-downloading — the machinery in [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/).

**Integrity artefacts.** A published checksum is the minimum. Some providers also publish signatures, which additionally prove the file came from them rather than from whatever answered the DNS query.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="epd2-t epd2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="epd2-t">How the main kinds of OSM extract source differ on the properties that matter</title>
  <desc id="epd2-d">A grid comparing three source kinds across four properties. A country and state provider offers an administrative hierarchy, daily cadence, per-region replication directories and published checksums. A city-extract provider offers arbitrary urban cuts, varied cadence, usually no replication directory, and checksums. The full planet file offers complete coverage, a weekly cadence, the canonical replication stream, and both checksums and signatures.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three source kinds, and replication is the dividing line</text>
  <rect x="196" y="48" width="219" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="306" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Country/state</text>
  <rect x="415" y="48" width="219" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="525" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">City extracts</text>
  <rect x="635" y="48" width="219" height="30" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="744" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Planet file</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Coverage model</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="306" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">administrative</text>
  <text x="525" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">arbitrary urban</text>
  <text x="744" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">everything</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Cadence</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="306" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">daily</text>
  <text x="525" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">varies</text>
  <text x="744" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">weekly</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Replication</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="306" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">per region</text>
  <text x="525" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">usually none</text>
  <text x="744" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">canonical</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Integrity</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="306" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">checksums</text>
  <text x="525" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">checksums</text>
  <text x="744" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">checksum + sig</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Without a replication directory you are re-downloading the whole region forever, which is the hidden cost of a convenient city cut.</text>
</svg>
<figcaption>The replication row is the one that decides your operational model for the next two years.</figcaption>
</figure>

## Integrity: Checksums, Signatures and Atomic Writes

Three mechanisms, doing three different jobs, and they are frequently confused.

A **checksum** proves the bytes you have are the bytes the provider published. It catches truncated transfers, corrupted storage and the occasional bad mirror. It is the minimum bar and it costs one extra small download.

A **signature** proves the file came from the provider, not from someone who intercepted the connection or compromised a mirror. Where a provider publishes one, verifying it is strictly better than verifying a checksum alone — a checksum served from the same compromised host proves nothing.

An **atomic write** is the local half of the problem. Downloading directly to the path your pipeline reads means a process killed mid-transfer leaves a truncated file exactly where the parser expects a complete one. Download to a temporary path, verify, then rename. The rename is atomic on any sane filesystem, so the target path only ever holds a verified file. [Automating Geofabrik Extract Downloads with Checksums](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/automating-geofabrik-extract-downloads-with-checksums/) implements all three.

## Freshness as a Gate, Not a Log Line

The stale-extract failure deserves its own discipline because it is invisible by construction. The defence is a single assertion at the top of the pipeline: **the input file's publication timestamp must be within an explicitly declared tolerance, and the pipeline must fail if it is not.**

Two details make it work. First, use the *file's* timestamp, not the filesystem's modification time, which changes when you copy the file and tells you nothing about the data. PBF files carry a header timestamp; providers also publish per-file dates. Second, declare the tolerance in the pipeline's configuration next to the schedule, so a daily job asserting a three-day tolerance is visibly inconsistent and gets noticed.

The same assertion also catches a subtler failure: a download that silently fell back to a cached copy because the provider returned an error the client swallowed.

## Validation and Error Handling

| Condition | Root cause | Detection | Remediation |
| --- | --- | --- | --- |
| Parser fails at a blob boundary | Truncated transfer | Checksum mismatch, or a parse error mid-file | Verify the digest before the file is moved into place |
| Output describes an old map | Mirror stopped updating | File timestamp older than the cadence | Assert freshness; fail the run, do not warn |
| Roads end abruptly at the border | Provider's cut strategy | Dangling way references at the region edge | Choose a provider strategy, or take a larger region |
| Download succeeds but is HTML | Provider returned an error page with HTTP 200 | File is kilobytes, not gigabytes | Assert a minimum size and the PBF magic bytes |
| Different results on two machines | Each downloaded a different daily file | The two files' timestamps differ | Pin one file and share it, rather than downloading twice |
| Provider outage stops every job | No local cache of the last good file | All jobs fail simultaneously | Keep the previous verified file and fall back explicitly |
| Checksum verified, file still wrong | Checksum served from the same bad mirror | Signature verification fails | Verify the signature where one is published |

## Performance, Scale and the Shared Cache

A fleet of jobs each downloading the same country extract is the most common waste in an OSM pipeline. Ten jobs downloading the same six-gigabyte file is sixty gigabytes of transfer, a heavy load on a volunteer-funded mirror, and — worse — ten copies that may not be the same file if the provider published a new one partway through.

The fix is a single fetch into shared storage, keyed on the provider's published version, with every job reading from there. That change gives reproducibility for free: jobs that read the same key are provably reading the same bytes. [Mirroring OSM Downloads Behind a Local Cache](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/mirroring-osm-downloads-behind-a-local-cache/) covers the cache and the fallback behaviour when the provider is unreachable.

Beyond that, the biggest lever is not downloading at all. A region kept current with replication diffs transfers a few megabytes a day instead of gigabytes, which is the whole argument of [Building a Minutely Update Pipeline](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/).

<figure class="diagram-wrap">
<svg viewBox="0 0 880 248" role="img" aria-labelledby="epd3-t epd3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="epd3-t">Daily bytes transferred under four ways of keeping a country extract current</title>
  <desc id="epd3-d">Four approaches compared on daily transfer volume for a hypothetical fleet of ten jobs using one country extract. Every job downloading its own copy daily transfers the most by a wide margin. One shared download per day transfers a tenth of that. Downloading only when the published checksum changes saves a little more. Applying replication diffs instead of re-downloading transfers a tiny fraction of the file size each day.</desc>
  <rect x="0" y="0" width="880" height="248" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four ways to stay current, three orders of magnitude apart</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">Ten jobs, ten downloads</text>
  <rect x="296" y="60" width="438" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">baseline</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">One shared download</text>
  <rect x="296" y="100" width="44" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">a tenth</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">Download on checksum change</text>
  <rect x="296" y="140" width="35" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">slightly less</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">Apply replication diffs</text>
  <rect x="296" y="180" width="6" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">a hundredth</text>
  <text x="868" y="232" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The first bar is what most pipelines actually do, and the gap to the second one is a configuration change rather than an engineering project.</text>
</svg>
<figcaption>Only the last approach changes the operational model; the first improvement is simply not fetching the same file ten times.</figcaption>
</figure>

## Failure Modes and Gotchas

- **An error page is a valid HTTP 200.** Assert a plausible minimum size and check the file's magic bytes before trusting it.
- **Filesystem mtime is not data freshness.** Copying a file updates its mtime and tells you nothing about the map it describes.
- **"Latest" is not a version.** A URL ending in `-latest.osm.pbf` names different bytes on different days. Record the checksum you actually used.
- **Boundary effects are provider choices.** A way crossing the region edge behaves differently depending on the cut strategy, and that difference propagates into routing graphs.
- **Two machines, two files.** Concurrent downloads around a publication boundary can fetch different versions. Fetch once, share the result.
- **Decompression is not verification.** A file that decompresses is not necessarily complete; the checksum is the only proof.
- **A provider is a dependency.** Its outage is your outage unless you keep the last good file and fall back deliberately.

## Integration Points

Downstream, a verified extract is the input to every parsing workflow on this site — the parser choice in [Choosing an OSM Parser: pyosmium, pyrosm or osmium-tool](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/) assumes a complete, trustworthy file. If your region of interest is smaller than the smallest published extract, the clipping workflow in [Clipping an OSM Extract with a .poly Boundary](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/clipping-an-osm-extract-with-a-poly-boundary/) takes over.

Sideways, the provenance of the download — which provider, which file, which checksum, which date — is exactly what the licensing obligations in [Recording OSM Data Provenance in a Pipeline](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/recording-osm-data-provenance-in-a-pipeline/) need recorded.

## Guides in This Topic

- [Automating Geofabrik Extract Downloads with Checksums](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/automating-geofabrik-extract-downloads-with-checksums/) — a download client with digest verification, freshness gating and atomic replacement.
- [Choosing Between Geofabrik, BBBike and the Planet File](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/choosing-between-geofabrik-bbbike-and-the-planet-file/) — matching a source to a region, a cadence and a replication requirement.
- [Mirroring OSM Downloads Behind a Local Cache](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/mirroring-osm-downloads-behind-a-local-cache/) — one fetch for a whole fleet, with a deliberate fallback when the provider is down.

## Frequently Asked Questions

<details>
<summary>Is verifying a checksum enough?</summary>

It is enough to prove the bytes are intact, which catches truncation and corruption. It does not prove the file came from the provider, because a compromised mirror can serve a matching checksum alongside a modified file. Where a provider publishes a signature, verify that instead — it establishes origin as well as integrity. And neither mechanism says anything about whether the file is current, which needs a separate freshness assertion.
</details>

<details>
<summary>How do I detect a stale extract?</summary>

Assert on the data's own timestamp rather than on the file's modification time. A PBF file carries a header timestamp describing the state of the map it was cut from, and providers publish per-file dates alongside the download. Compare that against an explicitly declared tolerance and fail the run when it is exceeded. Logging a warning is not enough, because the pipeline will succeed and nobody reads warnings on a successful run.
</details>

<details>
<summary>Should every job download its own extract?</summary>

No. A fleet of jobs downloading the same regional file wastes bandwidth, loads a volunteer-funded mirror unnecessarily, and — the part that actually bites — can leave different jobs working from different daily files if a publication happens mid-run. Fetch once into shared storage keyed on the published version, and have every job read from there, which makes reproducibility a property of the design rather than a hope.
</details>

<details>
<summary>What happens at the edge of a regional extract?</summary>

That depends on the cut strategy the provider used, and providers differ. A way crossing the boundary may be included complete with its nodes outside the region, included but truncated with dangling references, or excluded entirely. The consequences show up downstream as roads that stop at the border or geometry that cannot be assembled. If edge behaviour matters — it always does for routing — either choose a provider whose strategy you have verified or take a larger region and clip it yourself.
</details>

<details>
<summary>When should I use the planet file instead of a regional extract?</summary>

When your area of interest spans several countries, when you need the canonical replication stream rather than a per-region one, or when you are cutting your own regions and want to control the boundary strategy. The planet file is a large commitment in storage and processing time, so it is rarely the right answer for a single country — but for a multi-region pipeline that already needs its own cutting step it removes a whole class of provider dependency.
</details>

## Related

- [Querying OSM: Overpass, Nominatim & APIs](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/) — the parent section and why a file usually beats a query.
- [OSM Extract Clipping & Boundaries](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/) — cutting your own region when no published extract fits.
- [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/) — staying current without re-downloading.
- [Splitting a Planet File into Regional Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/splitting-a-planet-file-into-regional-extracts/) — becoming your own provider.
- [Choosing an OSM Parser: pyosmium, pyrosm or osmium-tool](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/) — what reads the verified file next.
- [Recording OSM Data Provenance in a Pipeline](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/recording-osm-data-provenance-in-a-pipeline/) — capturing which file a result came from.

Up one level: [Querying OSM: Overpass, Nominatim & APIs](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "OSM Extract Providers & Automated Downloads",
  "description": "Choosing an OSM extract provider and consuming it reproducibly: coverage and cut strategy, checksum and signature verification, freshness assertions, and caching for a fleet of jobs.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Querying OSM: Overpass, Nominatim & APIs",
  "about": ["OSM extract providers", "checksum verification", "data freshness"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Querying OSM: Overpass, Nominatim & APIs", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/" },
    { "@type": "ListItem", "position": 3, "name": "OSM Extract Providers & Automated Downloads", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Consume an OSM extract provider reproducibly",
  "description": "Pick a provider on coverage, cut strategy and replication, then download with digest verification, an explicit freshness gate, atomic replacement and a shared cache.",
  "step": [
    { "@type": "HowToStep", "name": "Choose on replication, not convenience", "text": "Prefer a provider that publishes a replication directory for your region, because without one you re-download the whole file forever." },
    { "@type": "HowToStep", "name": "Verify integrity", "text": "Download the published checksum alongside the file and compare the computed digest, preferring a signature where the provider publishes one." },
    { "@type": "HowToStep", "name": "Gate on freshness", "text": "Assert the data's own timestamp is within an explicitly declared tolerance and fail the run rather than warning when it is not." },
    { "@type": "HowToStep", "name": "Write atomically", "text": "Download to a temporary path, verify there, and rename into place so the pipeline's input path only ever holds a verified file." },
    { "@type": "HowToStep", "name": "Fetch once for the fleet", "text": "Store the verified file in shared storage keyed on its published version so every job provably reads the same bytes." },
    { "@type": "HowToStep", "name": "Record the provenance", "text": "Persist the provider, file name, checksum and publication date alongside any results derived from the extract." }
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
      "name": "Is verifying a checksum enough for an OSM extract?",
      "acceptedAnswer": { "@type": "Answer", "text": "It is enough to prove the bytes are intact, which catches truncation and corruption. It does not prove the file came from the provider, because a compromised mirror can serve a matching checksum alongside a modified file. Where a provider publishes a signature, verify that instead. And neither mechanism says anything about whether the file is current, which needs a separate freshness assertion." }
    },
    {
      "@type": "Question",
      "name": "How do I detect a stale OSM extract?",
      "acceptedAnswer": { "@type": "Answer", "text": "Assert on the data's own timestamp rather than on the file's modification time. A PBF file carries a header timestamp describing the state of the map it was cut from, and providers publish per-file dates. Compare that against an explicitly declared tolerance and fail the run when it is exceeded. Logging a warning is not enough, because the pipeline will succeed and nobody reads warnings on a successful run." }
    },
    {
      "@type": "Question",
      "name": "Should every job download its own extract?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. A fleet of jobs downloading the same regional file wastes bandwidth, loads a volunteer-funded mirror unnecessarily, and can leave different jobs working from different daily files if a publication happens mid-run. Fetch once into shared storage keyed on the published version, and have every job read from there." }
    },
    {
      "@type": "Question",
      "name": "What happens at the edge of a regional OSM extract?",
      "acceptedAnswer": { "@type": "Answer", "text": "That depends on the cut strategy the provider used, and providers differ. A way crossing the boundary may be included complete with its nodes outside the region, included but truncated with dangling references, or excluded entirely. If edge behaviour matters — it always does for routing — either choose a provider whose strategy you have verified or take a larger region and clip it yourself." }
    },
    {
      "@type": "Question",
      "name": "When should I use the planet file instead of a regional extract?",
      "acceptedAnswer": { "@type": "Answer", "text": "When your area of interest spans several countries, when you need the canonical replication stream rather than a per-region one, or when you are cutting your own regions and want to control the boundary strategy. It is a large commitment in storage and processing time, so it is rarely right for a single country." }
    }
  ]
}
</script>
