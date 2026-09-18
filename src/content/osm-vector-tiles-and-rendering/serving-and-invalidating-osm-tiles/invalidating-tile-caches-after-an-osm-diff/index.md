---
title: "Invalidating Tile Caches After an OSM Diff"
description: "Turn a change file into a purge set: locate touched tiles, expand to neighbours and ancestors, re-render, then issue purges to every cache layer without enumerating millions of URLs."
pageTitle: "Purge Only the Tiles an OSM Diff Actually Changed"
pageDescription: "Build a dirty tile set from a change file, expand it for buffers and ancestor zooms, re-render and swap atomically, then purge edge and origin caches by tag rather than by URL."
slug: invalidating-tile-caches-after-an-osm-diff
type: article
breadcrumb: "Cache Invalidation"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Invalidating Tile Caches After an OSM Diff

Take the change file your replication pipeline just applied and end up with a map that is current everywhere — including in caches you do not control — without regenerating a continent.

## Prerequisites

- [ ] A dirty tile list produced from the change file, per [Computing a Dirty Tile List from an .osc File](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/computing-a-dirty-tile-list-from-an-osc-file/).
- [ ] An updateable tile archive, since this workflow re-renders individual tiles.
- [ ] Purge credentials for every cache layer in the request path — and a list of what those layers actually are.
- [ ] Python 3.10+ with `requests`.
- [ ] The cache-layer model from [Serving & Invalidating OSM Tiles](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/serving-and-invalidating-osm-tiles/).

## Conceptual minimum

Invalidation has two halves that are easy to conflate and must not be.

**Re-rendering** makes the archive correct. It takes the dirty set, generates those tiles from current data, and writes them back. Until it completes, the archive still holds old tiles, so purging before re-rendering simply refills every cache with stale content.

**Purging** makes the caches consistent with the archive. It must run *after* re-rendering, must reach every layer, and must be idempotent, because a purge that partially fails has to be safe to repeat.

The expansion rules that produce the dirty set are worth restating because they are where correctness lives. A change at the deepest zoom dirties the tile containing it, the eight tiles around it — because each retains buffer geometry from its neighbours — and the entire ancestor chain up to zoom 0. Ancestors matter because a low-zoom tile shows a generalized version of the same feature; skipping them leaves a map that is right zoomed in and wrong zoomed out.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="itc1-t itc1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="itc1-t">The order of operations after a change file is applied</title>
  <desc id="itc1-d">Four stages in strict order. The expand stage takes the raw touched tiles and adds neighbours at the deepest zoom and the full ancestor chain at every lower zoom. The render stage regenerates every tile in the expanded set from current data. The swap stage writes the new tiles into the archive atomically so no partially updated state is ever served. The purge stage issues invalidations to each cache layer, ordered from the layer nearest the origin outward, so a refill cannot repopulate an outer cache from a stale inner one.</desc>
  <defs><marker id="itc1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Render before purge, and purge inward to outward</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">expand</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">neighbours and ancestors</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">cheap over-approximation</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#itc1-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">render</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">from current data</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">archive becomes correct</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#itc1-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">swap</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">atomic write-back</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">never a partial state</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#itc1-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">purge</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">origin then edge</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">idempotent by design</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Purging before rendering refills every cache with the stale tiles it was supposed to remove, which is the classic ordering bug.</text>
</svg>
<figcaption>The ordering is the whole design: each stage is only safe once the one before it has finished.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
from collections.abc import Iterable, Iterator
from dataclasses import dataclass

import requests

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.tiles.invalidate")

MAXZOOM = 14
PURGE_BATCH = 500


@dataclass(frozen=True, order=True)
class Tile:
    z: int
    x: int
    y: int

    def parent(self) -> "Tile | None":
        return None if self.z == 0 else Tile(self.z - 1, self.x // 2, self.y // 2)

    def neighbours(self) -> Iterator["Tile"]:
        span = 1 << self.z
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                nx, ny = self.x + dx, self.y + dy
                if 0 <= nx < span and 0 <= ny < span:
                    yield Tile(self.z, nx, ny)

    def url(self, base: str, version: str) -> str:
        return f"{base}/{version}/{self.z}/{self.x}/{self.y}.mvt"

    def tag(self) -> str:
        """A coarse purge tag: every tile shares one with its zoom-6 ancestor."""
        shift = max(0, self.z - 6)
        return f"z6-{self.x >> shift}-{self.y >> shift}"


def expand(touched: Iterable[Tile]) -> set[Tile]:
    """Add buffer neighbours at the deepest zoom, then every ancestor."""
    dirty: set[Tile] = set()
    for tile in touched:
        if tile.z != MAXZOOM:
            raise ValueError("expand expects tiles at the deepest zoom")
        dirty.add(tile)
        dirty.update(tile.neighbours())

    # Walk up level by level; each level is a quarter the size of the one below.
    level = {t for t in dirty}
    while level:
        parents = {p for t in level if (p := t.parent()) is not None}
        dirty |= parents
        level = parents
    logger.info("expanded %d touched tile(s) to %d dirty tile(s)",
                len(set(touched)), len(dirty))
    return dirty


def render_and_swap(dirty: set[Tile], render, archive) -> None:
    """Regenerate every dirty tile, then write them back in one transaction."""
    rendered: list[tuple[Tile, bytes]] = []
    for tile in sorted(dirty):
        rendered.append((tile, render(tile)))
    archive.write_batch(rendered)          # atomic: all tiles land or none do
    logger.info("re-rendered and swapped %d tile(s)", len(rendered))


def purge(dirty: set[Tile], base: str, version: str,
          origin_purge_url: str, edge_purge_url: str, token: str) -> None:
    """Purge inner caches first so an outer refill cannot pull a stale copy."""
    headers = {"Authorization": f"Bearer {token}"}

    urls = [t.url(base, version) for t in sorted(dirty)]
    for i in range(0, len(urls), PURGE_BATCH):
        batch = urls[i:i + PURGE_BATCH]
        response = requests.post(origin_purge_url, json={"urls": batch},
                                 headers=headers, timeout=60)
        response.raise_for_status()
    logger.info("purged %d URL(s) from the origin cache", len(urls))

    # Tag-based purge at the edge: far fewer requests than enumerating URLs.
    tags = sorted({t.tag() for t in dirty})
    for i in range(0, len(tags), PURGE_BATCH):
        batch = tags[i:i + PURGE_BATCH]
        response = requests.post(edge_purge_url, json={"tags": batch},
                                 headers=headers, timeout=60)
        response.raise_for_status()
    logger.info("purged %d tag(s) from the edge network", len(tags))


def invalidate(touched: Iterable[Tile], render, archive, **purge_args) -> None:
    dirty = expand(touched)
    render_and_swap(dirty, render, archive)   # archive correct BEFORE purging
    purge(dirty, **purge_args)


if __name__ == "__main__":
    logger.info("feed `touched` from the dirty-tile computation over the .osc")
```

## Step-by-step walkthrough

1. **Insist the input is at the deepest zoom.** The expansion assumes it, and a mixed-zoom input silently produces an incomplete dirty set. Failing loudly is better than a map that is quietly wrong at some levels.
2. **Add neighbours before ancestors.** A neighbour's own ancestors must be dirty too, so expanding in the other order misses them.
3. **Walk ancestors level by level.** Each level is a quarter the size of the one below, so the whole chain adds roughly a third to the set — cheap, and the alternative is a permanently stale low-zoom map.
4. **Render everything before writing anything.** Collecting the rendered tiles first and writing them in one batch means the archive never holds a mixture of old and new tiles from the same change.
5. **Purge after the swap.** Purging first evicts correct-but-old tiles and immediately refills every cache with them again from an archive that has not been updated yet.
6. **Purge inward to outward.** The origin cache is purged before the edge, so an edge refill triggered by a reader pulls from an already-correct origin.
7. **Use tags at the edge.** A coarse tag shared by every tile under one zoom-6 ancestor turns hundreds of thousands of URL purges into a few hundred tag purges, which stays well inside rate limits.
8. **Keep purges idempotent.** Batches can be retried safely, which matters because a partial failure is the normal case at this volume.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 248" role="img" aria-labelledby="itc2-t itc2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="itc2-t">Purge request counts for one change file, by purge strategy</title>
  <desc id="itc2-d">Four strategies compared on the number of purge API requests needed for a single minutely change file. Purging each URL individually needs one request per tile, in the thousands. Batching URLs five hundred at a time reduces it to a handful of requests. Purging by coarse tag reduces it further, because many tiles share one tag. Purging the entire cache is a single request but evicts everything, destroying a hit ratio that took hours to build.</desc>
  <rect x="0" y="0" width="880" height="248" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four strategies, and the cheapest one is the worst</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">One request per URL</text>
  <rect x="246" y="60" width="488" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 1,520</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">Batched URLs</text>
  <rect x="246" y="100" width="6" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 4</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">By coarse tag</text>
  <rect x="246" y="140" width="6" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 2</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">Purge everything</text>
  <rect x="246" y="180" width="6" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">1, and ruinous</text>
  <text x="868" y="232" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The last strategy evicts a cache that took hours to warm, so the next hour of traffic lands on the origin instead of the edge.</text>
</svg>
<figcaption>Tag purges win because many tiles under one coarse ancestor change together, which is exactly how edits cluster.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 239" role="img" aria-labelledby="itc3-t itc3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="itc3-t">Three invalidation mistakes and the symptom each produces for a reader</title>
  <desc id="itc3-d">Three panels. Skipping ancestor expansion leaves low zoom tiles permanently behind, so the map is correct when zoomed in and progressively more stale as the reader zooms out. Purging before rendering evicts correct-but-old tiles and immediately refills every cache from an archive that has not been updated, leaving the caches unchanged and the hit ratio damaged. Purging the entire cache makes the map correct at once but evicts hours of warmed entries, sending the next hour of traffic to the origin.</desc>
  <rect x="0" y="0" width="880" height="239" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three mistakes, three very different symptoms</text>
  <rect x="26" y="52" width="259" height="153" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">No ancestors</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Symptom: stale at low zoom</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Correct when zoomed in</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Worsens as you zoom out</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Hard to attribute to a cause</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Fix: walk the whole chain</text>
  <rect x="311" y="52" width="259" height="153" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Purge before render</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Symptom: nothing changes</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Caches refill from the archive</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Archive not updated yet</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Hit ratio damaged for nothing</text>
  <text x="325" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Fix: render, swap, then purge</text>
  <rect x="595" y="52" width="259" height="153" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Purge everything</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Symptom: map is correct</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">But origin load spikes</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Hours of warming lost</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Latency rises for everyone</text>
  <text x="609" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Fix: purge only the dirty set</text>
  <text x="868" y="223" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Only the second mistake leaves the map wrong; the other two are correct maps bought at a cost somebody else pays.</text>
</svg>
<figcaption>That is why invalidation bugs survive review: two of the three produce a map that looks entirely fine.</figcaption>
</figure>

## Verification

- **A changed feature is visible at every zoom.** Check the edited area at the deepest zoom and at zoom 8; both must reflect the change.
- **The dirty count is proportional to the change.** A minutely diff producing a dirty set in the millions means the expansion is wrong, not that the diff was large.
- **No partial state is ever served.** Request tiles continuously during a swap; every response must be either wholly old or wholly new.
- **Purges are idempotent.** Re-run the same purge batch; it must succeed and change nothing.
- **Cache hit ratio recovers quickly.** A dip after invalidation is expected; a sustained drop means the purge is far broader than the change.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Low zooms permanently stale | Ancestors not included | Walk the full ancestor chain of every touched tile |
| Seams beside edited features | Neighbours not included | Add the eight neighbours at the deepest zoom |
| Stale tiles immediately after a purge | Purge ran before re-rendering | Render and swap first, purge second |
| Edge serves old tiles after an origin purge | Purge order reversed | Purge the origin before the edge |
| Purge API rate limited | One request per tile URL | Batch URLs, and prefer coarse tags at the edge |
| Hit ratio collapses after every update | Whole-cache purge used | Purge only the dirty set |
| Readers still see old tiles | Browser cache with a long lifetime | Put a version token in the tile URL |

## Specification reference

> A tile at zoom level \\(z\\) with coordinates \\((x, y)\\) has as its parent the tile at zoom \\(z-1\\) with coordinates \\((\lfloor x/2 \rfloor, \lfloor y/2 \rfloor)\\), and the ancestor chain continues to zoom 0. Because generalized representations of a feature appear in every ancestor tile, a change affecting one tile affects its whole chain. See the [Slippy map tilenames documentation](https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames) for the addressing scheme and the coordinate arithmetic.

## Frequently Asked Questions

<details>
<summary>Why must re-rendering happen before purging?</summary>

Because a purge evicts a cached tile and the next reader request refills it from the archive. If the archive has not been updated yet, the refill pulls exactly the stale tile the purge was meant to remove, and the caches end up in the same state they started in — except that the hit ratio has been damaged for nothing. Rendering first, then purging, is the only ordering that converges.
</details>

<details>
<summary>How far up do I need to invalidate?</summary>

All the way to zoom 0. It sounds expensive and is not: each level contributes a quarter as many tiles as the one below, so the entire ancestor chain adds roughly a third to the dirty set. Stopping partway produces a map that is correct when zoomed in and progressively more stale as the reader zooms out, which is both confusing and hard to attribute to a cause.
</details>

<details>
<summary>Should I purge by URL or by tag?</summary>

By tag at the edge, where the volume is high and rate limits bite, and by URL at the origin, where the layer is closer and the set is smaller. A coarse tag shared by every tile under a common low-zoom ancestor collapses hundreds of thousands of URLs into a handful of tags. The cost is precision — a tag purge evicts some tiles that did not change — which is a good trade because edits cluster geographically anyway.
</details>

<details>
<summary>Is purging the whole cache ever acceptable?</summary>

Only after a change that genuinely affects every tile, such as a schema or style change that regenerated the whole set. For an ordinary data update it destroys a hit ratio that took hours of traffic to build, and the following hour of requests lands on the origin instead of the edge. The cost of that is usually far larger than the cost of computing a precise dirty set.
</details>

## Related

- [Serving & Invalidating OSM Tiles](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/serving-and-invalidating-osm-tiles/) — the parent topic and the cache-layer model.
- [Computing a Dirty Tile List from an .osc File](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/computing-a-dirty-tile-list-from-an-osc-file/) — producing the input this workflow expands.
- [Serving PMTiles from Object Storage](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/serving-and-invalidating-osm-tiles/serving-pmtiles-from-object-storage/) — the alternative when the archive is rebuilt whole.
- [Applying Minutely Diffs to a PostGIS Database](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/applying-minutely-diffs-to-a-postgis-database/) — the upstream step that produced the change.
- [Incremental Updates for Derived Datasets](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/) — the same pattern for other derived outputs.

Up one level: [Serving & Invalidating OSM Tiles](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/serving-and-invalidating-osm-tiles/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Invalidating Tile Caches After an OSM Diff",
  "description": "Turn a change file into a purge set: locate touched tiles, expand to neighbours and ancestors, re-render, then issue purges to every cache layer without enumerating millions of URLs.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Vector Tiles & Rendering Pipelines",
  "about": ["cache invalidation", "dirty tile expansion", "purge strategies"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Vector Tiles & Rendering Pipelines", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/" },
    { "@type": "ListItem", "position": 3, "name": "Serving & Invalidating OSM Tiles", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/serving-and-invalidating-osm-tiles/" },
    { "@type": "ListItem", "position": 4, "name": "Invalidating Tile Caches After an OSM Diff", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/serving-and-invalidating-osm-tiles/invalidating-tile-caches-after-an-osm-diff/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Invalidate tile caches after applying an OSM change file",
  "description": "Expand the touched tiles with neighbours and ancestors, re-render the whole dirty set, swap it into the archive atomically, then purge the origin cache before the edge using batched and tag-based requests.",
  "step": [
    { "@type": "HowToStep", "name": "Require deepest-zoom input", "text": "Reject a mixed-zoom touched set, because the expansion assumes every input tile is at the deepest zoom." },
    { "@type": "HowToStep", "name": "Add buffer neighbours", "text": "Include the eight surrounding tiles at the deepest zoom, since each retains geometry from across its edges." },
    { "@type": "HowToStep", "name": "Walk the ancestor chain", "text": "Add every ancestor up to zoom zero, which adds roughly a third to the set and keeps low zooms current." },
    { "@type": "HowToStep", "name": "Render before writing", "text": "Generate every dirty tile first and write them back as one batch so the archive never holds a mixture." },
    { "@type": "HowToStep", "name": "Purge after the swap", "text": "Issue purges only once the archive is correct, otherwise a refill restores the stale tiles." },
    { "@type": "HowToStep", "name": "Purge inward to outward", "text": "Purge the origin cache before the edge so an edge refill pulls from an already-correct origin." },
    { "@type": "HowToStep", "name": "Batch and tag", "text": "Batch URL purges at the origin and use coarse tags at the edge to stay within rate limits." }
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
      "name": "Why must tile re-rendering happen before purging?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because a purge evicts a cached tile and the next reader request refills it from the archive. If the archive has not been updated yet, the refill pulls exactly the stale tile the purge was meant to remove, and the caches end up as they started except that the hit ratio has been damaged for nothing." }
    },
    {
      "@type": "Question",
      "name": "How far up the zoom levels do I need to invalidate?",
      "acceptedAnswer": { "@type": "Answer", "text": "All the way to zoom 0. Each level contributes a quarter as many tiles as the one below, so the entire ancestor chain adds roughly a third to the dirty set. Stopping partway produces a map that is correct when zoomed in and progressively more stale as the reader zooms out." }
    },
    {
      "@type": "Question",
      "name": "Should I purge tiles by URL or by tag?",
      "acceptedAnswer": { "@type": "Answer", "text": "By tag at the edge, where the volume is high and rate limits bite, and by URL at the origin, where the set is smaller. A coarse tag shared by every tile under a common low-zoom ancestor collapses hundreds of thousands of URLs into a handful of tags. The cost is precision, which is a good trade because edits cluster geographically." }
    },
    {
      "@type": "Question",
      "name": "Is purging the whole tile cache ever acceptable?",
      "acceptedAnswer": { "@type": "Answer", "text": "Only after a change that genuinely affects every tile, such as a schema or style change that regenerated the whole set. For an ordinary data update it destroys a hit ratio that took hours of traffic to build, and the following hour of requests lands on the origin instead of the edge." }
    }
  ]
}
</script>
