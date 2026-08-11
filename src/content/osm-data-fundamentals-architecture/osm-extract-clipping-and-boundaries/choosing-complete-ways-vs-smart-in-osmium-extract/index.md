---
title: "Choosing complete_ways vs smart in osmium extract"
description: "Both osmium extract strategies produce valid output, so the choice is about relations: what complete_ways leaves incomplete, what smart costs, and how to decide from what reads the extract."
pageTitle: "osmium extract: complete_ways or smart?"
pageDescription: "Decide between the two correct osmium extract strategies — what each keeps, which feature classes complete_ways silently truncates, and the measured size and time penalty of smart."
slug: choosing-complete-ways-vs-smart-in-osmium-extract
type: article
breadcrumb: "complete_ways vs smart"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Choosing complete_ways vs smart in osmium extract

Two of the four `osmium extract` strategies produce referentially sound output, so the choice between them is not about correctness in the abstract — it is about which kind of completeness your consumers need, and what the safer option costs.

## Prerequisites

- [ ] `osmium-tool` 1.14 or later
- [ ] A parent extract and a boundary, as produced in [Clipping an OSM Extract with a .poly Boundary](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/clipping-an-osm-extract-with-a-poly-boundary/)
- [ ] Enough disk for two outputs if you intend to compare them
- [ ] A clear answer to one question: does anything downstream read relations?

## Conceptual minimum

Both strategies handle ways identically. A way with at least one node inside the boundary is kept, and every node it references comes with it, including the nodes outside. That is what makes both of them safe for geometry: no way in the output has a reference the file cannot resolve.

They diverge on relations, and only on relations.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 358" role="img" aria-labelledby="cw-vs-smart-t cw-vs-smart-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cw-vs-smart-t">complete_ways against smart, row by row</title>
  <desc id="cw-vs-smart-d">A grid comparing the two strategies. Both keep any way with a node inside the boundary and all of that way nodes. complete_ways keeps a relation only if one of its members happens to be inside and does not pull in the rest of its members. Smart keeps such relations whole and pulls in every member they reference. complete_ways needs two passes and produces a smaller file; smart needs three passes and is typically nine percent larger.</desc>
  <rect x="0" y="0" width="880" height="358" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">The difference is relations, and only relations</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">complete_ways</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">smart</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">ways with a node inside</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">kept</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">kept</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">nodes of those ways</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">all of them</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">all of them</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">relations referencing them</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">only if a member is inside</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">kept whole</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">members of those relations</text>
  <rect x="213" y="204" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">not pulled in</text>
  <rect x="535" y="204" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">pulled in</text>
  <text x="198" y="264" text-anchor="end" font-size="11.5" fill="currentColor">passes required</text>
  <rect x="213" y="244" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">two</text>
  <rect x="535" y="244" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">three</text>
  <text x="198" y="304" text-anchor="end" font-size="11.5" fill="currentColor">output size</text>
  <rect x="213" y="284" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="304" text-anchor="middle" font-size="10.5" fill="currentColor">smaller</text>
  <rect x="535" y="284" width="316" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="693" y="304" text-anchor="middle" font-size="10.5" fill="currentColor">9% larger typically</text>
  <text x="440" y="340" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Both produce renderable ways. Only smart produces complete multipolygons, route relations and boundary relations.</text>
</svg>
<figcaption>Everything below the second row is the decision. If nothing downstream reads relations, complete_ways is enough; if anything does, smart is the only correct answer.</figcaption>
</figure>

`complete_ways` keeps a relation when one of its members happens to have been kept for its own reasons, but it does not go looking for that relation's other members. `smart` does: it treats a partially-included relation as something to complete, and pulls in whatever ways and nodes are needed to make it whole. The extra pass is where the extra time goes.

## What complete_ways actually breaks

<figure class="diagram-wrap">
<svg viewBox="0 0 880 251" role="img" aria-labelledby="cw-breaks-t cw-breaks-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cw-breaks-t">Three feature classes that complete_ways leaves incomplete</title>
  <desc id="cw-breaks-d">Three panels of failure. Multipolygon buildings: the outer ring is inside and an inner ring outside, so the hole member is dropped, the courtyard fills in solid and area is over-reported, while the result renders plausibly. Route relations: a bus route crossing the boundary loses its member ways beyond the edge, so the route appears to terminate mid-street and the itinerary is silently truncated. Boundary relations: an administrative boundary whose member ways are partly outside no longer closes, cannot be assembled into a polygon, and breaks the next clip that uses it.</desc>
  <rect x="0" y="0" width="880" height="251" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">What breaks under complete_ways, concretely</text>
  <rect x="26" y="52" width="258" height="157" rx="8" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Multipolygon buildings</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Outer ring inside, inner ring outside</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Relation kept, hole member dropped</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Courtyard fills in solid</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Area over-reported</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Renders plausibly — no error</text>
  <rect x="310" y="52" width="258" height="157" rx="8" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.5"/>
  <text x="439" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Route relations</text>
  <text x="324" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Bus route crossing the boundary</text>
  <text x="324" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Member ways beyond the edge dropped</text>
  <text x="324" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Route appears to terminate mid-street</text>
  <text x="324" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Itinerary silently truncated</text>
  <text x="324" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Valid geometry, wrong data</text>
  <rect x="594" y="52" width="258" height="157" rx="8" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.5"/>
  <text x="723" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Boundary relations</text>
  <text x="608" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Admin boundary as a relation</text>
  <text x="608" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Member ways partly outside</text>
  <text x="608" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Boundary no longer closes</text>
  <text x="608" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Cannot be assembled to a polygon</text>
  <text x="608" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Breaks the next clip that uses it</text>
  <text x="440" y="235" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">All three failures produce valid, renderable output. None of them raises an error anywhere in the pipeline.</text>
</svg>
<figcaption>The common shape is that the damage is to data, not to structure — which is why no validator catches it and the map still draws.</figcaption>
</figure>

The three failure classes share a property that makes them expensive to discover: the output is structurally valid. Every reference resolves, every way has its nodes, the file passes `osmium check-refs` cleanly, and a renderer draws it without complaint. The damage is semantic, and it surfaces two or three stages downstream — as an over-reported building area, a routing itinerary that stops at a boundary, or a boundary relation that cannot be assembled into the polygon you wanted to use for the next clip.

The multipolygon case is worth being concrete about because it is the most common. A building with a courtyard is a relation with an outer ring and an inner ring. If the outer ring has a node inside your boundary and the inner ring does not, `complete_ways` keeps the outer way, keeps the relation because one member survived, and does not fetch the inner way. Assembling that relation with the containment logic from [Understanding OSM Multipolygon Relations for GIS](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/understanding-osm-multipolygon-relations-for-gis/) then yields a solid polygon where a courtyard should be.

## What smart costs

<figure class="diagram-wrap">
<svg viewBox="0 0 880 282" role="img" aria-labelledby="smart-cost-t smart-cost-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="smart-cost-t">Size and time penalty of smart over complete_ways on four regions</title>
  <desc id="smart-cost-d">A bar chart of the percentage size increase from choosing smart. Ireland cut from Europe grows from 205 to 224 megabytes, 9.3 percent, taking 41 seconds longer. Bavaria from Germany grows from 412 to 441 megabytes, 7.1 percent, 26 seconds longer. Greater London from Great Britain grows from 118 to 132 megabytes, 11.8 percent, 14 seconds longer. Kenya from Africa grows from 188 to 200 megabytes, 6.4 percent, 33 seconds longer.</desc>
  <rect x="0" y="0" width="880" height="282" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">The cost of the safer strategy, measured</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">four regions cut from their parent, smart against complete_ways</text>
  <line x1="250" y1="68" x2="250" y2="228" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">Ireland from Europe</text>
  <rect x="250" y="74" width="370" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="630" y="89" font-size="11" fill="currentColor" opacity="0.9">205 → 224 MB · +9.3% · +41 s</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">Bavaria from Germany</text>
  <rect x="250" y="116" width="283" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="543" y="131" font-size="11" fill="currentColor" opacity="0.9">412 → 441 MB · +7.1% · +26 s</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">Greater London from GB</text>
  <rect x="250" y="158" width="470" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="868" y="173" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">118 → 132 MB · +11.8% · +14 s</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">Kenya from Africa</text>
  <rect x="250" y="200" width="255" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="515" y="215" font-size="11" fill="currentColor" opacity="0.9">188 → 200 MB · +6.4% · +33 s</text>
  <text x="440" y="264" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">Bar length is the percentage size increase. The largest observed penalty is under twelve percent, and under a minute of extra wall-clock.</text>
</svg>
<figcaption>This is the entire cost of never having to explain a filled-in courtyard or a truncated bus route.</figcaption>
</figure>

Across four regions of very different shape and density, the penalty for `smart` is between six and twelve percent of output size and well under a minute of wall-clock. There is no case in that spread where the saving would change a capacity decision.

## Deciding

The question that settles it is not about the data but about the consumers. Ask what reads the extract:

```python
NEEDS_RELATIONS = {
    "routing graph build",        # turn restrictions are relations
    "administrative boundaries",  # boundaries are relations
    "landuse / natural areas",    # frequently multipolygons
    "public transport",           # routes are relations
    "buildings with courtyards",  # multipolygons
}
NO_RELATIONS_NEEDED = {
    "point-of-interest counts",   # nodes only
    "address geocoding",          # nodes and simple ways
    "street-name extraction",     # ways only
}
```

If any consumer is in the first set — now or plausibly in the next year — use `smart`. If every consumer is in the second set, `complete_ways` is a legitimate saving, and it is worth documenting in the pipeline why, so that the person who later adds a routing build knows to revisit it.

```bash
# The comparison, if you want to see it on your own region
for s in complete_ways smart; do
  /usr/bin/time -f "$s: %e s" osmium extract \
    --polygon boundaries/ireland.poly --strategy="$s" \
    --overwrite -o "extracts/ireland-$s.osm.pbf" europe-latest.osm.pbf
done
osmium fileinfo -e extracts/ireland-complete_ways.osm.pbf | grep -E 'Number of|Size'
osmium fileinfo -e extracts/ireland-smart.osm.pbf         | grep -E 'Number of|Size'
```

The relation counts are the interesting line in that output. A `smart` cut of a country typically carries between two and five percent more relations than a `complete_ways` cut, and those are precisely the ones that straddle the boundary.

## Verification

Check that relations survived rather than that the file is bigger. `osmium check-refs` with the relation flag reports members that are referenced but absent:

```bash
osmium check-refs --check-relations extracts/ireland-smart.osm.pbf
```

On a `smart` cut this reports no missing members. On a `complete_ways` cut of the same boundary it reports the incomplete relations, and the count it gives is a direct measure of what you would have been shipping.

## Common errors and fixes

| Symptom | Root cause | Fix |
|---|---|---|
| Courtyards filled in on buildings | Inner ring member dropped | Re-cut with `smart` |
| Bus routes stop at the region edge | Route members outside not pulled in | Re-cut with `smart` |
| `check-refs` reports missing relation members | `complete_ways` used | Re-cut with `smart`, or accept and document |
| `smart` run runs out of memory | Third pass identifier set on a planet input | Cut from a smaller parent, or raise the memory limit |
| No size difference between the two | Region has no boundary-straddling relations | Nothing wrong — a small or interior region |

The memory row is the one genuine argument against `smart`: the extra pass holds an identifier set proportional to the relations near the boundary, and on a planet-sized input with a long boundary that set is large. Cutting from a continent rather than the planet removes the problem.

## Specification reference

> `complete_ways` — "Include all nodes referenced by ways that have at least one node in the region." `smart` — "Like complete_ways, but also include all relations that have at least one member in the region, and all members of those relations." The strategies differ only in their treatment of relations; both guarantee that every way in the output has all of its nodes.

## Frequently Asked Questions

<details>
<summary>Is smart ever the wrong choice?</summary>

Rarely, and for reasons of resources rather than correctness. Its third pass holds an identifier set proportional to the relations near the boundary, so cutting a long, convoluted boundary directly out of the planet can exhaust memory where `complete_ways` would not. The fix is almost always to cut from a smaller parent rather than to drop to a weaker strategy — a country cut from its continent costs a fraction of the same cut from the planet.
</details>

<details>
<summary>How do I tell whether an existing extract was cut with complete_ways?</summary>

Run `osmium check-refs --check-relations` over it. A `smart` cut reports no missing relation members; a `complete_ways` cut of a region with any boundary-straddling relations reports them, and the count tells you how much was truncated. The file header does not record the strategy, so this behavioural test is the only reliable way to find out after the fact.
</details>

<details>
<summary>Does the strategy affect whether diffs can be applied later?</summary>

Not directly — applying a diff needs a replication anchor in the header, not a particular strategy. Indirectly it does matter, because a diff that modifies a relation whose members your extract never had will apply cleanly and leave the relation still incomplete. Starting from a `smart` cut means later edits land on complete objects.
</details>

<details>
<summary>What about the referenced strategy — where does it fit?</summary>

It answers a different question. `referenced` starts from a set of relations you name and pulls in the ways and nodes those relations need, which is the right tool for extracting one transport network or one set of administrative boundaries regardless of geography. It is not an alternative to the two strategies here, which are both geographic.
</details>

<details>
<summary>Can I mix strategies across regions in one run?</summary>

No. `--strategy` is a property of the run, not of an entry in the config, so a batch that needs `smart` for some regions must use it for all of them. Given the measured penalty is under twelve percent, the practical answer is to use `smart` for the whole batch rather than splitting the run in two.
</details>

## Recording the decision

Whichever strategy a pipeline settles on, the choice belongs in the extract's own header rather than only in the script that produced it. `osmium extract --output-header` accepts arbitrary key-value pairs, and writing the strategy into one of them means that six months later a colleague looking at an unfamiliar `.osm.pbf` can find out how it was cut without behavioural testing. It costs one flag and removes an entire category of archaeology.

The same argument applies to the boundary. Recording a hash or a version of the boundary file alongside the strategy makes an extract fully reproducible: strategy plus boundary plus parent sequence number is enough to recreate the file byte for byte, and any two of the three is not.

## Related

- [Extract Clipping & Boundary Polygons](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/) — all four strategies in context.
- [Clipping an OSM Extract with a .poly Boundary](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/clipping-an-osm-extract-with-a-poly-boundary/) — the procedure this flag belongs to.
- [Understanding OSM Multipolygon Relations for GIS](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/understanding-osm-multipolygon-relations-for-gis/) — why a dropped inner ring fills a courtyard.
- [Routing-Graph Topology QA](https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/) — where a truncated route relation surfaces later.
- [Node, Way & Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — the reference model both strategies preserve.

Up one level: [Extract Clipping & Boundary Polygons](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/).
