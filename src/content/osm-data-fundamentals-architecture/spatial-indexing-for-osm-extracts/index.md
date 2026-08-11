---
pageDescription: "Build production spatial indexes over OSM extracts: choosing between R-tree, Quadkey grids, and H3, a streaming pyosmium + rtree builder, an error matrix, and benchmark-driven scale guidance for bounding-box queries and topology joins."
---
# Spatial Indexing for OSM Extracts

OpenStreetMap extracts are large, densely interconnected geospatial datasets, and the pipeline challenge this guide solves is blunt: without a spatial index, every bounding-box query, point-in-polygon test, and topology join degenerates into a full linear scan of millions of primitives. A single `highway=*` clip against an unindexed European extract can mean reading and testing hundreds of millions of geometries per request, turning a sub-second lookup into minutes of wasted I/O — and the cost compounds on every query thereafter. The failure is silent until scale arrives: a prototype that runs fine on a city extract grinds to a halt on a continent, because the work grew linearly while the data grew super-linearly. The defence is to build a deterministic spatial index once, so spatial predicates resolve in logarithmic time and downstream analytics, quality checks, and exports read only the candidates that can possibly match. This guide sits within the broader [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/) layer, which frames why fast spatial access underpins every serious OSM workflow.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1040 360" style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit" role="img" aria-label="Comparison of the three spatial-index families used for OSM extracts. The R-tree is a bounding-box hierarchy of minimum bounding rectangles that adapts to irregular extents and is best for exact spatial joins and varying-density queries. The quadkey / grid family divides the extent into fixed-resolution cells on power-of-two splits and is best for tiling and point-in-polygon pre-filtering. The H3 / S2 family uses uniform hexagonal or spherical cells with deterministic neighbours and is best for global aggregation and completeness sampling.">
  <title>R-tree, quadkey grid, and H3 / S2 spatial index families compared</title>
  <desc>Three side-by-side panels. The R-tree panel shows nested minimum bounding rectangles, a bounding-box hierarchy that adapts to irregular extents, best for exact spatial joins and varying-density queries. The quadkey / grid panel shows a square subdivided into fixed-resolution cells on power-of-two splits, best for tiling and point-in-polygon pre-filtering. The H3 / S2 panel shows tessellating hexagons, uniform hex or spherical cells with deterministic neighbours, best for global aggregation and completeness sampling.</desc>
  <rect x="0" y="0" width="1040" height="360" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="520" y="26" text-anchor="middle" font-size="15" fill="currentColor" font-weight="700">Three index families, matched to the query — not competing</text>
  <!-- Card 1: R-tree -->
  <rect x="20" y="48" width="320" height="292" rx="8" fill="none" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <rect x="20" y="48" width="320" height="34" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="180" y="71" text-anchor="middle" font-size="14" fill="currentColor" font-weight="700">R-tree</text>
  <!-- nested MBR glyph -->
  <rect x="120" y="100" width="120" height="64" rx="2" fill="none" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <rect x="130" y="110" width="46" height="24" rx="2" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <rect x="186" y="128" width="44" height="26" rx="2" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <rect x="134" y="114" width="16" height="14" rx="1" fill="none" stroke="var(--osm-accent,#0369a1)" stroke-width="1"/>
  <rect x="154" y="114" width="16" height="14" rx="1" fill="none" stroke="var(--osm-accent,#0369a1)" stroke-width="1"/>
  <text x="180" y="205" text-anchor="middle" font-size="12" fill="currentColor">Bounding-box hierarchy of MBRs</text>
  <text x="180" y="225" text-anchor="middle" font-size="12" fill="currentColor" opacity="0.85">adapts to irregular extents</text>
  <line x1="44" y1="246" x2="316" y2="246" stroke="currentColor" stroke-width="1" opacity="0.35"/>
  <text x="180" y="268" text-anchor="middle" font-size="11.5" fill="currentColor" font-weight="700">Best for</text>
  <text x="180" y="288" text-anchor="middle" font-size="12" fill="currentColor">Exact spatial joins &amp;</text>
  <text x="180" y="308" text-anchor="middle" font-size="12" fill="currentColor">varying-density queries</text>
  <!-- Card 2: Quadkey / Grid -->
  <rect x="360" y="48" width="320" height="292" rx="8" fill="none" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <rect x="360" y="48" width="320" height="34" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="520" y="71" text-anchor="middle" font-size="14" fill="currentColor" font-weight="700">Quadkey / Grid</text>
  <!-- quad-split grid glyph -->
  <rect x="470" y="98" width="100" height="68" rx="2" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <line x1="520" y1="98" x2="520" y2="166" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <line x1="470" y1="132" x2="570" y2="132" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <line x1="495" y1="98" x2="495" y2="132" stroke="var(--osm-ok,#15803d)" stroke-width="1"/>
  <line x1="470" y1="115" x2="520" y2="115" stroke="var(--osm-ok,#15803d)" stroke-width="1"/>
  <text x="520" y="205" text-anchor="middle" font-size="12" fill="currentColor">Fixed-resolution cells on</text>
  <text x="520" y="225" text-anchor="middle" font-size="12" fill="currentColor" opacity="0.85">power-of-two splits</text>
  <line x1="384" y1="246" x2="656" y2="246" stroke="currentColor" stroke-width="1" opacity="0.35"/>
  <text x="520" y="268" text-anchor="middle" font-size="11.5" fill="currentColor" font-weight="700">Best for</text>
  <text x="520" y="288" text-anchor="middle" font-size="12" fill="currentColor">Tiling &amp; point-in-polygon</text>
  <text x="520" y="308" text-anchor="middle" font-size="12" fill="currentColor">pre-filtering</text>
  <!-- Card 3: H3 / S2 -->
  <rect x="700" y="48" width="320" height="292" rx="8" fill="none" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <rect x="700" y="48" width="320" height="34" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="860" y="71" text-anchor="middle" font-size="14" fill="currentColor" font-weight="700">H3 / S2</text>
  <!-- hexagon tessellation glyph -->
  <polygon points="880,113 870,130.32 850,130.32 840,113 850,95.68 870,95.68" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <polygon points="910,130.32 900,147.64 880,147.64 870,130.32 880,113 900,113" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <polygon points="880,147.64 870,164.96 850,164.96 840,147.64 850,130.32 870,130.32" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="860" y="205" text-anchor="middle" font-size="12" fill="currentColor">Uniform hex / spherical cells</text>
  <text x="860" y="225" text-anchor="middle" font-size="12" fill="currentColor" opacity="0.85">deterministic neighbours</text>
  <line x1="724" y1="246" x2="996" y2="246" stroke="currentColor" stroke-width="1" opacity="0.35"/>
  <text x="860" y="268" text-anchor="middle" font-size="11.5" fill="currentColor" font-weight="700">Best for</text>
  <text x="860" y="288" text-anchor="middle" font-size="12" fill="currentColor">Global aggregation &amp;</text>
  <text x="860" y="308" text-anchor="middle" font-size="12" fill="currentColor">completeness sampling</text>
</svg>

## Prerequisites: Concepts to Anchor First

This guide assumes three foundations. First, the [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/): you index *reconstructed geometries*, and a way only becomes a line or polygon once its node references are resolved into coordinates, so reference closure governs what is indexable at all. Second, the [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/), because the dense, delta-encoded node arrays and block framing of `.osm.pbf` are what let you stream geometries into an index without loading the whole file. Third, the WGS 84 storage model in [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) — OSM stores unprojected latitude and longitude, and the choice to index in geographic versus projected coordinates changes how every bounding box is computed. Readers comfortable with those three can treat the rest of this page as an indexing reference.

## Indexing Architectures for OSM Primitives

OSM's node-way-relation model demands indexing at multiple geometric granularities. Nodes store raw WGS 84 coordinates; ways define linear or polygonal geometries through ordered node references; relations encode multipolygon, route, and administrative hierarchies. A production index strategy must align with these primitives while accounting for tag-based filtering and the wide density gradient between dense urban cores and sparse rural extents. Three families of index dominate OSM work, and they are complementary rather than competing.

- **R-tree (bounding-box hierarchies):** Optimized for arbitrary polygon, line, and point queries. Disk-backed implementations via `libspatialindex` (exposed in Python through `rtree`) provide efficient pruning for spatial joins and bounding-box filters by storing a tree of minimum bounding rectangles (MBRs). R-trees excel when query extents are irregular or when feature density varies sharply across a region, because the tree adapts its node shapes to the data.
- **Quadkey / grid partitioning:** Divides the geographic extent into fixed-resolution cells along power-of-two splits — the same scheme that underpins slippy-map tiles and Bing-style quadkeys. Grid cells are cheap to compute (a pure function of coordinate and zoom), trivially parallelizable, and ideal for density analysis, point-in-polygon pre-filtering, and tile generation. The weakness is boundary fragmentation: a feature straddling a cell edge must be registered in every cell it touches.
- **Hierarchical spatial grids (H3 / S2):** Provide near-uniform area coverage and deterministic neighbour traversal over the whole globe. H3's hexagonal cells and S2's spherical quadrilaterals mitigate the latitude distortion inherent in planar projections, which makes them the right tool for spatial aggregation, completeness sampling, and distributed validation where every cell should cover a comparable ground area.

Selecting an architecture depends on the downstream query, not on taste. Topology-validation pipelines that test precise intersections favour R-trees; tag-based analytics and completeness sampling favour hierarchical grids; tile rendering favours quadkeys. Many production stacks run two indexes side by side — an R-tree for exact spatial joins and an H3 column for coarse aggregation — because the two answer different questions. For a criterion-by-criterion decision matrix, see [R-tree vs H3 vs Quadkey: Spatial Index Selection](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/), the companion guide to this one that maps a workload to the index family that fits it.

## Specification & Encoding Reference

The numbers that constrain index construction come straight from the formats OSM uses.

| Property | Value / rule | Why it matters for indexing |
|---|---|---|
| Coordinate CRS | WGS 84, EPSG:4326 (implicit) | Bounding boxes are computed in degrees unless you reproject first |
| Coordinate storage | 64-bit signed integers, nanodegree-scaled | Convert to float only at index insertion; integers stay exact |
| Default granularity | 100 nanodegrees (≈1.1 cm at equator) | Storage precision far exceeds index precision needs |
| Longitude / latitude range | lon ∈ [−180, 180], lat ∈ [−90, 90] | Out-of-range values signal corrupt or clipped data; reject pre-insert |
| Way closure rule | first node ref == last, ≥4 nodes | Determines Polygon vs LineString before bounds are taken |
| R-tree MBR ordering | (minx, miny, maxx, maxy) | `rtree` and `libspatialindex` expect this exact tuple order |

A bounding box for an R-tree is the tuple `(min_lon, min_lat, max_lon, max_lat)` — Shapely's `geometry.bounds` already returns it in that order, which is why coordinates are stored as `(lon, lat)` pairs rather than the human-readable `(lat, lon)`. For grid and quadkey schemes the controlling quantity is ground resolution at a given zoom level and latitude. In Web Mercator, the metres-per-pixel that sizes a quadkey cell is:

$$
\text{resolution}(\varphi, z) = \frac{\cos(\varphi)\,\cdot\,2\pi R}{256 \cdot 2^{z}}
$$

where $\varphi$ is latitude, $z$ the zoom level, and $R = 6{,}378{,}137\,\text{m}$ the Earth's equatorial radius. The $\cos(\varphi)$ term is exactly the latitude distortion that hexagonal H3 cells are designed to avoid, and it is why a quadkey cell near the poles covers a tiny fraction of the ground area of one at the equator.

## Step-by-Step: Building a Disk-Backed R-tree

The following pattern turns a streamed OSM extract into a persistent, query-ready R-tree using `pyosmium` for sequential PBF parsing and `rtree` for the index. It uses Python 3.10+ type hints and the project's standard logger pattern, and it prioritizes memory efficiency, deterministic output, and non-blocking error recovery.

1. **Select a location store.** Pass `locations=True` to `apply_file` so pyosmium resolves node coordinates into each way automatically. Choose `idx='flex_mem'` (in-memory) for regional extracts under ~1 GB, or `idx='sparse_file_array'` (disk-backed) for continental and planet files to avoid an out-of-memory kill.
2. **Reconstruct geometry per way.** Read each node reference's resolved location, decide Polygon versus LineString from the closure rule, and repair self-intersections with a zero-width buffer.
3. **Insert the MBR.** Take `geometry.bounds` and insert it under a monotonically increasing feature id, carrying the geometry as the stored object for later exact tests.
4. **Finalize deterministically.** Flush the index to disk and return the captured error log so defective primitives can be reviewed or quarantined.

```python
import logging
import osmium
import rtree
from shapely.geometry import LineString, Polygon
from shapely.errors import TopologicalError

logger = logging.getLogger(__name__)


class OSMWayIndexer(osmium.SimpleHandler):
    """Build a disk-backed R-tree of way geometries from an OSM extract.

    Pass ``locations=True`` to ``apply_file`` so pyosmium resolves node
    coordinates automatically via its internal location store. The node()
    callback is not needed in that configuration — coordinates are available
    directly on each NodeRef in ``w.nodes`` via ``nr.location``.

    For continental extracts, use ``idx='flex_mem'`` (in-memory location
    store) or ``idx='sparse_file_array'`` (disk-backed) to avoid exhausting
    available RAM.
    """

    def __init__(self, index_path: str) -> None:
        super().__init__()
        self.index = rtree.index.Index(
            index_path, properties=rtree.index.Property(dimension=2)
        )
        self.feature_id: int = 0
        self.errors: list[dict] = []

    def way(self, w: osmium.osm.Way) -> None:
        try:
            coords: list[tuple[float, float]] = []
            for nr in w.nodes:
                loc = nr.location
                if not loc.valid():
                    self.errors.append(
                        {"type": "way", "id": w.id, "error": f"invalid location for node {nr.ref}"}
                    )
                    return
                # Store as (lon, lat) so bounds map to (minx, miny, maxx, maxy).
                coords.append((loc.lon, loc.lat))

            if len(coords) < 2:
                return

            if coords[0] == coords[-1] and len(coords) >= 4:
                geom = Polygon(coords)
            else:
                geom = LineString(coords)

            if not geom.is_valid:
                geom = geom.buffer(0)  # Standard self-intersection repair.

            self.index.insert(self.feature_id, geom.bounds, obj=geom)
            self.feature_id += 1

        except (TopologicalError, ValueError) as exc:
            self.errors.append({"type": "way", "id": w.id, "error": str(exc)})
            logger.warning("Geometry error on way %s: %s", w.id, exc)

    def finalize(self) -> list[dict]:
        """Flush the index to disk and return the error log."""
        self.index.close()
        logger.info(
            "Index finalized. %d features indexed, %d errors logged.",
            self.feature_id, len(self.errors),
        )
        return self.errors


# Usage:
# indexer = OSMWayIndexer("/tmp/osm_rtree")
# indexer.apply_file("extract.osm.pbf", locations=True, idx="flex_mem")
# errors = indexer.finalize()
```

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Build a disk-backed spatial index over an OSM extract",
  "description": "Stream an OSM PBF extract with pyosmium and build a persistent R-tree of way geometries for logarithmic-time bounding-box queries.",
  "step": [
    { "@type": "HowToStep", "name": "Select a location store", "text": "Pass locations=True to apply_file and choose idx='flex_mem' for regional extracts or idx='sparse_file_array' for continental and planet files to bound memory." },
    { "@type": "HowToStep", "name": "Reconstruct way geometry", "text": "Read each node reference's resolved location, decide Polygon versus LineString from the closure rule, and repair self-intersections with a zero-width buffer." },
    { "@type": "HowToStep", "name": "Insert the bounding box", "text": "Take geometry.bounds as (minx, miny, maxx, maxy) and insert it under a monotonically increasing feature id, storing the geometry for later exact tests." },
    { "@type": "HowToStep", "name": "Finalize the index", "text": "Flush the index to disk with close() and return the captured error log so defective primitives can be quarantined or reviewed." },
    { "@type": "HowToStep", "name": "Query the index", "text": "Resolve a bounding-box query against the R-tree to retrieve candidate ids, then run an exact geometric predicate on the stored geometries to remove false positives." }
  ]
}
</script>

## Querying: Coarse Filter, Exact Refine

An R-tree returns *candidates*, not answers. Every spatial query is two stages: the index prunes the search to features whose MBRs overlap the query window, then an exact geometric predicate removes the false positives that a rectangle inevitably admits. Skipping the refine step is a common correctness bug — the index will happily return a feature whose bounding box overlaps but whose actual geometry does not.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 282" role="img" aria-labelledby="sidx-funnel-t sidx-funnel-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="sidx-funnel-t">Candidate counts through the two-stage spatial query funnel</title>
  <desc id="sidx-funnel-d">A four-stage funnel over a 4.1 million geometry extract. A full scan touches all 4.1 million. The R-tree bounding-box query returns 3140 candidates. A prepared-geometry intersects test keeps 214. The attribute filter leaves 176 final rows. Bar length is candidates surviving each stage.</desc>
  <rect x="0" y="0" width="880" height="282" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Two-stage querying: what each filter actually removes</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">geometries still under consideration after each stage — city-boundary join, 4.1 M input</text>
  <line x1="250" y1="68" x2="250" y2="228" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">no index — full scan</text>
  <rect x="250" y="74" width="442" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="702" y="89" font-size="11" fill="currentColor" opacity="0.9">4 100 000 exact tests · 38 s</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">R-tree bbox query</text>
  <rect x="250" y="116" width="6" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="266" y="131" font-size="11" fill="currentColor" opacity="0.9">3 140 candidates · 4 ms</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">prepared intersects()</text>
  <rect x="250" y="158" width="6" height="21" rx="3" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="266" y="173" font-size="11" fill="currentColor" opacity="0.9">214 true hits · 11 ms</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">attribute predicate</text>
  <rect x="250" y="200" width="6" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="266" y="215" font-size="11" fill="currentColor" opacity="0.9">176 rows returned</text>
  <text x="440" y="264" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Bar length is candidate count on a linear scale, which is why the last three are barely visible — that is the result, not a drawing error.</text>
</svg>
<figcaption>The index never answers the question — it only shrinks it. Every millisecond saved comes from the exact predicate running 4.1 million times fewer.</figcaption>
</figure>

```python
from shapely.geometry import box


def query_window(index: rtree.index.Index, bbox: tuple[float, float, float, float]) -> list:
    """Return geometries that genuinely intersect a (minx, miny, maxx, maxy) window."""
    window = box(*bbox)
    hits = index.intersection(bbox, objects=True)          # coarse: MBR overlap
    return [item.object for item in hits if item.object.intersection(window)]  # exact
```

Because the geometry was stored as the index `obj`, the refine step never has to revisit the source file. For workloads dominated by tag filters — extracting only `highway=*` or `building=*` — apply the conventions in [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) at insertion time and index each feature class into its own tree, so a query touches only the relevant subset rather than one monolithic index.

## Validation & Error-Handling Matrix

Error handling in spatial ETL must be non-blocking: OSM data routinely contains orphaned nodes clipped by extract boundaries, unclosed rings, and self-intersecting polygons, and a single malformed primitive must never abort an hours-long index build. Each row below is a real failure seen in production indexing, with how to detect and remediate it.

| Error condition | Root cause | Detection | Remediation |
|---|---|---|---|
| `invalid location for node` | Way references a node clipped by the extract boundary | `nr.location.valid()` is false | Skip and log the way; rebuild from a larger extract if closure matters |
| Self-intersecting polygon | Mapper error or ring digitized in a figure-eight | `geom.is_valid` is false | Repair with `geom.buffer(0)`; quarantine if area changes drastically |
| Coordinates swapped (lat/lon) | Bounds inserted as (lat, lon) not (lon, lat) | Reconstructed bbox falls outside region | Always insert `geometry.bounds`; store coords as (lon, lat) |
| Query returns non-overlapping features | Coarse MBR result used without exact refine | Visual or predicate spot-check | Re-test each candidate with an exact `intersects`/`contains` predicate |
| `MemoryError` on continental file | In-memory location store on a planet-scale extract | RSS climbs until OOM kill | Switch `idx` to `sparse_file_array`; index in disk-backed mode |
| Non-reproducible index across runs | Feature ids assigned by nondeterministic ordering | Diff of two builds differs | Insert in PBF id order; partition only on non-overlapping bboxes |
| Empty / single-point geometry | Degenerate way with < 2 distinct nodes | `len(coords) < 2` | Skip silently; these carry no spatial extent |

OSM stores coordinates in unprojected WGS 84 (EPSG:4326). The recommended practice is to index in native WGS 84 and defer projection to the query or export stage, reprojecting with the `pyproj` `Transformer` API — a pattern walked through in [converting OSM coordinates to a local CRS with pyproj](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/converting-osm-coordinates-to-local-crs-with-pyproj/). Indexing in geographic degrees keeps bounding boxes exact and avoids re-indexing whenever a downstream consumer needs a different projection.

## Performance & Scale Considerations

Memory efficiency hinges on streaming consumption and the right location-store choice. When using `apply_file(..., locations=True)`, pyosmium manages the node-location store internally. For regional extracts (under ~1 GB) `idx='flex_mem'` keeps the store resident and is fastest; for continental or planet-scale extracts `idx='sparse_file_array'` spills the store to disk, trading I/O throughput for a bounded memory ceiling and avoiding OOM kills. The R-tree itself, when constructed via a persistent `rtree.index.Index(path, ...)`, is memory-mapped from disk, so the resident set stays modest even as the index grows to gigabytes.

Two tuning levers matter at scale. First, **bulk loading**: building an R-tree by streaming inserts is acceptable, but packing it from a pre-sorted geometry stream (an STR-pack) produces a flatter, better-balanced tree with materially faster queries — worth the extra pass on read-heavy indexes. Second, **parallel construction**: because PBF blocks are independent, you can split a planet file into geographic partitions, build one R-tree per partition on a separate worker, and union the partition results at query time. Partition on non-overlapping bounding boxes, never on arbitrary block offsets, so each worker holds a self-contained spatial region and the merged result has no duplicated or torn features. Query latency on a well-packed R-tree over a country-scale extract is typically sub-millisecond per bounding-box lookup, versus a full-scan baseline that grows linearly with feature count.

## Failure Modes & Gotchas

Beyond the matrix, a few edge cases catch even careful implementations:

- **Coordinate tuple order.** R-trees, `libspatialindex`, and Shapely's `bounds` all use `(minx, miny, maxx, maxy)` — that is `(lon, lat)` order. Store node coordinates as `(lon, lat)` from the start; the lat/lon swap is the single most common indexing bug and it silently relocates every feature.
- **MBRs over-select on diagonal geometries.** A long diagonal road has an MBR that covers a huge empty area, so it appears as a candidate for many unrelated queries. The exact-refine stage absorbs this, but on diagonal-heavy data the candidate set can be large — measure refine cost, not just index hits.
- **Boundary fragmentation in grids.** Quadkey and grid schemes must register a feature in every cell its bounds touch, so a feature spanning a cell edge appears multiple times; deduplicate query results by feature id.
- **Float conversion drift.** Coordinate precision must be normalized early. Keep the nanodegree integers exact through reconstruction and convert to float once, at insertion — converting repeatedly invites floating-point drift that makes two index builds diverge.
- **`buffer(0)` can change area.** The zero-width buffer repairs self-intersections but on pathological rings it can drop a lobe or merge them. Compare pre/post area and quarantine geometries whose area shifts beyond a tolerance rather than indexing a silently mangled polygon.
- **Relations are not free geometry.** Multipolygon relations require assembling member ways into rings before they have indexable bounds; index them in a relation-aware pass, not the way pass shown above.

## Reproducibility & Pipeline Automation

Deterministic indexing is non-negotiable for reproducible geospatial workflows, and it rests on three practices:

1. **Input checksum verification.** Validate PBF integrity with a SHA-256 hash before parsing, so a partial download or storage bit-rot cannot silently poison the index.
2. **Deterministic feature ordering.** OSM primitives are serialized in id order within PBF blocks. Index insertion should respect that sequence, and any parallelization must use partitioned, non-overlapping bounding boxes to avoid race conditions and nondeterministic id assignment during concurrent writes.
3. **Environment pinning.** Lock Python dependencies, the C-extension version of `libspatialindex`, and the index parameters (leaf capacity, fill factor) in a configuration manifest, alongside the exact CRS, precision thresholds, and tag filters applied during ingestion — so a downstream analyst can replicate the index bit-for-bit.

Spatial indexing also accelerates compliance and licensing automation. By pre-computing bounding boxes and spatial relationships, a pipeline can rapidly identify features intersecting jurisdictional boundaries, apply region-specific licensing tags, or flag data requiring contributor attribution. For teams running continuous OSM updates, combining `osmium apply-changes` with incremental R-tree inserts turns raw extracts into query-ready assets without a full index rebuild on every cycle.

## Integration Points: Feeding the Next Stage

The finished index is an input, not an endpoint. Its output is a fast candidate-resolution service that the normalization and analytics stages consume without knowing anything about R-tree internals — the clean boundary that the [parsing and tag-normalization workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/) build on. The wiring below joins two OSM datasets spatially, routing geometry failures to a quarantine in the discipline detailed in [error handling in large OSM extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/):

```python
def spatial_join(index: rtree.index.Index, probes: list) -> list[dict]:
    """Attach each probe geometry to the indexed features it intersects."""
    results: list[dict] = []
    for probe in probes:
        try:
            hits = index.intersection(probe.bounds, objects=True)
            matched = [h.object for h in hits if h.object.intersects(probe)]
            results.append({"probe": probe, "matches": matched})
        except (TopologicalError, ValueError) as exc:
            logger.warning("quarantining probe geometry: %s", exc)
            quarantine(probe, exc)  # provided by the normalization stage
    return results
```

For ingestion that produces the geometry stream this index consumes, the concurrent reader in [async PBF parsing with pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/) and the windowed approach in [memory-efficient chunk processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) apply the same block-boundary partitioning the parallel-construction section recommends.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1100 460" style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit" role="img" aria-label="Data-flow diagram of the spatial-indexing stage. A build pipeline streams the PBF extract, reconstructs geometry, and inserts minimum bounding rectangles into a disk-backed R-tree, persisting it as a memory-mapped index; invalid or unclosed geometries branch off reconstruction into a quarantine. A serve pipeline takes a bounding-box query window, reads candidate ids from the persistent index in a coarse MBR-overlap filter, removes false positives in an exact predicate-refine stage, and feeds the survivors to downstream spatial join and tag analytics.">
  <title>Indexing-stage data flow: build pipeline, persistent index, and query pipeline</title>
  <desc>Top row, the build pipeline: PBF extract stream feeds geometry reconstruction (ways to LineString or Polygon), which feeds R-tree insert (disk-backed). Invalid or self-intersecting geometries branch down from reconstruction into a quarantine box. R-tree insert persists down into a memory-mapped persistent R-tree drawn as a cylinder. Bottom row, the query pipeline: a bounding-box query window feeds a coarse filter that reads candidate ids from the persistent index by MBR overlap; the candidates pass to an exact refine stage using intersects or contains predicates; the matches feed downstream spatial join and tag analytics.</desc>
  <defs>
    <marker id="idx-arr" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <rect x="0" y="0" width="1100" height="460" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="550" y="24" text-anchor="middle" font-size="15" fill="currentColor" font-weight="700">Build once, then serve every query as coarse filter then exact refine</text>
  <text x="140" y="46" text-anchor="middle" font-size="11.5" fill="currentColor" font-weight="700" opacity="0.8">BUILD</text>
  <text x="135" y="296" text-anchor="middle" font-size="11.5" fill="currentColor" font-weight="700" opacity="0.8">SERVE</text>
  <!-- Build row -->
  <rect x="40" y="56" width="200" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="140" y="84" text-anchor="middle" font-size="13" fill="currentColor" font-weight="600">PBF extract stream</text>
  <text x="140" y="104" text-anchor="middle" font-size="11.5" fill="currentColor" opacity="0.85">sequential blocks</text>
  <rect x="300" y="56" width="200" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="400" y="84" text-anchor="middle" font-size="13" fill="currentColor" font-weight="600">Geometry reconstruction</text>
  <text x="400" y="104" text-anchor="middle" font-size="11.5" fill="currentColor" opacity="0.85">refs → Line / Polygon</text>
  <rect x="560" y="56" width="200" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="660" y="84" text-anchor="middle" font-size="13" fill="currentColor" font-weight="600">R-tree insert</text>
  <text x="660" y="104" text-anchor="middle" font-size="11.5" fill="currentColor" opacity="0.85">geometry.bounds → MBR</text>
  <line x1="240" y1="88" x2="298" y2="88" stroke="currentColor" stroke-width="1.5" marker-end="url(#idx-arr)"/>
  <line x1="500" y1="88" x2="558" y2="88" stroke="currentColor" stroke-width="1.5" marker-end="url(#idx-arr)"/>
  <!-- Quarantine branch off reconstruction -->
  <path d="M340,120 V150 H140 V178" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 3" marker-end="url(#idx-arr)"/>
  <text x="232" y="144" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">invalid · self-intersecting</text>
  <rect x="40" y="180" width="200" height="56" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="140" y="204" text-anchor="middle" font-size="13" fill="currentColor" font-weight="600">Quarantine</text>
  <text x="140" y="223" text-anchor="middle" font-size="11.5" fill="currentColor" opacity="0.85">logged, not dropped</text>
  <!-- Persist into memory-mapped index -->
  <line x1="660" y1="120" x2="660" y2="156" stroke="currentColor" stroke-width="1.5" marker-end="url(#idx-arr)"/>
  <text x="700" y="146" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">persist</text>
  <ellipse cx="660" cy="172" rx="72" ry="12" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <path d="M588,172 V232 A72,12 0 0 0 732,232 V172" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="660" y="200" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="600">Persistent R-tree</text>
  <text x="660" y="218" text-anchor="middle" font-size="11.5" fill="currentColor" opacity="0.85">(memory-mapped)</text>
  <!-- Index serves the coarse filter -->
  <path d="M660,244 V268 H400 V298" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#idx-arr)"/>
  <text x="530" y="262" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">candidate ids</text>
  <!-- Serve row -->
  <rect x="40" y="300" width="200" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="140" y="328" text-anchor="middle" font-size="13" fill="currentColor" font-weight="600">Bbox query window</text>
  <text x="140" y="348" text-anchor="middle" font-size="11.5" fill="currentColor" opacity="0.85">minx, miny, maxx, maxy</text>
  <rect x="300" y="300" width="200" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="400" y="328" text-anchor="middle" font-size="13" fill="currentColor" font-weight="600">Coarse filter</text>
  <text x="400" y="348" text-anchor="middle" font-size="11.5" fill="currentColor" opacity="0.85">MBR overlap</text>
  <rect x="560" y="300" width="200" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="660" y="328" text-anchor="middle" font-size="13" fill="currentColor" font-weight="600">Exact refine</text>
  <text x="660" y="348" text-anchor="middle" font-size="11.5" fill="currentColor" opacity="0.85">intersects / contains</text>
  <rect x="820" y="300" width="240" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="940" y="328" text-anchor="middle" font-size="13" fill="currentColor" font-weight="600">Spatial join / tag analytics</text>
  <text x="940" y="348" text-anchor="middle" font-size="11.5" fill="currentColor" opacity="0.85">downstream consumers</text>
  <line x1="240" y1="332" x2="298" y2="332" stroke="currentColor" stroke-width="1.5" marker-end="url(#idx-arr)"/>
  <line x1="500" y1="332" x2="558" y2="332" stroke="currentColor" stroke-width="1.5" marker-end="url(#idx-arr)"/>
  <text x="529" y="322" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">candidates</text>
  <line x1="760" y1="332" x2="818" y2="332" stroke="currentColor" stroke-width="1.5" marker-end="url(#idx-arr)"/>
  <text x="789" y="322" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">matches</text>
  <text x="550" y="408" text-anchor="middle" font-size="11.5" fill="currentColor" opacity="0.9">The index is built once from the stream; every later query is a cheap MBR prune followed by an exact predicate on the stored geometries.</text>
</svg>

## Frequently Asked Questions

<details>
<summary>Should I index OSM data in WGS 84 or a projected CRS?</summary>

Index in native WGS 84 (EPSG:4326) and defer projection to the query or export stage. OSM stores coordinates in geographic degrees, so indexing in degrees keeps bounding boxes exact and avoids re-indexing whenever a consumer needs a different projection. Reproject candidate results on demand with the pyproj Transformer API.
</details>

<details>
<summary>R-tree, quadkey, or H3 — which spatial index should I use?</summary>

Match the index to the query. R-trees are best for exact spatial joins and irregular bounding-box queries against varying-density data. Quadkey and grid schemes suit tiling and point-in-polygon pre-filtering. H3 and S2 give near-uniform global cells for aggregation and completeness sampling. Many pipelines run an R-tree for exact joins alongside an H3 column for coarse aggregation, because they answer different questions.
</details>

<details>
<summary>Why does my query return features that do not actually intersect?</summary>

An R-tree query is a coarse filter: it returns every feature whose minimum bounding rectangle overlaps the query window, including false positives a rectangle inevitably admits. Always run an exact geometric predicate (intersects, contains) on the candidate geometries to remove them. Storing the geometry as the index object lets the refine step run without rereading the source file.
</details>

<details>
<summary>How do I keep memory bounded when indexing a continental or planet extract?</summary>

Use a disk-backed node-location store by passing idx='sparse_file_array' to apply_file, and construct the R-tree as a persistent, memory-mapped rtree.index.Index on a file path rather than in memory. For regional extracts under ~1 GB, idx='flex_mem' is faster and fits in RAM. Partition planet files into non-overlapping geographic regions and build one index per partition in parallel.
</details>

<details>
<summary>How do I make index builds reproducible?</summary>

Verify the PBF SHA-256 before parsing, insert features in PBF id order, pin the libspatialindex version and index parameters in a manifest, and partition any parallel build on non-overlapping bounding boxes so feature-id assignment is deterministic. Record the CRS, precision thresholds, and tag filters used so the index can be rebuilt bit-for-bit.
</details>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Should I index OSM data in WGS 84 or a projected CRS?",
      "acceptedAnswer": { "@type": "Answer", "text": "Index in native WGS 84 (EPSG:4326) and defer projection to the query or export stage. OSM stores coordinates in geographic degrees, so indexing in degrees keeps bounding boxes exact and avoids re-indexing whenever a consumer needs a different projection. Reproject candidate results on demand with the pyproj Transformer API." }
    },
    {
      "@type": "Question",
      "name": "R-tree, quadkey, or H3 — which spatial index should I use?",
      "acceptedAnswer": { "@type": "Answer", "text": "Match the index to the query. R-trees are best for exact spatial joins and irregular bounding-box queries against varying-density data. Quadkey and grid schemes suit tiling and point-in-polygon pre-filtering. H3 and S2 give near-uniform global cells for aggregation and completeness sampling. Many pipelines run an R-tree for exact joins alongside an H3 column for coarse aggregation." }
    },
    {
      "@type": "Question",
      "name": "Why does my query return features that do not actually intersect?",
      "acceptedAnswer": { "@type": "Answer", "text": "An R-tree query is a coarse filter: it returns every feature whose minimum bounding rectangle overlaps the query window, including false positives a rectangle inevitably admits. Always run an exact geometric predicate such as intersects or contains on the candidate geometries to remove them. Storing the geometry as the index object lets the refine step run without rereading the source file." }
    },
    {
      "@type": "Question",
      "name": "How do I keep memory bounded when indexing a continental or planet extract?",
      "acceptedAnswer": { "@type": "Answer", "text": "Use a disk-backed node-location store by passing idx='sparse_file_array' to apply_file, and construct the R-tree as a persistent, memory-mapped index on a file path rather than in memory. For regional extracts under about 1 GB, idx='flex_mem' is faster and fits in RAM. Partition planet files into non-overlapping geographic regions and build one index per partition in parallel." }
    },
    {
      "@type": "Question",
      "name": "How do I make index builds reproducible?",
      "acceptedAnswer": { "@type": "Answer", "text": "Verify the PBF SHA-256 before parsing, insert features in PBF id order, pin the libspatialindex version and index parameters in a manifest, and partition any parallel build on non-overlapping bounding boxes so feature-id assignment is deterministic. Record the CRS, precision thresholds, and tag filters used so the index can be rebuilt bit-for-bit." }
    }
  ]
}
</script>

## Related

- [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) — the streamed, delta-encoded source the index is built from.
- [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — the primitives whose reconstructed geometries are indexed.
- [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) — why indexing in WGS 84 and reprojecting on query is the default.
- [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) — filtering feature classes into per-class indexes before insertion.
- [OSM XML vs PBF Comparison](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/) — why PBF is the practical input for scalable index construction.
- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — quarantine and remediation for the defective geometries indexing surfaces.

This guide is part of the [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/) section — return there for the full map of the OSM data model, serialization formats, and ingestion foundations.
