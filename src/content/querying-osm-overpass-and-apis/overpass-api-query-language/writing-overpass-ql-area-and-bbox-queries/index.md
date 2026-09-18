---
title: "Writing Overpass QL Area and Bounding Box Queries"
description: "Resolve an administrative area reliably, choose between an area filter and a bounding box, and assert the spatial set is non-empty before the rest of the query depends on it."
pageTitle: "Overpass QL: Area vs Bounding Box Spatial Filters"
pageDescription: "Bind an Overpass area by name and admin level, fall back to a bounding box when no boundary is mapped, and guard against the empty-area failure that returns no data and no error."
slug: writing-overpass-ql-area-and-bbox-queries
type: article
breadcrumb: "Area & Bbox Queries"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Writing Overpass QL Area and Bounding Box Queries

Select every feature inside a named administrative boundary — or inside a rectangle when no boundary is mapped — without hitting the silent failure where an unresolved area returns zero elements and no error at all.

## Prerequisites

- [ ] An Overpass endpoint you are allowed to query, and a client that sets an identifying `User-Agent`.
- [ ] Familiarity with the set model described in [Overpass API Query Language](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/) — this guide binds sets constantly.
- [ ] Python 3.10+ with `requests` installed, if you want to run the client below rather than paste queries into a web form.
- [ ] A rough bounding box for your area of interest, as a fallback and as a sanity check on whatever the area filter returns.
- [ ] Optional: `shapely` ≥ 2.0 if you want to verify returned points fall inside the boundary you thought you asked for.

## Conceptual minimum

Overpass has two ways to say "inside here", and they are not variations of one idea. A **bounding box** is a rectangle in degrees, written `(south,west,north,east)`, tested by coordinate comparison. It is cheap, exact, and completely indifferent to what is actually mapped — it will happily span three countries and half the sea.

An **area filter** tests membership of a polygon derived from a mapped closed way or relation. Areas are not first-class OSM objects; the Overpass server derives them from boundary relations and closed ways during its own area-generation pass, and it assigns them synthetic ids offset from the source object's id. That derivation is why two things are true at once: an area filter is the only way to ask a question that respects a real administrative edge, and an area filter is the only spatial filter that can silently match nothing because the boundary you named is spelled differently, tagged at a different `admin_level`, or simply not present in the server's area index.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 260" role="img" aria-labelledby="aqb1-t aqb1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="aqb1-t">Bounding box and area filters compared on precision, cost and how each one fails</title>
  <desc id="aqb1-d">Two panels. A bounding box is a rectangle in degrees tested by coordinate comparison, is the cheapest spatial filter, always matches something, and fails by returning too much — features from neighbouring regions that happen to fall inside the rectangle. An area filter tests membership of a polygon derived from a boundary relation, costs more, respects the real administrative edge, and fails silently by matching nothing at all when the name or admin level does not resolve.</desc>
  <rect x="0" y="0" width="880" height="260" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Two spatial filters, two completely different failure modes</text>
  <rect x="26" y="52" width="401" height="174" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="226" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Bounding box</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">A rectangle in degrees</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Tested by coordinate comparison</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Cheapest spatial filter there is</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Always matches something</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Fails by returning too much</text>
  <text x="40" y="209" font-size="10.5" fill="currentColor" opacity="0.92">Neighbouring regions leak in</text>
  <rect x="453" y="52" width="401" height="174" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="654" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Area filter</text>
  <text x="467" y="104" font-size="10.5" fill="currentColor" opacity="0.92">A polygon from a boundary relation</text>
  <text x="467" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Derived, with a synthetic id</text>
  <text x="467" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Costs more than a rectangle</text>
  <text x="467" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Respects the real administrative edge</text>
  <text x="467" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Fails by matching nothing</text>
  <text x="467" y="209" font-size="10.5" fill="currentColor" opacity="0.92">And reports no error when it does</text>
  <text x="868" y="244" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">A rectangle over-selects loudly and an area under-selects silently, which is why the area form needs an explicit non-empty assertion.</text>
</svg>
<figcaption>The rectangle's failure shows up in the data; the area's failure shows up as an empty file nobody questions.</figcaption>
</figure>

The practical consequence is a rule: **resolve the area by tags, bind it to a named set, and assert it is non-empty before anything else uses it.** Never compute an area id by hand from a relation id, and never assume a name matched.

## Runnable solution

The module below resolves an area, checks it resolved, and runs the real query against it — falling back to a bounding box when the boundary is not available.

```python
from __future__ import annotations

import logging
from dataclasses import dataclass

import requests

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.overpass.area")

ENDPOINT = "https://overpass-api.de/api/interpreter"
HEADERS = {"User-Agent": "osm-pipeline-example/1.0 (contact@example.org)"}


@dataclass(frozen=True)
class Bbox:
    south: float
    west: float
    north: float
    east: float

    def ql(self) -> str:
        return f"({self.south},{self.west},{self.north},{self.east})"


def _post(query: str, timeout: int = 180) -> dict:
    response = requests.post(ENDPOINT, data={"data": query},
                             headers=HEADERS, timeout=timeout)
    response.raise_for_status()
    return response.json()


def area_exists(name: str, admin_level: int) -> bool:
    """Confirm the boundary resolves to exactly one area before relying on it."""
    query = (
        "[out:json][timeout:25];\n"
        f'area["name"="{name}"]["admin_level"="{admin_level}"]->.a;\n'
        ".a out count;"
    )
    payload = _post(query, timeout=60)
    # `out count` returns a single element whose tags carry the totals.
    tags = payload.get("elements", [{}])[0].get("tags", {})
    total = int(tags.get("total", 0))
    logger.info("area %r at admin_level %s resolved to %d area(s)",
                name, admin_level, total)
    return total == 1


def pois_in_area(name: str, admin_level: int, key: str, value: str) -> list[dict]:
    """Every node/way/relation with key=value inside a named administrative area."""
    query = (
        "[out:json][timeout:120];\n"
        f'area["name"="{name}"]["admin_level"="{admin_level}"]->.a;\n'
        "(\n"
        f'  node["{key}"="{value}"](area.a);\n'
        f'  way["{key}"="{value}"](area.a);\n'
        f'  relation["{key}"="{value}"](area.a);\n'
        ");\n"
        "out center tags;"
    )
    return _post(query)["elements"]


def pois_in_bbox(bbox: Bbox, key: str, value: str) -> list[dict]:
    """The same question, bounded by a rectangle instead of a boundary relation."""
    query = (
        "[out:json][timeout:120];\n"
        "(\n"
        f'  node["{key}"="{value}"]{bbox.ql()};\n'
        f'  way["{key}"="{value}"]{bbox.ql()};\n'
        f'  relation["{key}"="{value}"]{bbox.ql()};\n'
        ");\n"
        "out center tags;"
    )
    return _post(query)["elements"]


def fetch(name: str, admin_level: int, fallback: Bbox,
          key: str, value: str) -> list[dict]:
    """Prefer the administrative boundary; fall back to the rectangle, loudly."""
    if area_exists(name, admin_level):
        return pois_in_area(name, admin_level, key, value)
    logger.warning("no single area for %r at admin_level %s — using the bbox fallback,"
                   " results will include neighbouring territory", name, admin_level)
    return pois_in_bbox(fallback, key, value)


if __name__ == "__main__":
    elements = fetch(
        name="Kraków", admin_level=8,
        fallback=Bbox(49.96, 19.79, 50.13, 20.22),
        key="amenity", value="pharmacy",
    )
    logger.info("fetched %d element(s)", len(elements))
```

## Step-by-step walkthrough

1. **Resolve before you query.** `area_exists` runs a tiny query whose only job is to count how many areas match the name and administrative level. It costs almost nothing and converts the silent failure into a decision.
2. **Insist on exactly one.** A count of zero means the boundary did not resolve; a count above one means the name is ambiguous, and picking arbitrarily between two areas called the same thing is worse than failing. Both cases fall through to the fallback.
3. **Bind the area once.** The real query resolves the boundary a second time but binds it with `->.a` and references `.a` from all three element queries, so the boundary is resolved once per query rather than once per element type.
4. **Name the element types explicitly.** Pharmacies exist as nodes, as building ways, and occasionally as relations. Listing all three is deliberate; using `nwr` would also work but makes the candidate set larger than necessary when you only want one type.
5. **Ask for centres, not geometry.** `out center tags` gives one coordinate plus the tags per feature, which is exactly what a point-of-interest table needs and a fraction of the payload of `out geom`.
6. **Make the fallback loud.** The warning names the consequence — results will include neighbouring territory — because a bounding box quietly substituted for a boundary is a correctness change, not a performance tweak.
7. **Keep the bbox honest.** The fallback rectangle is passed in, not computed, so the caller owns the decision about how much surrounding territory is acceptable.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="aqb2-t aqb2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="aqb2-t">The resolve, assert, query, verify sequence for an area-bounded query</title>
  <desc id="aqb2-d">Four steps. First resolve the boundary by name and administrative level with a cheap count query. Second assert that exactly one area matched, treating zero as unresolved and more than one as ambiguous. Third run the real query with the area bound to a named set and referenced from each element query. Fourth verify the returned feature count and a sample coordinate against the expected bounding box, so a wrong boundary is caught before the data is used.</desc>
  <defs><marker id="aqb2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four steps, and the second one is the one people skip</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">resolve</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">name plus admin_level</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">a cheap count query</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#aqb2-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">assert</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">exactly one area</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">zero or many both fail</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#aqb2-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">query</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">bind once, reference</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">name the element types</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#aqb2-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">verify</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">count and a sample point</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">against the expected bbox</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Skipping the assertion is what turns a misspelled place name into an empty dataset that flows downstream without complaint.</text>
</svg>
<figcaption>The assertion costs one small request and removes the only failure mode of this query that produces no error.</figcaption>
</figure>

## Verification

- **The area count is exactly one.** Run the `area_exists` query by hand for your boundary; a count of zero or two means the query you are about to run is not asking what you think.
- **The result count is plausible.** A city of a million people has tens of pharmacies, not two and not eleven thousand. An order-of-magnitude surprise usually means the area resolved to the wrong administrative level.
- **A sample point lies inside the fallback bbox.** Take the `center` of any returned element and confirm it falls inside your rectangle; if it does not, the area you resolved is somewhere else entirely — a same-named place in another country is the usual culprit.
- **The area and bbox answers overlap sensibly.** Run both forms once during development. The bbox result should be a superset of the area result; if the area result contains elements the bbox does not, one of the two is wrong.
- **Repeat runs agree.** Two runs minutes apart should return nearly identical counts. A large swing means you are hitting different servers in a load-balanced pool with different area-generation freshness.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="aqb3-t aqb3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="aqb3-t">How administrative level maps to the unit you probably mean, by country group</title>
  <desc id="aqb3-d">A grid showing which administrative level corresponds to a state or province, a county or district, and a municipality across three country groups. Much of Europe uses four for a state, six for a county and eight for a municipality. The United States uses four for a state, six for a county and eight for a city. Many other countries diverge, using four or five for a first-level division and seven or eight for a local one. A note says the level must be verified per country rather than assumed.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">admin_level is not portable — verify it per country</text>
  <rect x="216" y="48" width="213" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="322" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Much of Europe</text>
  <rect x="429" y="48" width="213" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="535" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">United States</text>
  <rect x="641" y="48" width="213" height="30" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="748" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Elsewhere</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">State or province</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="322" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">4</text>
  <text x="535" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">4</text>
  <text x="748" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">4 or 5</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">County or district</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="322" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">6</text>
  <text x="535" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">6</text>
  <text x="748" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">5 to 7</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Municipality</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="322" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">8</text>
  <text x="535" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">8</text>
  <text x="748" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">7 to 9</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Neighbourhood</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="322" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">10</text>
  <text x="535" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">10 rarely used</text>
  <text x="748" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">9 to 11</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Record the verified level alongside each region in your configuration; a level that worked in one country is not evidence for the next one.</text>
</svg>
<figcaption>The same number means different things in different places, which is why a level hard-coded across a multi-country job eventually returns a region instead of a city.</figcaption>
</figure>

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Zero elements, HTTP 200 | The area did not resolve | Assert the area count before the real query |
| Elements from the wrong country | A same-named place matched first | Add a `["ISO3166-1"]` or parent-area constraint |
| Far too many elements | `admin_level` too coarse — a region, not a city | Raise the level; 8 is a typical municipality |
| `runtime error: Query run out of memory` | Area filter applied to an unbounded element query | Add a tag filter before the area filter |
| Hand-computed area id returns nothing | Area ids are derived, not equal to relation ids | Resolve by tags, never by arithmetic on an id |
| Ways returned without coordinates | `out body` instead of `out center` or `out geom` | Choose an output mode that carries geometry |
| Different counts on repeated runs | Different servers in the public pool | Pin an endpoint, or accept the variance explicitly |

## Specification reference

> Overpass generates area objects from closed ways and boundary relations during a separate area-generation pass, and identifies them with ids derived from — but not equal to — the source object's id. An `area` query filters those generated objects by tag exactly as an element query filters elements, and the `(area.setname)` filter then selects elements located inside them. See the Overpass QL documentation on [area filters and the area statement](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL) for the exact derivation rules and the set-binding syntax used throughout this guide.

## Frequently Asked Questions

<details>
<summary>Why does my area query return nothing when the city obviously exists?</summary>

Because the area did not resolve, and an unresolved area produces an empty result rather than an error. The usual causes are a name that differs from the mapped value by an accent or a suffix, an administrative level that is wrong for that country's hierarchy, or a boundary the server has not generated an area for. Run a small count query against the area statement alone before the real query, and treat a count other than one as a failure.
</details>

<details>
<summary>What administrative level should I use for a city?</summary>

There is no single answer, because the meaning of each level varies by country. Level eight is a municipality in much of Europe and is the most common choice for a city, but some countries use six or seven for the same concept and others attach the city name to a level that also covers surrounding rural territory. Resolve by name first, inspect what came back, and record the level you verified for each country rather than assuming one value travels.
</details>

<details>
<summary>Can I compute the area id from a relation id?</summary>

You can, and you should not. The derivation is an implementation detail of the area-generation pass, it differs between ways and relations, and a hand-computed id that happens to work today is exactly the kind of assumption that breaks silently later. Resolve areas by their tags, bind the result to a named set, and let the server tell you what matched.
</details>

<details>
<summary>Is a bounding box ever better than an area?</summary>

Yes, in two cases. When no boundary is mapped for the region you want, a rectangle is the only option. And when you are running a scheduled job where a predictable cost matters more than a precise edge, a rectangle's cost is easy to estimate by eye while an area's depends on the complexity of the boundary polygon. Accept that a rectangle over-selects, and filter the surplus out downstream where you can see what you removed.
</details>

## Related

- [Overpass API Query Language](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/) — the parent topic with the set model and filter cost ordering this query relies on.
- [Handling Overpass Timeouts and Rate Limits](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/handling-overpass-timeouts-and-rate-limits/) — the client behaviour that keeps a scheduled version of this query welcome.
- [Converting Overpass JSON to a GeoDataFrame](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/converting-overpass-json-to-a-geodataframe/) — turning the elements returned here into typed rows.
- [OSM Extract Clipping & Boundaries](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/) — the local-file equivalent of an area filter.
- [Building a .poly File from an OSM Admin Relation](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/building-a-poly-file-from-an-osm-admin-relation/) — reusing the same boundary offline.

Up one level: [Overpass API Query Language](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Writing Overpass QL Area and Bounding Box Queries",
  "description": "Resolve an administrative area reliably, choose between an area filter and a bounding box, and assert the spatial set is non-empty before the rest of the query depends on it.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Querying OSM: Overpass, Nominatim & APIs",
  "about": ["Overpass area filter", "bounding box query", "OSM administrative boundaries"]
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
    { "@type": "ListItem", "position": 4, "name": "Writing Overpass QL Area and Bounding Box Queries", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/writing-overpass-ql-area-and-bbox-queries/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Bound an Overpass query by an administrative area with a bounding box fallback",
  "description": "Resolve an OSM boundary to an Overpass area, assert exactly one match, run the bounded query, and fall back to an explicit rectangle when no boundary resolves.",
  "step": [
    { "@type": "HowToStep", "name": "Resolve the boundary", "text": "Run a small count query against an area statement filtered by name and administrative level." },
    { "@type": "HowToStep", "name": "Assert exactly one match", "text": "Treat a count of zero as unresolved and a count above one as ambiguous, and fail over rather than guessing." },
    { "@type": "HowToStep", "name": "Bind and reuse the area", "text": "Bind the resolved area to a named set and reference it from each element query so the boundary resolves once per query." },
    { "@type": "HowToStep", "name": "Choose an output mode", "text": "Request representative centres plus tags when a point-of-interest table is the consumer, rather than full inlined geometry." },
    { "@type": "HowToStep", "name": "Fall back loudly", "text": "When no single area resolves, run the bounding-box form and log that results will include neighbouring territory." },
    { "@type": "HowToStep", "name": "Verify the result", "text": "Check the element count is plausible and that a sample centre coordinate falls inside the expected rectangle." }
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
      "name": "Why does my area query return nothing when the city obviously exists?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because the area did not resolve, and an unresolved area produces an empty result rather than an error. The usual causes are a name that differs from the mapped value by an accent or a suffix, an administrative level that is wrong for that country's hierarchy, or a boundary the server has not generated an area for. Run a small count query against the area statement alone before the real query, and treat a count other than one as a failure." }
    },
    {
      "@type": "Question",
      "name": "What administrative level should I use for a city?",
      "acceptedAnswer": { "@type": "Answer", "text": "There is no single answer, because the meaning of each level varies by country. Level eight is a municipality in much of Europe and is the most common choice for a city, but some countries use six or seven for the same concept. Resolve by name first, inspect what came back, and record the level you verified for each country rather than assuming one value travels." }
    },
    {
      "@type": "Question",
      "name": "Can I compute the area id from a relation id?",
      "acceptedAnswer": { "@type": "Answer", "text": "You can, and you should not. The derivation is an implementation detail of the area-generation pass, it differs between ways and relations, and a hand-computed id that happens to work today is exactly the kind of assumption that breaks silently later. Resolve areas by their tags, bind the result to a named set, and let the server tell you what matched." }
    },
    {
      "@type": "Question",
      "name": "Is a bounding box ever better than an area?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes, in two cases. When no boundary is mapped for the region you want, a rectangle is the only option. And when you are running a scheduled job where a predictable cost matters more than a precise edge, a rectangle's cost is easy to estimate by eye while an area's depends on the complexity of the boundary polygon. Accept that a rectangle over-selects, and filter the surplus out downstream." }
    }
  ]
}
</script>
