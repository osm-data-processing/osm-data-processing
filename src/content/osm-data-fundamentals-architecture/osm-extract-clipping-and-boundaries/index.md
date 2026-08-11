---
title: "Extract Clipping & Boundary Polygons"
description: "How osmium extract cuts a region out of a larger OSM file, what the simple, complete_ways, smart and referenced strategies each keep, and how to write .poly boundaries that produce self-contained extracts."
pageTitle: "OSM Extract Clipping & Boundary Polygons"
pageDescription: "Cut regional OSM extracts correctly: .poly and GeoJSON boundaries, the four osmium extract strategies, referential completeness, multi-extract runs, and verifying the result."
slug: osm-extract-clipping-and-boundaries
type: guide
breadcrumb: "Extract Clipping & Boundaries"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Extract Clipping & Boundary Polygons

Almost no production pipeline processes the planet. It processes a region — a country, a metropolitan area, a service territory drawn by a business rather than by a border — and the first stage of that pipeline is a cut: taking a larger `.osm.pbf` and producing a smaller one covering exactly the area of interest. The operation sounds like a spatial filter and is routinely implemented as one, which is where the trouble starts. OpenStreetMap objects are not independent geometries that can be tested individually against a polygon; they are a reference graph in which a way is nothing but a list of node identifiers, and a relation is nothing but a list of member identifiers. Cutting that graph with a polygon means deciding what to do with every edge that crosses the line, and the decision is not made for you.

This topic covers the mechanics of that cut. It defines the boundary formats OSM tooling accepts, walks the four `osmium extract` strategies and what each one keeps, quantifies the cost of choosing the wrong one, and sets out how to verify that the extract you produced is actually self-contained. It sits under [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/) because clipping is a format-level operation on the reference model described in the [Node, Way & Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — if the way-references-node relationship is unfamiliar, read that first, because every decision below is about preserving it.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="clip-strategy-t clip-strategy-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="clip-strategy-t">How a clipping run decides what crosses the boundary</title>
  <desc id="clip-strategy-d">A four-stage chain. A continent or planet extract is read. Each node is tested for membership of the boundary polygon, which is the only cheap test available. A reference policy such as complete_ways or smart then decides what happens to ways and relations that straddle the line. The output is either a self-contained extract or a referentially broken one, depending on that policy.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="cls" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">What crosses the cut line, and what each strategy does about it</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">input extract</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">continent .osm.pbf</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">or a planet file</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#cls)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">boundary test</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">node inside the polygon?</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">the only cheap test</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#cls)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">reference policy</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">complete_ways · smart</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">decides the edge cases</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#cls)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">output extract</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">self-contained .osm.pbf</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">or a referentially broken one</text>
  <text x="440" y="158" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Every clipping decision reduces to one question asked at the boundary: when a way has nodes on both sides, which of them come with it?</text>
</svg>
<figcaption>Clipping is not a spatial operation with a single right answer. The node test is unambiguous; everything interesting happens to the objects that reference nodes on both sides.</figcaption>
</figure>

## Prerequisite concepts

Three ideas from elsewhere on this site do most of the work here. The first is the reference model: ways store node identifiers, not coordinates, so a way is only renderable if every node it names is present in the same file. The second is the [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) view of a file as ordered blocks of nodes, then ways, then relations, which is what makes a two-pass clip possible without holding the file in memory. The third is the bounding box in the file header, described in the same page, which lets a pipeline reject an extract that cannot possibly cover the area requested before spending twenty minutes proving it.

## Boundary formats: bbox, .poly and GeoJSON

The cheapest boundary is a bounding box, given as four numbers in the order left, bottom, right, top. It is exact, it costs one comparison per node, and it is almost always the wrong shape. Countries are not rectangles, and a bounding box around a country with an awkward outline pulls in large parts of its neighbours — a bbox around Norway includes most of Sweden, and a bbox around Chile includes most of Argentina.

The Osmosis `.poly` format is the format OSM tooling has settled on for real boundaries. It is a plain-text file: a name line, then one or more polygon sections, each opened by an identifier line, followed by coordinate pairs as longitude then latitude, one pair per line, closed by `END`, with the whole file closed by a final `END`. A section identifier prefixed with `!` marks a hole rather than an outer ring, which is how enclaves are expressed. The format has no CRS declaration; coordinates are always WGS 84 degrees, the same convention described in [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/).

```text
ireland
1
   -1.06E+01   5.14E+01
   -5.30E+00   5.14E+01
   -5.30E+00   5.55E+01
   -1.06E+01   5.55E+01
   -1.06E+01   5.14E+01
END
END
```

Recent `osmium` versions also accept GeoJSON directly, which is usually easier to produce because it comes straight out of the tools that already hold your boundaries. A GeoJSON boundary must be a single `Feature` or `FeatureCollection` containing `Polygon` or `MultiPolygon` geometry; a collection of separate features is interpreted as a multi-region request rather than as one boundary, which is a useful behaviour and an easy accident.

Vertex count matters more than the format. Every node tested against the boundary pays a point-in-polygon cost proportional to the number of edges, so a boundary simplified from an administrative relation with 180 000 vertices to one with 2 000 vertices runs roughly two orders of magnitude faster and, for a clipping operation, describes the same region to well within the accuracy anyone needs. Simplify boundaries with a tolerance of around 100 metres before using them to cut.

## The four strategies

`osmium extract` takes a `--strategy` flag with four values, and this flag decides what "inside" means.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 278" role="img" aria-labelledby="clip-modes-t clip-modes-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="clip-modes-t">The four osmium extract strategies compared</title>
  <desc id="clip-modes-d">A grid comparing simple, complete_ways, smart and referenced strategies on which ways are kept, which nodes are kept, and what the output looks like. Simple keeps only fully-inside ways and only inside nodes, producing the smallest file with geometry clipped at the edge. complete_ways keeps any way with at least one inside node together with all of that way nodes, producing geometrically complete features. Smart adds the relations those ways belong to and all their referenced members, producing the largest and relationally complete output. Referenced keeps the ways that chosen relations need.</desc>
  <rect x="0" y="0" width="880" height="278" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four strategies, four different definitions of "inside"</text>
  <text x="317" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">ways kept</text>
  <text x="531" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">nodes kept</text>
  <text x="745" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">output is</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">simple</text>
  <rect x="213" y="84" width="208" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="317" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">only fully-inside ways</text>
  <rect x="427" y="84" width="208" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="531" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">only inside nodes</text>
  <rect x="641" y="84" width="208" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="745" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">smallest, clipped at the edge</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">complete_ways</text>
  <rect x="213" y="124" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="317" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">any way with one inside node</text>
  <rect x="427" y="124" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="531" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">all nodes of those ways</text>
  <rect x="641" y="124" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="745" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">geometrically complete</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">smart</text>
  <rect x="213" y="164" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="317" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">complete_ways + their relations</text>
  <rect x="427" y="164" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="531" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">all referenced nodes</text>
  <rect x="641" y="164" width="208" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="745" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">relationally complete, largest</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">referenced</text>
  <rect x="213" y="204" width="208" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="317" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">ways referenced by kept relations</text>
  <rect x="427" y="204" width="208" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="531" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">all referenced nodes</text>
  <rect x="641" y="204" width="208" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="745" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">complete for chosen relations</text>
  <text x="868" y="260" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The difference between the first and the third is roughly 8 percent of file size on a country cut, and the difference between a usable coastline and a shredded one.</text>
</svg>
<figcaption>The strategy is the single most consequential flag in a clipping run, and the default is not the one most pipelines want.</figcaption>
</figure>

The `simple` strategy keeps a node if it is inside the polygon and a way only if every one of its nodes is inside. It is the fastest and produces the smallest file, and it truncates every feature that crosses the boundary. A coastline way running along the edge of the region disappears entirely; a road crossing the border is dropped rather than clipped. Use it only when the consumer genuinely does not care about edge features — a point-of-interest count, say.

The `complete_ways` strategy keeps a way if *any* of its nodes is inside, and then keeps every node that way references, including the ones outside the polygon. This is the strategy most pipelines actually want: features are geometrically complete, no way has a dangling reference, and the file is a few percent larger than `simple`. The output extends slightly beyond the boundary wherever a long way crosses it, which is a property to know about rather than a defect.

The `smart` strategy does everything `complete_ways` does, then additionally keeps relations that reference the kept objects and, in turn, the members those relations need. This is what makes multipolygon buildings, route relations and boundary relations survive a cut intact. It produces the largest output and takes the longest, and it is the correct choice whenever relations matter — which includes any routing, boundary or landuse work.

The `referenced` strategy inverts the question: it starts from relations you want and pulls in the ways and nodes they need. It is the right tool for extracting a specific set of features, such as one bus network, rather than a geographic area.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 282" role="img" aria-labelledby="clip-cost-t clip-cost-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="clip-cost-t">Output size and referential integrity by clipping strategy</title>
  <desc id="clip-cost-d">A bar chart of output size cutting Ireland from a 28.4 gigabyte Europe extract. The simple strategy produces 190 megabytes with 4100 broken way references. complete_ways produces 205 megabytes with no broken way references. Smart produces 224 megabytes with no broken references of any kind. The unclipped Europe input is shown at 28.4 gigabytes for scale.</desc>
  <rect x="0" y="0" width="880" height="282" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">What each strategy costs on the same boundary</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">Ireland cut from the Europe extract (28.4 GB input)</text>
  <line x1="250" y1="68" x2="250" y2="228" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">simple</text>
  <rect x="250" y="74" width="6" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="266" y="89" font-size="11" fill="currentColor" opacity="0.9">190 MB · 4 100 broken way references</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">complete_ways</text>
  <rect x="250" y="116" width="6" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="266" y="131" font-size="11" fill="currentColor" opacity="0.9">205 MB · 0 broken way references</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">smart</text>
  <rect x="250" y="158" width="6" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="266" y="173" font-size="11" fill="currentColor" opacity="0.9">224 MB · 0 broken references at all</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">no clip (Europe)</text>
  <rect x="250" y="200" width="462" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="722" y="215" font-size="11" fill="currentColor" opacity="0.9">28.4 GB · the input, for scale</text>
  <text x="868" y="264" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The gap between the cheapest and the correct strategy is 15 MB on a 200 MB output — under 8 percent, for the difference between broken and complete geometry.</text>
</svg>
<figcaption>The economics are not close. Referential completeness costs single-digit percentages of output size and removes an entire class of downstream failure.</figcaption>
</figure>

The numbers make the choice straightforward. Cutting Ireland out of a Europe extract, `simple` saves fifteen megabytes over `complete_ways` on a two-hundred-megabyte output and hands the next stage four thousand broken way references. Nothing downstream benefits from that trade.

## Running the cut

A single-region cut is one command. The `--strategy` flag is the important one; the rest is plumbing.

```bash
osmium extract \
  --polygon boundaries/ireland.poly \
  --strategy=smart \
  --output-header="osmosis_replication_base_url=https://planet.osm.org/replication/minute/" \
  --overwrite \
  -o extracts/ireland.osm.pbf \
  europe-latest.osm.pbf
```

Two details in that command are worth dwelling on. `--overwrite` is required because `osmium` refuses to clobber an existing output, which is correct behaviour and inconvenient in an automated pipeline; set it deliberately rather than discovering it at 03:00. And `--output-header` is how replication metadata survives the cut. By default an extract carries the header fields of its parent, and if the parent was itself an extract with no replication anchor, the child has none either, which means the resulting file cannot be caught up by the diff-sync workflow described in [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/). Set the base URL and, where you know it, the sequence number, at cut time.

Cutting many regions from the same input should be one pass, not many. `osmium extract` accepts a JSON configuration listing every output and its boundary, and reads the input once:

```json
{
  "directory": "extracts",
  "extracts": [
    { "output": "ireland.osm.pbf",  "polygon": { "file_name": "boundaries/ireland.poly",  "file_type": "poly" } },
    { "output": "scotland.osm.pbf", "polygon": { "file_name": "boundaries/scotland.geojson", "file_type": "geojson" } },
    { "output": "wales.osm.pbf",    "bbox": [-5.35, 51.35, -2.63, 53.44] }
  ]
}
```

```bash
osmium extract --config extracts.json --strategy=smart europe-latest.osm.pbf
```

The saving is not marginal. Twelve separate runs over a 28 GB input read 336 GB; one configured run reads 28 GB. On network-backed storage that is the difference between a nightly job and a job that does not finish overnight.

## Validation and error-handling matrix

| Condition | Root cause | How it surfaces | Action |
|---|---|---|---|
| Ways render as straight lines between distant points | `simple` strategy dropped intermediate nodes | Visible only when rendered | Re-cut with `complete_ways` |
| Multipolygon buildings missing their holes | Relation members outside the polygon were dropped | Courtyards filled in | Re-cut with `smart` |
| Output is empty but the command succeeded | Boundary coordinates in latitude, longitude order | Zero objects written, exit code 0 | Swap to longitude, latitude |
| Extract cannot be caught up with diffs | Replication header not carried through | `osmium fileinfo` shows no sequence | Re-cut with `--output-header` |
| Cut takes hours on a small region | Boundary has tens of thousands of vertices | CPU-bound, single core pinned | Simplify the boundary first |
| Coastline broken along the edge | Coastline ways truncated at the boundary | Rendering shows land bleeding into sea | Use `complete_ways` and re-run the coastline build |

The empty-output row deserves emphasis because it is silent. A `.poly` file written in latitude, longitude order describes a polygon somewhere off the coast of Somalia for most European regions, and `osmium` will happily cut it, write a valid PBF containing nothing, and exit zero. The check is trivial — assert that the output object count is non-zero — and it is not done by default.

## Performance and scale considerations

Clipping is dominated by reading the input, not by the geometric test. A well-simplified boundary costs a few hundred nanoseconds per node; reading and inflating a 28 GB input costs minutes. Three consequences follow. First, cut from the smallest input that contains your region: cutting a German state out of the Germany extract rather than out of Europe reads 3 GB instead of 28 GB. Second, batch every region you need into one configured run. Third, spend effort on boundary simplification only when a profile shows the point-in-polygon test actually mattering, which it does only for pathological boundaries.

Memory behaviour differs sharply by strategy. `simple` streams in constant memory. `complete_ways` and `smart` need two passes and an identifier set: the first pass determines which ways and relations are wanted, and the second collects the nodes they reference. That identifier set is the memory cost, and it scales with the number of objects near the boundary rather than with the size of the input, so a long, convoluted boundary costs more than a compact one of the same area.

## Failure modes and gotchas

The subtle failure is the one that produces a file that looks right. An extract cut with `simple` opens fine, renders mostly correctly, and passes a naive object count. Its damage shows up two stages later, when a routing graph built from it has roads that stop at the boundary and a connectivity check reports components that do not exist in the real network — a defect the [Routing-Graph Topology QA](https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/) topic treats as a data-quality problem when it is actually a clipping problem.

A second gotcha concerns re-cutting. Applying diffs to a clipped extract does not keep the clip honest: an object edited upstream so that it now falls inside your boundary will not appear in your extract, because the diff stream contains the edit but your file never had the object. Over months, a diff-updated regional extract drifts away from what a fresh cut of the same boundary would contain. The fix is to re-cut periodically from a current parent rather than to trust the diff stream to maintain the boundary.

Third, boundaries that cross the antimeridian are handled by neither `.poly` nor GeoJSON in a way tools agree on. Split such a region into two polygons either side of 180 degrees and merge the outputs.

## Integration points

The output of a clip is the input to everything else on this site. Feed it to the parsers surveyed in [Choosing an OSM Parser](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/); anchor it to a replication stream using the header fields covered in [Replication Sequence Numbers & State Tracking](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/); index it using one of the schemes compared in [Spatial Index Selection](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/).

The wiring that matters is a verification step between the cut and everything after it:

```python
import logging
import subprocess
import json

logger = logging.getLogger(__name__)

def verify_extract(path: str, min_nodes: int = 1) -> dict[str, int]:
    """Assert a freshly cut extract is non-empty and carries a replication anchor."""
    raw = subprocess.run(
        ["osmium", "fileinfo", "--extended", "--json", path],
        capture_output=True, text=True, check=True,
    ).stdout
    info = json.loads(raw)
    counts = info["data"]["count"]
    if counts["nodes"] < min_nodes:
        raise ValueError(f"{path}: {counts['nodes']} nodes — boundary is probably inverted")
    header = info["header"]["options"]
    if "osmosis_replication_base_url" not in header:
        logger.warning("%s: no replication anchor — this extract cannot be caught up", path)
    logger.info("%s: %d nodes, %d ways, %d relations",
                path, counts["nodes"], counts["ways"], counts["relations"])
    return counts
```

## In this section

- [Clipping an OSM Extract with a .poly Boundary](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/clipping-an-osm-extract-with-a-poly-boundary/) — the end-to-end procedure for a single region, including writing the boundary file.
- [Choosing complete_ways vs smart in osmium extract](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/choosing-complete-ways-vs-smart-in-osmium-extract/) — how to decide between the two strategies that both produce valid output.
- [Splitting a Planet File into Regional Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/splitting-a-planet-file-into-regional-extracts/) — one pass, many outputs, and how to keep the run within a disk budget.

## Frequently Asked Questions

<details>
<summary>Which strategy should I use if I am not sure?</summary>

Use `smart`. It is the only strategy that guarantees no dangling references of any kind, including relation members, and on a country-sized cut it costs under twenty percent more output size than the cheapest option. The cases where a smaller strategy is genuinely better are narrow — a point-of-interest count that ignores geometry, or a disk budget so tight that a few percent matters — and in those cases you will know.
</details>

<details>
<summary>Why does my extract contain objects outside the boundary polygon?</summary>

Because `complete_ways` and `smart` deliberately keep them. A way with one node inside the polygon is kept entire, which means every node of that way comes too, including the ones several kilometres outside. This is what makes the feature renderable and routable. If you need output strictly bounded, clip the resulting geometries in your own processing rather than asking the extractor for it.
</details>

<details>
<summary>Can I clip a file that has already been clipped?</summary>

Yes, and it is often the fastest route — cutting a city out of its country extract reads far less data than cutting it out of a continent. The caveat is referential: if the parent was cut with `simple`, it already has dangling references, and no strategy applied to it can restore the nodes that are not there. Cut from parents produced with `complete_ways` or `smart`.
</details>

<details>
<summary>Does clipping preserve the replication sequence number?</summary>

Only if you ask for it. `osmium extract` copies the parent header, so the sequence survives when the parent had one, but many published extracts do not carry one. Set `--output-header` explicitly with the base URL and, where known, the sequence number and timestamp, so the extract can be caught up later rather than only re-cut.
</details>

<details>
<summary>How do I clip to an administrative boundary from OSM itself?</summary>

Extract the boundary relation, assemble it into a polygon, simplify it, and write it out as GeoJSON. The assembly is the multipolygon problem described in [Understanding OSM Multipolygon Relations for GIS](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/understanding-osm-multipolygon-relations-for-gis/) — administrative boundaries are frequently open or mis-roled and need the same containment-based ring classification as any other multipolygon.
</details>

## Related

- [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/) — the section this topic belongs to.
- [Node, Way & Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — the reference graph that clipping has to cut without breaking.
- [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) — the block ordering that makes a two-pass clip possible.
- [Choosing an OSM Parser](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/) — where osmium-tool sits among the alternatives.
- [Replication Sequence Numbers & State Tracking](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/) — the header fields a cut must carry forward.
- [Routing-Graph Topology QA](https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/) — where a bad clip shows up as a phantom connectivity defect.

Up one level: [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Which osmium extract strategy should I use if I am not sure?",
      "acceptedAnswer": { "@type": "Answer", "text": "Use smart. It is the only strategy that guarantees no dangling references of any kind, including relation members, and on a country-sized cut it costs under twenty percent more output size than the cheapest option. The cases where a smaller strategy is genuinely better are narrow, such as a point-of-interest count that ignores geometry." }
    },
    {
      "@type": "Question",
      "name": "Why does my OSM extract contain objects outside the boundary polygon?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because complete_ways and smart deliberately keep them. A way with one node inside the polygon is kept entire, which means every node of that way comes too, including nodes several kilometres outside. This is what makes the feature renderable and routable. If you need strictly bounded output, clip the resulting geometries in your own processing." }
    },
    {
      "@type": "Question",
      "name": "Can I clip an OSM file that has already been clipped?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes, and it is often faster because cutting a city out of its country extract reads far less data than cutting it out of a continent. The caveat is referential: if the parent was cut with the simple strategy it already has dangling references, and no strategy applied to it can restore nodes that are not present. Cut from parents produced with complete_ways or smart." }
    },
    {
      "@type": "Question",
      "name": "Does clipping an OSM extract preserve the replication sequence number?",
      "acceptedAnswer": { "@type": "Answer", "text": "Only if you ask for it. osmium extract copies the parent header, so the sequence survives when the parent had one, but many published extracts do not carry one. Set --output-header explicitly with the base URL and, where known, the sequence number and timestamp, so the extract can be caught up later rather than only re-cut." }
    },
    {
      "@type": "Question",
      "name": "How do I clip an OSM extract to an administrative boundary from OSM itself?",
      "acceptedAnswer": { "@type": "Answer", "text": "Extract the boundary relation, assemble it into a polygon, simplify it, and write it out as GeoJSON. Administrative boundaries are frequently open or mis-roled, so the assembly needs the same containment-based ring classification as any other OSM multipolygon." }
    }
  ]
}
</script>
