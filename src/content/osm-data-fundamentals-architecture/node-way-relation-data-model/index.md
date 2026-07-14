---
title: "Node-Way-Relation Data Model"
description: "Resolve OSM node, way, and relation primitives into valid geometry: reference integrity, multipolygon assembly, and topology-safe ETL for spatial pipelines."
pageDescription: "Deep dive into OSM's node, way, and relation primitives: reference integrity, multipolygon resolution, and topology-safe ETL for geospatial data pipelines."
slug: node-way-relation-data-model
type: guide
breadcrumb: "Node-Way-Relation Data Model"
datePublished: 2025-09-12
dateModified: 2026-06-26
date: 2026-06-26
---
# Node-Way-Relation Data Model

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1040 620" style="width:100%;max-width:1040px;display:block;margin:1.5rem auto" role="img" aria-label="Entity diagram of the OSM data model. Three primitives — Node, Way, and Relation — each carry an id, a tag map, and a Metadata block. A Way aggregates an ordered list of Node references; a Relation aggregates typed Members; and each Member's ref resolves to a Node, Way, or Relation.">
  <title>OSM node, way, and relation data model</title>
  <desc>Node holds id, lat, lon and tags. Way holds id, an ordered node_refs list and tags. Relation holds id, a members list and tags. Member holds a type (node, way or relation), a ref id and a role such as outer or inner. Metadata holds version, timestamp, changeset and uid and is owned by every primitive. A Way aggregates ordered Node references, a Relation aggregates typed Members, and each Member reference resolves to a Node, Way or Relation.</desc>
  <defs>
    <marker id="nwr-arr" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <text x="520" y="26" text-anchor="middle" font-size="15" font-family="inherit" fill="currentColor" font-weight="700">OSM data model: three primitives, references, and shared metadata</text>
  <!-- Node -->
  <rect x="30" y="48" width="280" height="150" rx="8" fill="none" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <rect x="30" y="48" width="280" height="32" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="170" y="69" text-anchor="middle" font-size="14" font-family="inherit" fill="currentColor" font-weight="700">Node</text>
  <text x="44" y="108" font-size="12.5" font-family="inherit" fill="currentColor">id : int64</text>
  <text x="44" y="132" font-size="12.5" font-family="inherit" fill="currentColor">lat : float</text>
  <text x="44" y="156" font-size="12.5" font-family="inherit" fill="currentColor">lon : float</text>
  <text x="44" y="180" font-size="12.5" font-family="inherit" fill="currentColor">tags : dict&lt;str,str&gt;</text>
  <!-- Way -->
  <rect x="380" y="48" width="280" height="150" rx="8" fill="none" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <rect x="380" y="48" width="280" height="32" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="520" y="69" text-anchor="middle" font-size="14" font-family="inherit" fill="currentColor" font-weight="700">Way</text>
  <text x="394" y="108" font-size="12.5" font-family="inherit" fill="currentColor">id : int64</text>
  <text x="394" y="132" font-size="12.5" font-family="inherit" fill="currentColor">node_refs[] : int64  (ordered)</text>
  <text x="394" y="156" font-size="12.5" font-family="inherit" fill="currentColor">tags : dict&lt;str,str&gt;</text>
  <!-- Relation -->
  <rect x="730" y="48" width="280" height="150" rx="8" fill="none" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <rect x="730" y="48" width="280" height="32" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="870" y="69" text-anchor="middle" font-size="14" font-family="inherit" fill="currentColor" font-weight="700">Relation</text>
  <text x="744" y="108" font-size="12.5" font-family="inherit" fill="currentColor">id : int64</text>
  <text x="744" y="132" font-size="12.5" font-family="inherit" fill="currentColor">members[] : Member</text>
  <text x="744" y="156" font-size="12.5" font-family="inherit" fill="currentColor">tags : dict&lt;str,str&gt;</text>
  <!-- Member -->
  <rect x="380" y="262" width="280" height="118" rx="8" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <rect x="380" y="262" width="280" height="32" rx="8" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="520" y="283" text-anchor="middle" font-size="14" font-family="inherit" fill="currentColor" font-weight="700">Member</text>
  <text x="394" y="320" font-size="12.5" font-family="inherit" fill="currentColor">type : node | way | relation</text>
  <text x="394" y="344" font-size="12.5" font-family="inherit" fill="currentColor">ref : int64</text>
  <text x="394" y="368" font-size="12.5" font-family="inherit" fill="currentColor">role : outer | inner | stop | …</text>
  <!-- Metadata -->
  <rect x="30" y="440" width="280" height="150" rx="8" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <rect x="30" y="440" width="280" height="32" rx="8" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="170" y="461" text-anchor="middle" font-size="14" font-family="inherit" fill="currentColor" font-weight="700">Metadata</text>
  <text x="44" y="500" font-size="12.5" font-family="inherit" fill="currentColor">version : int</text>
  <text x="44" y="524" font-size="12.5" font-family="inherit" fill="currentColor">timestamp : datetime</text>
  <text x="44" y="548" font-size="12.5" font-family="inherit" fill="currentColor">changeset : int</text>
  <text x="44" y="572" font-size="12.5" font-family="inherit" fill="currentColor">uid : int</text>
  <!-- Legend -->
  <rect x="730" y="440" width="280" height="150" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.85"/>
  <text x="744" y="462" font-size="12.5" font-family="inherit" fill="currentColor" font-weight="700">How to read this</text>
  <path d="M744,486 L754,481 L764,486 L754,491 Z" fill="currentColor"/>
  <line x1="764" y1="486" x2="800" y2="486" stroke="currentColor" stroke-width="1.5"/>
  <text x="808" y="490" font-size="12" font-family="inherit" fill="currentColor">aggregates (owns members)</text>
  <line x1="744" y1="514" x2="800" y2="514" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3" marker-end="url(#nwr-arr)"/>
  <text x="808" y="518" font-size="12" font-family="inherit" fill="currentColor">reference resolves to</text>
  <text x="744" y="546" font-size="12" font-family="inherit" fill="currentColor" opacity="0.9">No coordinates are stored on</text>
  <text x="744" y="564" font-size="12" font-family="inherit" fill="currentColor" opacity="0.9">ways or relations — only ids</text>
  <text x="744" y="582" font-size="12" font-family="inherit" fill="currentColor" opacity="0.9">that your parser dereferences.</text>
  <!-- Way aggregates ordered Node refs -->
  <path d="M380,123 L370,118 L360,123 L370,128 Z" fill="currentColor"/>
  <line x1="360" y1="123" x2="312" y2="123" stroke="currentColor" stroke-width="1.5" marker-end="url(#nwr-arr)"/>
  <text x="336" y="110" text-anchor="middle" font-size="9.5" font-family="inherit" fill="currentColor">ordered</text>
  <text x="336" y="142" text-anchor="middle" font-size="9.5" font-family="inherit" fill="currentColor">node refs</text>
  <!-- Relation aggregates typed Members -->
  <path d="M870,198 L865,208 L870,218 L875,208 Z" fill="currentColor"/>
  <path d="M870,218 L870,408 L662,408" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <line x1="662" y1="408" x2="662" y2="382" stroke="currentColor" stroke-width="1.5" marker-end="url(#nwr-arr)"/>
  <text x="790" y="400" text-anchor="middle" font-size="11" font-family="inherit" fill="currentColor">members[]</text>
  <!-- Member ref resolves to Node / Way / Relation (dashed) -->
  <line x1="470" y1="262" x2="230" y2="200" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3" marker-end="url(#nwr-arr)"/>
  <line x1="520" y1="262" x2="520" y2="200" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3" marker-end="url(#nwr-arr)"/>
  <line x1="570" y1="262" x2="810" y2="200" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3" marker-end="url(#nwr-arr)"/>
  <text x="520" y="244" text-anchor="middle" font-size="10.5" font-family="inherit" fill="currentColor">ref → node | way | relation</text>
  <!-- Metadata composition to every primitive (anchored to Node) -->
  <path d="M170,198 L164,208 L170,218 L176,208 Z" fill="currentColor"/>
  <line x1="170" y1="218" x2="170" y2="440" stroke="currentColor" stroke-width="1.5"/>
  <text x="178" y="332" font-size="10.5" font-family="inherit" fill="currentColor">1 per primitive</text>
  <text x="520" y="612" text-anchor="middle" font-size="11" font-family="inherit" fill="currentColor" opacity="0.9">Each Node, Way, and Relation owns one Metadata block; a Way aggregates ordered Node refs and a Relation aggregates typed Members.</text>
</svg>

## The Reference-Resolution Problem

OpenStreetMap stores no precomputed geometry. A way is not a line — it is an ordered list of 64-bit node identifiers, and a relation is not a polygon — it is a list of typed member references with roles. Every coordinate your pipeline emits is *reconstructed* by dereferencing those identifiers against the node table you built earlier in the same pass. This deferred, pointer-based model is what makes OSM editable and compact, and it is also the single largest source of silent ETL failures.

Consider a concrete failure scenario. You stream a regional `.osm.pbf` extract clipped to a bounding box, build a node coordinate index, then reconstruct ways. A coastal way crosses the clip boundary, so three of its node references resolve and two do not. A naive parser either raises a `KeyError` and aborts the whole run, or — worse — silently drops the missing nodes and emits a polygon with a sliver where the coastline was cut. The geometry passes a basic `is_valid` check, lands in your warehouse, and corrupts every area calculation downstream. The defect is invisible until an analyst notices that a national land-cover total is 4% short. The fix is not more validation at the end of the pipeline; it is enforcing **reference closure** at the moment of reconstruction, which is exactly what the node, way, and relation contract below specifies.

This reference graph is the foundation introduced in [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/); the page you are reading is where that graph becomes runnable geometry.

## Prerequisite Concepts

Before reconstructing geometry you should be comfortable with three foundational ideas:

- The physical encoding the references arrive in — the [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) explains how dense nodes, delta-encoded IDs, and string tables deliver these primitives to your handler, and why node coordinates must be resolved with `locations=True`.
- The coordinate space the resolved points live in — every raw node is stored in WGS 84 (EPSG:4326), and any projection happens *after* assembly as covered in [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/).
- The semantic layer that turns geometry into features — keys and values follow the conventions documented in [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/), which decide whether a closed way is a building, a roundabout, or a lake.

## Specification & Field Reference

Each primitive carries a globally unique signed 64-bit identifier, an extensible key-value tag map, and a metadata block. Identifier namespaces are independent per type: node `1`, way `1`, and relation `1` are three distinct objects. The table below summarizes the fields your reader must populate and the constraints it must enforce.

| Primitive | Geometry source | Required fields | Topological constraint |
|---|---|---|---|
| Node | `lat`, `lon` (intrinsic) | `id`, `lat`, `lon` | `-90 ≤ lat ≤ 90`, `-180 ≤ lon ≤ 180`, finite |
| Way | ordered `node_refs[]` | `id`, ≥2 node refs | closed ⇔ first ref == last ref; ≥4 refs for a valid ring |
| Relation | typed `members[]` | `id`, ≥1 member | every member `ref` resolves; roles valid for `type` tag |
| Member | reference only | `type`, `ref`, `role` | `type ∈ {node, way, relation}` |
| Metadata | — | `version`, `timestamp`, `changeset`, `uid` | monotonic `version` per object |

Two encoding facts shape every parser. First, coordinates in PBF are stored as integer nanodegrees (degrees × 10⁻⁷) and delta-encoded within a primitive group, so a node at latitude 51.5074° is carried as the integer `515074000` relative to the running accumulator. Second, a closed way is *not* automatically an area — the `area=yes` tag, or an area-implying key such as `building` or `landuse`, is what distinguishes a polygon from a closed linear loop like a roundabout. Encoding the wrong assumption here produces topologically valid but semantically wrong features.

## Step-by-Step Implementation

The pipeline runs in three ordered stages: index nodes, reconstruct ways, then assemble relations. Each stage depends on the working set produced by the previous one.

### 1. Index and validate nodes

Nodes are the atomic spatial units. Stream them first, enforce strict WGS 84 bounds, reject non-finite values, and keep only what downstream stages will dereference. This streaming validator uses `pyosmium` and never materializes the whole file in memory.

```python
import osmium
import numpy as np
from typing import Dict, Tuple, Optional
import logging

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")


class NodeValidator(osmium.SimpleHandler):
    def __init__(self, max_nodes: Optional[int] = None) -> None:
        super().__init__()
        self.valid_nodes: Dict[int, Tuple[float, float]] = {}
        self.invalid_count = 0
        self.max_nodes = max_nodes

    def node(self, n: osmium.osm.Node) -> None:
        if self.max_nodes is not None and len(self.valid_nodes) >= self.max_nodes:
            return
        try:
            lat, lon = n.location.lat, n.location.lon
            # Strict WGS 84 bounds and finiteness check
            if (
                -90.0 <= lat <= 90.0
                and -180.0 <= lon <= 180.0
                and np.isfinite(lat)
                and np.isfinite(lon)
            ):
                self.valid_nodes[n.id] = (lat, lon)
            else:
                self.invalid_count += 1
                logging.debug("Invalid coordinates for node %d: (%f, %f)", n.id, lat, lon)
        except Exception as e:  # noqa: BLE001 - log and continue, never abort the stream
            logging.warning("Failed to process node %d: %s", n.id, e)
            self.invalid_count += 1

    def get_indexed_nodes(self) -> Dict[int, Tuple[float, float]]:
        return self.valid_nodes


# Usage: apply_file with locations=True so pyosmium resolves coordinates.
handler = NodeValidator()
handler.apply_file("extract.pbf", locations=True)
```

Untagged nodes frequently act as geometric anchors for ways and relations. Retain every valid node during reconstruction even when it carries no tags; feature-extraction stages may filter the orphans afterward to shrink storage and speed up spatial joins.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 340" style="width:100%;max-width:1000px;display:block;margin:1.5rem auto" role="img" aria-label="Three-stage OSM resolution pipeline. A node index mapping id to latitude and longitude feeds way reconstruction, which turns ordered references into a LineString or Polygon; that feeds relation assembly, which turns members and roles into a MultiPolygon, emitting valid geometry. A reference-closure gate beneath the ways and relations stages tests whether every reference resolves and routes unresolved references to a quarantine table instead of silently dropping them.">
  <title>Three-stage resolution pipeline with a reference-closure gate</title>
  <desc>Stage 1 builds a node index from id to (lat, lon). Stage 2 reconstructs ways, turning ordered node references into a LineString or area-tagged Polygon. Stage 3 assembles relations, turning members and roles into a MultiPolygon. Valid geometry flows on to tag normalization. A reference-closure gate beneath stages 2 and 3 asks whether every reference resolves; references that do not resolve are dropped, counted, and written to a quarantine table for re-clipping rather than corrupting downstream geometry.</desc>
  <defs>
    <marker id="pipe-arr" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <text x="500" y="24" text-anchor="middle" font-size="14" font-family="inherit" fill="currentColor" font-weight="700">Index nodes → reconstruct ways → assemble relations, gated by reference closure</text>
  <!-- Stage 1: node index -->
  <rect x="24" y="46" width="212" height="100" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="130" y="76" text-anchor="middle" font-size="13" font-family="inherit" fill="currentColor" font-weight="600">1 · Node index</text>
  <text x="130" y="98" text-anchor="middle" font-size="12" font-family="inherit" fill="currentColor">id → (lat, lon)</text>
  <text x="130" y="118" text-anchor="middle" font-size="11.5" font-family="inherit" fill="currentColor" opacity="0.85">WGS 84 bounds checked</text>
  <!-- Stage 2: way reconstruction -->
  <rect x="268" y="46" width="212" height="100" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="374" y="76" text-anchor="middle" font-size="13" font-family="inherit" fill="currentColor" font-weight="600">2 · Way reconstruction</text>
  <text x="374" y="98" text-anchor="middle" font-size="12" font-family="inherit" fill="currentColor">ordered refs →</text>
  <text x="374" y="116" text-anchor="middle" font-size="12" font-family="inherit" fill="currentColor">LineString / Polygon</text>
  <!-- Stage 3: relation assembly -->
  <rect x="512" y="46" width="212" height="100" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="618" y="76" text-anchor="middle" font-size="13" font-family="inherit" fill="currentColor" font-weight="600">3 · Relation assembly</text>
  <text x="618" y="98" text-anchor="middle" font-size="12" font-family="inherit" fill="currentColor">members + roles →</text>
  <text x="618" y="116" text-anchor="middle" font-size="12" font-family="inherit" fill="currentColor">MultiPolygon</text>
  <!-- Output -->
  <rect x="756" y="46" width="220" height="100" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="866" y="84" text-anchor="middle" font-size="13" font-family="inherit" fill="currentColor" font-weight="600">Valid geometry</text>
  <text x="866" y="106" text-anchor="middle" font-size="12" font-family="inherit" fill="currentColor">→ tag normalization</text>
  <!-- Forward arrows -->
  <line x1="236" y1="96" x2="266" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#pipe-arr)"/>
  <line x1="480" y1="96" x2="510" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#pipe-arr)"/>
  <line x1="724" y1="96" x2="754" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#pipe-arr)"/>
  <!-- Reference-closure gate -->
  <rect x="296" y="224" width="208" height="82" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="400" y="254" text-anchor="middle" font-size="12.5" font-family="inherit" fill="currentColor" font-weight="600">Reference-closure gate</text>
  <text x="400" y="276" text-anchor="middle" font-size="12" font-family="inherit" fill="currentColor">does every ref resolve?</text>
  <text x="400" y="294" text-anchor="middle" font-size="11.5" font-family="inherit" fill="currentColor" opacity="0.85">unresolved → drop &amp; count</text>
  <!-- Quarantine -->
  <rect x="600" y="224" width="220" height="82" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 4"/>
  <text x="710" y="258" text-anchor="middle" font-size="12.5" font-family="inherit" fill="currentColor" font-weight="600">Quarantine table</text>
  <text x="710" y="280" text-anchor="middle" font-size="12" font-family="inherit" fill="currentColor">flag · count · re-clip</text>
  <!-- Stage 2 & 3 feed the gate -->
  <path d="M374,146 L374,200 L390,200 L390,224" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#pipe-arr)"/>
  <path d="M618,146 L618,200 L410,200 L410,224" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#pipe-arr)"/>
  <!-- Gate routes unresolved to quarantine -->
  <line x1="504" y1="265" x2="598" y2="265" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 4" marker-end="url(#pipe-arr)"/>
  <text x="500" y="332" text-anchor="middle" font-size="11" font-family="inherit" fill="currentColor" opacity="0.9">Resolved references flow on to geometry; unresolved references are quarantined, never silently dropped.</text>
</svg>

### 2. Reconstruct way geometry

A way resolves its ordered node references into coordinates, removes degenerate segments, and becomes a `LineString` or, when closed and area-tagged, a `Polygon`. Shapely requires explicit closure (first point equal to last) for a polygon ring.

```python
from shapely.geometry import LineString, Polygon
from shapely.validation import make_valid
from shapely.errors import TopologicalError
from typing import List, Tuple, Union

def reconstruct_way_geometry(
    node_refs: List[int],
    node_index: Dict[int, Tuple[float, float]],
    is_closed: bool,
) -> Union[LineString, Polygon, None]:
    try:
        # Reference closure: keep only refs that resolved in the node index
        coords = [node_index[nid] for nid in node_refs if nid in node_index]
        missing = len(node_refs) - len(coords)
        if missing:
            logging.warning("Way dropped %d unresolved node refs", missing)
        if len(coords) < 2:
            return None

        # Remove consecutive duplicates to prevent degenerate segments
        cleaned: List[Tuple[float, float]] = [coords[0]]
        for c in coords[1:]:
            if c != cleaned[-1]:
                cleaned.append(c)
        if len(cleaned) < 2:
            return None

        if is_closed and len(cleaned) >= 3:
            if cleaned[0] != cleaned[-1]:
                cleaned.append(cleaned[0])
            geom = Polygon(cleaned)
        else:
            geom = LineString(cleaned)

        if not geom.is_valid:
            geom = make_valid(geom)
        return geom

    except KeyError as e:
        logging.warning("Missing node reference in way reconstruction: %s", e)
        return None
    except TopologicalError as e:
        logging.error("Topological failure during geometry creation: %s", e)
        return None
```

Reporting `missing` rather than silently discarding it is the difference between the corrupt-coastline scenario above and a pipeline you can trust: a way that drops references near a clip boundary is flagged, counted, and routed for review.

### 3. Assemble relations

Relations group nodes, ways, or other relations and assign each member a role (`outer`, `inner`, `stop`, `forward`, and so on). A `type=multipolygon` relation builds exterior rings from `outer` members and subtracts `inner` members as holes. Member references must resolve and roles must be consistent, or the assembled geometry inverts.

```python
from shapely.geometry import MultiPolygon, Polygon
from shapely.ops import polygonize, unary_union
from typing import Dict, List, Tuple

def assemble_multipolygon(
    members: List[Tuple[str, int, str]],          # (type, ref, role)
    way_geoms: Dict[int, "Polygon | LineString"],  # reconstructed in stage 2
) -> "MultiPolygon | None":
    outer_lines, inner_lines = [], []
    for mtype, ref, role in members:
        if mtype != "way":
            continue  # multipolygon members are ways; skip stray node/relation refs
        geom = way_geoms.get(ref)
        if geom is None:
            logging.warning("Multipolygon references unresolved way %d", ref)
            continue
        (outer_lines if role != "inner" else inner_lines).append(geom.boundary)

    if not outer_lines:
        return None

    # polygonize stitches partial ways into closed rings, then subtract holes
    outers = list(polygonize(unary_union(outer_lines)))
    holes = unary_union(inner_lines) if inner_lines else None
    rings = [p.difference(holes) if holes else p for p in outers]
    rings = [r for r in rings if not r.is_empty]
    return MultiPolygon([r for r in rings if r.geom_type == "Polygon"]) or None
```

Multipolygon assembly is intricate enough to warrant its own treatment; for the full handling of overlapping inner rings, disjoint outers, and ring-direction repair, see [Understanding OSM multipolygon relations for GIS](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/understanding-osm-multipolygon-relations-for-gis/).

## Validation & Error-Handling Matrix

Each defect class has a distinct root cause, detection method, and remediation. Quarantine genuinely defective records rather than aborting the run, but treat a malformed header as a hard stop.

| Error condition | Root cause | Detection | Remediation |
|---|---|---|---|
| Unresolved node ref in way | Clip boundary or incomplete extract | `nid not in node_index` count > 0 | Quarantine way; re-clip with buffer |
| Coordinate out of bounds | Corrupt source or unit error | WGS 84 range check fails | Drop node, increment `invalid_count` |
| Coordinate drift across file | Missing delta accumulator reset at group boundary | Coordinates diverge mid-stream | Reset accumulator per primitive group |
| Self-intersecting polygon | Bow-tie ordering of refs | `geom.is_valid` is `False` | `make_valid()`; log original WKT |
| Inverted multipolygon | `inner`/`outer` roles swapped | Negative or zero signed area | Re-derive ring direction; fix roles |
| Duplicate consecutive nodes | Editor artifact | Equal adjacent coordinates | Collapse before geometry build |
| Orphaned relation member | Member outside extract | `ref` absent from working set | Quarantine relation; flag for re-fetch |

## Performance & Scale Considerations

The cost center is the node index. A planet extract holds roughly nine billion nodes; an in-memory `dict[int, tuple]` of that size is impossible on commodity hardware. For continental and global runs, replace the Python dictionary with an on-disk node-location store — `pyosmium`'s `index.create_map("sparse_file_array,nodes.cache")` or a memory-mapped flat array keyed by node ID. This trades a few microseconds per lookup for a flat, predictable memory ceiling instead of unbounded heap growth.

Reconstruction is embarrassingly parallel once nodes are indexed, because each way and each relation resolves independently. Split work by primitive-group block boundaries (which the binary format already aligns for you) and fan out to a process pool; the node store is read-only at this stage, so workers can share a memory-mapped view without locking. In practice a buffered, block-aligned reader sustains hundreds of thousands of ways per second per core, and the bottleneck shifts from CPU to the random-access pattern of node lookups — which is why store locality, not parser speed, dominates wall-clock time on large extracts.

## Failure Modes & Gotchas

- **Accumulator reset boundaries.** Delta-encoded coordinates and IDs reset at every primitive-group boundary, not at every blob. Carrying an accumulator across a group boundary shifts every subsequent coordinate by a constant offset that looks like a plausible translation, so it evades range checks.
- **Closed ≠ area.** A closed way is a ring only when an area-implying tag is present. Treating every closed way as a polygon turns roundabouts and barrier loops into spurious filled areas.
- **Ring direction.** OSM does not guarantee winding order. Do not infer `outer` versus `inner` from clockwise/counter-clockwise direction; trust the member role and repair winding afterward.
- **Self-referencing relations.** A relation may reference another relation, and pathological data can form cycles. Bound recursion depth and detect visited IDs before assembling super-relations.
- **Tag index overflow.** In dense PBF blocks, tag keys and values are indices into a per-block string table. An off-by-one in the `0`-terminated key/value index stream silently misattributes tags to the wrong object.

## Integration Points

Reconstructed geometries are the input to the transformation half of the platform. Emit each feature with its primitive type, resolved geometry, normalized tags, and provenance metadata so the next stage can normalize tags and apply schema mapping without re-touching the reference graph. The wiring below hands assembled features to the normalization stage covered in [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/).

```python
def emit_feature(osm_type: str, osm_id: int, geom, tags: dict, meta: dict) -> dict:
    """Hand a resolved primitive to the tag-normalization stage."""
    return {
        "osm_type": osm_type,           # node | way | relation
        "osm_id": osm_id,
        "geometry": geom.wkb,           # serialized once, projected downstream
        "tags": tags,                   # normalized in the next stage
        "version": meta["version"],
        "changeset": meta["changeset"],
        "source": "© OpenStreetMap contributors",  # ODbL attribution carried forward
    }
```

Records that fail reference closure or topology validation should be written to a quarantine sink instead — the same contract feeds [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/), where defective records are triaged and reprocessed.

## Explore This Topic Further

- [Understanding OSM multipolygon relations for GIS](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/understanding-osm-multipolygon-relations-for-gis/) — assembling exterior boundaries and interior holes from `outer`/`inner` way members without sliver geometries or inversions.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Reconstruct OSM geometry from node, way, and relation primitives",
  "description": "Three-stage procedure to resolve OpenStreetMap reference graphs into valid geometry with reference-closure enforcement.",
  "step": [
    { "@type": "HowToStep", "name": "Index and validate nodes", "text": "Stream nodes first with pyosmium and locations=True, enforce WGS 84 bounds and finiteness, and keep a node-id to coordinate index for later dereferencing." },
    { "@type": "HowToStep", "name": "Reconstruct ways", "text": "Resolve each way's ordered node references against the node index, drop and count unresolved references, remove consecutive duplicates, and build a LineString or area-tagged Polygon." },
    { "@type": "HowToStep", "name": "Assemble relations", "text": "For multipolygon relations, polygonize outer way boundaries into rings and subtract inner members as holes, verifying that every member reference resolves and roles are consistent." },
    { "@type": "HowToStep", "name": "Enforce reference closure", "text": "Quarantine any way or relation with unresolved references rather than emitting partial geometry, so clip-boundary defects are flagged instead of corrupting downstream totals." },
    { "@type": "HowToStep", "name": "Emit with provenance", "text": "Serialize each valid feature with its primitive type, geometry, normalized tags, version metadata, and ODbL attribution for the tag-normalization stage." }
  ]
}
</script>

## Frequently Asked Questions

<details>
<summary>Why does OSM store references instead of coordinates on ways?</summary>

A way holds an ordered list of node IDs so that moving a single node updates every way and relation that shares it, keeping connected geometry consistent and the database compact. The cost is that your parser must build a node index first and dereference it at reconstruction time, which is why nodes are always streamed before ways.
</details>

<details>
<summary>How do I know whether a closed way is a polygon or a line?</summary>

Closure alone is not enough. A way is an area only when it carries an area-implying tag such as `building`, `landuse`, or an explicit `area=yes`; otherwise a closed way like a roundabout remains a linear ring. Apply the [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) rules before deciding the geometry type.
</details>

<details>
<summary>What happens when a way references a node outside my extract?</summary>

The reference does not resolve. Enforce reference closure: count and quarantine the affected way rather than silently dropping the missing points, because partial reconstruction near a clip boundary produces geometry that passes validity checks but is wrong. Re-clip with a buffer to recover the missing anchors.
</details>

<details>
<summary>Why does my multipolygon come out inverted or with swallowed holes?</summary>

OSM does not guarantee ring winding order, so inferring `outer` versus `inner` from direction is unreliable. Trust each member's role, build outer rings first, subtract inner members as holes, then repair winding. See [Understanding OSM multipolygon relations for GIS](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/understanding-osm-multipolygon-relations-for-gis/).
</details>

<details>
<summary>Can a node index fit in memory for a planet file?</summary>

No. A planet extract holds billions of nodes, so use an on-disk or memory-mapped node-location store rather than a Python dictionary. This caps memory at a flat, predictable level and lets parallel workers share a read-only view during reconstruction.
</details>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Why does OSM store references instead of coordinates on ways?",
      "acceptedAnswer": { "@type": "Answer", "text": "A way holds an ordered list of node IDs so that moving a single node updates every way and relation that shares it, keeping connected geometry consistent and the database compact. The cost is that your parser must build a node index first and dereference it at reconstruction time, which is why nodes are streamed before ways." }
    },
    {
      "@type": "Question",
      "name": "How do I know whether a closed way is a polygon or a line?",
      "acceptedAnswer": { "@type": "Answer", "text": "Closure alone is not enough. A way is an area only when it carries an area-implying tag such as building, landuse, or an explicit area=yes; otherwise a closed way like a roundabout remains a linear ring." }
    },
    {
      "@type": "Question",
      "name": "What happens when a way references a node outside my extract?",
      "acceptedAnswer": { "@type": "Answer", "text": "The reference does not resolve. Enforce reference closure by counting and quarantining the affected way rather than silently dropping the missing points, because partial reconstruction near a clip boundary produces geometry that passes validity checks but is wrong. Re-clip with a buffer to recover the missing anchors." }
    },
    {
      "@type": "Question",
      "name": "Why does my multipolygon come out inverted or with swallowed holes?",
      "acceptedAnswer": { "@type": "Answer", "text": "OSM does not guarantee ring winding order, so inferring outer versus inner from direction is unreliable. Trust each member's role, build outer rings first, subtract inner members as holes, then repair winding." }
    },
    {
      "@type": "Question",
      "name": "Can a node index fit in memory for a planet file?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. A planet extract holds billions of nodes, so use an on-disk or memory-mapped node-location store rather than a Python dictionary. This caps memory at a flat, predictable level and lets parallel workers share a read-only view during reconstruction." }
    }
  ]
}
</script>

## Related

- [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) — how dense nodes and delta encoding deliver these primitives to your handler.
- [OSM XML vs PBF Comparison](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/) — the format trade-offs that decide your ingestion strategy.
- [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) — projecting resolved WGS 84 geometry to a working CRS.
- [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) — turning resolved geometry into typed features.
- [Understanding OSM multipolygon relations for GIS](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/understanding-osm-multipolygon-relations-for-gis/) — full handling of `outer`/`inner` ring assembly.
- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — triaging the records this stage quarantines.

This guide is part of [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/); return to that overview to follow the data model through serialization, CRS handling, and spatial indexing.
