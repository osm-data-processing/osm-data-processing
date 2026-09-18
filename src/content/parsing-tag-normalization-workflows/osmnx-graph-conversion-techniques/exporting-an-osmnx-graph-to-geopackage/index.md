---
title: "Exporting an OSMnx Graph to GeoPackage"
description: "Write a routing graph to a portable GIS file without losing the edge geometry, the list-valued attributes or the node identifiers a router needs to rebuild it."
pageTitle: "Exporting a Routing Graph to GeoPackage Losslessly"
pageDescription: "Convert an OSMnx graph into node and edge layers, flatten list-valued attributes rather than dropping them, keep endpoint identifiers, and verify the graph rebuilds from the file."
slug: exporting-an-osmnx-graph-to-geopackage
type: article
breadcrumb: "Export to GeoPackage"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Exporting an OSMnx Graph to GeoPackage

A graph and a GIS file disagree about what a thing is. The graph has typed Python objects on edges and an implicit topology; the file has fixed columns and no notion of a node being connected to anything. The export is where that disagreement has to be settled deliberately.

## Prerequisites

- [ ] Python 3.10+ with `osmnx`, `geopandas` ≥ 0.14 and a GDAL build supporting GeoPackage.
- [ ] A graph, ideally simplified per [Simplifying an OSMnx Graph Without Losing Geometry](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/simplifying-an-osmnx-graph-without-losing-geometry/).
- [ ] A decision about who reads the file: a GIS user, a router, or both.
- [ ] The graph's CRS declared, since GeoPackage stores it and a wrong value travels.
- [ ] A test that rebuilds the graph from the file, because that is the only real check.

## Conceptual minimum

A graph exports as **two layers**: nodes and edges. The nodes layer is straightforward — a point per node with its identifier. The edges layer is where the problems are.

**Edges need their endpoints as columns.** A GIS file has no concept of connectivity, so the only way a graph can be rebuilt is if each edge row carries its source and target node identifiers explicitly.

**Parallel edges need a key.** Two roads can connect the same pair of junctions, and without a third component in the key the two collapse into one on reload.

**List-valued attributes have no column type.** An OSM way merged from several source ways carries a list of identifiers; a GeoPackage column holds a scalar. Dropping the attribute loses provenance and writing the Python representation of a list produces a string nothing can parse reliably. Joining on a separator, consistently, is the workable answer.

**Nulls and mixed types break the write.** A column that is an integer on most rows and a string on a few has no GeoPackage type, and the write either fails or silently coerces.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="eog1-t eog1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="eog1-t">What each graph concept becomes in the file, and what breaks if it is omitted</title>
  <desc id="eog1-d">A grid of four graph concepts against their file representation and the consequence of omitting them. Node identity becomes an identifier column on the nodes layer, without which nothing can be joined. Edge endpoints become source and target columns on the edges layer, without which the topology is unrecoverable. Parallel edges need a key column distinguishing them, without which two roads between the same junctions collapse into one. List attributes need a consistent joined string, without which provenance is either lost or written in a form nothing can parse.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four concepts, four columns, four failures</text>
  <rect x="196" y="48" width="329" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="360" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">In the file</text>
  <rect x="525" y="48" width="329" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="690" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">If omitted</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Node identity</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="360" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">an id column</text>
  <text x="690" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">nothing joins</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Edge endpoints</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="360" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">source and target</text>
  <text x="690" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">topology lost</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Parallel edges</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="360" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a key column</text>
  <text x="690" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">two roads become one</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">List attributes</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="360" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">joined on a separator</text>
  <text x="690" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">provenance lost</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Only the first of these is produced automatically by a naive export; the other three have to be arranged deliberately.</text>
</svg>
<figcaption>A file that opens correctly in a GIS viewer can still be missing everything needed to rebuild the graph.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
from pathlib import Path

import geopandas as gpd
import networkx as nx
import osmnx as ox
import pandas as pd

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.graph.export")

LIST_SEPARATOR = "|"          # not a comma: OSM values contain commas


def flatten_lists(frame: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Join list-valued cells into strings. A GeoPackage column holds scalars."""
    out = frame.copy()
    for column in out.columns:
        if column == "geometry":
            continue
        has_lists = out[column].map(lambda v: isinstance(v, (list, tuple))).any()
        if not has_lists:
            continue
        out[column] = out[column].map(
            lambda v: LIST_SEPARATOR.join(str(x) for x in v)
            if isinstance(v, (list, tuple)) else v)
        logger.info("flattened list values in column %r", column)
    return out


def coerce_types(frame: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Give every column one type. Mixed columns have no GeoPackage type."""
    out = frame.copy()
    for column in out.columns:
        if column == "geometry":
            continue
        series = out[column]
        if series.dtype == object:
            kinds = {type(v).__name__ for v in series.dropna()}
            if len(kinds) > 1:
                # Mixed types: stringify the whole column rather than let the
                # driver coerce unpredictably or drop rows.
                logger.warning("column %r has mixed types %s; storing as text",
                               column, sorted(kinds))
                out[column] = series.map(lambda v: None if v is None else str(v))
    return out


def export(graph: nx.MultiDiGraph, path: Path) -> Path:
    nodes, edges = ox.graph_to_gdfs(graph, nodes=True, edges=True,
                                    fill_edge_geometry=True)

    # Endpoints and the parallel-edge key live in the index; a file has no
    # index, so they must become real columns or the topology is unrecoverable.
    edges = edges.reset_index()
    for required in ("u", "v", "key"):
        if required not in edges.columns:
            raise ValueError(f"edges are missing {required!r}; the graph cannot "
                             f"be rebuilt from this export")
    nodes = nodes.reset_index().rename(columns={"osmid": "node_id"})

    edges = coerce_types(flatten_lists(edges))
    nodes = coerce_types(flatten_lists(nodes))

    if nodes.crs is None or edges.crs is None:
        raise ValueError("graph has no CRS; set one before exporting")

    path.unlink(missing_ok=True)
    nodes.to_file(path, layer="nodes", driver="GPKG")
    edges.to_file(path, layer="edges", driver="GPKG")
    logger.info("wrote %d node(s) and %d edge(s) to %s",
                len(nodes), len(edges), path.name)
    return path


def rebuild(path: Path) -> nx.MultiDiGraph:
    """Read the file back into a graph. This is the only real verification."""
    nodes = gpd.read_file(path, layer="nodes").set_index("node_id")
    edges = gpd.read_file(path, layer="edges").set_index(["u", "v", "key"])
    graph = ox.graph_from_gdfs(nodes, edges)
    logger.info("rebuilt graph with %d node(s) and %d edge(s)",
                graph.number_of_nodes(), graph.number_of_edges())
    return graph


def compare(original: nx.MultiDiGraph, restored: nx.MultiDiGraph) -> bool:
    ok = True
    for name, a, b in (("node", original.number_of_nodes(),
                        restored.number_of_nodes()),
                       ("edge", original.number_of_edges(),
                        restored.number_of_edges())):
        if a != b:
            logger.error("%s count differs: %d before, %d after", name, a, b)
            ok = False
    before = sum(d.get("length", 0.0) for *_, d in original.edges(data=True))
    after = sum(d.get("length", 0.0) for *_, d in restored.edges(data=True))
    if abs(before - after) > max(1.0, before * 1e-9):
        logger.error("total length differs: %.1f before, %.1f after", before, after)
        ok = False
    return ok


if __name__ == "__main__":
    logger.info("export, rebuild, compare — an export that cannot be rebuilt "
                "is a picture of a graph rather than a graph")
```

## Step-by-step walkthrough

1. **Promote the index to columns.** The endpoint identifiers and the parallel-edge key live in the frame's index, and a file has no index. Failing to reset it produces a file that draws correctly and cannot be rebuilt.
2. **Assert the three key columns exist.** Checking before writing turns a silent loss of topology into a clear error at the right moment.
3. **Choose a separator that does not appear in values.** A comma is the obvious choice and the wrong one, because OSM names and references contain commas. A pipe is safe in practice.
4. **Flatten lists rather than dropping them.** The merged-way identifier list is provenance, and losing it means a feature in the file cannot be traced to the OSM ways it came from.
5. **Coerce mixed-type columns to text.** A column that is numeric on most rows and a string on a few has no file type, and letting the driver decide produces either a failure or a silent coercion.
6. **Require a CRS.** GeoPackage stores it, so a wrong or missing value travels with the file and misplaces everything downstream.
7. **Rebuild and compare.** Node count, edge count and total length together catch collapsed parallel edges, lost rows and mangled geometry. An export that has not been rebuilt has not been verified.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="eog2-t eog2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="eog2-t">The export and the verification that makes it meaningful</title>
  <desc id="eog2-d">Four steps. The convert step turns the graph into node and edge frames with geometry filled in for every edge. The promote step moves the endpoint identifiers and parallel-edge key out of the index and into real columns, since a file has no index. The clean step flattens list-valued attributes onto a safe separator and gives mixed-type columns a single type. The verify step reads the file back into a graph and compares node count, edge count and total length against the original.</desc>
  <defs><marker id="eog2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Convert, promote, clean, verify</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">convert</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">nodes and edges</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">fill edge geometry</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#eog2-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">promote</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">index to columns</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">or topology is lost</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#eog2-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">clean</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">flatten and coerce</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">one type per column</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#eog2-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">verify</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">rebuild and compare</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">the only real check</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">An export that opens in a viewer proves the geometry is fine and says nothing about whether the graph survived.</text>
</svg>
<figcaption>The fourth step is the only one that would notice parallel edges collapsing, which a viewer cannot show.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="eog3-t eog3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="eog3-t">Three things a GIS viewer cannot tell you about an exported graph</title>
  <desc id="eog3-d">Three panels. Collapsed parallel edges look identical in a viewer, because two overlapping roads between the same junctions draw as one line either way, and only a count comparison reveals the loss. An unparseable list attribute looks like an ordinary text column, and only attempting to split it reveals that the values were written in a form nothing can read back. Missing endpoint columns are invisible entirely, because the geometry draws perfectly and the topology simply is not there.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three losses a viewer renders perfectly</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Collapsed parallel edges</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Two roads draw as one</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Either way, identically</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Only counts reveal it</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Routing silently changes</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Unparseable lists</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Looks like a text column</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Until you split it</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Provenance unrecoverable</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Discovered much later</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Missing endpoints</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Geometry draws perfectly</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Topology is absent</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Invisible in a viewer</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Found by the router</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Each of these is caught immediately by rebuilding the graph, and by nothing else that anybody would think to do.</text>
</svg>
<figcaption>The export's purpose is the graph, so the check has to be on the graph rather than on the picture.</figcaption>
</figure>

## Verification

- **The graph rebuilds.** Reading the file back must produce a graph, not an error about missing columns.
- **Counts match exactly.** Node and edge counts before and after must be identical; a lower edge count means parallel edges collapsed.
- **Total length is preserved.** Summing edge lengths should agree to floating-point tolerance.
- **List attributes survive.** Find an edge merged from several ways and confirm its identifier list is present and splittable.
- **The CRS is correct.** Open the file in a GIS and confirm it lands where expected.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Graph cannot be rebuilt | Endpoint identifiers left in the index | Reset the index so they become columns |
| Edge count falls on reload | Parallel-edge key not exported | Include the key column in the edges layer |
| List attributes become unparseable | Python list representation written | Join on a separator absent from the values |
| Write fails on a column | Mixed types in one column | Coerce the whole column to text |
| Features land in the wrong place | CRS unset or wrong | Require a CRS before writing |
| Separator splits real values | A comma used as the separator | Use a character that does not occur in OSM values |
| Edges have no geometry | Geometry not filled for straight edges | Fill edge geometry during conversion |

## Specification reference

> GeoPackage stores vector features in SQLite tables with a declared geometry column and coordinate reference system, one table per layer, with fixed column types. It has no representation for list-valued attributes or for graph connectivity, so both must be encoded explicitly by the writer. See the [GeoPackage specification](https://www.geopackage.org/) for the table and geometry model.

## Frequently Asked Questions

<details>
<summary>Why must the endpoint identifiers become columns?</summary>

Because a GIS file has no notion of an index or of connectivity. In memory the edge frame is indexed by source, target and key, and that index is what encodes the topology; writing the file discards it. Without those three as real columns, the file contains a set of lines that draw correctly and cannot be reassembled into a graph, which is usually discovered by whoever tries to route on it.
</details>

<details>
<summary>Why not use a comma to join list values?</summary>

Because OSM values contain commas routinely — names, references, opening hours and address fields all do. Splitting on a comma then breaks a single value into fragments, and the damage is silent because the fragments look like plausible list members. A character that does not occur in the data, such as a pipe, avoids the problem entirely and costs nothing.
</details>

<details>
<summary>What should happen to a column with mixed types?</summary>

Coerce the whole column to text and say so. A GeoPackage column has one type, so a column that is numeric on most rows and a string on a few must be resolved somehow; letting the driver choose produces either a failed write or a silent coercion that loses the non-conforming values. Stringifying preserves everything at the cost of the consumer parsing it back.
</details>

<details>
<summary>Is opening the file in a GIS a sufficient check?</summary>

No. A viewer shows that the geometry is present and correctly located, which is the part least likely to be wrong. It cannot show that parallel edges collapsed, that a list attribute became unparseable, or that the endpoint columns are missing. Rebuilding the graph from the file and comparing counts and total length is the only check that exercises what the export was for.
</details>

## Related

- [OSMnx Graph Conversion Techniques](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/) — the parent topic and building the graph.
- [Simplifying an OSMnx Graph Without Losing Geometry](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/simplifying-an-osmnx-graph-without-losing-geometry/) — the step that should precede export.
- [Exporting OSM to GeoParquet & PostGIS](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/) — sinks with richer type systems.
- [Splitting Semicolon-Separated OSM Tag Values](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/splitting-semicolon-separated-osm-tag-values/) — the same separator problem in the source data.
- [Routing Graph Topology QA](https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/) — checks the rebuilt graph should pass.

Up one level: [OSMnx Graph Conversion Techniques](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Exporting an OSMnx Graph to GeoPackage",
  "description": "Write a routing graph to a portable GIS file without losing the edge geometry, the list-valued attributes or the node identifiers a router needs to rebuild it.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Parsing & Tag Normalization Workflows",
  "about": ["GeoPackage export", "graph serialisation", "list attributes"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Parsing & Tag Normalization Workflows", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/" },
    { "@type": "ListItem", "position": 3, "name": "OSMnx Graph Conversion Techniques", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/" },
    { "@type": "ListItem", "position": 4, "name": "Exporting an OSMnx Graph to GeoPackage", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/exporting-an-osmnx-graph-to-geopackage/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Export a routing graph to GeoPackage without losing topology",
  "description": "Convert to node and edge frames with filled geometry, promote the index into real columns, flatten list attributes on a safe separator, coerce mixed-type columns, and rebuild to verify.",
  "step": [
    { "@type": "HowToStep", "name": "Convert with filled geometry", "text": "Produce node and edge frames, ensuring every edge carries a geometry even where it is a straight segment." },
    { "@type": "HowToStep", "name": "Promote the index", "text": "Move the source, target and parallel-edge key out of the index and into real columns, since a file has no index." },
    { "@type": "HowToStep", "name": "Assert the key columns", "text": "Fail before writing when any of the three is missing, rather than producing an unrebuildable file." },
    { "@type": "HowToStep", "name": "Flatten list attributes", "text": "Join list values on a separator that does not occur in OSM data, rather than dropping them or writing a language representation." },
    { "@type": "HowToStep", "name": "Coerce mixed columns", "text": "Give every column one type, stringifying where values are heterogeneous, so the driver cannot coerce silently." },
    { "@type": "HowToStep", "name": "Require a CRS", "text": "Refuse to write without a declared coordinate reference system, since the file carries it onward." },
    { "@type": "HowToStep", "name": "Rebuild and compare", "text": "Read the file back into a graph and compare node count, edge count and total edge length against the original." }
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
      "name": "Why must graph endpoint identifiers become file columns?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because a GIS file has no notion of an index or of connectivity. In memory the edge frame is indexed by source, target and key, and that index encodes the topology; writing the file discards it. Without those three as real columns, the file contains lines that draw correctly and cannot be reassembled into a graph." }
    },
    {
      "@type": "Question",
      "name": "Why not use a comma to join list values on export?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because OSM values contain commas routinely — names, references, opening hours and address fields all do. Splitting on a comma breaks a single value into fragments, and the damage is silent because the fragments look like plausible list members. A character that does not occur in the data avoids it entirely." }
    },
    {
      "@type": "Question",
      "name": "What should happen to a column with mixed types on export?",
      "acceptedAnswer": { "@type": "Answer", "text": "Coerce the whole column to text and say so. A GeoPackage column has one type, so letting the driver choose produces either a failed write or a silent coercion that loses non-conforming values. Stringifying preserves everything at the cost of the consumer parsing it back." }
    },
    {
      "@type": "Question",
      "name": "Is opening the exported file in a GIS a sufficient check?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. A viewer shows that the geometry is present and correctly located, which is the part least likely to be wrong. It cannot show that parallel edges collapsed or that endpoint columns are missing. Rebuilding the graph and comparing counts and total length is the only check that exercises what the export was for." }
    }
  ]
}
</script>
