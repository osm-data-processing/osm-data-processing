---
title: "Serving & Invalidating OSM Tiles"
description: "Packaging and delivering a tile set — MBTiles, PMTiles and loose directories — plus the cache layers between archive and client, and how to purge exactly what an OSM diff made wrong."
pageTitle: "Serving OSM Vector Tiles and Invalidating Them Correctly"
pageDescription: "Compare MBTiles, PMTiles and loose tile directories, understand the cache layers between archive and browser, and purge only the tiles an OSM change file actually invalidated."
slug: serving-and-invalidating-osm-tiles
type: guide
breadcrumb: "Serving & Invalidation"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Serving & Invalidating OSM Tiles

Generating a tile set is a batch problem with a clear end. Serving one is an operational problem with no end, and the decisions that make it cheap or expensive are made at packaging time, before a single request arrives.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="sit1-t sit1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="sit1-t">The layers a tile request passes through and where each one can hold a stale copy</title>
  <desc id="sit1-d">Five layers between the archive and the reader. The browser holds tiles in its own HTTP cache keyed on the URL. A content delivery network holds copies at edge locations worldwide. An origin cache or reverse proxy may hold a copy in front of the server. The tile server or object store holds the archive itself. The generator produced the archive from an extract at a point in time. Any of the first four can serve a stale tile after the archive is updated, which is why invalidation has to address each of them.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Five layers, four of which can be stale</text>
  <rect x="26" y="50" width="828" height="52" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="42" y="72" font-size="12.5" font-weight="700" fill="currentColor">Browser cache</text>
  <text x="42" y="90" font-size="10.5" fill="currentColor" opacity="0.88">Per reader, keyed on the URL</text>
  <text x="838" y="82" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">cleared by nobody</text>
  <rect x="26" y="112" width="828" height="52" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="42" y="134" font-size="12.5" font-weight="700" fill="currentColor">Edge network</text>
  <text x="42" y="152" font-size="10.5" fill="currentColor" opacity="0.88">Copies at edge locations</text>
  <text x="838" y="144" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">purge by key or by tag</text>
  <rect x="26" y="174" width="828" height="52" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="42" y="196" font-size="12.5" font-weight="700" fill="currentColor">Origin cache</text>
  <text x="42" y="214" font-size="10.5" fill="currentColor" opacity="0.88">Reverse proxy in front</text>
  <text x="838" y="206" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">purge or short TTL</text>
  <rect x="26" y="236" width="828" height="52" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="42" y="258" font-size="12.5" font-weight="700" fill="currentColor">Archive</text>
  <text x="42" y="276" font-size="10.5" fill="currentColor" opacity="0.88">The tiles you generated</text>
  <text x="838" y="268" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">the source of truth</text>
  <text x="868" y="308" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The browser layer is the one you cannot purge, which is why a cache-busting element in the URL is worth building in from the start.</text>
</svg>
<figcaption>Every layer above the archive is a place a reader can be shown yesterday's map after you have fixed it.</figcaption>
</figure>

## The Problem This Topic Solves

You have an archive of tiles and readers who need to see them, on a map that must reflect the data without being regenerated from scratch every time an edit lands. The serving decision determines your ongoing cost and your operational surface; the invalidation decision determines whether the map is ever actually current.

The failure scenario is a map that is correct in the archive and wrong in the browser. A diff is applied, the affected tiles are regenerated, and readers continue to see the old ones — from a browser cache, from an edge location, or from a proxy nobody remembered was in the path. Nothing errors, the archive is demonstrably right, and the bug report says "the map is wrong" with a screenshot that cannot be reproduced.

## Prerequisites

Understand the tile pyramid from [OSM Vector Tiles & Rendering Pipelines](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/), especially the ancestor relationship between zooms. Know how change files identify what moved, from [Applying .osc Change Files with osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/). And have an archive to serve, from either [Building OSM Tiles with Tippecanoe](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/building-tiles-with-tippecanoe/) or [Planetiler & Tilemaker Workflows](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/planetiler-and-tilemaker-workflows/).

## Three Packaging Formats

**MBTiles** is a SQLite database holding tiles and metadata. It is the natural output of most generators, it is easy to inspect with ordinary tools, and it requires a process that can open the database to serve from it. Updating individual tiles is a straightforward row update, which makes it the friendliest format for incremental re-rendering.

**PMTiles** is a single file with a hierarchical index at its head, designed so a client can find and fetch one tile with a couple of HTTP range requests. That removes the server entirely: the archive sits in object storage behind a content delivery network and clients read it directly. The trade is that the file is immutable in practice — updating individual tiles means rewriting it — so it suits a tile set rebuilt as a unit.

**Loose directories** store one file per tile. Conceptually simple and trivially cacheable, but a continent at zoom 14 is hundreds of millions of objects, and most storage systems handle that number of small files badly. It remains reasonable for a small area or for a tile set with a shallow maximum zoom.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="sit2-t sit2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="sit2-t">The three packaging formats compared on serving, updates and operational cost</title>
  <desc id="sit2-d">A grid of four properties against three formats. MBTiles needs a server process, supports updating individual tiles easily, produces one file, and suits a tile set that is re-rendered incrementally. PMTiles needs no server because clients read it by range request, is effectively immutable so updates mean a rewrite, produces one file, and suits a tile set rebuilt as a unit. Loose directories need only a static file server, allow trivial per-tile updates, produce hundreds of millions of objects, and suit small or shallow tile sets.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three formats, and updateability is the dividing line</text>
  <rect x="206" y="48" width="216" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="314" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">MBTiles</text>
  <rect x="422" y="48" width="216" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="530" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">PMTiles</text>
  <rect x="638" y="48" width="216" height="30" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="746" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Loose files</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Needs a server</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="314" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">yes</text>
  <text x="530" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">no</text>
  <text x="746" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">static only</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Update one tile</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="314" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">easy</text>
  <text x="530" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">rewrite</text>
  <text x="746" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">trivial</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Object count</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="314" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">one file</text>
  <text x="530" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">one file</text>
  <text x="746" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">hundreds of millions</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Natural fit</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="314" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">incremental</text>
  <text x="530" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">rebuilt whole</text>
  <text x="746" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">small or shallow</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Choosing PMTiles for a tile set updated from minutely diffs means rewriting a multi-gigabyte file every few minutes.</text>
</svg>
<figcaption>The update row is what ties the packaging choice to the invalidation strategy, which is why they belong in one topic.</figcaption>
</figure>

## Invalidation: the Dirty Tile Computation

When a change file arrives, the great majority of tiles are unaffected. Working out which ones are not is the whole game, and it has three parts.

**Locate the changes.** Every created, modified or deleted element in the change file has a position — directly for a node, through its members for a way or relation. Those positions map to tile coordinates at the maximum zoom. The mechanics are in [Computing a Dirty Tile List from an .osc File](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/computing-a-dirty-tile-list-from-an-osc-file/).

**Expand to ancestors.** A tile at zoom 14 has one parent at 13, one grandparent at 12, and so on to zoom 0. A change visible at 14 also changes the generalized representation at every lower zoom, so the dirty set must include the whole ancestor chain. Forgetting this produces the characteristic bug of a map that is right zoomed in and wrong zoomed out.

**Expand for the buffer.** A change near a tile boundary affects the neighbouring tile too, because that tile retains geometry past its edge. Including the eight neighbours at the deepest zoom is a cheap over-approximation that avoids a whole class of edge artefacts.

The result is a set of tile addresses to re-render and, separately, to purge from every cache layer.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 248" role="img" aria-labelledby="sit3-t sit3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="sit3-t">How the dirty tile set grows as each expansion rule is applied</title>
  <desc id="sit3-d">Four counts for one minutely change file over a country. The raw changed elements map to a few hundred tiles at the deepest zoom. Adding the eight immediate neighbours of each, to account for buffer geometry, roughly quadruples that once overlaps are removed. Adding the full ancestor chain up to zoom zero adds about a third again, because each level contributes only a quarter as many tiles as the one below. The final set remains a vanishing fraction of the whole pyramid.</desc>
  <rect x="0" y="0" width="880" height="248" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Expansion is cheap; the pyramid is not</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">Changed elements</text>
  <rect x="256" y="60" width="6" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 320 tiles</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">Plus neighbours</text>
  <rect x="256" y="100" width="6" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 1,150</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">Plus ancestors</text>
  <rect x="256" y="140" width="8" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 1,520</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">Whole pyramid</text>
  <rect x="256" y="180" width="478" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">millions</text>
  <text x="868" y="232" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Even fully expanded the dirty set is a tiny fraction of the pyramid, which is why re-rendering everything is never the right answer.</text>
</svg>
<figcaption>Both expansions together add less than five times the base set, and both prevent a class of visible artefact.</figcaption>
</figure>

## Cache Layers and What Each Needs

Every layer between the archive and the reader needs its own invalidation, and they do not all support the same operations.

An **edge network** typically supports purging by URL or by a tag attached at response time. Tagging responses with the tile's zoom and a coarse spatial key makes bulk purges possible without enumerating millions of URLs.

An **origin cache** — a reverse proxy in front of a tile server — usually supports purge by URL or a short time to live. For a tile set updated every few minutes, a time to live shorter than the update interval is simpler than wiring purges and costs little.

A **browser cache** cannot be purged at all. The only reliable control is the URL: including a version token in the tile path, incremented when the tile set is rebuilt, makes every tile a new URL and sidesteps the problem entirely. That is worth building in from the start, because retrofitting it means changing every style document.

## Validation and Error Handling

| Condition | Root cause | Detection | Remediation |
| --- | --- | --- | --- |
| Map right zoomed in, wrong zoomed out | Ancestor tiles not invalidated | Low-zoom tiles predate the change | Expand the dirty set up the whole ancestor chain |
| Stale tiles after a purge | A cache layer nobody knew about | Response headers name an unexpected cache | Trace the full request path and purge each layer |
| Artefacts near changed features | Neighbouring tiles not invalidated | Seams appear only next to edits | Include neighbours at the deepest zoom |
| Readers see old tiles for days | Browser cache with a long time to live | Only a hard refresh fixes it | Put a version token in the tile URL |
| Rewrite takes longer than the update interval | Immutable format with frequent updates | Each rebuild overlaps the next | Use an updateable format, or update less often |
| Purge API rate limited | Enumerating millions of URLs | Purge requests throttled | Tag responses and purge by tag |
| Archive updated, server serves old data | Server holds the file open | Restart fixes it | Swap archives atomically and signal the server |

## Performance and Scale

Tile serving is an unusually favourable workload: requests are read-only, responses are immutable for their lifetime, and the access distribution is extremely skewed — a small fraction of tiles serve the overwhelming majority of requests. That skew is what makes edge caching so effective and what makes origin capacity planning far less alarming than the tile count suggests.

Two consequences matter. **Cache hit ratio is the metric**, not origin throughput; a ratio in the high nineties is normal and achievable, and a drop in it is the earliest signal that something is wrong with cache keys or invalidation. And **the long tail is cheap to serve slowly**: tiles nobody looks at can be rendered on demand rather than pre-generated, which for deep zooms saves enormous amounts of generation time.

Compression matters too. Vector tiles compress well and clients accept gzipped payloads, so tiles should be stored compressed and served with the appropriate header rather than compressed per request.

## Failure Modes and Gotchas

- **Ancestors are not optional.** A dirty set without the ancestor chain leaves low zooms permanently behind.
- **Buffers make neighbours dirty.** A change just inside one tile alters the geometry retained by the tile next door.
- **Browser caches are unpurgeable.** Only a URL change reaches them, which is why versioned paths are worth the effort.
- **Immutable formats and frequent updates conflict.** Pick one; a minutely-updated single-file archive is a rewrite treadmill.
- **Open file handles hide updates.** A server holding an archive open keeps serving the old contents after the file is replaced.
- **Range requests need range support.** Serverless delivery depends on the storage and every cache in front of it honouring range requests correctly.
- **An empty tile is not a missing tile.** Returning a not-found status where a legitimately empty tile exists makes clients retry endlessly.

## Integration Points

Upstream, the dirty tile list comes from the replication stream — [Incremental Updates for Derived Datasets](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/) covers the general pattern and tiles are one instance of it. Downstream, the style document consumes the archive's metadata, so the layer names and zoom range recorded at build time are part of the serving contract.

The two guides develop each half: [Serving PMTiles from Object Storage](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/serving-and-invalidating-osm-tiles/serving-pmtiles-from-object-storage/) for delivery, and [Invalidating Tile Caches After an OSM Diff](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/serving-and-invalidating-osm-tiles/invalidating-tile-caches-after-an-osm-diff/) for keeping it current.

## Guides in This Topic

- [Serving PMTiles from Object Storage](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/serving-and-invalidating-osm-tiles/serving-pmtiles-from-object-storage/) — a tile set with no server at all, and what that requires of the storage layer.
- [Invalidating Tile Caches After an OSM Diff](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/serving-and-invalidating-osm-tiles/invalidating-tile-caches-after-an-osm-diff/) — turning a change file into a purge set that reaches every cache layer.

## Frequently Asked Questions

<details>
<summary>Why is my map correct when zoomed in and stale when zoomed out?</summary>

Because the invalidation computed the tiles a change touches at the deepest zoom and stopped there. A feature that changed at zoom 14 also appears, generalized, in the zoom 13 tile containing that one, and in its parent, and so on to zoom 0. The dirty set must include the whole ancestor chain of every touched tile — which is cheap, since each level contributes only a quarter as many tiles as the one below.
</details>

<details>
<summary>Do I need a tile server at all?</summary>

Not for a static base map. A single-file archive with an embedded index can be read directly by clients using HTTP range requests, so the whole serving stack becomes an object store and a content delivery network. A server earns its place when you need per-request behaviour — access control, filtering by user, dynamically composed layers — or when the tile set is updated incrementally and rewriting a large immutable file is impractical.
</details>

<details>
<summary>How do I invalidate a browser cache?</summary>

You cannot, which is why the answer has to be in the URL. Including a version token in the tile path — incremented whenever the tile set is rebuilt — makes every tile a new URL that no browser has cached, and lets you set a long cache lifetime on the old URLs without ever needing them to expire. Retrofitting this means updating every style document that references the tiles, so it is worth building in before the first reader arrives.
</details>

<details>
<summary>Should empty tiles be stored or omitted?</summary>

Omit them from storage and return a valid empty response for them, rather than a not-found status. Storing hundreds of millions of zero-length objects is a real cost in any storage system, and clients handle a missing tile as a transient failure to be retried rather than as an answer. An explicit empty tile — or a not-found the client is configured to treat as empty — avoids both problems.
</details>

<details>
<summary>What cache hit ratio should I expect?</summary>

High nineties for a map with ordinary usage, because tile requests are extremely skewed towards a small number of popular areas and zoom levels. That is also why the ratio is the metric to watch: a sudden drop usually means cache keys changed, a version token was introduced without the caches being warmed, or invalidation purged far more than it needed to.
</details>

## Related

- [OSM Vector Tiles & Rendering Pipelines](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/) — the parent section and the pyramid this serving layer delivers.
- [Incremental Updates for Derived Datasets](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/) — the general pattern tiles are one instance of.
- [Computing a Dirty Tile List from an .osc File](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/computing-a-dirty-tile-list-from-an-osc-file/) — producing the input to every invalidation here.
- [Generating MBTiles from OSM GeoJSON](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/building-tiles-with-tippecanoe/generating-mbtiles-from-osm-geojson/) — the archive and metadata this layer serves.
- [Building a Minutely Update Pipeline](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/) — the change stream that drives re-rendering.
- [Measuring OSM Replication Lag in Seconds](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-monitoring-and-lag-alerting/measuring-osm-replication-lag-in-seconds/) — how far behind the served map actually is.

Up one level: [OSM Vector Tiles & Rendering Pipelines](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Serving & Invalidating OSM Tiles",
  "description": "Packaging and delivering a tile set — MBTiles, PMTiles and loose directories — plus the cache layers between archive and client, and how to purge exactly what an OSM diff made wrong.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Vector Tiles & Rendering Pipelines",
  "about": ["tile serving", "cache invalidation", "PMTiles and MBTiles"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Vector Tiles & Rendering Pipelines", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/" },
    { "@type": "ListItem", "position": 3, "name": "Serving & Invalidating OSM Tiles", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/serving-and-invalidating-osm-tiles/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Serve an OSM tile set and keep it current",
  "description": "Choose a packaging format matched to how often tiles change, version tile URLs for browser caches, compute a dirty set including ancestors and neighbours, and purge every cache layer in the path.",
  "step": [
    { "@type": "HowToStep", "name": "Match format to update cadence", "text": "Choose an updateable archive for incremental re-rendering and an immutable single-file archive for a tile set rebuilt as a unit." },
    { "@type": "HowToStep", "name": "Version the tile URLs", "text": "Include a token in the tile path that changes when the tile set is rebuilt, since browser caches cannot be purged any other way." },
    { "@type": "HowToStep", "name": "Locate the changes", "text": "Map every created, modified and deleted element in the change file to tile coordinates at the deepest zoom." },
    { "@type": "HowToStep", "name": "Expand the dirty set", "text": "Add the full ancestor chain of each touched tile and its immediate neighbours at the deepest zoom." },
    { "@type": "HowToStep", "name": "Re-render and replace", "text": "Regenerate the dirty tiles and swap them into the archive atomically so no partially updated state is served." },
    { "@type": "HowToStep", "name": "Purge every cache layer", "text": "Trace the full request path and issue a purge at each layer that holds copies, preferring tag-based purges over URL enumeration." }
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
      "name": "Why is my map correct when zoomed in and stale when zoomed out?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because the invalidation computed the tiles a change touches at the deepest zoom and stopped there. A feature that changed at zoom 14 also appears, generalized, in the zoom 13 tile containing it, and so on to zoom 0. The dirty set must include the whole ancestor chain of every touched tile, which is cheap since each level contributes only a quarter as many tiles as the one below." }
    },
    {
      "@type": "Question",
      "name": "Do I need a tile server at all?",
      "acceptedAnswer": { "@type": "Answer", "text": "Not for a static base map. A single-file archive with an embedded index can be read directly by clients using HTTP range requests, so the serving stack becomes an object store and a content delivery network. A server earns its place when you need per-request behaviour such as access control, or when the tile set is updated incrementally." }
    },
    {
      "@type": "Question",
      "name": "How do I invalidate a browser cache for map tiles?",
      "acceptedAnswer": { "@type": "Answer", "text": "You cannot, which is why the answer has to be in the URL. Including a version token in the tile path — incremented whenever the tile set is rebuilt — makes every tile a new URL that no browser has cached. Retrofitting this means updating every style document that references the tiles, so it is worth building in early." }
    },
    {
      "@type": "Question",
      "name": "Should empty tiles be stored or omitted?",
      "acceptedAnswer": { "@type": "Answer", "text": "Omit them from storage and return a valid empty response, rather than a not-found status. Storing hundreds of millions of zero-length objects is a real cost, and clients handle a missing tile as a transient failure to be retried rather than as an answer." }
    },
    {
      "@type": "Question",
      "name": "What cache hit ratio should a tile service expect?",
      "acceptedAnswer": { "@type": "Answer", "text": "High nineties for a map with ordinary usage, because tile requests are extremely skewed towards a small number of popular areas and zoom levels. A sudden drop usually means cache keys changed, a version token was introduced without warming the caches, or invalidation purged far more than it needed to." }
    }
  ]
}
</script>
