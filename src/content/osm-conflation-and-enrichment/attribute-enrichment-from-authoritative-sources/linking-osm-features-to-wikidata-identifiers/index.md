---
title: "Linking OSM Features to Wikidata Identifiers"
description: "Establish durable identifier links between OSM features and an external knowledge base, verify them against coordinates and types, and use them to make every later enrichment nearly free."
pageTitle: "Linking OSM Features to Wikidata Identifiers Reliably"
pageDescription: "Create and verify wikidata links on OSM features: confirm the entity's coordinate and instance type, detect reciprocal links, and treat the identifier as the strongest conflation signal available."
slug: linking-osm-features-to-wikidata-identifiers
type: article
breadcrumb: "Wikidata Links"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Linking OSM Features to Wikidata Identifiers

A shared identifier turns conflation from a scoring problem into a lookup. Establishing one correctly is worth considerable care, because a wrong link is both more damaging and far harder to notice than a wrong fuzzy match.

## Prerequisites

- [ ] Python 3.10+ with `requests`; the query endpoint returns JSON.
- [ ] OSM features carrying a `wikidata` tag, or candidates from a matcher per [Matching OSM Features to External Datasets](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/).
- [ ] An identifying `User-Agent`, since the knowledge base's endpoints apply the same etiquette as OSM's own.
- [ ] A metric distance function, or geographic distance handled correctly.
- [ ] The enrichment discipline from [Attribute Enrichment from Authoritative Sources](https://www.osm-data-processing.org/osm-conflation-and-enrichment/attribute-enrichment-from-authoritative-sources/).

## Conceptual minimum

A knowledge-base identifier is an assertion that an OSM feature and an external entity are **the same thing in the world**. That is a stronger claim than "these two records look similar", and it earns its strength by being verifiable in a way a fuzzy score is not.

Two properties make verification possible. The entity carries a **coordinate**, so a link can be checked against the OSM feature's position. And it carries a **type** — an "instance of" statement — so a link can be checked for category agreement: an OSM railway station linked to an entity that is a human is wrong regardless of how well the names match.

The third property is the one that makes the whole exercise worthwhile: **links are reciprocal in practice**. The knowledge base frequently records the OSM relation or way identifier for administrative entities, and OSM records the entity identifier. Where both directions exist and agree, the link is about as certain as anything in this section gets.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="lwi1-t lwi1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="lwi1-t">Three checks that verify an identifier link, and what each one catches</title>
  <desc id="lwi1-d">Three panels. The coordinate check compares the entity's recorded position against the OSM feature's, catching links to a same-named place somewhere else entirely. The type check compares the entity's instance-of statement against the OSM feature's category, catching links to a person, a book or a film that shares a name with a place. The reciprocity check looks for the entity recording the OSM identifier back, which when present makes the link close to certain and when contradictory is a strong signal that one side is wrong.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three checks, three different wrong links</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Coordinate</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Entity position versus OSM</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Catches the same name elsewhere</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Tolerance by feature size</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">A city needs kilometres</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Type</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Instance-of versus category</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Catches a person or a film</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Needs a type mapping</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Cheap and decisive</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Reciprocity</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Does it link back to OSM?</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Present and agreeing: certain</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Present and differing: alarm</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Absent: neutral, not bad</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Absent reciprocity is not evidence against a link; most features have no reason for the knowledge base to record them.</text>
</svg>
<figcaption>Each check catches a different wrong link, and the type check is both the cheapest and the most decisive.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
import math
from dataclasses import dataclass

import requests

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.enrich.wikidata")

ENDPOINT = "https://query.wikidata.org/sparql"
HEADERS = {
    "User-Agent": "osm-pipeline-example/1.0 (contact@example.org)",
    "Accept": "application/sparql-results+json",
}
EARTH_RADIUS_M = 6_371_008.8

# OSM category -> acceptable entity types. Deliberately broad: the check is
# meant to catch a person or a film, not to police fine-grained taxonomy.
TYPE_EXPECTATIONS: dict[str, set[str]] = {
    "railway_station": {"Q55488", "Q55678", "Q4167836"},
    "museum": {"Q33506", "Q207694"},
    "school": {"Q3914", "Q9842"},
    "church": {"Q16970", "Q1370598"},
}


QUERY_TEMPLATE = """
SELECT ?item ?coord ?type ?osmRel WHERE {
  VALUES ?item { __VALUES__ }
  OPTIONAL { ?item wdt:P625 ?coord. }
  OPTIONAL { ?item wdt:P31 ?type. }
  OPTIONAL { ?item wdt:P402 ?osmRel. }
}
"""


@dataclass(frozen=True)
class Verdict:
    qid: str
    ok: bool
    distance_m: float | None
    type_ok: bool | None
    reciprocal: bool
    reason: str


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def fetch_entities(qids: list[str]) -> dict[str, dict]:
    """One query for many entities: never one request per feature."""
    values = " ".join(f"wd:{q}" for q in qids)
    # Built by substitution rather than an f-string: a SPARQL query is full of
    # braces, and escaping every one of them makes the query unreadable.
    query = QUERY_TEMPLATE.replace("__VALUES__", values)
    response = requests.get(ENDPOINT, params={"query": query},
                            headers=HEADERS, timeout=120)
    response.raise_for_status()

    out: dict[str, dict] = {}
    for row in response.json()["results"]["bindings"]:
        qid = row["item"]["value"].rsplit("/", 1)[-1]
        entry = out.setdefault(qid, {"types": set(), "coord": None,
                                     "osm_relation": None})
        if "type" in row:
            entry["types"].add(row["type"]["value"].rsplit("/", 1)[-1])
        if "coord" in row and entry["coord"] is None:
            # Point(lon lat) — longitude first, as in every WKT.
            lon, lat = row["coord"]["value"].strip("Point()").split()
            entry["coord"] = (float(lat), float(lon))
        if "osmRel" in row:
            entry["osm_relation"] = row["osmRel"]["value"]
    return out


def verify(qid: str, entity: dict, osm_lat: float, osm_lon: float,
           osm_category: str, osm_relation_id: str | None,
           tolerance_m: float) -> Verdict:
    distance = None
    if entity.get("coord"):
        distance = haversine(osm_lat, osm_lon, *entity["coord"])
        if distance > tolerance_m:
            return Verdict(qid, False, distance, None, False,
                           f"entity is {distance/1000:.1f} km away")

    type_ok = None
    expected = TYPE_EXPECTATIONS.get(osm_category)
    if expected is not None and entity["types"]:
        type_ok = bool(entity["types"] & expected)
        if not type_ok:
            return Verdict(qid, False, distance, False, False,
                           f"entity types {sorted(entity['types'])} do not match "
                           f"{osm_category}")

    reciprocal = (entity.get("osm_relation") is not None
                  and osm_relation_id is not None
                  and str(entity["osm_relation"]) == str(osm_relation_id))
    if entity.get("osm_relation") and osm_relation_id and not reciprocal:
        return Verdict(qid, False, distance, type_ok, False,
                       "entity links to a different OSM relation")

    return Verdict(qid, True, distance, type_ok, reciprocal, "verified")


if __name__ == "__main__":
    entities = fetch_entities(["Q42", "Q90"])
    logger.info("fetched %d entity record(s)", len(entities))
```

## Step-by-step walkthrough

1. **Batch the lookups.** One query covering many identifiers rather than one request each; the endpoint is a shared resource and per-request overhead dominates otherwise.
2. **Handle the coordinate literal correctly.** The point literal is longitude first, which is the opposite order from how latitude and longitude are usually spoken and the source of a familiar class of bug.
3. **Scale the tolerance to the feature.** A pub's entity coordinate should be within tens of metres; a city's may legitimately be kilometres from any particular OSM node, because the entity describes the whole settlement.
4. **Treat a missing coordinate as neutral.** Many entities have none, and their absence is not evidence against a link — only a present and distant coordinate is.
5. **Keep type expectations broad.** The check is meant to catch a link to a person, a film or a book, not to enforce a fine-grained ontology. A broad allowed set keeps false alarms low while still catching the failures that matter.
6. **Treat a contradictory reciprocal link as decisive.** If the entity records a different OSM object, one of the two links is wrong and the pair needs a human.
7. **Return a reason, not a boolean.** "Entity is 340 km away" is actionable; `False` is not.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="lwi2-t lwi2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="lwi2-t">What a verified identifier link is worth to every later enrichment</title>
  <desc id="lwi2-d">Four stages showing the compounding value. Establishing the link once costs a verified match, which is the expensive part. Every later enrichment from the same knowledge base becomes a join on the identifier rather than a fresh matching run. Enrichment from any other source that also carries the identifier becomes a join too, without any matching at all. And because the link survives edits that change geometry or names, it decays far more slowly than a stored fuzzy match.</desc>
  <defs><marker id="lwi2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Pay once, join forever</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">establish</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">verified match</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">the expensive part</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#lwi2-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">same source</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">join, not match</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">every later attribute</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#lwi2-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">other sources</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">any that carry it</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">no matching at all</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#lwi2-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">survives edits</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">geometry and names change</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">the link does not</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">This is why establishing identifier links deliberately pays for itself: every subsequent enrichment stops being a conflation problem.</text>
</svg>
<figcaption>The last step is the quiet benefit — an identifier link outlives the geometry and naming changes that break fuzzy matches.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="lwi3-t lwi3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="lwi3-t">How coordinate tolerance should scale with the kind of feature being linked</title>
  <desc id="lwi3-d">A grid of four feature scales against the coordinate tolerance each needs and the reason. A building or point of interest needs tens of metres, because the entity coordinate should name the same structure. A campus or a site needs a few hundred metres, because the entity coordinate may sit anywhere within the grounds. A settlement needs several kilometres, because the entity names the whole place and its coordinate is a chosen centre. An administrative region needs tens of kilometres for the same reason at a larger scale.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">One global tolerance cannot serve all four</text>
  <rect x="216" y="48" width="319" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="376" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Tolerance</text>
  <rect x="535" y="48" width="319" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="694" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Why</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Building or POI</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">tens of metres</text>
  <text x="694" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">same structure</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Campus or site</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a few hundred metres</text>
  <text x="694" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">anywhere in the grounds</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Settlement</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">several kilometres</text>
  <text x="694" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a chosen centre</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Administrative region</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">tens of kilometres</text>
  <text x="694" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">same, larger</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Deriving the tolerance from the feature's own bounding box is more robust than a lookup table and needs no maintenance.</text>
</svg>
<figcaption>A single tolerance chosen for buildings rejects every city link; one chosen for cities accepts the pub in the next town.</figcaption>
</figure>

## Verification

- **Distant links are rejected.** Construct a link to an entity in another country and confirm the verdict rejects it with the distance in the reason.
- **Type mismatches are rejected.** Link a station to a person entity and confirm the type check fires.
- **Missing data is neutral.** An entity with no coordinate and no type should verify rather than fail.
- **Reciprocal disagreement is caught.** Where the entity names a different OSM object, the verdict must be a rejection.
- **Batching actually batches.** Count requests for a hundred identifiers; it should be one or two, not a hundred.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Every link rejected as distant | Coordinate literal parsed latitude-first | The point literal is longitude first |
| Large features always rejected | One tolerance for every feature type | Scale the tolerance to the feature's extent |
| Links with no coordinate rejected | Missing data treated as failure | Treat absent evidence as neutral |
| Type check rejects valid links | Expectation set too narrow | Broaden the allowed types; catch absurdities only |
| Endpoint throttles the pipeline | One request per feature | Batch many identifiers into one query |
| Wrong links go unnoticed | Only a boolean returned | Return a reason naming the failing check |
| Verified links decay quietly | No re-verification schedule | Re-verify periodically as with any stored match |

## Specification reference

> Wikidata entities carry a coordinate location property, an instance-of property giving the entity's type, and — for many administrative and geographic entities — an OpenStreetMap relation identifier property. The query service accepts SPARQL over HTTP and returns JSON, subject to a usage policy that expects an identifying user agent and discourages high request rates. See the [Wikidata query service documentation](https://query.wikidata.org/) and the [OSM wikidata tag documentation](https://wiki.openstreetmap.org/wiki/Key:wikidata) for the tagging conventions.

## Frequently Asked Questions

<details>
<summary>Why verify a link that already exists in the data?</summary>

Because wrong identifier links are both more damaging and harder to spot than wrong fuzzy matches. A link is an assertion of identity, so anything joined through it inherits that assertion without further checking — which is exactly why it is worth establishing carefully. Existing links in OSM were added by people of varying care, and a coordinate and type check over them is cheap and finds real errors.
</details>

<details>
<summary>What tolerance should the coordinate check use?</summary>

One scaled to the feature. An entity describing a pub should sit within tens of metres of the OSM node; an entity describing a city legitimately sits at whatever point somebody chose as its centre, which can be kilometres from any particular feature within it. A single global tolerance either rejects every large feature or accepts links to same-named places in the next county.
</details>

<details>
<summary>Is a missing coordinate or type a reason to reject?</summary>

No. Many entities have neither, particularly for smaller or less documented subjects, and treating absence as failure rejects perfectly good links for the crime of being about something obscure. Only present-and-contradictory evidence should reject: a coordinate far away, a type that is absurd for the feature, or a reciprocal link naming a different object.
</details>

<details>
<summary>How much is an identifier link actually worth?</summary>

A great deal, because it converts every later enrichment from a matching problem into a join. Once the link exists and is verified, any attribute from that knowledge base — and from any other dataset that also carries the identifier — attaches without scoring, thresholds or review. It also survives the geometry and naming changes that break stored fuzzy matches, so it decays far more slowly.
</details>

## Related

- [Attribute Enrichment from Authoritative Sources](https://www.osm-data-processing.org/osm-conflation-and-enrichment/attribute-enrichment-from-authoritative-sources/) — the parent topic and the namespace this feeds.
- [Scoring Conflation Candidates with Multiple Signals](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/scoring-conflation-candidates-with-multiple-signals/) — where a verified identifier short-circuits the scorer.
- [OSM Feature Identity & ID Stability](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/) — why an external identifier outlives an OSM one.
- [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) — where the link is stored on the OSM side.
- [Handling Overpass Timeouts and Rate Limits](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/handling-overpass-timeouts-and-rate-limits/) — the same client etiquette this endpoint expects.

Up one level: [Attribute Enrichment from Authoritative Sources](https://www.osm-data-processing.org/osm-conflation-and-enrichment/attribute-enrichment-from-authoritative-sources/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Linking OSM Features to Wikidata Identifiers",
  "description": "Establish durable identifier links between OSM features and an external knowledge base, verify them against coordinates and types, and use them to make every later enrichment nearly free.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Conflation & Data Enrichment",
  "about": ["Wikidata linking", "identifier verification", "knowledge base joins"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Conflation & Data Enrichment", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/" },
    { "@type": "ListItem", "position": 3, "name": "Attribute Enrichment from Authoritative Sources", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/attribute-enrichment-from-authoritative-sources/" },
    { "@type": "ListItem", "position": 4, "name": "Linking OSM Features to Wikidata Identifiers", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/attribute-enrichment-from-authoritative-sources/linking-osm-features-to-wikidata-identifiers/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Verify an OSM to knowledge-base identifier link",
  "description": "Batch entity lookups, compare the entity coordinate against the feature with a size-scaled tolerance, check the entity type against the feature category, look for a reciprocal link, and return a reason.",
  "step": [
    { "@type": "HowToStep", "name": "Batch the lookups", "text": "Query many identifiers in one request rather than one request per feature." },
    { "@type": "HowToStep", "name": "Parse the coordinate correctly", "text": "Read the point literal as longitude first, which is the opposite of how the pair is usually spoken." },
    { "@type": "HowToStep", "name": "Scale the tolerance", "text": "Allow a distance proportional to the feature's extent, since an entity for a city is not near any particular node." },
    { "@type": "HowToStep", "name": "Check the type broadly", "text": "Compare the entity's instance-of statements against a deliberately wide set of acceptable types for the feature category." },
    { "@type": "HowToStep", "name": "Treat absence as neutral", "text": "Do not reject a link because the entity lacks a coordinate or a type; only contradictory evidence should reject." },
    { "@type": "HowToStep", "name": "Use reciprocity when present", "text": "Accept a matching reverse link as strong confirmation and treat a contradictory one as a rejection." },
    { "@type": "HowToStep", "name": "Return a reason", "text": "Emit the failing check and its measurement rather than a bare boolean." }
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
      "name": "Why verify an identifier link that already exists in OSM?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because wrong identifier links are both more damaging and harder to spot than wrong fuzzy matches. A link is an assertion of identity, so anything joined through it inherits that assertion without further checking. Existing links were added by people of varying care, and a coordinate and type check over them is cheap and finds real errors." }
    },
    {
      "@type": "Question",
      "name": "What tolerance should a coordinate check use for identifier links?",
      "acceptedAnswer": { "@type": "Answer", "text": "One scaled to the feature. An entity describing a pub should sit within tens of metres of the OSM node; an entity describing a city legitimately sits wherever somebody placed its centre. A single global tolerance either rejects every large feature or accepts links to same-named places in the next county." }
    },
    {
      "@type": "Question",
      "name": "Is a missing coordinate or type a reason to reject a link?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. Many entities have neither, particularly for smaller subjects, and treating absence as failure rejects good links for being about something obscure. Only present-and-contradictory evidence should reject: a coordinate far away, an absurd type, or a reciprocal link naming a different object." }
    },
    {
      "@type": "Question",
      "name": "How much is an identifier link actually worth?",
      "acceptedAnswer": { "@type": "Answer", "text": "A great deal, because it converts every later enrichment from a matching problem into a join. Once verified, any attribute from that knowledge base — and from any other dataset carrying the identifier — attaches without scoring or review. It also survives the geometry and naming changes that break stored fuzzy matches." }
    }
  ]
}
</script>
