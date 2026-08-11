---
pageTitle: "Convert OSM Coordinates to a Local CRS with pyproj"
pageDescription: "Reproject OSM WGS 84 (EPSG:4326) node arrays into a local projected CRS with pyproj's Transformer API, always_xy=True, and memory-bounded NumPy chunks."
---
# Converting OSM coordinates to local CRS with pyproj

Take decoded OpenStreetMap node arrays stored in implicit WGS 84 (EPSG:4326) and reproject them into a local projected CRS — UTM, LAEA, or Web Mercator — using pyproj's `Transformer` API without silently swapping the latitude and longitude axes.

## Prerequisites

Confirm each item before running the code below; an unmet prerequisite is the usual cause of a "works on my laptop, NaNs in production" reprojection bug.

- [ ] `pyproj` ≥ 3.4.0 installed (`pip install "pyproj>=3.4"`) — it bundles PROJ ≥ 9.0 and the `Transformer` operation database.
- [ ] `numpy` ≥ 1.23 installed for vectorized array transforms.
- [ ] A streaming PBF reader available (`pip install osmium` for `pyosmium`) so coordinates feed the buffer without per-object Python overhead.
- [ ] The target EPSG code chosen for your study area (e.g. `32633` for UTM Zone 33N over central Europe; `3035` for Europe-wide equal-area; `3857` for slippy-map tiles).
- [ ] Required datum-shift grids provisioned in `PROJ_DATA`; set `PROJ_NETWORK=OFF` in air-gapped runs so PROJ never silently fetches or falls back to a lower-accuracy path.
- [ ] Input coordinates already validated against the WGS 84 envelope (this is the output of the reprojection stage's upstream bounds check).

## Conceptual minimum

OpenStreetMap persists every node, way, and relation in unprojected WGS 84 geographic coordinates, and — as [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) explains — that CRS is implicit: no projection string is stored against any primitive. Angular degrees are the wrong unit for buffering, distance, and topology work, so an analytics pipeline must reproject into a metric Cartesian system. Because only nodes carry coordinates in the [Node-Way-Relation data model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/), you transform raw node arrays first and assemble way and relation geometries afterward.

The single rule that prevents most corruption is axis order. PROJ follows the EPSG registry, which defines EPSG:4326 as latitude-first, while OSM tooling, GeoJSON, and Shapely all expect `(longitude, latitude)`. Passing `always_xy=True` forces pyproj to treat the X argument as longitude and Y as latitude regardless of the CRS pair or PROJ version, removing a brittle implicit dependency. For local accuracy, pick the UTM zone covering the extract centroid, where the zone number follows:

<figure class="diagram-wrap">
<svg viewBox="0 0 860 244" role="img" aria-labelledby="pyproj-cost-t pyproj-cost-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="pyproj-cost-t">Cost of transformer construction against transformer reuse</title>
  <desc id="pyproj-cost-d">A horizontal bar chart of wall-clock seconds to reproject one million nodes. Constructing a Transformer inside the loop takes 612 seconds. Constructing it once and calling it per point takes 44 seconds. Constructing it once and passing the whole coordinate array in a single call takes 1.1 second.</desc>
  <rect x="0" y="0" width="860" height="244" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="430" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Where the time goes: constructing the transformer, not using it</text>
  <text x="34" y="58" font-size="11.5" font-weight="600" fill="currentColor">1 M nodes reprojected, wall-clock seconds</text>
  <line x1="290" y1="70" x2="290" y2="212" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="280" y="96" text-anchor="end" font-size="11.5" fill="currentColor">Transformer per point</text>
  <rect x="290" y="82" width="500" height="22" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="798" y="98" font-size="11" font-weight="600" fill="currentColor">612 s</text>
  <text x="280" y="140" text-anchor="end" font-size="11.5" fill="currentColor">Built once, called per point</text>
  <rect x="290" y="126" width="36" height="22" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="334" y="142" font-size="11" fill="currentColor">44 s</text>
  <text x="280" y="184" text-anchor="end" font-size="11.5" fill="currentColor">Built once, whole array at once</text>
  <rect x="290" y="170" width="8" height="22" rx="2" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="306" y="186" font-size="11" font-weight="600" fill="currentColor">1.1 s</text>
  <text x="430" y="226" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Construction parses the CRS definition and builds a pipeline; the projection maths itself is a handful of floating-point operations.</text>
</svg>
<figcaption>Two independent wins stack here: hoisting construction out of the loop, then handing pyproj whole arrays so the per-call overhead is amortised across a million points instead of paid a million times.</figcaption>
</figure>

$$ \text{zone} = \left\lfloor \frac{\lambda + 180}{6} \right\rfloor + 1 $$

with $\lambda$ the centroid longitude in decimal degrees.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 320" style="width:100%;max-width:100%;display:block;margin:1.5rem auto" role="img" aria-label="Axis-order pitfall: the same OSM node (lat 52.52, lon 13.40) sent through pyproj two ways. With always_xy=True the X argument is treated as longitude, producing correct UTM Zone 33N coordinates near Berlin. Without it PROJ reads X as latitude, swapping the axes and producing an out-of-bounds result.">
  <title>Axis-order pitfall: always_xy=True versus the default</title>
  <desc>Two parallel pipelines start from one OSM node with latitude 52.52 and longitude 13.40. The top lane passes always_xy=True, so the pyproj Transformer maps X to longitude and Y to latitude, yielding valid UTM Zone 33N coordinates x≈392,440 and y≈5,820,080 over Berlin. The bottom lane omits always_xy, so PROJ follows EPSG authority order and reads the first argument as latitude; the axes are swapped and the point projects outside the zone extent, landing in the wrong place.</desc>
  <defs>
    <marker id="ax-arr" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <rect x="0" y="0" width="1000" height="320" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <!-- Shared source node -->
  <rect x="16" y="116" width="172" height="88" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="102" y="146" text-anchor="middle" font-size="13" font-family="inherit" fill="currentColor" font-weight="600">OSM node</text>
  <text x="102" y="166" text-anchor="middle" font-size="12" font-family="inherit" fill="currentColor">lat = 52.52</text>
  <text x="102" y="184" text-anchor="middle" font-size="12" font-family="inherit" fill="currentColor">lon = 13.40</text>
  <!-- splitter lines -->
  <path d="M188,160 L214,160 L214,74 L240,74" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#ax-arr)"/>
  <path d="M188,160 L214,160 L214,246 L240,246" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#ax-arr)"/>
  <!-- TOP LANE: correct -->
  <text x="242" y="40" text-anchor="start" font-size="12.5" font-family="inherit" fill="currentColor" font-weight="700">always_xy=True &#8594; X is longitude</text>
  <rect x="242" y="46" width="190" height="56" rx="8" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="337" y="70" text-anchor="middle" font-size="12" font-family="inherit" fill="currentColor" font-weight="600">Transformer</text>
  <text x="337" y="88" text-anchor="middle" font-size="11.5" font-family="inherit" fill="currentColor">in: (13.40, 52.52)</text>
  <line x1="432" y1="74" x2="466" y2="74" stroke="currentColor" stroke-width="1.5" marker-end="url(#ax-arr)"/>
  <rect x="468" y="46" width="206" height="56" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="571" y="70" text-anchor="middle" font-size="12" font-family="inherit" fill="currentColor" font-weight="600">UTM 33N (x, y)</text>
  <text x="571" y="88" text-anchor="middle" font-size="11.5" font-family="inherit" fill="currentColor">392440, 5820080</text>
  <line x1="674" y1="74" x2="708" y2="74" stroke="currentColor" stroke-width="1.5" marker-end="url(#ax-arr)"/>
  <rect x="710" y="46" width="274" height="56" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="847" y="70" text-anchor="middle" font-size="13" font-family="inherit" fill="currentColor" font-weight="700">&#10003; Valid &#8212; lands on Berlin</text>
  <text x="847" y="88" text-anchor="middle" font-size="11.5" font-family="inherit" fill="currentColor">inside zone extent</text>
  <!-- BOTTOM LANE: wrong -->
  <text x="242" y="226" text-anchor="start" font-size="12.5" font-family="inherit" fill="currentColor" font-weight="700">default &#8594; X read as latitude</text>
  <rect x="242" y="232" width="190" height="56" rx="8" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="337" y="256" text-anchor="middle" font-size="12" font-family="inherit" fill="currentColor" font-weight="600">Transformer</text>
  <text x="337" y="274" text-anchor="middle" font-size="11.5" font-family="inherit" fill="currentColor">reads lat = 13.40</text>
  <line x1="432" y1="260" x2="466" y2="260" stroke="currentColor" stroke-width="1.5" marker-end="url(#ax-arr)"/>
  <rect x="468" y="232" width="206" height="56" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="571" y="256" text-anchor="middle" font-size="12" font-family="inherit" fill="currentColor" font-weight="600">axes swapped</text>
  <text x="571" y="274" text-anchor="middle" font-size="11.5" font-family="inherit" fill="currentColor">lon 52.52 &#8594; off-zone</text>
  <line x1="674" y1="260" x2="708" y2="260" stroke="currentColor" stroke-width="1.5" marker-end="url(#ax-arr)"/>
  <rect x="710" y="232" width="274" height="56" rx="8" fill="none" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="847" y="256" text-anchor="middle" font-size="13" font-family="inherit" fill="currentColor" font-weight="700">&#10007; Out of bounds</text>
  <text x="847" y="274" text-anchor="middle" font-size="11.5" font-family="inherit" fill="currentColor">ocean / inf / nan</text>
</svg>

## Runnable solution

The snippet builds a cached `Transformer`, then streams `(lat, lon)` tuples through it in memory-bounded NumPy chunks, yielding projected `(x, y)` arrays in the target CRS.

```python
import logging
from typing import Iterable, Iterator, Tuple

import numpy as np
from pyproj import CRS, Transformer

logger = logging.getLogger("osm.reproject")

SOURCE_CRS = CRS.from_epsg(4326)            # OSM's implicit WGS 84
TARGET_CRS = CRS.from_epsg(32633)           # UTM Zone 33N — set per study area

# Build ONE transformer per process. Initialization queries the PROJ
# operation database and loads any datum-shift grids, so never rebuild
# it inside a loop or per worker task.
TRANSFORMER = Transformer.from_crs(
    SOURCE_CRS,
    TARGET_CRS,
    always_xy=True,                         # map X<-lon, Y<-lat explicitly
)


def chunk_transform(
    lat_lon_iter: Iterable[Tuple[float, float]],
    transformer: Transformer = TRANSFORMER,
    chunk_size: int = 1_000_000,
) -> Iterator[np.ndarray]:
    """Yield projected (N, 2) float64 arrays in the target CRS.

    Input tuples are (lat, lon) as OSM stores them; they are reordered to
    (lon, lat) before transforming. Memory per chunk is ~16 MB at 1M points.
    """
    buffer: list[Tuple[float, float]] = []

    def _flush(rows: list[Tuple[float, float]]) -> np.ndarray:
        arr = np.asarray(rows, dtype=np.float64)        # columns: lon, lat
        x, y = transformer.transform(arr[:, 0], arr[:, 1])
        out = np.column_stack((x, y))
        finite = np.isfinite(out).all(axis=1)
        if not finite.all():
            logger.warning(
                "dropped %d of %d points outside target CRS extent",
                int((~finite).sum()), out.shape[0],
            )
        return out[finite]

    for lat, lon in lat_lon_iter:
        buffer.append((lon, lat))                        # enforce (x=lon, y=lat)
        if len(buffer) >= chunk_size:
            yield _flush(buffer)
            buffer.clear()
    if buffer:
        yield _flush(buffer)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    nodes = [(52.5200, 13.4050), (48.1372, 11.5755)]     # Berlin, Munich (lat, lon)
    for projected in chunk_transform(nodes):
        logger.info("projected chunk shape=%s sample=%s", projected.shape, projected[0])
```

## Step-by-step walkthrough

1. **CRS construction** — `CRS.from_epsg(4326)` and `CRS.from_epsg(32633)` resolve full WKT definitions from the EPSG registry. Using `from_epsg` rather than a raw proj-string guarantees the datum and ellipsoid are unambiguous.
2. **Transformer caching** — `Transformer.from_crs(...)` is assigned to a module-level `TRANSFORMER`. The constructor performs a database lookup and may load grid-shift files, so it is built once and reused across calls and worker threads.
3. **`always_xy=True`** — this pins argument order to `(longitude, latitude)`, the convention every downstream tool expects, so axis order can never silently flip between PROJ versions.
4. **Axis reordering** — each incoming `(lat, lon)` tuple is appended as `(lon, lat)`, matching the X/Y contract enforced above.
5. **Vectorized flush** — `_flush` builds a `float64` array and calls `transformer.transform` on whole columns, letting PROJ's C routines run without Python per-point overhead.
6. **Finite masking** — `np.isfinite(...).all(axis=1)` drops any row that transformed to `inf`/`nan` (input outside the target CRS extent), and the count is logged rather than silently swallowed.
7. **Bounded streaming** — `chunk_size` caps live memory; at 1,000,000 points a chunk holds roughly 16 MB of `float64`, leaving headroom on a standard worker even when several stages run concurrently. Pair this with [memory-efficient chunk processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) to keep the whole ingestion deterministic on multi-gigabyte extracts.

<figure class="diagram-wrap">
<svg viewBox="0 0 860 232" role="img" aria-labelledby="ppl-anatomy-t ppl-anatomy-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="ppl-anatomy-t">The three stages a pyproj Transformer resolves at construction time</title>
  <desc id="ppl-anatomy-d">A left-to-right chain: source CRS EPSG:4326, then a datum shift from WGS 84 to the target datum, then the projection itself such as transverse Mercator, Lambert azimuthal equal-area or Mercator, ending in projected x and y in metres. A panel below notes that all three stages are resolved once at construction and cached, making the object expensive to build, cheap to call, and something to build per worker after a fork.</desc>
  <rect x="0" y="0" width="860" height="232" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="ppl" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="430" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">What <tspan font-family="monospace">Transformer.from_crs</tspan> actually assembles</text>
  <rect x="24" y="52" width="150" height="62" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="99" y="76" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">source CRS</text>
  <text x="99" y="96" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">EPSG:4326</text>
  <line x1="174" y1="83" x2="212" y2="83" stroke="currentColor" stroke-width="1.5" marker-end="url(#ppl)"/>
  <rect x="214" y="52" width="176" height="62" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="302" y="76" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">datum shift</text>
  <text x="302" y="96" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">WGS 84 → target datum</text>
  <line x1="390" y1="83" x2="428" y2="83" stroke="currentColor" stroke-width="1.5" marker-end="url(#ppl)"/>
  <rect x="430" y="52" width="176" height="62" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="518" y="76" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">projection</text>
  <text x="518" y="96" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">tmerc · laea · merc</text>
  <line x1="606" y1="83" x2="644" y2="83" stroke="currentColor" stroke-width="1.5" marker-end="url(#ppl)"/>
  <rect x="646" y="52" width="188" height="62" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="740" y="76" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">projected (x, y)</text>
  <text x="740" y="96" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">metres</text>
  <rect x="24" y="140" width="810" height="72" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.4"/>
  <text x="429" y="164" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">All three stages are resolved once, at construction — and cached on the object</text>
  <text x="429" y="186" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.9">A Transformer is therefore expensive to build, cheap to call, and safe to reuse for every node in the extract.</text>
  <text x="429" y="204" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.9">It is not thread-safe to share across processes, so build one per worker after the fork, not before.</text>
</svg>
<figcaption>Reuse is safe because the object is immutable once built — but build it <em>inside</em> each worker process. A Transformer created before a fork carries a PROJ context that does not survive the copy cleanly.</figcaption>
</figure>

## Verification

Confirm the reprojection is correct before wiring it into the next stage:

- **Range check.** For UTM Zone 33N, easting (`x`) should sit near 166,000–834,000 m and northing (`y`) be positive in the northern hemisphere. Berlin (`52.52, 13.405`) projects to roughly `x ≈ 392,440`, `y ≈ 5,820,080`.
- **Round-trip residual.** Build the inverse transformer (`Transformer.from_crs(TARGET_CRS, SOURCE_CRS, always_xy=True)`), reproject the output back, and assert the residual is below your tolerance (`< 1e-6` degrees for a clean grid path).
- **Log lines.** A healthy run logs `projected chunk shape=...` and emits no `dropped N of M points` warnings; any drop warning means inputs fell outside the target CRS extent.
- **Sample audit.** Compare a 1% random sample against known control points to confirm sub-meter agreement before trusting downstream metric joins.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Coordinates land in the ocean / wrong hemisphere | Axis order swapped (lat passed as X) | Set `always_xy=True` and feed `(lon, lat)`. |
| Output columns are all `inf` | Point outside the target CRS valid extent (e.g. wrong UTM zone) | Select the UTM zone for the extract centroid, or use EPSG:3035/3857. |
| `CRSError: Invalid projection` | Source CRS never assigned to raw OSM input | Construct with `CRS.from_epsg(4326)` at the ingestion boundary. |
| Throughput collapses on large extracts | Per-node `transform()` calls in a Python loop | Batch into NumPy arrays and transform whole columns. |
| Sub-meter drift vs. control points | Datum-shift grid missing; PROJ fell back | Provision grids in `PROJ_DATA`; set `PROJ_NETWORK=OFF` to fail loudly. |
| `DeprecationWarning` on `Proj`/`transform` | Legacy pyproj 1.x API | Migrate to the `Transformer` API shown above. |

## Specification reference

> OpenStreetMap stores all geometry in WGS 84 (EPSG:4326); the datum is fixed by convention and is not encoded in the data. See the OSM Wiki on [Node](https://wiki.openstreetmap.org/wiki/Node) coordinates and the [EPSG:4326](https://epsg.io/4326) and [EPSG:32633](https://epsg.io/32633) definitions for axis order and valid extents. In PBF, raw integers are reconstructed via `granularity` and `lat_offset`/`lon_offset` before any reprojection — the [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) covers that decode step.

Projected node arrays from this procedure feed directly into the metric stages that follow — most often [spatial indexing for OSM extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/), where R-tree, H3, or Quadkey structures accelerate proximity queries and boundary clipping.

## Frequently Asked Questions

<details>
<summary>Is a Transformer safe to share between threads?</summary>

Reading from one concurrently is safe in current pyproj releases, because the underlying PROJ context is thread-local and the transformation itself does not mutate the object. Sharing across a `fork`, however, is not: the child inherits a context that was created in the parent, and behaviour ranges from a silent slow path to a crash. Build the transformer inside each worker after the fork, which is cheap enough when it happens once per worker and catastrophic when it happens once per point.
</details>

<details>
<summary>Why does pyproj sometimes download grid files?</summary>

Because an accurate datum transformation between some pairs of systems needs a correction grid that is too large to ship with the package. When the grid is missing, PROJ falls back to a less accurate transformation rather than failing, so results differ by metres between a machine with the grid and one without. If reproducibility across environments matters, either pre-fetch the grids with `pyproj sync` and bake them into the image, or pin the transformation explicitly so no fallback is possible.
</details>

<details>
<summary>Should I reproject before or after filtering?</summary>

After. Filtering is usually cheaper in the source system — a bounding-box test in degrees is a comparison, and the same test after projection needs the projection first — and reprojecting fewer points is strictly less work. The exception is a filter expressed in metres, such as "within 500 m of a line", which cannot be evaluated correctly in degrees at all.
</details>

## Related

- [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) — how OSM encodes coordinates and why the CRS is implicit.
- [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/) — index the projected `(x, y)` arrays this page produces.
- [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) — the delta/granularity decode that yields the coordinates you reproject.
- [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — which primitives carry coordinates versus inherit them.
- [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) — bound memory while streaming large extracts through the transformer.
- [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/) — the foundation this stage sits within.

Up one level: [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/).
