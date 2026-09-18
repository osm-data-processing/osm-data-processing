---
title: "Computing a Dirty Tile List from an .osc File"
description: "Turn a change file into the set of tile coordinates that need re-cutting, covering the old geometry as well as the new one, and keep the list small enough to be worth having."
pageTitle: "Deriving Dirty Tiles from an OSM Change File"
pageDescription: "Expand changed OSM features to the tiles they appear in at every rendered zoom, include the pre-edit geometry so moves invalidate where the feature was, and collapse the result before queueing."
slug: computing-a-dirty-tile-list-from-an-osc-file
type: article
breadcrumb: "Dirty Tile Lists"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Computing a Dirty Tile List from an .osc File

Re-cutting every tile after a minutely diff is impossible and re-cutting only the tiles containing the new geometry is wrong, because a feature that moved is still drawn where it used to be.

## Prerequisites

- [ ] Python 3.10+ with `shapely` 2.x for geometry, and `mercantile` or equivalent for tile maths.
- [ ] A tile pyramid with a known zoom range, per [OSM Vector Tiles & Rendering Pipelines](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/).
- [ ] Access to the pre-diff geometry of every changed feature, which is the hard prerequisite.
- [ ] The ordering discipline from [Incremental Updates for Derived Datasets](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/).
- [ ] A queue or dirty-list store the re-cutting worker drains.

## Conceptual minimum

A dirty tile list is the set of tile coordinates whose rendered content would differ if re-cut now. Deriving it involves three expansions, each of which is a common place to stop too early.

**Expand over both geometries.** The union of the pre-edit and post-edit geometry is what changed visually. A building demolished in place has no post-edit geometry at all, and a shop that moved two streets away dirties both streets. Using only the new geometry is the single most common cause of a tile cache that slowly accumulates ghosts.

**Expand over zooms.** A feature rendered from zoom 6 to zoom 14 dirties tiles at every one of those zooms. That is not eight tiles; a way spanning several zoom-14 tiles occupies fewer tiles as zoom decreases, so the count is dominated by the highest zoom, and the total for a long motorway can be in the thousands.

**Expand by buffer.** Tile cutting usually includes a buffer beyond the tile edge so that labels and lines crossing the boundary render correctly. A feature just outside a tile can therefore affect it, so the invalidation must grow the geometry by the same buffer the cutter uses, expressed in the tile's own units.

The counterweight to all this expansion is **collapse**. A list of a million dirty zoom-14 tiles in one metropolitan area is better expressed as the handful of zoom-10 tiles containing them, and re-cutting at the parent level costs less than servicing each child. A threshold on children per parent gives that collapse cheaply.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="dtl1-t dtl1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="dtl1-t">The three expansions, and what stopping early costs</title>
  <desc id="dtl1-d">Three panels. Expanding over both the old and new geometry catches features that moved or were deleted, and stopping at the new geometry alone leaves the old rendering in place indefinitely, which is the ghost-building failure. Expanding over every rendered zoom catches the whole column of tiles a feature appears in, and stopping at the maximum zoom leaves lower zooms showing the previous state. Expanding by the cutter's buffer catches tiles a feature affects without entering, and stopping at strict containment leaves clipped labels and broken lines at tile edges.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three expansions, three failures</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Old and new</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Catches moves and deletes</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Stop early: ghosts remain</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Deleted features persist</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">The commonest bug</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Every zoom</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">A column, not one tile</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Stop early: low zooms stale</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Overviews lag for weeks</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Rarely noticed quickly</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Plus buffer</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Neighbours are affected</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Stop early: edge artefacts</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Labels clipped at seams</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Lines break across tiles</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Each failure is visually subtle and geographically local, so it is reported by users long before it is caught by monitoring.</text>
</svg>
<figcaption>All three expansions grow the list; the collapse step is what keeps it usable.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
from collections import Counter
from collections.abc import Iterable, Iterator
from dataclasses import dataclass

from shapely.geometry import base as shapely_base

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.tiles.dirty")

MIN_ZOOM, MAX_ZOOM = 6, 14
BUFFER_PX = 64          # must match the cutter's buffer, not merely resemble it
TILE_PX = 4096
COLLAPSE_AT = 12        # children dirty under one parent -> dirty the parent


@dataclass(frozen=True)
class Tile:
    z: int
    x: int
    y: int


@dataclass(frozen=True)
class ChangedFeature:
    osm_type: str
    osm_id: int
    old_geom: shapely_base.BaseGeometry | None   # None only for a create
    new_geom: shapely_base.BaseGeometry | None   # None only for a delete
    min_zoom: int = MIN_ZOOM                      # from the layer's schema


def _lonlat_to_tile(lon: float, lat: float, z: int) -> tuple[int, int]:
    import math
    n = 2 ** z
    x = int((lon + 180.0) / 360.0 * n)
    lat_r = math.radians(max(-85.05112878, min(85.05112878, lat)))
    y = int((1.0 - math.asinh(math.tan(lat_r)) / math.pi) / 2.0 * n)
    return max(0, min(n - 1, x)), max(0, min(n - 1, y))


def tiles_for_bounds(bounds: tuple[float, float, float, float],
                     z: int) -> Iterator[Tile]:
    west, south, east, north = bounds
    x0, y0 = _lonlat_to_tile(west, north, z)
    x1, y1 = _lonlat_to_tile(east, south, z)
    for x in range(min(x0, x1), max(x0, x1) + 1):
        for y in range(min(y0, y1), max(y0, y1) + 1):
            yield Tile(z, x, y)


def buffered_bounds(geom: shapely_base.BaseGeometry, z: int
                    ) -> tuple[float, float, float, float]:
    """Grow by the cutter's buffer, expressed in degrees at this zoom.

    A feature outside a tile still affects it when the cutter reads a margin
    beyond the tile edge, which every renderer does for labels and joins.
    """
    degrees_per_tile = 360.0 / (2 ** z)
    pad = degrees_per_tile * BUFFER_PX / TILE_PX
    west, south, east, north = geom.bounds
    return (west - pad, south - pad, east + pad, north + pad)


def dirty_tiles(features: Iterable[ChangedFeature]) -> set[Tile]:
    dirty: set[Tile] = set()
    for feature in features:
        # BOTH geometries. Where it was and where it is are both now wrong.
        for geom in (feature.old_geom, feature.new_geom):
            if geom is None or geom.is_empty:
                continue
            for z in range(feature.min_zoom, MAX_ZOOM + 1):
                dirty.update(tiles_for_bounds(buffered_bounds(geom, z), z))
    logger.info("expanded to %d dirty tile(s)", len(dirty))
    return dirty


def collapse(dirty: set[Tile], threshold: int = COLLAPSE_AT) -> set[Tile]:
    """Replace many dirty children with their parent.

    Re-cutting one parent costs less than servicing a dozen children, and a
    metropolitan edit session otherwise produces a list nobody can drain.
    """
    result = set(dirty)
    for z in range(MAX_ZOOM, MIN_ZOOM, -1):
        level = [t for t in result if t.z == z]
        parents = Counter(Tile(z - 1, t.x // 2, t.y // 2) for t in level)
        for parent, count in parents.items():
            if count < threshold:
                continue
            result -= {t for t in level
                       if t.x // 2 == parent.x and t.y // 2 == parent.y}
            result.add(parent)
    logger.info("collapsed to %d tile(s)", len(result))
    return result


def queue(dirty: Iterable[Tile], store, sequence: int) -> int:
    """Record, do not re-cut. Popularity decides what is worth the work."""
    count = 0
    for tile in sorted(dirty, key=lambda t: (t.z, t.x, t.y)):
        store.mark_dirty(tile.z, tile.x, tile.y, sequence)
        count += 1
    logger.info("queued %d dirty tile(s) at sequence %d", count, sequence)
    return count


if __name__ == "__main__":
    logger.info("expand over both geometries, all zooms, plus buffer; collapse")
```

## Step-by-step walkthrough

1. **Capture the old geometry before applying.** Once the diff lands, a deleted feature's geometry is gone and its tiles can never be identified. This is an ordering requirement on the whole loop, not a detail of this function.
2. **Iterate both geometries.** A create has no old geometry and a delete has no new one; a modification usually has both and they may be far apart.
3. **Respect the layer's minimum zoom.** A footpath rendered only from zoom 15 should not dirty zoom 6, and the schema already states this.
4. **Match the cutter's buffer exactly.** Approximating it produces edge artefacts that appear only at tile seams and are miserable to diagnose.
5. **Use bounds rather than exact coverage, at first.** Bounds over-invalidate for diagonal linework, and the extra tiles cost less than the exact computation for all but the largest features.
6. **Collapse upward from the deepest zoom.** Working downward lets a collapse at one level feed the next, which is what turns a metropolitan edit session into a tractable list.
7. **Queue rather than re-cut.** Marking a tile dirty and letting requests or a background drainer service it means unvisited tiles cost nothing, which across a pyramid is most of them.
8. **Record the sequence with each mark.** A tile dirtied at sequence N and re-cut afterwards is clean; without the sequence you cannot tell re-cut from never-dirty.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 288" role="img" aria-labelledby="dtl2-t dtl2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="dtl2-t">Tile count by zoom for one motorway edit, before collapse</title>
  <desc id="dtl2-d">A bar chart of how many tiles a single edited motorway segment dirties at each rendered zoom. At zoom six the feature falls within about two tiles. At zoom eight it spans roughly six. At zoom ten around twenty. At zoom twelve around eighty. At zoom fourteen around three hundred and twenty. The count roughly quadruples with each zoom level, so the deepest zoom dominates the total and is where an upward collapse repays most.</desc>
  <rect x="0" y="0" width="880" height="288" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Tiles dirtied per zoom, one motorway edit</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">Zoom 6 (overview)</text>
  <rect x="226" y="60" width="6" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">2 tiles</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">Zoom 8 (regional)</text>
  <rect x="226" y="100" width="10" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">6 tiles</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">Zoom 10 (metro)</text>
  <rect x="226" y="140" width="32" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">20 tiles</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">Zoom 12 (district)</text>
  <rect x="226" y="180" width="127" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">80 tiles</text>
  <text x="26" y="234" font-size="11.5" font-weight="600" fill="currentColor">Zoom 14 (street)</text>
  <rect x="226" y="220" width="508" height="18" rx="4" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="854" y="234" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">320 tiles</text>
  <text x="868" y="272" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Roughly ninety percent of the list lives at the deepest two zooms, which is exactly where a parent collapse removes the most work.</text>
</svg>
<figcaption>One edit, four hundred and twenty-eight tiles, before any buffer expansion is applied.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="dtl3-t dtl3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="dtl3-t">From change file to a queued dirty list</title>
  <desc id="dtl3-d">Four steps. The change file is filtered against the tile schema so edits touching keys no layer reads are discarded before any geometric work. Each surviving feature is expanded over the union of its old and new geometry, across every zoom the layer renders at, padded by the cutter buffer. The expanded set is collapsed upward, replacing a parent tile coordinate whenever enough of its children are dirty, which is what keeps a dense urban editing session tractable. The collapsed set is queued with the upstream sequence recorded against each mark, and a drainer or an incoming request services it later.</desc>
  <defs><marker id="dtl3-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Filter, expand, collapse, queue</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">filter</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">schema keys only</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">most edits discarded</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#dtl3-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">expand</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">both geoms, all zooms</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">plus cutter buffer</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#dtl3-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">collapse</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">children to parents</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">deepest zoom first</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#dtl3-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">queue</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">sequence per mark</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">serviced on demand</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Expansion and collapse pull in opposite directions on purpose: correctness first, then a list somebody can actually drain.</text>
</svg>
<figcaption>Skipping the first step makes the second one do geometric work for edits that change no pixel.</figcaption>
</figure>

## Verification

- **A move dirties both locations.** Relocate a test feature and confirm tiles at the old position appear in the list.
- **A delete dirties anything at all.** A pipeline deriving after the apply produces an empty list here, which is the diagnostic.
- **Zoom coverage matches the schema.** Confirm no tiles below the layer's minimum zoom are marked.
- **Collapse reduces the count.** Feed a dense urban diff and confirm the collapsed list is materially smaller.
- **Re-cut tiles come back clean.** Render a dirtied tile and confirm the output differs from the cached version.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Demolished buildings still rendered | Only new geometry expanded | Union the old and new geometry |
| Deletes dirty nothing | Derivation runs after the apply | Capture old geometry before applying |
| Low-zoom tiles show old data | Expansion limited to maximum zoom | Iterate the full rendered zoom range |
| Broken lines at tile seams | Buffer not matched to the cutter | Expand bounds by the cutter's exact buffer |
| Dirty list grows faster than it drains | No upward collapse | Collapse children to parents past a threshold |
| Footpaths dirty continental tiles | Layer minimum zoom ignored | Start expansion at the layer's own minimum zoom |
| Cannot tell re-cut from never-dirty | No sequence recorded per mark | Store the sequence alongside each dirty mark |

## Specification reference

> In the Web Mercator tiling scheme, zoom level z divides the world into 2^z by 2^z tiles, with tile x increasing eastward from the antimeridian and tile y increasing southward from approximately 85.0511 degrees north. Vector tile cutters typically extend geometry beyond the tile envelope by a buffer, expressed in tile-local units, so that features crossing the boundary render without visible seams. See the Mapbox Vector Tile specification and the Slippy Map tilenames convention.

## Frequently Asked Questions

<details>
<summary>Should the dirty list use exact geometry coverage rather than bounds?</summary>

Only where bounds are badly wasteful, which in practice means very long diagonal features. A coastline or a trunk road's bounding box covers a great deal of sea or countryside it never enters, and at deep zooms that is thousands of tiles invalidated for nothing. For everything else the exact computation costs more than the tiles it saves. A reasonable rule is to use bounds by default and exact coverage above a bounding-box area threshold.
</details>

<details>
<summary>How is a dirty tile actually re-cut?</summary>

Either on request, when a viewer asks for a tile marked dirty and the server re-cuts before responding, or by a background worker draining the list in priority order. The first gives correctness with a latency spike on the first request; the second gives consistent latency at the cost of rendering tiles nobody wants. Most production setups do both, with the background drainer working through recently requested tiles first.
</details>

<details>
<summary>What about tiles that no longer contain anything?</summary>

They still need re-cutting, and they are the case people forget. A tile whose only feature was deleted must be regenerated as empty, because the cached version still shows the feature. An empty tile is cheap to store and cheap to serve, but it has to exist — serving a 404 for a tile that was previously populated makes clients fall back to the last successful response in some implementations.
</details>

<details>
<summary>Does a tag-only edit dirty tiles?</summary>

If the tag participates in the tile schema, yes, and with the same geometric extent as a geometry edit. If it does not, the edit should be filtered out before any expansion, which is usually the largest available saving because most tag edits touch keys no renderer reads. That filter needs the schema's key list, which is one more reason for the schema to be data rather than code.
</details>

## Related

- [Incremental Updates for Derived Datasets](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/) — the parent topic.
- [OSM Vector Tiles & Rendering Pipelines](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/) — the pyramid this list invalidates.
- [Serving Vector Tiles from PMTiles](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/serving-vector-tiles-with-pmtiles/) — where a dirty archive has to be republished rather than patched.
- [Propagating OSM Diffs Into a GeoParquet Lake](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/propagating-osm-diffs-into-a-geoparquet-lake/) — the same derivation for immutable files.
- [Applying .osc Change Files with Osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/) — the apply step this must precede.

Up one level: [Incremental Updates for Derived Datasets](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Computing a Dirty Tile List from an .osc File",
  "description": "Turn a change file into the set of tile coordinates that need re-cutting, covering the old geometry as well as the new one, and keep the list small enough to be worth having.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Replication & Diff Sync",
  "about": ["dirty tiles", "tile invalidation", "vector tile pyramid"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Replication & Diff Sync", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/" },
    { "@type": "ListItem", "position": 3, "name": "Incremental Updates for Derived Datasets", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/" },
    { "@type": "ListItem", "position": 4, "name": "Computing a Dirty Tile List from an .osc File", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/computing-a-dirty-tile-list-from-an-osc-file/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Derive a dirty tile list from an OSM change file",
  "description": "Expand each changed feature over its old and new geometry, across every rendered zoom, padded by the cutter's buffer, then collapse dense children into parents and queue the result.",
  "step": [
    { "@type": "HowToStep", "name": "Capture pre-diff geometry", "text": "Read each changed feature's previous geometry before the diff is applied, since a delete destroys it." },
    { "@type": "HowToStep", "name": "Expand over both geometries", "text": "Union the tiles covering the old and new geometry, so a moved feature invalidates where it was." },
    { "@type": "HowToStep", "name": "Iterate the rendered zooms", "text": "Expand from the layer's minimum zoom to the maximum, since a feature appears in a column of tiles." },
    { "@type": "HowToStep", "name": "Pad by the cutter's buffer", "text": "Grow the bounds by the same margin the tile cutter reads, expressed in degrees at each zoom." },
    { "@type": "HowToStep", "name": "Collapse dense children", "text": "Replace a parent's children with the parent once enough of them are dirty, working from the deepest zoom up." },
    { "@type": "HowToStep", "name": "Queue rather than re-cut", "text": "Mark tiles dirty and let requests or a background drainer service them, so unvisited tiles cost nothing." },
    { "@type": "HowToStep", "name": "Record the sequence per mark", "text": "Store the upstream sequence with each dirty mark so re-cut can be distinguished from never-dirty." }
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
      "name": "Should a dirty tile list use exact geometry coverage rather than bounds?",
      "acceptedAnswer": { "@type": "Answer", "text": "Only where bounds are badly wasteful, which means very long diagonal features. A coastline's bounding box covers a great deal of sea it never enters, invalidating thousands of deep-zoom tiles for nothing. For everything else the exact computation costs more than the tiles it saves, so use bounds above a size threshold only." }
    },
    {
      "@type": "Question",
      "name": "How is a dirty tile actually re-cut?",
      "acceptedAnswer": { "@type": "Answer", "text": "Either on request, when a viewer asks for a tile marked dirty and the server re-cuts before responding, or by a background worker draining the list in priority order. Most production setups do both, with the drainer working through recently requested tiles first." }
    },
    {
      "@type": "Question",
      "name": "What about tiles that no longer contain any features?",
      "acceptedAnswer": { "@type": "Answer", "text": "They still need re-cutting, and they are the case people forget. A tile whose only feature was deleted must be regenerated as empty, because the cached version still shows it. Serving a 404 instead makes some clients fall back to the last successful response." }
    },
    {
      "@type": "Question",
      "name": "Does a tag-only OSM edit dirty tiles?",
      "acceptedAnswer": { "@type": "Answer", "text": "If the tag participates in the tile schema, yes, with the same geometric extent as a geometry edit. If it does not, filter the edit out before expansion — usually the largest available saving, since most tag edits touch keys no renderer reads." }
    }
  ]
}
</script>
