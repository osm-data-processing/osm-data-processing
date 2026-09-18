---
title: "Estimating the Cost of an Overpass Query"
description: "Size an Overpass query before running it: a counting probe, per-element byte estimates for each output mode, and a refusal threshold that stops a mis-scoped query from ever being sent."
pageTitle: "Size an Overpass Query Before You Run It"
pageDescription: "Use a cheap counting query and per-output-mode byte estimates to predict an Overpass response size and runtime, and refuse to send anything above an explicit threshold."
slug: estimating-the-cost-of-an-overpass-query
type: article
breadcrumb: "Estimating Query Cost"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Estimating the Cost of an Overpass Query

Find out how big a query's answer is before you ask for it, using one request that costs almost nothing — and refuse to send anything the pipeline cannot handle.

## Prerequisites

- [ ] An Overpass endpoint and a client that identifies itself, as built in [Handling Overpass Timeouts and Rate Limits](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/handling-overpass-timeouts-and-rate-limits/).
- [ ] The output-mode semantics from [Overpass API Query Language](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/), because the byte estimate depends entirely on which mode you will use.
- [ ] Python 3.10+ with `requests`.
- [ ] An explicit ceiling: the largest response your pipeline is prepared to handle.
- [ ] A willingness to act on the estimate, which is the part that actually prevents incidents.

## Conceptual minimum

Overpass offers a counting output mode. Replacing the final output statement with `out count;` returns a single element whose tags carry the number of nodes, ways, relations and the total — and it does so without serialising any of them. The query still has to be *evaluated*, so a badly shaped query can still time out while counting, but the response is a few bytes and the server does no serialisation work.

That count is the input to a simple size model. Each element costs a roughly predictable number of bytes in the response, and the multiplier depends almost entirely on the output mode:

- `out ids` is a handful of bytes per element.
- `out tags` adds the tag payload, which for typical OSM features averages a couple of hundred bytes.
- `out center` adds one coordinate pair per way and relation.
- `out geom` inlines every coordinate of every way, which for a road network is the dominant term by a wide margin — a way with forty nodes carries forty coordinate pairs, and a shared junction node appears once per way that uses it.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 288" role="img" aria-labelledby="eoq1-t eoq1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="eoq1-t">Approximate response bytes per element under each Overpass output mode</title>
  <desc id="eoq1-d">Five output modes ranked by approximate bytes per returned element. Identifier-only output is the smallest at a few tens of bytes. Tags-only output is a few hundred bytes for a typical feature. Centre output adds a coordinate pair to that. Metadata output adds version, timestamp, changeset and user fields. Full geometry output is by far the largest because it inlines every coordinate of every way, with shared nodes repeated once per way that references them.</desc>
  <rect x="0" y="0" width="880" height="288" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">The output mode decides the payload, not the filter</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">out ids</text>
  <rect x="246" y="60" width="15" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">tens of bytes</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">out tags</text>
  <rect x="246" y="100" width="98" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">a few hundred</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">out center</text>
  <rect x="246" y="140" width="117" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">plus a coordinate</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">out meta</text>
  <rect x="246" y="180" width="156" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">plus provenance</text>
  <text x="26" y="234" font-size="11.5" font-weight="600" fill="currentColor">out geom</text>
  <rect x="246" y="220" width="488" height="18" rx="4" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="854" y="234" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">every coordinate</text>
  <text x="868" y="272" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">On a dense street network the last row can be twenty times the second, which is why the mode is checked before the filter is tuned.</text>
</svg>
<figcaption>Changing one word in the output statement is the cheapest order-of-magnitude saving available in Overpass.</figcaption>
</figure>

The model does not need to be accurate. It needs to distinguish "a few megabytes" from "several gigabytes", and a rough per-element figure does that reliably.

## Runnable solution

```python
from __future__ import annotations

import logging
import re
from dataclasses import dataclass

import requests

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.overpass.estimate")

ENDPOINT = "https://overpass-api.de/api/interpreter"
HEADERS = {"User-Agent": "osm-pipeline-example/1.0 (contact@example.org)"}

# Rough bytes per element, by output mode. Deliberately generous.
PER_ELEMENT = {
    "ids": 30,
    "tags": 260,
    "center": 300,
    "meta": 400,
    "geom": 1400,          # dominated by inlined way coordinates
}

_OUT_RE = re.compile(r"^\s*\.?\w*\s*out\b[^;]*;", re.M)


class QueryTooLarge(RuntimeError):
    """The estimated response exceeds what this pipeline will accept."""


@dataclass(frozen=True)
class Estimate:
    nodes: int
    ways: int
    relations: int
    total: int
    mode: str

    @property
    def bytes(self) -> int:
        # Geometry cost falls on ways and relations; nodes are cheap everywhere.
        if self.mode == "geom":
            return (self.nodes * PER_ELEMENT["tags"]
                    + (self.ways + self.relations) * PER_ELEMENT["geom"])
        return self.total * PER_ELEMENT[self.mode]


def to_count_query(query: str) -> str:
    """Replace the final output statement with a counting one."""
    if not _OUT_RE.search(query):
        raise ValueError("query has no out statement to replace")
    # Replace only the LAST out statement; earlier ones may be intermediate probes.
    matches = list(_OUT_RE.finditer(query))
    last = matches[-1]
    return query[:last.start()] + "\nout count;" + query[last.end():]


def count(query: str) -> dict[str, int]:
    response = requests.post(ENDPOINT, data={"data": to_count_query(query)},
                             headers=HEADERS, timeout=180)
    response.raise_for_status()
    elements = response.json().get("elements", [])
    if not elements:
        return {"nodes": 0, "ways": 0, "relations": 0, "total": 0}
    tags = elements[0].get("tags", {})
    return {k: int(tags.get(k, 0))
            for k in ("nodes", "ways", "relations", "total")}


def estimate(query: str, mode: str) -> Estimate:
    counts = count(query)
    result = Estimate(counts["nodes"], counts["ways"], counts["relations"],
                      counts["total"], mode)
    logger.info("%d element(s) (%dn/%dw/%dr), est. %.1f MiB in %s mode",
                result.total, result.nodes, result.ways, result.relations,
                result.bytes / (1 << 20), mode)
    return result


def run_if_affordable(query: str, mode: str, ceiling_bytes: int) -> dict:
    """Refuse to send a query whose answer we already know we cannot handle."""
    projected = estimate(query, mode)
    if projected.bytes > ceiling_bytes:
        raise QueryTooLarge(
            f"estimated {projected.bytes / (1 << 20):.0f} MiB exceeds the "
            f"{ceiling_bytes / (1 << 20):.0f} MiB ceiling — narrow the query")
    response = requests.post(ENDPOINT, data={"data": query},
                             headers=HEADERS, timeout=600)
    response.raise_for_status()
    return response.json()


if __name__ == "__main__":
    q = ('[out:json][timeout:120];'
         'way["highway"](50.0,19.8,50.2,20.2);'
         'out geom;')
    try:
        run_if_affordable(q, mode="geom", ceiling_bytes=64 << 20)
    except QueryTooLarge as exc:
        logger.error("refused: %s", exc)
```

## Step-by-step walkthrough

1. **Rewrite the output statement, not the query.** `to_count_query` replaces only the last `out`, leaving filters, set bindings and intermediate probes intact. Estimating a *different* query than the one you will run is worse than not estimating.
2. **Replace the last statement, not the first.** A query with intermediate `out` calls for debugging would otherwise be truncated at the wrong point.
3. **Read the counts per type.** Nodes, ways and relations are separated because geometry cost falls almost entirely on ways and relations, and a query dominated by untagged nodes has a very different profile from one dominated by roads.
4. **Model geometry separately.** In `geom` mode the estimate applies the large per-element figure only to ways and relations, which is what makes the number useful rather than uniformly pessimistic.
5. **Be generous with the constants.** The figures err high deliberately. An estimate that occasionally refuses a query you could have run is a minor annoyance; one that lets through a response that exhausts memory is an incident.
6. **Refuse, do not warn.** `run_if_affordable` raises rather than logging, because the whole value of the estimate is that it prevents the request.
7. **Name the remedy in the message.** The exception says "narrow the query", because the person reading it at three in the morning needs the next action, not just the number.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="eoq2-t eoq2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="eoq2-t">Four steps between writing a query and sending it</title>
  <desc id="eoq2-d">Four steps. The rewrite step swaps the final output statement for a counting one, leaving every filter and set binding untouched. The probe step sends the counting query, which is one small request that does no serialisation on the server. The model step multiplies the per-type counts by generous per-element byte figures chosen for the output mode that will actually be used. The decide step compares the projection against an explicit ceiling and refuses to send anything above it.</desc>
  <defs><marker id="eoq2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Probe, model, decide — then send</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">rewrite</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">swap the last out</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">filters untouched</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#eoq2-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">probe</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">one small request</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">no serialisation</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#eoq2-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">model</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">counts times bytes</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">per output mode</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#eoq2-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">decide</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">compare to a ceiling</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">refuse, do not warn</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The probe still evaluates the query, so a query too expensive to count is already a query too expensive to run.</text>
</svg>
<figcaption>A counting probe that times out has told you the answer just as clearly as one that returns a number.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="eoq3-t eoq3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="eoq3-t">What a counting probe tells you in each of its three possible outcomes</title>
  <desc id="eoq3-d">Three panels covering the outcomes of a counting probe. A small count means the query is well shaped and the full request is safe to send in any output mode. A large count means the filters are correct but the answer is bigger than the pipeline can hold, so either the output mode must be reduced or the spatial bound tightened. A probe that times out means the query is expensive to evaluate rather than merely to serialise, so no output mode will rescue it and the work belongs in a local extract.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three outcomes, three different next actions</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Small count</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Filters are well shaped</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Any output mode is affordable</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Send the real query</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">No further action needed</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Large count</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Filters are correct</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Answer exceeds the ceiling</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Try a cheaper output mode</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Or tighten the spatial bound</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Probe times out</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Expensive to evaluate</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Not merely to serialise</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">No output mode rescues it</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Move the work to a file</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The third outcome is the most informative: it identifies a query that would have failed however patiently the client waited.</text>
</svg>
<figcaption>Each outcome names a different fix, which is why the probe is worth running even when you expect the first one.</figcaption>
</figure>

## Verification

- **The counting query returns the same filters.** Diff the rewritten query against the original; only the final output statement should differ.
- **The estimate brackets reality.** Run a query for real and compare the actual response size against the projection; the estimate should be within a factor of two and should err high.
- **Geometry mode is visibly more expensive.** Estimate the same query in `center` and `geom` modes; the ratio should be large on a way-heavy query and small on a node-heavy one.
- **The ceiling actually refuses.** Set a deliberately low ceiling and confirm no request for the full query is made.
- **A counting probe that times out is handled.** Point the estimator at a continent-wide query; it should surface the timeout as a refusal rather than an unhandled exception.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Estimate for the wrong query | Whole query rebuilt instead of the output swapped | Replace only the final output statement |
| Counting probe also times out | Query is expensive to evaluate, not just to serialise | Narrow spatially; the probe has already answered you |
| Estimate wildly low | `geom` modelled with a flat per-element figure | Apply the geometry figure to ways and relations only |
| Estimate ignored | Projection logged rather than enforced | Raise on exceeding the ceiling |
| Probe returns zero | A set was overwritten before the output statement | Bind sets explicitly and count the intended one |
| Ceiling never triggers | Ceiling set larger than available memory | Derive the ceiling from the smallest worker's memory |

## Specification reference

> The `out count;` statement returns a single result element whose tags carry the number of nodes, ways, relations and areas in the set being printed, without serialising the elements themselves. The query is still executed, so its declared timeout and memory ceiling still apply. See the [Overpass QL output statement documentation](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL) for the counting mode and the other output modifiers.

## Frequently Asked Questions

<details>
<summary>Does a counting query cost the server nothing?</summary>

It costs the evaluation but not the serialisation, which is usually the smaller half for a large result and the larger half for an expensive filter. That means a counting probe is cheap for the common case of a well-shaped query returning a lot of data, and no cheaper than the real thing for a badly shaped query that scans too much. Usefully, that second case is itself the answer: a probe that times out tells you the query needs narrowing.
</details>

<details>
<summary>How accurate do the per-element byte figures need to be?</summary>

Not very. The purpose is to distinguish a few megabytes from a few gigabytes, and any figure within a factor of two does that. Choose values that err high, so the estimator occasionally refuses something you could have run rather than occasionally admitting something that exhausts memory. Measure a handful of real responses against the projection once, adjust the constants, and leave them alone.
</details>

<details>
<summary>Why separate nodes from ways in the estimate?</summary>

Because geometry cost is not uniform across element types. In full-geometry mode a way carries one coordinate pair per node it references, so a road with forty nodes is roughly forty times the size of a tagged point. A query returning a million untagged nodes and a query returning a million ways have wildly different payloads, and a single per-element figure cannot express that.
</details>

<details>
<summary>Should the estimate refuse, or just warn?</summary>

Refuse. A warning is written to a log that nobody reads on a run that succeeded, and the failure it was warning about — a response that exhausts the worker's memory — arrives minutes later as something much harder to diagnose. Raising an exception that names the projected size and tells the reader to narrow the query converts a mysterious out-of-memory kill into a clear, immediate message.
</details>

## Related

- [Choosing Between Overpass and a Local Extract](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/choosing-between-overpass-and-a-local-extract/) — the parent topic; a query that keeps failing this check belongs in a file.
- [Overpass API Query Language](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/) — the output modes the byte model is built on.
- [Handling Overpass Timeouts and Rate Limits](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/handling-overpass-timeouts-and-rate-limits/) — the client whose size guard this estimate complements.
- [Replacing an Overpass Query with an osmium Filter](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/choosing-between-overpass-and-a-local-extract/replacing-an-overpass-query-with-an-osmium-filter/) — where a query that fails the estimate should go.
- [Sizing PBF Chunk Batches to a Memory Budget](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/sizing-pbf-chunk-batches-to-a-memory-budget/) — the same budgeting discipline applied to local parsing.

Up one level: [Choosing Between Overpass and a Local Extract](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/choosing-between-overpass-and-a-local-extract/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Estimating the Cost of an Overpass Query",
  "description": "Size an Overpass query before running it: a counting probe, per-element byte estimates for each output mode, and a refusal threshold that stops a mis-scoped query from ever being sent.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Querying OSM: Overpass, Nominatim & APIs",
  "about": ["Overpass out count", "response size estimation", "query budgeting"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Querying OSM: Overpass, Nominatim & APIs", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/" },
    { "@type": "ListItem", "position": 3, "name": "Choosing Between Overpass and a Local Extract", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/choosing-between-overpass-and-a-local-extract/" },
    { "@type": "ListItem", "position": 4, "name": "Estimating the Cost of an Overpass Query", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/choosing-between-overpass-and-a-local-extract/estimating-the-cost-of-an-overpass-query/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Estimate an Overpass response size before sending the query",
  "description": "Swap the final output statement for a counting one, read the per-type element counts, multiply by generous per-element byte figures for the intended output mode, and refuse queries above an explicit ceiling.",
  "step": [
    { "@type": "HowToStep", "name": "Rewrite only the output", "text": "Replace the last output statement with a counting statement, leaving filters and set bindings exactly as they are." },
    { "@type": "HowToStep", "name": "Send the counting probe", "text": "Run the rewritten query, which evaluates the filters but serialises nothing, and read the node, way and relation counts." },
    { "@type": "HowToStep", "name": "Model per output mode", "text": "Multiply the counts by per-element byte figures chosen for the mode you will actually use, applying the geometry figure only to ways and relations." },
    { "@type": "HowToStep", "name": "Err high deliberately", "text": "Choose generous constants so the estimator occasionally refuses a query you could have run rather than admitting one that exhausts memory." },
    { "@type": "HowToStep", "name": "Compare against a ceiling", "text": "Derive the ceiling from the smallest worker's memory and refuse to send anything projected above it." },
    { "@type": "HowToStep", "name": "Name the remedy", "text": "Raise an error stating the projected size and instructing the reader to narrow the query rather than logging a warning." }
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
      "name": "Does an Overpass counting query cost the server nothing?",
      "acceptedAnswer": { "@type": "Answer", "text": "It costs the evaluation but not the serialisation, which is usually the smaller half for a large result and the larger half for an expensive filter. A counting probe is cheap for a well-shaped query returning a lot of data, and no cheaper than the real thing for a badly shaped query. That second case is itself the answer: a probe that times out tells you the query needs narrowing." }
    },
    {
      "@type": "Question",
      "name": "How accurate do the per-element byte figures need to be?",
      "acceptedAnswer": { "@type": "Answer", "text": "Not very. The purpose is to distinguish a few megabytes from a few gigabytes, and any figure within a factor of two does that. Choose values that err high, so the estimator occasionally refuses something you could have run rather than occasionally admitting something that exhausts memory." }
    },
    {
      "@type": "Question",
      "name": "Why separate nodes from ways in an Overpass size estimate?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because geometry cost is not uniform across element types. In full-geometry mode a way carries one coordinate pair per node it references, so a road with forty nodes is roughly forty times the size of a tagged point. A query returning a million untagged nodes and a query returning a million ways have wildly different payloads." }
    },
    {
      "@type": "Question",
      "name": "Should a query size estimate refuse, or just warn?",
      "acceptedAnswer": { "@type": "Answer", "text": "Refuse. A warning is written to a log that nobody reads on a run that succeeded, and the failure it was warning about arrives minutes later as something much harder to diagnose. Raising an exception that names the projected size and tells the reader to narrow the query converts a mysterious out-of-memory kill into a clear, immediate message." }
    }
  ]
}
</script>
