---
title: "Understanding OSM Multipolygon Relations for GIS"
description: "Assemble valid OSM multipolygon geometry from outer/inner way members: role-driven ring construction, hole subtraction, winding repair, and topology-safe PostGIS ingestion."
pageTitle: "Understanding OSM Multipolygon Relations for GIS"
pageDescription: "Reconstruct OSM type=multipolygon relations into OGC-valid polygons in Python: outer/inner roles, hole subtraction, ring winding repair, and PostGIS ingestion with pyosmium and Shapely."
slug: understanding-osm-multipolygon-relations-for-gis
type: article
breadcrumb: "Multipolygon Relations for GIS"
datePublished: 2025-09-12
dateModified: 2026-06-26
date: 2026-06-26
---
# Understanding OSM multipolygon relations for GIS

Take an OpenStreetMap `type=multipolygon` relation and reconstruct it into an OGC-valid polygon — building exterior rings from `outer` members, subtracting `inner` members as holes, and repairing winding order — before it reaches PostGIS, so a lake island or a country enclave is never silently swallowed or inverted.

## Prerequisites

Confirm each item before running the code below; an unmet prerequisite is the usual cause of a relation that "parses" but produces geometry that fails `ST_IsValid` only after ingestion.

- [ ] `pyosmium` ≥ 3.6.0 installed (`pip install "osmium>=3.6"`) — it wraps libosmium and resolves node locations when `apply_file(..., locations=True)` is set.
- [ ] `Shapely` ≥ 2.0 installed (`pip install "shapely>=2.0"`) for `LinearRing`, `polygonize`, `make_valid`, and the vectorized GEOS backend.
- [ ] `pyproj` ≥ 3.4 installed for the metric area sanity check (`pip install "pyproj>=3.4"`).
- [ ] An `.osm.pbf` extract whose `complete_ways` are present at clip edges, so every `outer`/`inner` member fully resolves (re-clip with `osmium extract --strategy=complete_ways` if not).
- [ ] A target projected CRS chosen for the area check (`EPSG:3857` for a quick metric proxy; `EPSG:3035` for European equal-area work).
- [ ] A node-location index strategy selected (`flex_mem` for country extracts; `sparse_file_array` on an NVMe scratch volume for planet-scale runs).

## Conceptual minimum

OpenStreetMap encodes complex areal features through multipolygon relations: a structural primitive that aggregates several linear `way` members into one topological area. Each member carries a `role` of `outer` or `inner`, and that role — not the geometric winding direction — is the authoritative signal for how the ring participates. As the parent [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) explains, OSM does not guarantee ring orientation, so inferring exterior versus hole from segment direction is unreliable; you must trust the role, build `outer` rings first, then subtract every `inner` ring that falls inside them. The assembled signed area is the sum of outer areas minus the sum of inner areas:

$$ \text{Area} = \sum_{o \in \text{outer}} |A_o| \; - \sum_{i \in \text{inner}} |A_i| $$

<svg viewBox="0 0 760 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Membership tree of a type=multipolygon relation: the relation points to five way members by solid membership edges (two role=outer ways forming exterior rings A and B, and three role=inner ways), then dashed contains edges show outer ring A containing inner holes 1 and 2 and outer ring B containing inner hole 3" style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>Multipolygon Relation Membership and Containment</title>
  <desc>A type=multipolygon relation has solid membership edges to five way members: two role=outer ways (exterior rings A and B) and three role=inner ways. Dashed "contains" edges show that outer ring A contains inner holes 1 and 2, while outer ring B contains inner hole 3. The role attribute, not the way winding, determines whether a member is an exterior ring or a hole.</desc>
  <defs>
    <marker id="mpTreeArr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <rect x="0" y="0" width="760" height="300" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <!-- relation node -->
  <rect x="270" y="18" width="220" height="52" rx="4" fill="currentColor" fill-opacity="0.10" stroke="currentColor" stroke-width="1.5"/>
  <text x="380" y="40" text-anchor="middle" font-size="13" fill="currentColor">Relation</text>
  <text x="380" y="57" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.75">type = multipolygon</text>
  <!-- membership edges (solid) -->
  <line x1="380" y1="70" x2="104" y2="118" stroke="currentColor" stroke-width="1.5" marker-end="url(#mpTreeArr)" opacity="0.85"/>
  <line x1="380" y1="70" x2="242" y2="118" stroke="currentColor" stroke-width="1.5" marker-end="url(#mpTreeArr)" opacity="0.85"/>
  <line x1="380" y1="70" x2="380" y2="118" stroke="currentColor" stroke-width="1.5" marker-end="url(#mpTreeArr)" opacity="0.85"/>
  <line x1="380" y1="70" x2="518" y2="118" stroke="currentColor" stroke-width="1.5" marker-end="url(#mpTreeArr)" opacity="0.85"/>
  <line x1="380" y1="70" x2="656" y2="118" stroke="currentColor" stroke-width="1.5" marker-end="url(#mpTreeArr)" opacity="0.85"/>
  <text x="232" y="96" text-anchor="end" font-size="9.5" fill="currentColor" opacity="0.65">member</text>
  <!-- outer member boxes (filled) -->
  <rect x="44" y="122" width="120" height="58" rx="3" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.5"/>
  <text x="104" y="146" text-anchor="middle" font-size="11.5" fill="currentColor">Way · role=outer</text>
  <text x="104" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">exterior ring A</text>
  <rect x="458" y="122" width="120" height="58" rx="3" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.5"/>
  <text x="518" y="146" text-anchor="middle" font-size="11.5" fill="currentColor">Way · role=outer</text>
  <text x="518" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">exterior ring B</text>
  <!-- inner member boxes (dashed border = hole) -->
  <rect x="182" y="122" width="120" height="58" rx="3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3"/>
  <text x="242" y="146" text-anchor="middle" font-size="11.5" fill="currentColor">Way · role=inner</text>
  <text x="242" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">hole 1 in A</text>
  <rect x="320" y="122" width="120" height="58" rx="3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3"/>
  <text x="380" y="146" text-anchor="middle" font-size="11.5" fill="currentColor">Way · role=inner</text>
  <text x="380" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">hole 2 in A</text>
  <rect x="596" y="122" width="120" height="58" rx="3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3"/>
  <text x="656" y="146" text-anchor="middle" font-size="11.5" fill="currentColor">Way · role=inner</text>
  <text x="656" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">hole 3 in B</text>
  <!-- containment edges (dashed) -->
  <path d="M104,180 C104,226 242,226 242,180" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="3 3" marker-end="url(#mpTreeArr)" opacity="0.7"/>
  <path d="M104,180 C104,258 380,258 380,180" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="3 3" marker-end="url(#mpTreeArr)" opacity="0.7"/>
  <path d="M518,180 C518,226 656,226 656,180" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="3 3" marker-end="url(#mpTreeArr)" opacity="0.7"/>
  <text x="173" y="238" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.75">contains</text>
  <text x="587" y="238" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.75">contains</text>
  <!-- note -->
  <text x="380" y="288" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.7">Role (not winding) decides exterior vs. hole · each inner lies inside exactly one outer</text>
</svg>

<figure class="diagram-wrap">
<svg viewBox="0 0 856 262" role="img" aria-labelledby="mp-roles-t mp-roles-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="mp-roles-t">Role tags against containment when classifying multipolygon rings</title>
  <desc id="mp-roles-d">Two panels showing the same building with two courtyards. On the left, the member roles are taken literally: one inner ring carries an empty role and another is mistagged as outer, producing overlapping outer rings and an invalid geometry. On the right, rings are classified by even-odd containment depth: the enclosing ring is depth zero and therefore outer, and both courtyards are depth one and therefore holes, regardless of what the role tags say.</desc>
  <rect x="0" y="0" width="856" height="262" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="mpr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="430" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Roles are a hint; containment is the answer</text>
  <rect x="26" y="48" width="386" height="196" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.4"/>
  <text x="219" y="72" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Trusting role= as written</text>
  <path d="M70,96 H360 V214 H70 Z" fill="none" stroke="currentColor" stroke-width="1.8"/>
  <text x="80" y="112" font-size="10.5" fill="currentColor" opacity="0.85">role="outer"</text>
  <path d="M120,132 H210 V182 H120 Z" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.6"/>
  <text x="165" y="160" text-anchor="middle" font-size="10.5" fill="currentColor">role=""</text>
  <path d="M250,132 H330 V182 H250 Z" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.6"/>
  <text x="290" y="160" text-anchor="middle" font-size="10.5" fill="currentColor">role="outer"</text>
  <text x="219" y="232" text-anchor="middle" font-size="10.5" fill="currentColor">two courtyards become overlapping outer rings → invalid</text>
  <rect x="444" y="48" width="386" height="196" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.4"/>
  <text x="637" y="72" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Classifying by even-odd containment</text>
  <path d="M488,96 H778 V214 H488 Z" fill="none" stroke="currentColor" stroke-width="1.8"/>
  <text x="498" y="112" font-size="10.5" fill="currentColor" opacity="0.85">depth 0 → outer</text>
  <path d="M538,132 H628 V182 H538 Z" fill="var(--osm-canvas,#fffdf8)" stroke="var(--osm-ok,#15803d)" stroke-width="1.6"/>
  <text x="583" y="160" text-anchor="middle" font-size="10.5" fill="currentColor">depth 1 → hole</text>
  <path d="M668,132 H748 V182 H668 Z" fill="var(--osm-canvas,#fffdf8)" stroke="var(--osm-ok,#15803d)" stroke-width="1.6"/>
  <text x="708" y="160" text-anchor="middle" font-size="10.5" fill="currentColor">depth 1 → hole</text>
  <text x="637" y="232" text-anchor="middle" font-size="10.5" fill="currentColor">ring nesting decides the role, so a mistagged member cannot break it</text>
</svg>
<figcaption>Roles in OSM are contributor-supplied and routinely wrong or blank. Counting how many rings a candidate falls inside is cheap and cannot be mistagged.</figcaption>
</figure>

Topological validity adds three hard constraints: rings must be closed and non-self-intersecting, they may share nodes only at explicit boundary intersections, and an `inner` ring must lie wholly inside exactly one `outer` ring. Overlapping interiors or an unclosed ring violate the OGC Simple Features specification and abort geometry construction in standard GIS engines. Tag authority follows the same role discipline — the relation's key-value pairs are canonical, and member-way tags apply only when a way is used standalone — so a strict key allowlist drawn from [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) prevents inner-ring attributes from bleeding onto the assembled feature.

<svg viewBox="0 0 760 380" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Annotated multipolygon assembly: two disjoint outer rings A and B are reconstructed from role=outer ways, each with role=inner ways punched out as holes; outer rings are wound counter-clockwise and inner holes clockwise, and the total signed area equals the sum of outer ring areas minus the sum of all hole areas" style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>Assembling a Multipolygon: Outer Rings Minus Inner Holes</title>
  <desc>Two disjoint outer rings, A (with two holes) and B (with one hole), are reconstructed from role=outer way members; role=inner members are subtracted as cutouts so background shows through each hole. Outer rings are oriented counter-clockwise (CCW) and inner holes clockwise (CW). The assembled signed area is the sum of the outer ring areas minus the sum of all hole areas.</desc>
  <defs>
    <marker id="mpWind" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <rect x="0" y="0" width="760" height="380" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <!-- Outer ring A with two holes (evenodd punches the cutouts) -->
  <path d="M60,160 L108,78 L218,66 L300,128 L288,232 L176,262 L92,218 Z
           M132,128 L178,122 L184,158 L142,166 Z
           M214,176 L260,182 L254,218 L216,212 Z"
        fill-rule="evenodd" fill="currentColor" fill-opacity="0.10"
        stroke="currentColor" stroke-width="2"/>
  <!-- redraw hole rings dashed to mark them as inner -->
  <path d="M132,128 L178,122 L184,158 L142,166 Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="4 3" opacity="0.85"/>
  <path d="M214,176 L260,182 L254,218 L216,212 Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="4 3" opacity="0.85"/>
  <!-- Outer ring B with one hole -->
  <path d="M412,150 L452,80 L622,84 L672,158 L620,242 L452,236 Z
           M520,150 L576,144 L582,190 L526,196 Z"
        fill-rule="evenodd" fill="currentColor" fill-opacity="0.10"
        stroke="currentColor" stroke-width="2"/>
  <path d="M520,150 L576,144 L582,190 L526,196 Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="4 3" opacity="0.85"/>
  <!-- winding indicators: CCW on outers, CW on holes -->
  <path d="M168,150 A26,26 0 1 0 194,176" fill="none" stroke="currentColor" stroke-width="1.6" marker-end="url(#mpWind)"/>
  <text x="176" y="158" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.8">CCW</text>
  <path d="M524,156 A22,22 0 1 1 502,178" fill="none" stroke="currentColor" stroke-width="1.6" marker-end="url(#mpWind)"/>
  <text x="540" y="120" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.8">CCW</text>
  <!-- role labels -->
  <text x="160" y="58" text-anchor="middle" font-size="11.5" fill="currentColor">outer ring A</text>
  <text x="160" y="73" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.7">role=outer</text>
  <text x="540" y="62" text-anchor="middle" font-size="11.5" fill="currentColor">outer ring B</text>
  <text x="540" y="77" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.7">role=outer</text>
  <text x="158" y="143" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.85">hole · CW</text>
  <text x="234" y="197" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.85">hole · CW</text>
  <text x="551" y="172" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.85">hole · CW</text>
  <text x="300" y="300" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.7">inner members (role=inner) subtracted as holes</text>
  <!-- disjoint divider note -->
  <line x1="356" y1="70" x2="356" y2="270" stroke="currentColor" stroke-width="1" stroke-dasharray="2 4" opacity="0.4"/>
  <text x="356" y="284" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.55">disjoint outers</text>
  <!-- signed-area accumulation -->
  <line x1="40" y1="320" x2="720" y2="320" stroke="currentColor" stroke-width="1" opacity="0.3"/>
  <text x="380" y="346" text-anchor="middle" font-size="13" fill="currentColor">Area = |A| + |B| &#8722; (hole&#8321; + hole&#8322; + hole&#8323;)</text>
  <text x="380" y="366" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.7">sum of outer ring areas minus sum of all inner hole areas</text>
</svg>

## Runnable solution

This two-pass `pyosmium` handler collects way coordinates, then assembles each `type=multipolygon` relation: it validates member resolution, builds rings by role, repairs validity with `make_valid`, runs a projected area sanity check, enforces canonical winding, and routes defects to a log instead of crashing the stream. It targets `pyosmium>=3.6.0` and `Shapely>=2.0`.

```python
import logging
import osmium
import shapely.geometry as geom
from shapely.geometry.polygon import orient
from shapely.validation import make_valid
from shapely.ops import transform as shp_transform, polygonize, unary_union
from pyproj import Transformer

logger = logging.getLogger("osm.multipolygon")

# Build ONE transformer per process; the constructor queries the PROJ
# operation database, so never rebuild it inside the relation loop.
_transformer = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)


def _project(g):
    return shp_transform(_transformer.transform, g)


class MultipolygonETL(osmium.SimpleHandler):
    """Two-pass multipolygon handler: collect way coordinates, then assemble relations.

    Call ``apply_file(path, locations=True)`` so pyosmium resolves node
    coordinates and exposes them on each NodeRef in ``w.nodes``.
    """

    def __init__(self) -> None:
        super().__init__()
        self.way_coords: dict[int, list[tuple[float, float]]] = {}
        self.defect_log: list[str] = []
        self.relation_count = 0

    def way(self, w) -> None:
        # With locations=True each NodeRef carries a valid .location.
        coords = [
            (nr.location.lon, nr.location.lat)
            for nr in w.nodes
            if nr.location.valid()
        ]
        if coords:
            self.way_coords[w.id] = coords

    def relation(self, r) -> None:
        if r.tags.get("type") != "multipolygon":
            return

        self.relation_count += 1
        outer_rings: list[geom.LinearRing] = []
        inner_rings: list[geom.LinearRing] = []
        missing_ways: list[int] = []

        for member in r.members:
            if member.type != "w":
                continue  # multipolygon members are ways; skip stray node/relation refs
            coords = self.way_coords.get(member.ref)
            if not coords:
                missing_ways.append(member.ref)
                continue
            if len(coords) < 3:
                self.defect_log.append(
                    f"Relation {r.id}: way {member.ref} has fewer than 3 nodes"
                )
                continue

            ring = geom.LinearRing(coords)
            if member.role == "outer":
                outer_rings.append(ring)
            elif member.role == "inner":
                inner_rings.append(ring)

        if missing_ways:
            self.defect_log.append(f"Relation {r.id}: unresolved ways {missing_ways}")
            return
        if not outer_rings:
            self.defect_log.append(f"Relation {r.id}: no outer rings defined")
            return

        try:
            # One outer ring: pair it with all inners directly.
            # Multiple outer rings: let polygonize associate holes to the right shell.
            if len(outer_rings) == 1:
                poly = geom.Polygon(outer_rings[0], inner_rings)
            else:
                polys = list(polygonize(outer_rings + inner_rings))
                poly = unary_union(polys) if polys else geom.Polygon()

            valid_poly = make_valid(poly)
            if valid_poly.is_empty:
                self.defect_log.append(f"Relation {r.id}: empty geometry after validation")
                return

            # Project to a metric CRS for an area sanity check (< 1 m² is degenerate).
            if _project(valid_poly).area < 1.0:
                self.defect_log.append(f"Relation {r.id}: degenerate projected area")
                return

            # Enforce canonical winding (CCW outer / CW inner) before ingestion.
            if isinstance(valid_poly, geom.Polygon):
                valid_poly = orient(valid_poly, sign=1.0)

            self._ingest_to_postgis(r.id, valid_poly, dict(r.tags))

        except Exception as exc:  # GEOS topology failures surface here
            self.defect_log.append(f"Relation {r.id}: geometry construction failed: {exc}")

    def _ingest_to_postgis(self, rel_id: int, poly, tags: dict) -> None:
        # Placeholder for production DB insertion with ST_GeomFromWKB.
        pass


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    handler = MultipolygonETL()
    handler.apply_file("extract.osm.pbf", locations=True, idx="flex_mem")
    logger.info("processed %d multipolygon relations", handler.relation_count)
    for defect in handler.defect_log[:20]:
        logger.warning("DEFECT %s", defect)
```

## Step-by-step walkthrough

1. **Transformer caching** — `_transformer` is built once at module scope. Its constructor queries the PROJ database, so rebuilding it per relation would dominate runtime; `always_xy=True` pins argument order to `(lon, lat)` to match OSM's storage.
2. **First pass (`way`)** — with `locations=True`, every `NodeRef` in `w.nodes` carries a resolved `.location`, so the handler caches `(lon, lat)` arrays keyed by way id for later assembly. For planet runs, swap this dict for an on-disk LMDB/SQLite store.
3. **Relation filter** — only relations tagged `type=multipolygon` proceed; everything else returns immediately so the stream stays cheap.
4. **Role-driven sorting** — each `way` member is looked up; resolved rings are partitioned into `outer_rings` and `inner_rings` strictly by their `role` attribute, never by winding direction.
5. **Reference closure** — any unresolved member (`missing_ways`) aborts that relation with a logged defect rather than emitting a partial, deceptively valid shape — the same closure discipline covered in [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/).
6. **Assembly** — a single outer ring is combined with all inners via `Polygon(shell, holes)`; multiple outer rings are handed to `shapely.ops.polygonize`, which associates each hole with its containing shell, then `unary_union` merges the parts into a MultiPolygon.
7. **Validity repair** — `make_valid` resolves self-touches and bowties into an OGC-valid geometry; an empty result is logged and dropped.
8. **Area sanity check** — the geometry is projected to `EPSG:3857` and rejected if its area is under 1 m², catching collapsed or degenerate rings before they reach the database.
9. **Winding repair** — `orient(poly, sign=1.0)` rewrites the shell counter-clockwise and holes clockwise, the canonical order PostGIS and most renderers expect.

## Verification

Confirm the reconstruction is correct before wiring it into the next stage:

- **Relation count.** The `processed N multipolygon relations` log line should match `osmium fileinfo --extended extract.osm.pbf` relation counts filtered to `type=multipolygon`.
- **Defect ratio.** A healthy country extract logs defects for well under 1% of relations; a spike points to a clip that dropped `complete_ways` at the boundary.
- **Hole presence.** For a known feature with a hole (a lake with an island, an enclave), assert `poly.interiors` is non-empty — a missing interior means an `inner` member was misclassified or unresolved.
- **Validity gate.** After ingestion, `SELECT count(*) FROM features WHERE NOT ST_IsValid(geom)` must return 0; a non-zero count means a ring slipped past `make_valid`.
- **Winding.** `ST_IsPolygonCCW(ST_ExteriorRing(geom))` should be true for every shell after `orient(..., sign=1.0)`.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Polygon comes out inverted / hole becomes the body | Winding inferred from direction instead of role | Trust each member's `role`; build outer first, then `orient(poly, sign=1.0)`. |
| `Missing ways [...]` for edge features | Extract clipped without `complete_ways` | Re-clip with `osmium extract --strategy=complete_ways`. |
| `GEOSException: side location conflict` | Overlapping or self-intersecting rings | Run `make_valid(poly)` and drop any empty result. |
| Holes attached to the wrong shell | Multiple outers paired manually | Use `shapely.ops.polygonize` over the full ring set, then `unary_union`. |
| Feature carries an inner ring's tags | Attribute bleed from member ways | Apply a strict key allowlist; treat relation tags as canonical. |
| `inf`/huge area in the sanity check | Geometry left in WGS 84 degrees | Project with the cached `Transformer` before measuring area. |
| Process killed (OOM) on a planet file | `way_coords` dict held fully in RAM | Switch to `idx="sparse_file_array"` and an on-disk way cache. |

## Specification reference

> A `type=multipolygon` relation builds its area from `outer` and `inner` member roles, not from way winding order; an `inner` ring must be fully contained within a single `outer` ring, and rings must be closed and non-self-intersecting. See the OSM Wiki on [Relation:multipolygon](https://wiki.openstreetmap.org/wiki/Relation:multipolygon) for role rules and the OGC Simple Features access spec for the validity constraints GEOS enforces. OSM stores all coordinates in WGS 84 (EPSG:4326); reconstruct rings first, then project — the [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) covers the granularity/offset decode that yields those coordinates.

For loading into the database, `osm2pgsql --slim --flat-nodes --hstore` preserves multipolygon tags; follow it with `ST_MakeValid` and `ST_CollectionExtract(geom, 3)` to guarantee polygon output, then re-run `ST_IsValid` after each diff merge so community edits cannot quietly reintroduce topology regressions. Projected geometry from this stage feeds metric work most often through [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/).

## Related

- [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — how members and roles resolve into geometry across all relation types.
- [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) — why you reconstruct in WGS 84 and project only afterward.
- [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/) — R-tree and H3 structures for the assembled polygons.
- [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) — the key allowlist that prevents inner-ring tag bleed.
- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — quarantine patterns for the relations this handler rejects.
- [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) — the decode that delivers node coordinates to your handler.

Up one level: [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Understanding OSM Multipolygon Relations for GIS",
  "description": "Reconstruct OSM type=multipolygon relations into OGC-valid polygons in Python: outer/inner roles, hole subtraction, ring winding repair, and topology-safe PostGIS ingestion.",
  "datePublished": "2025-09-12",
  "dateModified": "2026-06-26",
  "articleSection": "OSM Data Fundamentals & Architecture",
  "about": ["OpenStreetMap multipolygon relations", "GIS geometry reconstruction", "PostGIS ingestion"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Fundamentals & Architecture", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/" },
    { "@type": "ListItem", "position": 3, "name": "Node-Way-Relation Data Model", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/" },
    { "@type": "ListItem", "position": 4, "name": "Understanding OSM Multipolygon Relations for GIS", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/understanding-osm-multipolygon-relations-for-gis/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Reconstruct an OSM multipolygon relation into a valid polygon",
  "description": "Two-pass pyosmium and Shapely procedure that assembles outer/inner rings by role, repairs validity and winding, and prepares geometry for PostGIS ingestion.",
  "step": [
    { "@type": "HowToStep", "name": "Cache way coordinates", "text": "Run apply_file with locations=True so pyosmium resolves node locations, then cache (lon, lat) arrays keyed by way id in the first pass." },
    { "@type": "HowToStep", "name": "Partition members by role", "text": "For each type=multipolygon relation, sort resolved way members into outer and inner rings strictly by their role attribute, not by winding direction." },
    { "@type": "HowToStep", "name": "Enforce reference closure", "text": "Abort and log any relation with unresolved members rather than emitting a partial geometry that passes validity checks but is wrong." },
    { "@type": "HowToStep", "name": "Assemble and repair", "text": "Combine a single outer with all inners directly or use shapely.ops.polygonize for multiple outers, then run make_valid to produce an OGC-valid geometry." },
    { "@type": "HowToStep", "name": "Check area and winding", "text": "Project to a metric CRS to reject degenerate sub-1-square-metre shapes, then orient the polygon CCW outer / CW inner before PostGIS ingestion." }
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
      "name": "Why does my multipolygon come out inverted or with a swallowed hole?",
      "acceptedAnswer": { "@type": "Answer", "text": "OSM does not guarantee ring winding order, so inferring outer versus inner from segment direction is unreliable. Trust each member's role, build outer rings first, subtract inner members as holes, then repair winding with orient(poly, sign=1.0)." }
    },
    {
      "@type": "Question",
      "name": "How do I handle a relation with more than one outer ring?",
      "acceptedAnswer": { "@type": "Answer", "text": "Do not pair outers and inners manually. Pass the full ring set to shapely.ops.polygonize, which associates each hole with its containing shell, then merge the parts with unary_union into a MultiPolygon." }
    },
    {
      "@type": "Question",
      "name": "Why are my edge features missing way members?",
      "acceptedAnswer": { "@type": "Answer", "text": "The extract was clipped without complete_ways, so boundary-spanning members were dropped. Re-clip with osmium extract --strategy=complete_ways so every outer and inner member resolves." }
    },
    {
      "@type": "Question",
      "name": "Whose tags win — the relation's or the member ways'?",
      "acceptedAnswer": { "@type": "Answer", "text": "The relation's tags are canonical for the assembled area; member-way tags apply only when a way is used standalone. Apply a strict key allowlist during parsing so inner-ring attributes do not bleed onto the feature." }
    },
    {
      "@type": "Question",
      "name": "Why does the process run out of memory on a planet file?",
      "acceptedAnswer": { "@type": "Answer", "text": "The in-memory way_coords dict cannot hold a planet's ways. Switch the node-location index to sparse_file_array on an NVMe scratch volume and back the way cache with LMDB or SQLite instead of a Python dict." }
    }
  ]
}
</script>
