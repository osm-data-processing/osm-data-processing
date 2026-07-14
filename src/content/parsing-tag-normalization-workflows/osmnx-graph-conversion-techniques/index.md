---
title: "OSMnx Graph Conversion Techniques"
description: "Convert normalized OpenStreetMap ways into deterministic, topology-validated NetworkX routing graphs with OSMnx — custom filters, projection, tag normalization, and validation gates."
pageDescription: "OSMnx graph conversion for production routing: custom_filter extraction, UTM projection, regex tag normalization, edge-speed imputation, topology validation, and memory-aware scaling."
slug: osmnx-graph-conversion-techniques
type: guide
breadcrumb: "OSMnx Graph Conversion"
datePublished: 2025-09-12
dateModified: 2026-06-26
date: 2026-06-26
---
# OSMnx Graph Conversion Techniques

Turning raw OpenStreetMap ways into a deterministic, topology-validated `networkx.MultiDiGraph` is the step where a normalization pipeline either earns or loses the trust of every routing engine downstream. OSMnx is the most accessible abstraction for this conversion, but its defaults are tuned for exploratory notebooks, not production spatial ETL: it retains permissive tags, preserves every degree-2 node, leaves `maxspeed` as free-text strings, and keeps disconnected subgraphs that quietly break shortest-path queries. The concrete failure scenario is familiar — an A* call returns `NetworkXNoPath` for two points that are obviously connected on the map, because the source node landed in a 3-edge island that survived extraction, or travel times come back as `inf` because `"50;30"` never parsed to a float. This page shows how to convert OSM ways into routing-ready graphs that behave identically across reruns, regions, and machines.

<svg viewBox="0 0 820 320" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Data-flow diagram of OSMnx graph conversion: cleaned OSM ways feed ox.graph_from_bbox or graph_from_gdfs, then ox.simplify_graph merges degree-2 nodes, then ox.project_graph reprojects from EPSG:4326 to a UTM zone, then edge weights for length and travel_time are computed, and finally A-star or Dijkstra routing consumes the graph" style="width:100%;max-width:820px;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>OSMnx Graph Conversion Data Flow</title>
  <desc>A six-stage pipeline arranged as a snake. Top row left to right: cleaned OSM ways as a GeoDataFrame, ox.graph_from_bbox or graph_from_gdfs, and ox.simplify_graph which merges degree-2 nodes. The flow drops down the right side into the bottom row, which runs right to left: ox.project_graph reprojecting EPSG:4326 to the UTM zone, edge weights computing length and travel_time, and finally A-star or Dijkstra routing.</desc>
  <defs>
    <marker id="arrOx" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <g fill="none" stroke="currentColor" stroke-width="1.5">
    <rect x="20"  y="50"  width="230" height="70" rx="7"/>
    <rect x="295" y="50"  width="230" height="70" rx="7"/>
    <rect x="570" y="50"  width="230" height="70" rx="7"/>
    <rect x="570" y="200" width="230" height="70" rx="7"/>
    <rect x="295" y="200" width="230" height="70" rx="7"/>
    <rect x="20"  y="200" width="230" height="70" rx="7"/>
  </g>
  <g text-anchor="middle" fill="currentColor" font-size="13">
    <text x="135" y="80">Cleaned OSM ways</text>
    <text x="135" y="100" font-size="11" opacity="0.75">(GeoDataFrame)</text>
    <text x="410" y="80">ox.graph_from_bbox /</text>
    <text x="410" y="100" font-size="11" opacity="0.75">graph_from_gdfs</text>
    <text x="685" y="80">ox.simplify_graph</text>
    <text x="685" y="100" font-size="11" opacity="0.75">merge degree-2 nodes</text>
    <text x="685" y="230">ox.project_graph</text>
    <text x="685" y="250" font-size="11" opacity="0.75">EPSG:4326 &#8594; UTM zone</text>
    <text x="410" y="230">Edge weights</text>
    <text x="410" y="250" font-size="11" opacity="0.75">length &#183; travel_time</text>
    <text x="135" y="230">A* / Dijkstra</text>
    <text x="135" y="250" font-size="11" opacity="0.75">routing</text>
  </g>
  <g fill="none" stroke="currentColor" stroke-width="1.6">
    <line x1="250" y1="85"  x2="288" y2="85"  marker-end="url(#arrOx)"/>
    <line x1="525" y1="85"  x2="563" y2="85"  marker-end="url(#arrOx)"/>
    <path d="M685,120 L685,200" marker-end="url(#arrOx)"/>
    <line x1="570" y1="235" x2="532" y2="235" marker-end="url(#arrOx)"/>
    <line x1="295" y1="235" x2="257" y2="235" marker-end="url(#arrOx)"/>
  </g>
</svg>

## Prerequisite concepts

Graph conversion assumes the upstream stages of the [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/) pipeline have already produced clean, typed input. Three foundations in particular must be in place first. You need a working grasp of the [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/), because OSMnx builds nodes from OSM nodes and edges from the ordered node references inside each way — the topology you get out is only as good as the way membership you feed in. You need the controlled vocabularies described in [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/), since the `highway`, `maxspeed`, `oneway`, and `surface` keys drive every routing weight. And because edge length is meaningless in degrees, you must understand projection from the work on [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) before any distance- or time-based weight is computed.

## Specification & format reference

OSMnx encodes a street network as a directed multigraph whose attribute schema is fixed enough to validate against. The fields that matter for routing are:

| Attribute | Lives on | Type after normalization | Source OSM key | Routing role |
|-----------|----------|--------------------------|----------------|--------------|
| `x`, `y` | node | float (CRS units) | node lon/lat | geometry, snapping |
| `osmid` | node / edge | int or list[int] | element id | provenance |
| `length` | edge | float (metres) | computed from geometry | distance weight |
| `highway` | edge | str | `highway` | class, speed lookup |
| `maxspeed` | edge | float (km/h) | `maxspeed` | speed input |
| `speed_kph` | edge | float | imputed | travel-time input |
| `travel_time` | edge | float (seconds) | computed | time weight |
| `oneway` | edge | int (-1/0/1) | `oneway` | directionality |
| `reversed` | edge | bool | derived | edge orientation |

Two encoding rules trip up most pipelines. First, OSMnx stores parallel edges between the same node pair under integer `key` values (0, 1, 2 …) — this is why iteration must use `G.edges(keys=True)`; ignoring the key collapses dual carriageways and turn lanes. Second, `length` is computed in the graph's current CRS, so a `length` derived before projection is in degrees and silently wrong. Project first, then compute or trust `length`.

Travel time per edge is derived from `length` (metres) and `maxspeed` (km/h):

$$ t_{\text{edge}} = \frac{\text{length}_\text{m}}{\text{maxspeed}_{\text{km/h}} \times \tfrac{1000}{3600}} \;=\; \frac{\text{length}_\text{m}}{\text{maxspeed}_{\text{km/h}} \times 0.2778}\ \text{seconds} $$

## Step-by-step implementation

### 1. Memory-aware extraction with explicit filters

OSMnx defaults to permissive tag retention and full topology preservation. Production pipelines must initialize extraction with an explicit `custom_filter` to restrict edge creation to routing-relevant OSM keys, and disable `retain_all` so disconnected subgraphs are pruned during extraction — reducing both downstream QA overhead and peak memory.

```python
import logging
import networkx as nx
import numpy as np
import osmnx as ox

logger = logging.getLogger(__name__)

# Overpass-style filter accepted by osmnx.
CUSTOM_FILTER = (
    '["highway"~"motorway|trunk|primary|secondary|tertiary|residential|'
    'unclassified|service|living_street|track"]'
)


def load_routing_graph(bbox: tuple[float, float, float, float]) -> nx.MultiDiGraph:
    """Extract, filter, and validate an OSMnx graph from a bounding box.

    bbox format for osmnx >= 2.0: (left, bottom, right, top) i.e.
    (min_lon, min_lat, max_lon, max_lat). Check your osmnx version;
    earlier versions used (north, south, east, west).
    """
    try:
        G = ox.graph_from_bbox(
            bbox=bbox,
            custom_filter=CUSTOM_FILTER,
            simplify=True,
            retain_all=False,
        )
        logger.info("Extracted %d nodes, %d edges.", G.number_of_nodes(), G.number_of_edges())
        return G
    except Exception as e:
        logger.error("Graph extraction failed for bbox %s: %s", bbox, e)
        raise
```

When the upstream stage has already produced GeoDataFrames — for example via [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/) — skip the Overpass round-trip entirely and feed cleaned nodes and edges straight into `ox.graph_from_gdfs(gdf_nodes, gdf_edges)`. This decouples ingestion from the OSM API, removes rate-limit exposure, and lets you tile regions in parallel.

### 2. Project before you weight

Projection must occur immediately after extraction to ensure accurate edge length calculations. Use `ox.project_graph(G)` to auto-detect the optimal UTM zone, or `ox.project_graph(G, to_crs="EPSG:32633")` to pin a fixed zone so every regional tile lands in the same CRS before merging.

```python
def project_and_weight(G: nx.MultiDiGraph, to_crs: str | None = None) -> nx.MultiDiGraph:
    """Project to a metric CRS, then impute speeds and travel times."""
    G = ox.project_graph(G, to_crs=to_crs) if to_crs else ox.project_graph(G)
    G = ox.add_edge_speeds(G)        # imputes speed_kph from highway-class table
    G = ox.add_edge_travel_times(G)  # length / speed_kph -> travel_time (seconds)
    return G
```

`ox.add_edge_speeds(G)` imputes missing `maxspeed` from highway-class lookup tables and writes `speed_kph`; `ox.add_edge_travel_times(G)` then computes `travel_time` in seconds. Pin the UTM zone explicitly for any multi-region run so two adjacent tiles never get auto-assigned to different zones.

### 3. Deterministic tag normalization

OSMnx preserves raw OSM tags as string attributes. Before any weight is computed, those strings must be coerced deterministically — the same logic explored in depth in [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/), applied here at the edge level.

```python
import re


def normalize_edge_attributes(G: nx.MultiDiGraph) -> nx.MultiDiGraph:
    """Apply regex cleaning, type coercion, and fallback imputation to edge data."""
    speed_pattern = re.compile(r"(\d+(?:\.\d+)?)\s*(?:km/h|kmh|kph)?", re.IGNORECASE)
    oneway_map = {"yes": 1, "true": 1, "1": 1, "no": 0, "false": 0, "0": 0, "-1": -1}

    for u, v, k, data in G.edges(data=True, keys=True):
        # Normalize maxspeed — OSM stores values like "50", "30 mph", "50;30".
        raw_speed = data.get("maxspeed")
        if isinstance(raw_speed, list):          # tag conflict: take the minimum
            raw_speed = min(raw_speed, key=lambda s: float(speed_pattern.search(str(s)).group(1)))
        if raw_speed and isinstance(raw_speed, str):
            match = speed_pattern.search(raw_speed)
            data["maxspeed"] = float(match.group(1)) if match else np.nan
        elif not isinstance(raw_speed, (int, float)):
            data["maxspeed"] = np.nan

        # Normalize oneway
        raw_oneway = str(data.get("oneway", "no")).lower()
        data["oneway"] = oneway_map.get(raw_oneway, 0)

        # Standardize surface class
        surface = str(data.get("surface", "unknown")).lower()
        if surface in ("paved", "asphalt", "concrete", "sett", "cobblestone"):
            data["surface_class"] = "paved"
        elif surface in ("unpaved", "gravel", "dirt", "sand", "grass"):
            data["surface_class"] = "unpaved"
        else:
            data["surface_class"] = "unknown"

    return G
```

The list branch is the subtle one: when a way carries multiple `maxspeed` values (e.g. `["50", "30"]`), OSMnx hands you a Python list, not a string, and a naive `.search()` raises `TypeError`. Resolving conservatively to the minimum keeps routing safe. For authoritative tagging semantics, consult the [OpenStreetMap Wiki Map Features](https://wiki.openstreetmap.org/wiki/Map_Features).

### 4. Topology and attribute validation gates

Large extracts frequently carry malformed geometries, missing mandatory tags, or topological inconsistencies that cause silent failures downstream.

```python
def validate_graph_topology(G: nx.MultiDiGraph) -> nx.MultiDiGraph:
    """Enforce routing-ready topology and attribute completeness.

    Returns the (possibly pruned) graph. Raises ``ValueError`` when attribute
    coverage falls below the configured threshold.
    """
    if not nx.is_weakly_connected(G):
        logger.warning("Graph has disconnected components. Pruning isolated subgraphs.")
        largest_cc = max(nx.weakly_connected_components(G), key=len)
        G = G.subgraph(largest_cc).copy()

    missing_speeds = sum(
        1 for _, _, d in G.edges(data=True)
        if np.isnan(float(d.get("maxspeed", float("nan"))))
    )
    coverage_gap = missing_speeds / max(G.number_of_edges(), 1)
    if coverage_gap > 0.35:
        raise ValueError(
            f"Excessive missing maxspeed values ({coverage_gap:.0%}). "
            "Run ox.add_edge_speeds() before validation."
        )

    logger.info("Topology and attribute validation passed.")
    return G
```

Use deterministic random seeds for any stochastic imputation step so the validation verdict is reproducible across reruns. For broader graph manipulation patterns, refer to the official [NetworkX documentation](https://networkx.org/documentation/stable/).

## Validation & error-handling matrix

| Error condition | Root cause | Detection method | Remediation |
|-----------------|------------|------------------|-------------|
| `NetworkXNoPath` on connected-looking points | source/target in a pruned island | `nx.is_weakly_connected(G)` | keep largest weakly-connected component, snap to it |
| `travel_time == inf` | `maxspeed` NaN, `speed_kph` zero | scan edges for non-finite weights | run `ox.add_edge_speeds()` then `add_edge_travel_times()` |
| `TypeError` in speed parse | `maxspeed` is a list, not str | type-check before regex | resolve conflicting tags to the minimum |
| edge `length` in degrees | weighting ran before projection | check `G.graph["crs"]` is metric | call `ox.project_graph()` first |
| dual carriageway collapsed | iterating without `keys=True` | compare edge count pre/post | use `G.edges(data=True, keys=True)` |
| `Overpass 429 / timeout` | API rate limiting | catch on extraction | retry with backoff, or switch to `graph_from_gdfs` |
| nondeterministic graphs across runs | unseeded imputation / API drift | hash node+edge sets | seed RNG, pin source extract checksum |

## Performance & scale considerations

For continental-scale pipelines, preprocessing raw `.osm.pbf` files before graph construction dramatically improves throughput. Streaming primitives into memory-mapped buffers, filtering at the byte level, and feeding cleaned GeoDataFrames directly into `ox.graph_from_gdfs` decouples extraction from conversion, reducing peak RAM and enabling parallel regional tiling — the chunking patterns in [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) apply directly here.

Practical scaling levers:

1. **Chunked processing with checkpointing.** Divide large bounding boxes into non-overlapping grid cells driven by the tiling scheme in [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/). Persist each processed tile to disk before merging, and resume from the last successful checkpoint rather than restarting the full extract.
2. **Memory-mapped serialization.** Persist projected subgraphs with `pickle` (protocol 5, with `buffer_callback`) or serialize edge lists to Parquet so large graphs round-trip without loading the entire structure into contiguous RAM.
3. **Idempotent execution.** Hash input extract checksums and graph configuration parameters to cache results and prevent redundant recomputation.

`ox.simplify_graph` is the single biggest size lever: merging interstitial degree-2 nodes routinely removes 60-80% of nodes on dense urban grids while preserving routing geometry, so simplify before you serialize.

## Failure modes & gotchas

- **Auto-UTM drift across tiles.** `ox.project_graph(G)` picks the zone from the graph's centroid; two adjacent tiles can land in different zones and fail to merge cleanly. Pin `to_crs` for any multi-tile run.
- **`simplify=True` after manual edits.** Calling `ox.simplify_graph` twice raises, and editing geometry before simplification can strip attributes you set. Normalize and weight *after* simplification.
- **Bbox argument order.** OSMnx ≥ 2.0 expects `(left, bottom, right, top)`; pre-2.0 code passing `(north, south, east, west)` silently extracts the wrong region.
- **`retain_all=False` over-pruning.** On sparse rural extracts the "largest component" can discard legitimately reachable hamlets connected only by ferries or tracks excluded by the filter. Audit component sizes before trusting the prune.
- **String weights reaching the solver.** If `add_edge_travel_times` never ran, `travel_time` is absent and `nx.shortest_path(..., weight="travel_time")` falls back to hop count, returning plausible-but-wrong routes.

## Integration points

The conversion's output — a projected, normalized, validated `MultiDiGraph` — is the direct input to routing and isochrone computation. Wire the stages into one idempotent entry point:

```python
def build_graph(bbox: tuple[float, float, float, float], crs: str = "EPSG:32633") -> nx.MultiDiGraph:
    """End-to-end: extract -> normalize -> project -> weight -> validate."""
    G = load_routing_graph(bbox)
    G = normalize_edge_attributes(G)
    G = project_and_weight(G, to_crs=crs)
    G = validate_graph_topology(G)
    return G


# Downstream routing consumes travel_time directly.
G = build_graph((11.50, 48.10, 11.62, 48.18))
orig = ox.distance.nearest_nodes(G, X=11.55, Y=48.14)
dest = ox.distance.nearest_nodes(G, X=11.60, Y=48.16)
route = nx.shortest_path(G, orig, dest, weight="travel_time")
```

Records that fail normalization or validation should not be dropped silently; route them to the same dead-letter discipline used in [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/), and reconcile the canonical attribute names against the registries defined in [Batch Attribute Mapping Strategies](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/) so the graph's edge schema matches every other store in the pipeline.

<svg viewBox="0 0 900 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="End-to-end build_graph lifecycle: extract, normalize, project, weight, and validate stages run left to right into a routing-ready MultiDiGraph. Records that fail normalization or validation branch downward into a shared dead-letter queue rather than being dropped silently." style="width:100%;max-width:900px;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>build_graph Lifecycle with Dead-Letter Branch</title>
  <desc>Five numbered process stages run left to right: 1 extract via graph_from_bbox or gdfs, 2 normalize edge tags with regex coercion, 3 project to a pinned UTM CRS, 4 weight edges with speed and travel_time, and 5 validate by keeping the largest weakly-connected component. The pipeline ends in a routing-ready MultiDiGraph output. Dashed branches drop from the normalize and validate stages into a single dead-letter queue at the bottom, capturing records that fail normalization or validation so none are dropped silently.</desc>
  <defs>
    <marker id="arrLc" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <g fill="none" stroke="currentColor" stroke-width="1.5">
    <rect x="16"  y="58" width="128" height="64" rx="7"/>
    <rect x="164" y="58" width="128" height="64" rx="7"/>
    <rect x="312" y="58" width="128" height="64" rx="7"/>
    <rect x="460" y="58" width="128" height="64" rx="7"/>
    <rect x="608" y="58" width="128" height="64" rx="7"/>
    <rect x="756" y="58" width="128" height="64" rx="9" stroke-width="2"/>
  </g>
  <g text-anchor="middle" fill="currentColor" font-size="12.5">
    <text x="80"  y="84">1 · Extract</text>
    <text x="228" y="84">2 · Normalize</text>
    <text x="376" y="84">3 · Project</text>
    <text x="524" y="84">4 · Weight</text>
    <text x="672" y="84">5 · Validate</text>
    <text x="820" y="84">Routing graph</text>
  </g>
  <g text-anchor="middle" fill="currentColor" font-size="10.5" opacity="0.75">
    <text x="80"  y="104">bbox / gdfs</text>
    <text x="228" y="104">regex tags</text>
    <text x="376" y="104">UTM CRS</text>
    <text x="524" y="104">speed · time</text>
    <text x="672" y="104">largest CC</text>
    <text x="820" y="104">MultiDiGraph</text>
  </g>
  <g fill="none" stroke="currentColor" stroke-width="1.6">
    <line x1="144" y1="90" x2="162" y2="90" marker-end="url(#arrLc)"/>
    <line x1="292" y1="90" x2="310" y2="90" marker-end="url(#arrLc)"/>
    <line x1="440" y1="90" x2="458" y2="90" marker-end="url(#arrLc)"/>
    <line x1="588" y1="90" x2="606" y2="90" marker-end="url(#arrLc)"/>
    <line x1="736" y1="90" x2="754" y2="90" marker-end="url(#arrLc)"/>
  </g>
  <!-- dead-letter branch -->
  <rect x="316" y="232" width="220" height="50" rx="7" fill="currentColor" fill-opacity="0.07" stroke="currentColor" stroke-width="1.5"/>
  <g text-anchor="middle" fill="currentColor">
    <text x="426" y="254" font-size="12.5">Dead-letter queue</text>
    <text x="426" y="272" font-size="10.5" opacity="0.75">records that fail conversion</text>
  </g>
  <g fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="4 3">
    <path d="M228,122 V257 H314" marker-end="url(#arrLc)"/>
    <path d="M672,122 V257 H538" marker-end="url(#arrLc)"/>
  </g>
  <g fill="currentColor" font-size="10" opacity="0.8" text-anchor="middle">
    <text x="258" y="180">fail</text>
    <text x="642" y="180">fail</text>
  </g>
</svg>

## Going deeper

- [OSMnx vs Pyrosm Performance Benchmarks for Routing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/osmnx-vs-pyrosm-performance-benchmarks-for-routing/) — measured extract-and-build timings to decide whether to prioritize ingestion velocity or immediate routing readiness.

## Frequently Asked Questions

<details>
<summary>Should I simplify the graph before or after normalizing tags?</summary>

Simplify first. `ox.simplify_graph` merges interstitial degree-2 nodes and consolidates the attributes of the merged edges; running your normalization afterward means you coerce each surviving edge exactly once and avoid re-deriving values that simplification just rewrote.
</details>

<details>
<summary>Why does my A* call raise NetworkXNoPath between two visibly connected points?</summary>

One endpoint almost certainly snapped to a node in a small subgraph that `retain_all=False` would have pruned, or that survived as a disconnected island. Keep only the largest weakly-connected component and re-snap with `ox.distance.nearest_nodes` against that pruned graph.
</details>

<details>
<summary>When should I use graph_from_gdfs instead of graph_from_bbox?</summary>

Use `graph_from_gdfs` whenever an upstream parser has already produced clean node and edge GeoDataFrames. It skips the Overpass round-trip, removes rate-limit exposure, and lets you tile and parallelize regions, which matters most at country or continental scale.
</details>

<details>
<summary>How do I make graph builds reproducible across machines?</summary>

Pin three things: the source extract (hash the `.osm.pbf` checksum), the projection CRS (pass an explicit `to_crs` rather than auto-UTM), and any RNG used in imputation (set a fixed seed). With those fixed, the node and edge sets hash identically on every run.
</details>

<details>
<summary>What happens to edges with no maxspeed tag?</summary>

`ox.add_edge_speeds()` imputes `speed_kph` from a highway-class lookup table, then `ox.add_edge_travel_times()` derives `travel_time`. If imputation is skipped, those edges keep NaN speed and produce `inf` travel time, which silently distorts shortest-path results.
</details>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Convert OpenStreetMap ways into a routing-ready NetworkX graph with OSMnx",
  "description": "Extract, normalize, project, weight, and validate OSM street networks into a deterministic NetworkX MultiDiGraph suitable for production routing.",
  "step": [
    { "@type": "HowToStep", "name": "Extract with explicit filters", "text": "Call graph_from_bbox with a custom_filter restricting highway classes and retain_all=False so disconnected subgraphs are pruned during extraction." },
    { "@type": "HowToStep", "name": "Project to a metric CRS", "text": "Run ox.project_graph with a pinned UTM CRS so edge length is computed in metres and every regional tile shares one coordinate system." },
    { "@type": "HowToStep", "name": "Normalize edge attributes", "text": "Regex-clean maxspeed, map oneway to integers, and classify surface, resolving list-valued maxspeed conflicts to the minimum." },
    { "@type": "HowToStep", "name": "Impute speeds and travel times", "text": "Apply ox.add_edge_speeds to fill missing maxspeed from highway-class tables, then ox.add_edge_travel_times to compute travel_time in seconds." },
    { "@type": "HowToStep", "name": "Validate topology", "text": "Keep the largest weakly-connected component and fail the build when missing-maxspeed coverage exceeds the configured threshold." }
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
      "name": "Should I simplify the graph before or after normalizing tags?",
      "acceptedAnswer": { "@type": "Answer", "text": "Simplify first. ox.simplify_graph merges interstitial degree-2 nodes and consolidates merged-edge attributes, so normalizing afterward coerces each surviving edge exactly once and avoids re-deriving values simplification just rewrote." }
    },
    {
      "@type": "Question",
      "name": "Why does my A* call raise NetworkXNoPath between two visibly connected points?",
      "acceptedAnswer": { "@type": "Answer", "text": "One endpoint likely snapped to a node in a small disconnected subgraph. Keep only the largest weakly-connected component and re-snap with ox.distance.nearest_nodes against that pruned graph." }
    },
    {
      "@type": "Question",
      "name": "When should I use graph_from_gdfs instead of graph_from_bbox?",
      "acceptedAnswer": { "@type": "Answer", "text": "Use graph_from_gdfs whenever an upstream parser has already produced clean node and edge GeoDataFrames. It skips the Overpass round-trip, removes rate-limit exposure, and lets you tile and parallelize regions at scale." }
    },
    {
      "@type": "Question",
      "name": "How do I make graph builds reproducible across machines?",
      "acceptedAnswer": { "@type": "Answer", "text": "Pin the source extract by hashing its checksum, pin the projection CRS with an explicit to_crs instead of auto-UTM, and fix any RNG seed used in imputation. With those fixed, the node and edge sets hash identically on every run." }
    },
    {
      "@type": "Question",
      "name": "What happens to edges with no maxspeed tag?",
      "acceptedAnswer": { "@type": "Answer", "text": "ox.add_edge_speeds imputes speed_kph from a highway-class lookup table and ox.add_edge_travel_times derives travel_time. If imputation is skipped, those edges keep NaN speed and produce inf travel time, silently distorting shortest-path results." }
    }
  ]
}
</script>

## Related

- [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/) — produces the cleaned GeoDataFrames that feed `ox.graph_from_gdfs`.
- [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/) — the canonical tag-coercion rules applied here at edge level.
- [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) — tiling and spill-to-disk patterns for continental-scale builds.
- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — dead-letter discipline for records that fail conversion.
- [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) — why projection must precede any length or travel-time weight.
- [OSMnx vs Pyrosm Performance Benchmarks for Routing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/osmnx-vs-pyrosm-performance-benchmarks-for-routing/) — measured trade-offs between the two conversion paths.

This guide is part of [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/); return to that overview to follow the data from parsing and normalization through error triage into routing-graph conversion.
