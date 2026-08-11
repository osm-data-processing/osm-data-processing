---
pageDescription: "How OpenStreetMap stores coordinates in implicit WGS 84 (EPSG:4326), and how to reproject OSM node arrays to projected CRS with pyproj at extract scale."
---
# Coordinate Reference Systems in OSM

OpenStreetMap standardizes on the WGS 84 geographic coordinate system (EPSG:4326) for every raw spatial primitive it stores. That single architectural decision simplifies global ingestion and keeps community editing tools interoperable, but it pushes a hard problem downstream: raw OSM extracts carry **no explicit projection metadata**, and angular degrees are the wrong unit for almost every metric operation an analytics pipeline needs to perform. The failure scenario is concrete and common. A team buffers building footprints by `25` "units" while the data is still in EPSG:4326, treating degrees as if they were metres; the buffer silently varies from roughly 1.8 km at the equator to under 1 km at 60° latitude, every downstream spatial join is corrupted, and nothing raises an error because degrees and metres are both just `float64`. This page covers how OSM encodes coordinates, why the CRS is implicit, and how to reproject node arrays correctly and reproducibly at extract scale.

Coordinate handling is one stage of a larger ingestion pipeline. It sits downstream of parsing and upstream of spatial indexing, so it inherits assumptions from the [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/) foundation and feeds the [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/) stage that follows.

## Data-flow for the reprojection stage

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 200" style="width:100%;max-width:100%;display:block;margin:1.5rem auto" role="img" aria-label="Reprojection data-flow: an OSM extract in EPSG:4326 is buffered, passed through a pyproj transformer with always_xy true, projected to UTM, LAEA or Web Mercator, then sent to a spatial index or analytic store.">
  <title>Reprojection stage data-flow</title>
  <desc>Five-stage horizontal pipeline. An OSM extract in EPSG:4326 (lat, lon) becomes an (N, 2) float64 buffer, flows through a pyproj Transformer with always_xy=True, emerges as projected (x, y) in UTM, LAEA or Web Mercator, and is handed to a spatial index or analytic store. Two invariants hold across the stage: the source is always EPSG:4326 and axis order is normalized to (longitude, latitude).</desc>
  <defs>
    <marker id="crs-arr" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <rect x="0" y="0" width="1000" height="200" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="500" y="22" text-anchor="middle" font-size="14" font-family="inherit" fill="currentColor" font-weight="700">EPSG:4326 in → projected (x, y) out</text>
  <!-- Box 1: source -->
  <rect x="16" y="48" width="168" height="88" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="100" y="78" text-anchor="middle" font-size="13" font-family="inherit" fill="currentColor" font-weight="600">OSM extract</text>
  <text x="100" y="98" text-anchor="middle" font-size="12" font-family="inherit" fill="currentColor">EPSG:4326</text>
  <text x="100" y="116" text-anchor="middle" font-size="12" font-family="inherit" fill="currentColor">(lat, lon)</text>
  <!-- Box 2: buffer -->
  <rect x="216" y="48" width="168" height="88" rx="8" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="300" y="88" text-anchor="middle" font-size="13" font-family="inherit" fill="currentColor" font-weight="600">Buffer</text>
  <text x="300" y="108" text-anchor="middle" font-size="12" font-family="inherit" fill="currentColor">(N, 2) float64</text>
  <!-- Box 3: transformer (critical) -->
  <rect x="416" y="48" width="168" height="88" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="500" y="88" text-anchor="middle" font-size="13" font-family="inherit" fill="currentColor" font-weight="600">pyproj Transformer</text>
  <text x="500" y="108" text-anchor="middle" font-size="12" font-family="inherit" fill="currentColor">always_xy=True</text>
  <!-- Box 4: projected -->
  <rect x="616" y="48" width="168" height="88" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="700" y="78" text-anchor="middle" font-size="13" font-family="inherit" fill="currentColor" font-weight="600">Projected (x, y)</text>
  <text x="700" y="98" text-anchor="middle" font-size="12" font-family="inherit" fill="currentColor">UTM · LAEA</text>
  <text x="700" y="116" text-anchor="middle" font-size="12" font-family="inherit" fill="currentColor">Web Mercator</text>
  <!-- Box 5: store -->
  <rect x="816" y="48" width="168" height="88" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="900" y="88" text-anchor="middle" font-size="13" font-family="inherit" fill="currentColor" font-weight="600">Spatial index /</text>
  <text x="900" y="108" text-anchor="middle" font-size="12" font-family="inherit" fill="currentColor">analytic store</text>
  <!-- Arrows -->
  <line x1="184" y1="92" x2="214" y2="92" stroke="currentColor" stroke-width="1.5" marker-end="url(#crs-arr)"/>
  <line x1="384" y1="92" x2="414" y2="92" stroke="currentColor" stroke-width="1.5" marker-end="url(#crs-arr)"/>
  <line x1="584" y1="92" x2="614" y2="92" stroke="currentColor" stroke-width="1.5" marker-end="url(#crs-arr)"/>
  <line x1="784" y1="92" x2="814" y2="92" stroke="currentColor" stroke-width="1.5" marker-end="url(#crs-arr)"/>
  <!-- Invariants caption -->
  <text x="500" y="172" text-anchor="middle" font-size="11.5" font-family="inherit" fill="currentColor" opacity="0.85">Invariants: source is always EPSG:4326 · axis order normalized to (longitude, latitude) before transform</text>
</svg>

The stage takes decoded latitude/longitude arrays, validates that they fall inside WGS 84 bounds, selects a target projection appropriate to the analysis, and emits projected `(x, y)` arrays ready for metric work. Everything hinges on two invariants: the source is always EPSG:4326, and axis order must be normalized to `(longitude, latitude)` before transformation.

## Prerequisite concepts

Read these foundations first, because the reprojection stage assumes their output:

- The [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) explains how coordinates are delta-encoded and scaled to integers — the raw values you reproject come out of this layer.
- The [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) defines which primitives actually carry coordinates (nodes) versus which inherit them by reference (ways and relations).
- The [OSM XML vs PBF Comparison](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/) shows how each serialization represents the same WGS 84 values, which determines the precision you start from before any projection step.

## Specification: how OSM encodes coordinates

Coordinates in OpenStreetMap are decimal degrees, but the on-disk representation differs by format and neither format embeds a CRS identifier.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 240" role="img" aria-labelledby="nanodeg-t nanodeg-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="nanodeg-t">Decoding a stored PBF latitude integer into a degree value</title>
  <desc id="nanodeg-d">A four-box flow. A delta-decoded DenseNodes latitude of 521234567 is combined with the block header offset of zero and granularity of 100 to give nanodegrees, then divided by one billion to give 52.1234567 degrees in EPSG:4326, a precision of about eleven millimetres. A side box warns that granularity is a per-file header value, so hardcoding 100 puts coordinates ten times off in a file that declares 1000.</desc>
  <rect x="0" y="0" width="880" height="240" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="nano-arr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">A stored int64 is not a degree until granularity and offset are applied</text>
  <rect x="30" y="52" width="330" height="58" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="195" y="74" text-anchor="middle" font-size="11.5" fill="currentColor" opacity="0.85">PBF DenseNodes.lat[i] — int64, delta-decoded</text>
  <text x="195" y="97" text-anchor="middle" font-size="16" font-weight="700" fill="currentColor" font-family="monospace">521_234_567</text>
  <path d="M195,110 V142" stroke="currentColor" stroke-width="1.5" marker-end="url(#nano-arr)"/>
  <rect x="30" y="144" width="330" height="76" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="195" y="166" text-anchor="middle" font-size="11.5" fill="currentColor" opacity="0.85">apply the header's own constants</text>
  <text x="195" y="188" text-anchor="middle" font-size="12" fill="currentColor" font-family="monospace">(offset + granularity × v)</text>
  <text x="195" y="208" text-anchor="middle" font-size="12" fill="currentColor" font-family="monospace">= (0 + 100 × 521234567) nanodeg</text>
  <path d="M360,182 H432" stroke="currentColor" stroke-width="1.5" marker-end="url(#nano-arr)"/>
  <rect x="434" y="144" width="330" height="76" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="599" y="170" text-anchor="middle" font-size="11.5" fill="currentColor" opacity="0.85">divide by 1e9 → degrees, EPSG:4326</text>
  <text x="599" y="196" text-anchor="middle" font-size="16" font-weight="700" fill="currentColor" font-family="monospace">52.1234567°</text>
  <text x="599" y="213" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.8">7 decimal places ≈ 11 mm at the equator</text>
  <rect x="434" y="52" width="330" height="58" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="599" y="74" text-anchor="middle" font-size="11.5" font-weight="600" fill="currentColor">the trap: granularity is per file</text>
  <text x="599" y="95" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">hardcode 100 and a granularity-1000 file lands 10× off</text>
  <path d="M599,110 V140" stroke="var(--osm-warn,#a16207)" stroke-width="1.5" stroke-dasharray="5 3"/>
</svg>
<figcaption>Every coordinate in a PBF is a scaled integer whose scale lives in the block header, not in the spec. Read <code>granularity</code> and <code>lat_offset</code> from the file you are decoding — never from the last one.</figcaption>
</figure>

In PBF, the `PrimitiveBlock` defines a `granularity` field (default `100`, expressed in nanodegrees) and `lat_offset` / `lon_offset` fields (default `0`). A node's stored integer is delta-encoded against the previous node in its dense group; the real coordinate is reconstructed as:

$$ \text{lat} = 10^{-9} \cdot (\text{lat\_offset} + \text{granularity} \cdot \text{lat}_{\text{int}}) $$

With the default granularity of 100 nanodegrees, the coordinate quantum is `1e-7` degrees — roughly 1.1 cm of latitude at the equator, far finer than any survey-grade source OSM ingests. Integer storage keeps parsing in fast integer arithmetic and lets delta-encoding compress monotonic ID-ordered nodes. The WGS 84 datum is assumed by strict convention; storing a spatial reference string against hundreds of millions of primitives would be pure overhead.

In OSM XML, the same value appears as a human-readable `lat="..."` / `lon="..."` attribute with up to seven decimal places. The convenience costs parsing throughput and memory, and again no projection is declared anywhere in the document.

The practical consequence: an ETL pipeline must **assign** EPSG:4326 explicitly at the ingestion boundary. This matters most when OSM data is merged with municipal datasets that default to a local state plane or UTM zone — without an explicit source CRS, a reprojection library has nothing to transform *from* and will either error or, worse, pass the coordinates through unchanged.

## Step-by-step: reproject an OSM node array

The following procedure turns validated WGS 84 arrays into a projected CRS suitable for metric operations.

1. **Validate bounds at the ingestion boundary.** Before any transformation, confirm every coordinate pair falls inside the valid WGS 84 envelope and flag outliers, which almost always indicate parsing corruption or a botched delta-decode:

$$ -90 \le \phi \le 90,\quad -180 \le \lambda \le 180 $$

where $\phi$ is latitude and $\lambda$ is longitude.

2. **Select the target projection.** For local metric accuracy, pick the UTM zone covering the extract's centroid; for continental equal-area statistics, use a Lambert Azimuthal Equal-Area (LAEA) CRS such as EPSG:3035 (Europe); for slippy-map tiles, use Web Mercator (EPSG:3857). The UTM zone for a given longitude follows:

$$ \text{zone} = \left\lfloor \frac{\lambda + 180}{6} \right\rfloor + 1 $$

3. **Initialize a reusable transformer.** Build one `Transformer` per process and enforce `(longitude, latitude)` ordering so axis conventions can never silently swap.

4. **Transform in memory-bounded chunks.** Stream node arrays through the transformer in fixed-size chunks to keep the memory footprint deterministic regardless of extract size.

```python
import numpy as np
import logging
from pyproj import Transformer, CRS
from pyproj.exceptions import ProjError

logger = logging.getLogger("osm_crs_etl")

def initialize_transformer(target_epsg: int) -> Transformer:
    """
    Initialize a thread-safe, reusable pyproj Transformer.
    Enforces (longitude, latitude) ordering to prevent axis-swap errors.
    """
    try:
        target_crs = CRS.from_epsg(target_epsg)
        transformer = Transformer.from_crs(
            "EPSG:4326", target_crs, always_xy=True
        )
        logger.info("Initialized transformer: EPSG:4326 -> EPSG:%d", target_epsg)
        return transformer
    except ProjError as e:
        raise RuntimeError("CRS initialization failed. Verify PROJ data availability.") from e

def transform_node_batch(
    transformer: Transformer,
    latitudes: np.ndarray,
    longitudes: np.ndarray,
    chunk_size: int = 500_000
) -> tuple[np.ndarray, np.ndarray]:
    """
    Vectorized coordinate transformation for OSM node arrays.
    Processes in memory-efficient chunks to prevent OOM failures on large extracts.
    Expects both arrays to have the same shape.
    """
    if latitudes.shape != longitudes.shape:
        raise ValueError("Latitude and longitude arrays must have identical shapes.")

    x_out = np.empty_like(latitudes, dtype=np.float64)
    y_out = np.empty_like(longitudes, dtype=np.float64)

    total_points = len(latitudes)
    for start in range(0, total_points, chunk_size):
        end = min(start + chunk_size, total_points)
        try:
            # pyproj with always_xy=True: first arg is longitude (x), second is latitude (y).
            cx, cy = transformer.transform(
                longitudes[start:end], latitudes[start:end]
            )
            x_out[start:end] = cx
            y_out[start:end] = cy
        except ProjError as e:
            logger.warning(
                "Transformation failed for chunk %d:%d — filling NaN. Error: %s",
                start, end, e
            )
            x_out[start:end] = np.nan
            y_out[start:end] = np.nan

    return x_out, y_out
```

The `always_xy=True` parameter is non-negotiable in modern PROJ versions. It enforces `(longitude, latitude)` input ordering regardless of how the EPSG registry defines the axis sequence for the source CRS, eliminating the silent axis-swap bugs that historically corrupted spatial joins. For an end-to-end implementation with grid management, worker caching, and cadastral-grade accuracy checks, see [Converting OSM coordinates to local CRS with PyProj](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/converting-osm-coordinates-to-local-crs-with-pyproj/).

## Validation and error-handling matrix

Coordinate transformation fails in a small number of recurring ways. Detect each at the boundary and remediate without halting the run.

| Error condition | Root cause | Detection method | Remediation |
| --- | --- | --- | --- |
| Coordinates appear swapped (lat in x slot) | `always_xy` omitted; relied on EPSG axis order | Round-trip deviates by whole degrees; points land in the ocean | Set `always_xy=True` on every `Transformer.from_crs` call |
| `ProjError` on a chunk | Point outside target projection's valid band (e.g. UTM ±6° envelope) | Exception raised mid-transform | Catch per-chunk, fill `NaN`, log array indices, route to quarantine |
| Latitude `> 90` / longitude `> 180` | Corrupt delta-decode or malformed offset/granularity | Bounds assertion at ingestion | Reject node, re-derive from `granularity` + `lat_offset` |
| Silent datum drift | Legacy NAD27/ED50 shift applied to a WGS 84 target | Compare WKT operation path against expected authority chain | Pin EPSG codes; assert `to_wkt()` matches reviewed transform |
| `PROJ_DATA not found` / missing grid | `PROJ_LIB`/`PROJ_DATA` unset or grid file absent | `ProjError` at transformer init | Provision grids; set `PROJ_NETWORK=OFF` in air-gapped runs |
| Distorted areas/distances near high latitudes | Web Mercator used for metric analysis | Computed areas inflate poleward | Switch to UTM or an equal-area CRS (LAEA) for metrics |

## Performance and scale considerations

Large OSM extracts routinely exceed available RAM when loaded as monolithic DataFrames. Chunked transformation, as shown above, holds the memory footprint flat regardless of extract size — a planet-scale node stream and a city extract use the same per-chunk allocation. Two practices keep throughput high:

- **Reuse one transformer.** `Transformer.from_crs` performs a database lookup and may load grid shift files; instantiating it per chunk destroys throughput. Build it once and share it across worker threads (the object is thread-safe for `transform`).
- **Stream, don't materialize.** When feeding a spatial database or a tile generator, write transformed coordinates straight to disk or DB buffers through generators instead of holding intermediate arrays. This is the same memory discipline applied in [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/).

`pyproj` vectorizes over NumPy arrays internally, so a 500,000-point chunk transforms in a single call rather than a Python loop — keep chunks large enough to amortize call overhead but small enough to bound peak memory.

## Failure modes and gotchas

- **Axis order is the silent killer.** Every other gotcha announces itself with an exception; an axis swap produces plausible-looking numbers that quietly place features on the wrong continent. Treat `always_xy=True` as a hard invariant and assert it in tests.
- **UTM zone boundaries.** A regional extract straddling two UTM zones (e.g. data spanning longitude 12°E) cannot share a single zone without distortion at the edges. Either clip per zone or choose an equal-area CRS that covers the whole region.
- **Granularity is not always the default.** Some producers set non-default `granularity` or non-zero `lat_offset`/`lon_offset` in the PBF block. Hard-coding `1e-7` instead of reading the block fields yields a constant positional shift.
- **Web Mercator for analytics.** EPSG:3857 is a visualization projection; using it for area or distance computation inflates measurements toward the poles. Keep it for tiles only.

<figure class="diagram-wrap">
<svg viewBox="0 0 864 240" role="img" aria-labelledby="axis-order-t axis-order-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="axis-order-t">Axis-order confusion moves a Berlin node thousands of kilometres</title>
  <desc id="axis-order-d">Two panels compare the same Berlin node passed through a pyproj transformer. On the left, always_xy=True takes longitude 13.405 then latitude 52.520 and places the point correctly in Berlin at UTM zone 33 north. On the right, the authority axis order takes the same two numbers in the opposite sense, placing the point roughly 4300 kilometres to the south-east. Neither call raises an exception.</desc>
  <rect x="0" y="0" width="864" height="240" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="axo" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">The same node, two axis conventions — one lands in the Indian Ocean</text>
  <rect x="26" y="48" width="392" height="176" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="222" y="72" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">always_xy=True — (lon, lat) in</text>
  <text x="222" y="96" text-anchor="middle" font-size="12" font-family="monospace" fill="currentColor">transform(13.405, 52.520)</text>
  <line x1="60" y1="150" x2="384" y2="150" stroke="currentColor" stroke-width="1"/>
  <line x1="222" y1="118" x2="222" y2="196" stroke="currentColor" stroke-width="1"/>
  <text x="380" y="144" text-anchor="end" font-size="9.5" fill="currentColor" opacity="0.7">+lon</text>
  <text x="228" y="126" font-size="9.5" fill="currentColor" opacity="0.7">+lat</text>
  <circle cx="252" cy="128" r="6" fill="var(--osm-ok,#15803d)"/>
  <text x="266" y="132" font-size="11.5" font-weight="600" fill="currentColor">Berlin ✓</text>
  <text x="222" y="214" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">UTM 33N → 392 023 E, 5 819 766 N</text>
  <rect x="446" y="48" width="392" height="176" rx="8" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.5"/>
  <text x="642" y="72" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">default authority order — (lat, lon) in</text>
  <text x="642" y="96" text-anchor="middle" font-size="12" font-family="monospace" fill="currentColor">transform(52.520, 13.405)</text>
  <line x1="480" y1="150" x2="804" y2="150" stroke="currentColor" stroke-width="1"/>
  <line x1="642" y1="118" x2="642" y2="196" stroke="currentColor" stroke-width="1"/>
  <text x="800" y="144" text-anchor="end" font-size="9.5" fill="currentColor" opacity="0.7">+lon</text>
  <text x="648" y="126" font-size="9.5" fill="currentColor" opacity="0.7">+lat</text>
  <circle cx="738" cy="164" r="6" fill="var(--osm-bad,#b91c1c)"/>
  <text x="730" y="182" text-anchor="end" font-size="11.5" font-weight="600" fill="currentColor">≈ 4 300 km south-east ✗</text>
  <text x="642" y="214" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">no exception raised — the numbers are simply wrong</text>
</svg>
<figcaption>Nothing in the API distinguishes the two calls — both take two floats and return two floats. Set <code>always_xy=True</code> once at transformer construction and the ambiguity is gone for the life of the pipeline.</figcaption>
</figure>

## Integration with the next pipeline stage

The output of this stage — validated, projected `(x, y)` arrays plus a recorded source/target EPSG pair — feeds directly into spatial indexing. A common pattern is to *index in native WGS 84 and defer projection to the query or export boundary*, which keeps the index portable across analyses; reproject only the working set a query returns. The wiring is small:

```python
# Index stays in EPSG:4326; reproject only on export for metric work.
transformer = initialize_transformer(32633)  # UTM 33N for central Europe

def export_metric(node_ids, lats, lons):
    xs, ys = transform_node_batch(transformer, lats, lons)
    # xs, ys are now metres — safe for buffering, area, distance, joins.
    return node_ids, xs, ys
```

From here the projected arrays are handed to the index build described in [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/), or to the normalization stages in [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/) when attributes must travel alongside geometry.

## Reproducibility and validation standards

Reproducible spatial ETL depends on deterministic transformation chains. Record the exact source and target EPSG codes and the PROJ version used for every run, and gate the pipeline on three checks:

1. **Round-trip verification.** Transform to the projected CRS and back to EPSG:4326; deviation should stay below 1 mm for standard datums.
2. **Topology preservation.** Confirm node adjacency and way connectivity survive transformation intact.
3. **Datum-shift auditing.** Ensure no legacy NAD27 or ED50 shift is inadvertently applied when targeting modern WGS 84 derivatives.

For authoritative grid-management and transformation guidance, consult the [PROJ documentation](https://proj.org/), and for OSM-specific precision and bounding-box conventions, the [OpenStreetMap Wiki coordinates reference](https://wiki.openstreetmap.org/wiki/Coordinates).

## Choosing a projection for the work at hand

Reprojection is not one decision but three, and conflating them is the usual source of results that are subtly wrong rather than obviously broken.

The first decision is whether to project at all. Distances, areas and buffers computed directly on EPSG:4326 degrees are meaningless: a degree of longitude is about 111 kilometres at the equator and 55 in Copenhagen, so a "0.001 degree buffer" is a different distance in every row of the table. If the output involves any measurement, the data has to be in a projected system with metre units. If the output is only a map tile or a point-in-polygon test against a polygon in the same system, it does not.

The second is which family of projection fits the question. An equal-area projection such as Lambert azimuthal preserves area at the cost of shape and is the right choice for anything aggregated by region — population density, landuse totals, coverage percentages. A conformal projection such as transverse Mercator preserves local angles and shape and is the right choice for routing, navigation and anything that cares about bearings. Web Mercator preserves neither at scale and is the right choice for exactly one thing: matching the tile scheme every web map already uses. Choosing Web Mercator because it is the default and then computing areas in it produces figures that are wrong by a factor of two at high latitudes.

The third is the zone or centre. A transverse Mercator projection is accurate in a band a few degrees wide either side of its central meridian and degrades quickly outside it, which is why UTM is divided into sixty zones. An extract that spans several zones cannot be projected into one of them without distortion at the edges, and the honest options are to project per-zone and handle the seams, or to use a single equal-area projection centred on the extract and accept the shape distortion.

A practical rule covers most OSM pipelines. Store and exchange in EPSG:4326, because that is what the data is and what every consumer expects. Project on the way into a measurement, choosing the family from the measurement rather than from convention. Never store a projected geometry as the only copy of a feature, because the projection is a lossy view of it and the zone you chose today is not the zone the next question needs.

The cost of getting this wrong is that nothing fails. A buffer in degrees returns a polygon, an area in Web Mercator returns a number, and a routing graph built from a mis-zoned projection routes. The error surfaces as a metric that disagrees with an official figure by a percentage nobody can explain, months later.

## Round-tripping and what it proves

A reprojection is reversible only in the sense that floating point allows, and testing that reversibility is the cheapest correctness check available. Project a set of known points forward and back, and the maximum displacement over the set is a direct measure of the pipeline's numerical health: sub-millimetre is expected, centimetres mean a datum grid is missing on one side, and anything larger means the two transformers are not inverses of each other — usually because one was built with `always_xy` and the other without.

Keep the round-trip fixture small and geographically spread: a handful of points near the extract's corners, one near its centre, and one deliberately outside the projection's valid band. The last of those is the interesting one, because a transverse Mercator projection does not fail outside its zone, it simply becomes inaccurate, and watching the round-trip error grow from millimetres to metres as a test point moves away from the central meridian is the clearest demonstration of why zone choice matters that a pipeline can produce for itself.

Record the transformation actually used alongside the output, not just the target code. Two pipelines both claiming EPSG:25832 can differ by metres if one had a datum grid available and the other silently fell back, and the only way to tell them apart afterwards is if each wrote down which pipeline PROJ selected. `Transformer.description` gives that string in one line and costs nothing to store.

## Go deeper

- [Converting OSM coordinates to local CRS with PyProj](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/converting-osm-coordinates-to-local-crs-with-pyproj/) — a complete, production-tested reprojection implementation with worker caching, grid provisioning, and accuracy verification.

## Related

- [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/) — the foundation this stage belongs to.
- [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) — how granularity, offsets, and delta-encoding produce the coordinates you reproject.
- [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/) — the stage that consumes projected coordinates.
- [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — which primitives carry coordinates and which inherit them.
- [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) — the chunking discipline applied across the pipeline.

Up one level: [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/).
