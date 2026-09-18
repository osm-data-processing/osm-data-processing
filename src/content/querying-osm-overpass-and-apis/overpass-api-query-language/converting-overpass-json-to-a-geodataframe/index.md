---
title: "Converting Overpass JSON to a GeoDataFrame"
description: "Turn each Overpass output mode — center, geom and body — into typed GeoDataFrame rows with valid geometry, keeping element type and id as a composite key."
pageTitle: "Overpass JSON to GeoDataFrame: Every Output Mode"
pageDescription: "Convert Overpass center, geom and body responses into a GeoPandas GeoDataFrame with correct Point, LineString and Polygon geometry and a stable element-type plus id key."
slug: converting-overpass-json-to-a-geodataframe
type: article
breadcrumb: "Overpass JSON to GeoDataFrame"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Converting Overpass JSON to a GeoDataFrame

Take the raw JSON an Overpass query returns and produce a `GeoDataFrame` whose geometry column is correct for every element type, without silently dropping the ways that arrived as node references.

## Prerequisites

- [ ] `geopandas` ≥ 0.14 and `shapely` ≥ 2.0 installed, plus `pandas` for the tag flattening.
- [ ] A response produced by a query whose output mode you know — see [Overpass API Query Language](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/) for what `center`, `geom` and `body` each contain.
- [ ] Python 3.10+ for the union type hints used below.
- [ ] A decision about coordinate reference system handling; everything Overpass returns is in WGS 84 geographic degrees.
- [ ] Optional: a cached response from [Handling Overpass Timeouts and Rate Limits](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/handling-overpass-timeouts-and-rate-limits/) so you can iterate without re-querying.

## Conceptual minimum

An Overpass JSON response is a flat `elements` array, not a nested feature collection. Every entry has a `type` (`node`, `way` or `relation`), an `id`, and usually a `tags` object. What it carries for geometry depends entirely on the output mode the query asked for, and that is the only thing you need to branch on.

With `out center`, ways and relations carry a `center` object with `lat` and `lon`; nodes carry `lat` and `lon` directly. Every row becomes a `Point`, and the conversion is trivial. With `out geom`, ways carry a `geometry` array of coordinate objects, and relations carry a `members` array where each member has its own `geometry`. With `out body`, ways carry only a `nodes` array of node ids, so geometry has to be assembled from the node elements in the same response — which only works if the query included a recursion to fetch them.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="ogd1-t ogd1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="ogd1-t">What each Overpass output mode carries for each element type</title>
  <desc id="ogd1-d">A grid showing what geometry information arrives for nodes, ways and relations under three output modes. Under out center, nodes carry latitude and longitude directly while ways and relations carry a single centre point. Under out geom, nodes carry a coordinate, ways carry a full coordinate array, and relations carry per-member coordinate arrays. Under out body, nodes carry a coordinate, ways carry only node identifiers, and relations carry only member references, so geometry must be assembled from other elements in the same response.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Branch on the output mode, not on the element type</text>
  <rect x="176" y="48" width="226" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="289" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">out center</text>
  <rect x="402" y="48" width="226" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="515" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">out geom</text>
  <rect x="628" y="48" width="226" height="30" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="741" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">out body</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">node</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="289" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">lat and lon</text>
  <text x="515" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">lat and lon</text>
  <text x="741" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">lat and lon</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">way</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="289" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">one centre point</text>
  <text x="515" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">coordinate array</text>
  <text x="741" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">node ids only</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">relation</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="289" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">one centre point</text>
  <text x="515" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">per-member arrays</text>
  <text x="741" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">member refs only</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Assembly needed</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="289" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">none</text>
  <text x="515" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">none</text>
  <text x="741" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">yes, from nodes</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">A converter that guesses the mode from the payload will get it wrong on a mixed response; pass the mode in explicitly.</text>
</svg>
<figcaption>The bottom row is the one that decides your code path: only out body requires you to hold node coordinates in memory.</figcaption>
</figure>

One more model detail matters: **the id is not unique on its own.** A node and a way can share the numeric id 12345, so the key for any table built from OSM elements is the pair `(type, id)`. Losing that distinction is the classic source of phantom duplicates after a join, and it is the same identity problem worked through in [OSM Feature Identity & ID Stability](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/).

## Runnable solution

```python
from __future__ import annotations

import logging
from typing import Any, Literal

import geopandas as gpd
import pandas as pd
from shapely.geometry import LineString, Point, Polygon

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.overpass.geodataframe")

Mode = Literal["center", "geom", "body"]
WGS84 = "EPSG:4326"


def _coords(seq: list[dict[str, float]]) -> list[tuple[float, float]]:
    """Overpass emits {'lat': .., 'lon': ..}; shapely wants (x, y) = (lon, lat)."""
    return [(p["lon"], p["lat"]) for p in seq]


def _is_area(tags: dict[str, str], ring: list[tuple[float, float]]) -> bool:
    """A closed way is an area only if its tags say so — a roundabout is not."""
    if len(ring) < 4 or ring[0] != ring[-1]:
        return False
    if tags.get("area") == "no":
        return False
    return bool(tags.keys() & {"building", "landuse", "natural", "leisure",
                               "amenity", "area", "water", "place"})


def _geometry(el: dict[str, Any], mode: Mode,
              nodes: dict[int, tuple[float, float]]) -> Any | None:
    tags = el.get("tags", {})
    if el["type"] == "node":
        return Point(el["lon"], el["lat"])

    if mode == "center":
        centre = el.get("center")
        return Point(centre["lon"], centre["lat"]) if centre else None

    if mode == "geom":
        if el["type"] == "way":
            ring = _coords(el.get("geometry", []))
            if len(ring) < 2:
                return None
            return Polygon(ring) if _is_area(tags, ring) else LineString(ring)
        # A relation under out geom carries per-member geometry; join the outer
        # members end to end only when the caller has already validated them.
        parts = [_coords(m["geometry"]) for m in el.get("members", [])
                 if m.get("geometry")]
        flat = [pt for part in parts for pt in part]
        return LineString(flat) if len(flat) >= 2 else None

    # mode == "body": ways carry node ids and nothing else.
    if el["type"] == "way":
        ring = [nodes[n] for n in el.get("nodes", []) if n in nodes]
        if len(ring) < 2:
            logger.warning("way %s: %d/%d nodes present — did the query recurse?",
                           el["id"], len(ring), len(el.get("nodes", [])))
            return None
        return Polygon(ring) if _is_area(tags, ring) else LineString(ring)
    return None


def to_geodataframe(payload: dict[str, Any], mode: Mode) -> gpd.GeoDataFrame:
    """Convert one Overpass JSON response into a GeoDataFrame."""
    elements = payload.get("elements", [])
    # Node coordinates are needed only for body mode, but building the map is cheap.
    nodes = {el["id"]: (el["lon"], el["lat"])
             for el in elements if el["type"] == "node" and "lon" in el}

    rows: list[dict[str, Any]] = []
    geoms: list[Any] = []
    skipped = 0
    for el in elements:
        # Untagged nodes exist only to give ways their shape; they are not features.
        if el["type"] == "node" and not el.get("tags"):
            continue
        geom = _geometry(el, mode, nodes)
        if geom is None or geom.is_empty:
            skipped += 1
            continue
        row: dict[str, Any] = {
            "osm_type": el["type"],
            "osm_id": el["id"],
            "osm_key": f"{el['type']}/{el['id']}",   # the only unique key
        }
        row.update(el.get("tags", {}))
        rows.append(row)
        geoms.append(geom)

    frame = gpd.GeoDataFrame(pd.DataFrame(rows), geometry=geoms, crs=WGS84)
    logger.info("built %d feature(s), skipped %d without usable geometry",
                len(frame), skipped)
    return frame


if __name__ == "__main__":
    sample = {"elements": [
        {"type": "node", "id": 1, "lat": 50.06, "lon": 19.94,
         "tags": {"amenity": "pharmacy", "name": "Apteka"}},
        {"type": "way", "id": 2, "center": {"lat": 50.07, "lon": 19.95},
         "tags": {"amenity": "pharmacy"}},
    ]}
    gdf = to_geodataframe(sample, mode="center")
    logger.info("columns: %s", list(gdf.columns))
```

## Step-by-step walkthrough

1. **Take the mode as an argument.** The converter never guesses. A mixed response — some elements with `center`, some with `geometry` — is a symptom of two queries merged, and guessing hides it.
2. **Build the node map once.** In `body` mode the node coordinates are the only source of way geometry, so they are collected in a single pass before any way is touched.
3. **Skip untagged nodes.** A query with a recursion returns thousands of geometry-carrier nodes with no tags. They are not features and including them turns a table of two hundred pharmacies into one of forty thousand rows.
4. **Swap the coordinate order.** Overpass names its fields `lat` and `lon`; Shapely takes `(x, y)`, which is `(lon, lat)`. This inversion is the single most common bug in OSM conversion code and it produces plausible-looking points in the wrong hemisphere.
5. **Decide area-ness from tags, not from closure.** A closed way is a ring, but a roundabout is a closed *line*. The tag test is what distinguishes a building outline from a circular road, and getting it wrong silently converts roads into polygons.
6. **Warn on incomplete ways.** In `body` mode a way whose nodes are missing means the query had no recursion. The warning names that cause, because the symptom — empty geometry — does not.
7. **Keep a composite key.** `osm_key` is `type/id`, which is the only unique identifier. Every downstream join should use it rather than the bare numeric id.
8. **Flatten tags into columns.** Spreading the tag dictionary across columns gives a usable analytic frame; in a wide, sparse result you may prefer to keep the dictionary in one column instead.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="ogd2-t ogd2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="ogd2-t">The four transformations between an Overpass response and a usable frame</title>
  <desc id="ogd2-d">Four steps. First index the nodes in the response by identifier so way geometry can be assembled. Second drop the untagged nodes, which exist only to carry coordinates and are not features. Third build geometry per element according to the declared output mode, deciding area versus line from the tags. Fourth assemble the frame with a composite type and identifier key, flattened tags, and an explicit WGS 84 coordinate reference system.</desc>
  <defs><marker id="ogd2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four steps from response to frame</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">index nodes</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">id to coordinate</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">needed for body mode</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#ogd2-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">drop carriers</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">untagged nodes out</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">they are not features</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#ogd2-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">build geometry</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">branch on the mode</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">tags decide area or line</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#ogd2-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">assemble</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">composite key, flat tags</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">set the CRS explicitly</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Step two is the one that turns a table of two hundred features into one of forty thousand rows when it is skipped.</text>
</svg>
<figcaption>Only the third step is interesting; the other three are where the bugs actually live.</figcaption>
</figure>

## Verification

- **Row count matches the tagged element count.** Count elements in the raw JSON that carry a `tags` object; the frame should have that many rows minus any with unusable geometry.
- **No geometry in the wrong hemisphere.** Assert every point's latitude is within your query's bounding box. A swapped coordinate order shows up immediately as a point off the coast of Africa.
- **Closed roads are lines.** Find a roundabout in the result and confirm its geometry type is `LineString`, not `Polygon`.
- **The key is unique.** `frame["osm_key"].is_unique` must be `True`; if it is not, the response contained the same element twice, which happens when two union branches overlap.
- **The CRS is set.** `frame.crs` must be WGS 84; an unset CRS silently breaks every later reprojection, as covered in [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/).

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="ogd3-t ogd3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="ogd3-t">Three conversion bugs that produce plausible-looking but wrong output</title>
  <desc id="ogd3-d">Three panels naming bugs whose symptom is not an error. Swapped coordinates produce valid points in the wrong part of the world and are caught by asserting latitude against the query bounding box. Included carrier nodes inflate the row count by orders of magnitude and are caught by comparing the frame length against the count of tagged elements. Closure used as the area test converts roundabouts into polygons and is caught by checking a known circular road's geometry type.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three bugs that never raise an exception</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Swapped coordinates</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Symptom: points far from the query</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Cause: lat/lon order to Point()</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Numbers stay valid, plots fine</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Catch: assert lat in the bbox</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Carrier nodes kept</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Symptom: 40k rows, not 200</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Cause: untagged nodes included</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Every way node became a feature</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Catch: compare to tagged count</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Closure as area test</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Symptom: roads became polygons</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Cause: ring closure used alone</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Area totals silently inflated</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Catch: check a known roundabout</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">None of these three raises anything: each produces a full frame with the right column names and the wrong contents.</text>
</svg>
<figcaption>Every one of these is caught by a single assertion, and none of them is caught by reading the code.</figcaption>
</figure>

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Points in the Gulf of Guinea | Latitude and longitude swapped | Shapely takes `(lon, lat)`, Overpass gives `lat`, `lon` |
| Tens of thousands of empty rows | Untagged carrier nodes included | Skip nodes with no `tags` key |
| Ways have no geometry | `out body` without a recursion | Add `>;` before `out`, or switch to `out geom` |
| Roundabouts became polygons | Closure used as the area test | Decide area-ness from tags, not from a closed ring |
| Duplicate features after a join | Joined on `osm_id` alone | Join on the `type/id` composite key |
| `ValueError` on empty frame | No elements matched the query | Return an empty frame with the right columns and CRS |
| Reprojection silently wrong | `crs` never set on construction | Pass `crs="EPSG:4326"` when building the frame |

## Specification reference

> The Overpass JSON output format returns a top-level `elements` array in which each element carries `type` and `id`, with `lat` and `lon` on nodes, an optional `center` when the query used the `center` output mode, and an optional `geometry` array of coordinate objects when it used `geom`. Relation members appear under `members` with their own role and, under `geom`, their own geometry. See the [Overpass API output formats documentation](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL) for the field-level definition of each mode.

## Frequently Asked Questions

<details>
<summary>Why are my points in the wrong place?</summary>

Almost certainly because latitude and longitude were passed to Shapely in the order Overpass names them. Overpass returns objects with lat and lon fields, but Shapely's Point constructor takes x then y, which is longitude then latitude. Swapping them produces coordinates that are still valid numbers and still plot, which is why the bug survives review — the points land in a plausible-looking but completely wrong part of the world.
</details>

<details>
<summary>How do I tell a closed way that is an area from one that is a line?</summary>

By its tags, never by whether the ring closes. A roundabout, a racetrack and a circular hiking route are all closed ways that are genuinely lines. The convention is that certain keys imply an area — building, landuse, natural, leisure and others — and that an explicit area equals no overrides them. Encode that test once and apply it everywhere, because deciding from closure alone converts roads into polygons and quietly corrupts any area calculation downstream.
</details>

<details>
<summary>Should tags become columns or stay in one dictionary column?</summary>

It depends on the shape of the result. For a focused query where most features share a handful of keys, flattening into columns gives a frame you can filter and group naturally. For a broad query across many feature types, flattening produces a very wide and very sparse table, and keeping the tags as a single dictionary or JSON column is both smaller and easier to work with. Decide per query rather than adopting one rule.
</details>

<details>
<summary>Why does my way have no geometry under out body?</summary>

Because out body returns ways as lists of node identifiers and nothing else, and those nodes are only present in the response if the query asked for them with a recursion operator. Without the recursion the converter has ids that resolve to nothing. Either add the recursion before the output statement so the nodes arrive alongside the ways, or switch to out geom and let the server inline the coordinates for you.
</details>

## Related

- [Overpass API Query Language](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/) — the parent topic and the output modes this converter branches on.
- [Handling Overpass Timeouts and Rate Limits](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/handling-overpass-timeouts-and-rate-limits/) — the cached client that makes iterating on this conversion cheap.
- [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) — why the CRS must be set at construction.
- [Understanding OSM Multipolygon Relations for GIS](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/understanding-osm-multipolygon-relations-for-gis/) — the relation assembly this converter deliberately does not attempt.
- [Exporting OSM to GeoParquet & PostGIS](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/) — where the resulting frame usually goes next.

Up one level: [Overpass API Query Language](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Converting Overpass JSON to a GeoDataFrame",
  "description": "Turn each Overpass output mode — center, geom and body — into typed GeoDataFrame rows with valid geometry, keeping element type and id as a composite key.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Querying OSM: Overpass, Nominatim & APIs",
  "about": ["Overpass JSON", "GeoPandas conversion", "OSM geometry assembly"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Querying OSM: Overpass, Nominatim & APIs", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/" },
    { "@type": "ListItem", "position": 3, "name": "Overpass API Query Language", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/" },
    { "@type": "ListItem", "position": 4, "name": "Converting Overpass JSON to a GeoDataFrame", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/converting-overpass-json-to-a-geodataframe/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Convert an Overpass JSON response into a GeoDataFrame",
  "description": "Branch on the declared output mode, skip untagged carrier nodes, build geometry with the correct coordinate order and area test, and assemble a frame keyed on element type and id.",
  "step": [
    { "@type": "HowToStep", "name": "Pass the mode explicitly", "text": "Take the output mode as an argument rather than inferring it, so a mixed response surfaces as an error instead of silently converting." },
    { "@type": "HowToStep", "name": "Index the nodes", "text": "Collect node coordinates into a map keyed on id in one pass, which is the only source of way geometry in body mode." },
    { "@type": "HowToStep", "name": "Skip carrier nodes", "text": "Drop nodes with no tags, because they exist to give ways their shape and are not features in their own right." },
    { "@type": "HowToStep", "name": "Build geometry correctly", "text": "Pass coordinates to Shapely as longitude then latitude, and decide whether a closed way is an area from its tags rather than from ring closure." },
    { "@type": "HowToStep", "name": "Key on type and id", "text": "Store a composite key combining element type and numeric id, because ids are only unique within a type." },
    { "@type": "HowToStep", "name": "Set the CRS", "text": "Construct the frame with an explicit WGS 84 coordinate reference system so later reprojections are correct." }
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
      "name": "Why are my points in the wrong place?",
      "acceptedAnswer": { "@type": "Answer", "text": "Almost certainly because latitude and longitude were passed to Shapely in the order Overpass names them. Overpass returns objects with lat and lon fields, but Shapely's Point constructor takes x then y, which is longitude then latitude. Swapping them produces coordinates that are still valid numbers and still plot, which is why the bug survives review." }
    },
    {
      "@type": "Question",
      "name": "How do I tell a closed way that is an area from one that is a line?",
      "acceptedAnswer": { "@type": "Answer", "text": "By its tags, never by whether the ring closes. A roundabout, a racetrack and a circular hiking route are all closed ways that are genuinely lines. The convention is that certain keys imply an area — building, landuse, natural, leisure and others — and that an explicit area equals no overrides them. Deciding from closure alone converts roads into polygons." }
    },
    {
      "@type": "Question",
      "name": "Should tags become columns or stay in one dictionary column?",
      "acceptedAnswer": { "@type": "Answer", "text": "It depends on the shape of the result. For a focused query where most features share a handful of keys, flattening into columns gives a frame you can filter and group naturally. For a broad query across many feature types, flattening produces a very wide and very sparse table, and keeping the tags as a single dictionary or JSON column is both smaller and easier to work with." }
    },
    {
      "@type": "Question",
      "name": "Why does my way have no geometry under out body?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because out body returns ways as lists of node identifiers and nothing else, and those nodes are only present in the response if the query asked for them with a recursion operator. Without the recursion the converter has ids that resolve to nothing. Either add the recursion before the output statement, or switch to out geom and let the server inline the coordinates." }
    }
  ]
}
</script>
