---
title: "Parsing & Tag Normalization Workflows"
description: "Async PBF parsing, batch attribute mapping, regex tag cleaning, error handling, and routing-graph conversion workflows for OpenStreetMap ETL pipelines."
pageDescription: "Async PBF parsing, batch attribute mapping, regex tag cleaning, error handling, and routing-graph conversion workflows for OpenStreetMap ETL pipelines."
slug: parsing-tag-normalization-workflows
type: overview
breadcrumb: "Parsing & Tag Normalization"
datePublished: 2025-09-12
dateModified: 2026-06-26
date: 2026-06-26
---
# Parsing & Tag Normalization Workflows

<svg viewBox="0 0 700 660" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Vertical data-flow diagram of an OSM parsing and tag-normalization pipeline, from a raw PBF or XML extract through streaming parse, memory-bounded chunks, tag extraction, value standardization, and a validation gate that routes valid features to topology assembly and downstream stores while defective features divert to a quarantine queue" style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>OSM Parsing &amp; Tag Normalization Data Flow</title>
  <desc>A raw PBF or XML extract feeds an async streaming parser (pyrosm or pyosmium), which emits memory-bounded chunks. Tag extraction and schema alignment produce typed fields, then value standardization applies regex cleaning and unit conversion. A validation gate splits the flow: valid features pass down to topology assembly and routing-graph construction and then to downstream stores such as GeoParquet or a graph database, while defective features divert right into a quarantine or dead-letter queue.</desc>
  <defs>
    <marker id="arrFlow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <rect x="0" y="0" width="700" height="660" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <!-- B1 source -->
  <rect x="100" y="20" width="260" height="52" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="230" y="51" text-anchor="middle" font-size="13" fill="currentColor">Raw PBF / XML extract</text>
  <line x1="230" y1="72" x2="230" y2="94" stroke="currentColor" stroke-width="1.5" marker-end="url(#arrFlow)"/>
  <!-- B2 parser -->
  <rect x="100" y="96" width="260" height="52" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="230" y="120" text-anchor="middle" font-size="13" fill="currentColor">Async streaming parser</text>
  <text x="230" y="137" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.75">pyrosm &#183; pyosmium</text>
  <line x1="230" y1="148" x2="230" y2="170" stroke="currentColor" stroke-width="1.5" marker-end="url(#arrFlow)"/>
  <!-- B3 chunks -->
  <rect x="100" y="172" width="260" height="52" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="230" y="203" text-anchor="middle" font-size="13" fill="currentColor">Memory-bounded chunks</text>
  <line x1="230" y1="224" x2="230" y2="246" stroke="currentColor" stroke-width="1.5" marker-end="url(#arrFlow)"/>
  <!-- B4 tag extraction -->
  <rect x="100" y="248" width="260" height="52" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="230" y="272" text-anchor="middle" font-size="13" fill="currentColor">Tag extraction &amp;</text>
  <text x="230" y="289" text-anchor="middle" font-size="13" fill="currentColor">schema alignment</text>
  <line x1="230" y1="300" x2="230" y2="322" stroke="currentColor" stroke-width="1.5" marker-end="url(#arrFlow)"/>
  <!-- B5 value standardization -->
  <rect x="100" y="324" width="260" height="52" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="230" y="348" text-anchor="middle" font-size="13" fill="currentColor">Value standardization</text>
  <text x="230" y="365" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.75">regex &#183; unit conversion</text>
  <line x1="230" y1="376" x2="230" y2="398" stroke="currentColor" stroke-width="1.5" marker-end="url(#arrFlow)"/>
  <!-- Validation diamond -->
  <polygon points="230,400 300,440 230,480 160,440" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="230" y="445" text-anchor="middle" font-size="13" fill="currentColor">Validation</text>
  <!-- valid path down -->
  <text x="246" y="500" text-anchor="start" font-size="11" fill="currentColor" opacity="0.85">valid</text>
  <line x1="230" y1="480" x2="230" y2="508" stroke="currentColor" stroke-width="1.5" marker-end="url(#arrFlow)"/>
  <!-- defective path right -->
  <text x="385" y="432" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">defective</text>
  <line x1="300" y1="440" x2="468" y2="440" stroke="currentColor" stroke-width="1.5" marker-end="url(#arrFlow)"/>
  <!-- Quarantine box -->
  <rect x="470" y="414" width="210" height="52" rx="6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 4"/>
  <text x="575" y="438" text-anchor="middle" font-size="13" fill="currentColor">Quarantine /</text>
  <text x="575" y="455" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.75">dead-letter queue</text>
  <!-- B6 topology -->
  <rect x="100" y="510" width="260" height="52" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="230" y="534" text-anchor="middle" font-size="13" fill="currentColor">Topology assembly</text>
  <text x="230" y="551" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.75">&amp; routing graph</text>
  <line x1="230" y1="562" x2="230" y2="584" stroke="currentColor" stroke-width="1.5" marker-end="url(#arrFlow)"/>
  <!-- B7 stores -->
  <rect x="100" y="586" width="260" height="52" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="230" y="610" text-anchor="middle" font-size="13" fill="currentColor">Downstream stores</text>
  <text x="230" y="627" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.75">Parquet &#183; graph DB</text>
</svg>

OpenStreetMap (OSM) data processing pipelines require deterministic parsing and rigorous tag normalization to turn community-contributed geographic primitives into production-ready datasets. This is the transformation layer of the stack: it sits between the raw [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/) that define how bytes are laid out on disk and the analytical or routing systems that consume clean, typed geometry. For mapping engineers, OSM contributors, GIS analysts, and Python ETL developers, a repeatable workflow for ingesting, structuring, and standardizing OSM elements is the foundation of every downstream task — spatial analysis, routing graph generation, isochrone modelling, and automated quality assurance all inherit the defects you fail to catch here. This article details the architectural patterns, format-level details, normalization strategies, and concrete failure modes required to build resilient OSM parsing pipelines.

## Conceptual foundations: what you are actually parsing

Before any code runs, it helps to be precise about the data model that flows through every stage of this workflow. OSM models the world as three primitives — nodes, ways, and relations — described in detail in the [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/). A node is a single point carrying a 64-bit identifier and a coordinate pair; a way is an ordered list of node references that becomes a polyline or, when closed, an area; a relation is an ordered list of typed member references that expresses higher-order structure such as multipolygons, turn restrictions, and route networks. Crucially, geometry is *not* stored inline: a way carries only the IDs of its nodes, so geometry reconstruction is a join, and that join is the single most expensive and error-prone operation in the entire pipeline.

Every primitive additionally carries a free-form dictionary of string key-value pairs — the tags. There is no enforced schema. A speed limit may appear as `maxspeed=50`, `maxspeed=50 mph`, `maxspeed:type=DE:urban`, or be absent entirely. This is the source of both OSM's flexibility and its normalization burden. The parsing workflow therefore has two intertwined responsibilities: **structural** (resolve references, rebuild geometry, preserve topology) and **semantic** (canonicalize keys, standardize values, type-cast attributes). Conflating these two concerns is the most common architectural mistake; the patterns below keep them in separate, independently testable stages.

## Data ingestion & parsing architecture

The initial phase extracts nodes, ways, and relations from compressed Protocol Buffer Binary Format (PBF) or XML extracts. Raw OSM extracts are sparse and topologically interdependent, so parsers must maintain referential integrity while minimizing I/O overhead. Production systems decouple disk reads from in-memory object construction with concurrent I/O, enabling parallel processing of bounding-box slices or regional extracts. [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/) demonstrates how to wrap a synchronous parser in a `ProcessPoolExecutor`/asyncio producer-consumer pattern that streams data through a bounded queue while preserving cache locality.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="ing-stages-t ing-stages-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="ing-stages-t">The five stages of an OSM ingestion pipeline and what each one is allowed to know</title>
  <desc id="ing-stages-d">A left-to-right chain of five ingestion stages with the knowledge each is scoped to. Read knows the container format and nothing about tags. Decode knows the object model — nodes, ways, relations — and nothing about your schema. Resolve knows object references and needs a node cache. Normalise knows your tag vocabulary and nothing about output formats. Write knows the sink and nothing about OSM. A note explains that a stage reaching past its scope is what turns a pipeline into something that cannot be tested in pieces.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="ing" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Five stages, and what each is deliberately ignorant of</text>
  <rect x="26" y="64" width="138" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="95" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">read</text>
  <text x="95" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">container framing</text>
  <text x="95" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">knows: bytes, blocks</text>
  <line x1="164" y1="96" x2="194" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#ing)"/>
  <rect x="198" y="64" width="138" height="64" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="267" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">decode</text>
  <text x="267" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">object model</text>
  <text x="267" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">knows: node/way/relation</text>
  <line x1="336" y1="96" x2="366" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#ing)"/>
  <rect x="370" y="64" width="138" height="64" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="439" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">resolve</text>
  <text x="439" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">references</text>
  <text x="439" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">knows: the node cache</text>
  <line x1="508" y1="96" x2="538" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#ing)"/>
  <rect x="542" y="64" width="138" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="611" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">normalise</text>
  <text x="611" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">your vocabulary</text>
  <text x="611" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">knows: tag rules</text>
  <line x1="680" y1="96" x2="710" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#ing)"/>
  <rect x="714" y="64" width="138" height="64" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="783" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">write</text>
  <text x="783" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">the sink</text>
  <text x="783" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">knows: Parquet, PostGIS</text>
  <text x="440" y="158" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">The test for a leak is simple: if changing the output format requires touching the decoder, the boundary has already been crossed.</text>
</svg>
<figcaption>The scoping is the design. Each stage can be tested with a fixture and swapped independently precisely because none of them knows what the next one needs.</figcaption>
</figure>

Because memory consumption scales non-linearly with feature density, pipelines must incorporate boundary-aware windowing and lazy evaluation. [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) is essential for preventing garbage-collection thrashing when transforming dense urban extracts, where millions of nodes and complex multipolygon relations coexist. The recurring constraint is the node-location store: to rebuild way geometry you must resolve every node reference to a coordinate, and a planet-scale node index will not fit in RAM. The two viable strategies are a streaming **two-pass** read (pass one caches node coordinates to an on-disk store, pass two assembles ways) or an **index-backed** store such as a flex-mem or LMDB cache. A minimal streaming skeleton with the logger pattern used across this site looks like this:

```python
from __future__ import annotations

import logging
from collections.abc import Iterator

import osmium

logger = logging.getLogger(__name__)


class TagHarvester(osmium.SimpleHandler):
    """Stream ways, emitting raw tag dicts without holding the file in memory."""

    def __init__(self) -> None:
        super().__init__()
        self.count: int = 0

    def way(self, w: osmium.osm.Way) -> None:
        tags: dict[str, str] = {t.k: t.v for t in w.tags}
        if "highway" in tags:
            self.count += 1
            if self.count % 100_000 == 0:
                logger.info("processed %d highway ways", self.count)


def harvest(path: str) -> int:
    handler = TagHarvester()
    handler.apply_file(path, locations=True)  # locations=True resolves node coords
    logger.info("finished: %d highway ways", handler.count)
    return handler.count
```

The `locations=True` flag instructs the underlying libosmium reader to maintain a node-location cache so way callbacks receive resolved geometry — the single setting that most often separates a working parser from a `KeyError` on an unresolved node reference.

## Serialization & format details

Sound normalization depends on understanding the bytes you decode. PBF is a sequence of length-delimited fileblocks, each a `BlobHeader` followed by a `Blob`; the [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) walks the block-level byte layout, and the [OSM XML vs PBF Comparison](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/) explains why PBF dominates production: string-table deduplication, delta encoding, and zlib compression typically yield a 5–10× size reduction over XML with proportional parse-time gains.

Three encoding facts directly shape the parsing stage. First, coordinates are stored as integers, not floats. Each `PrimitiveBlock` carries a `granularity` (default 100, in nanodegrees) and `lat_offset`/`lon_offset`; the decoded latitude is

$$ \text{lat}_{\deg} = 10^{-9}\,\bigl(\text{lat\_offset} + \text{granularity} \times \text{lat}_i\bigr) $$

with the analogous expression for longitude. Forgetting the offset or the nanodegree scale silently shifts an entire extract. Second, `DenseNodes` store IDs, coordinates, and timestamps as *delta-encoded* arrays: every value is the difference from the previous one, so a single misread varint corrupts everything after it because the running accumulator never recovers. Third, all tag strings are indexed into a per-block string table; tags are encoded as parallel `keys`/`vals` integer arrays terminated by a zero index. A tag-index overflow or a missing terminator yields keys paired with the wrong values — a defect that passes schema validation while producing nonsense attributes.

Spec-defined limits matter operationally: a `Blob` should not exceed 32 MiB uncompressed (16 MiB is the recommended working ceiling), and the `BlobHeader` `datasize` is capped at 64 KiB. These ceilings define your natural chunk boundary — one fileblock is the smallest independently decodable unit, which makes it the correct granularity for parallel workers.

## Tag extraction & schema alignment

OSM's schema-less tagging is flexible but introduces heavy variability downstream. Each element carries a dictionary of tags that must be parsed, validated, and aligned to a target schema before spatial operations proceed. Applying the conventions documented in [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) before ingestion prevents downstream schema drift. Normalization begins with **key canonicalization**: mapping community-specific, deprecated, or regionally variant keys onto a controlled vocabulary using deterministic lookup tables, versioned tag dictionaries, and fallback logic that preserves unmapped attributes for audit trails.

[Batch Attribute Mapping Strategies](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/) provide the structural framework for translating raw tag dictionaries into typed columns so categorical, numeric, and boolean fields are consistently represented across heterogeneous extracts. A two-pass mapping routine works well: the first pass resolves high-frequency keys with precompiled hash maps; the second applies rule-based transformations to low-frequency or compound keys (`addr:*`, `name:*`, namespaced subkeys). Resolving missing or partial tags is a discipline in itself — see [Handling Missing Tags in OSM Data Pipelines](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/handling-missing-tags-in-osm-data-pipelines/) for default-inference and null-policy patterns. Structuring this as a vectorized operation in pandas or Polars rather than a per-feature Python loop is what makes processing millions of features per cycle feasible.

## Value standardization & regex cleaning

Once keys are aligned, values require systematic standardization to eliminate formatting inconsistencies, unit mismatches, and localized abbreviations. Values such as `maxspeed=50 mph`, `surface=asphalt`, or `opening_hours=Mo-Fr 09:00-17:00` must be parsed into machine-readable forms. [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/) covers pattern-matching routines that extract numeric baselines, normalize casing, and strip non-standard suffixes; the companion guide on [automating tag case normalization with pandas](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/automating-tag-case-normalization-with-pandas/) shows the vectorized form. Compile expressions with anchored boundaries (`^`, `$`) to prevent partial matches that corrupt numeric fields or misclassify categorical attributes:

```python
import re

_SPEED = re.compile(r"^\s*(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>mph|km/h|knots)?\s*$")


def parse_maxspeed(raw: str) -> float | None:
    """Return a speed in km/h, or None if the value is unparseable."""
    m = _SPEED.match(raw)
    if not m:
        return None
    value = float(m.group("value"))
    unit = m.group("unit") or "km/h"
    factor = {"km/h": 1.0, "mph": 1.609344, "knots": 1.852}[unit]
    return round(value * factor, 2)
```

Enforce unit conversion at the ingestion layer: speed limits, elevations, and distances should be normalized to SI units or explicitly tagged with their measurement system. When parsing temporal or scheduling tags, validate against ISO 8601 and the [opening_hours specification](https://wiki.openstreetmap.org/wiki/Key:opening_hours) so downstream routing or accessibility tools receive compliant inputs.

## Spec compliance & validation gates

A normalization pipeline is only trustworthy if it rejects what it cannot prove correct. OSM extracts frequently contain orphaned nodes, unclosed ways, and broken relation memberships caused by incomplete edits or extraction-boundary clipping. [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) details strategies for isolating malformed geometries, logging referential failures, and applying graceful degradation rather than halting execution, while [Fixing Malformed OSM Tags During ETL Ingestion](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/fixing-malformed-osm-tags-during-etl-ingestion/) addresses the value-level repairs. Configure structured logging with correlation IDs so every validation failure traces back to a specific extract version and coordinate.

The table below is the minimum validation matrix a production parser should implement before any feature is committed to an analytical store.

| Failure condition | Root cause | Detection method | Remediation |
| --- | --- | --- | --- |
| Unresolved node reference | Way clipped at extract boundary | Node ID absent from location store | Drop way or back-fill from full extract |
| Duplicate node ID | Merge of overlapping extracts | Hash-set membership on ID | Deduplicate, keep highest version |
| Unclosed way tagged as area | `area=yes` but first ≠ last node | First/last node ID comparison | Quarantine for manual review |
| Multipolygon ring not closed | Missing relation member | Ring-assembly returns open ring | Skip polygon, log relation ID |
| Tag index out of range | Truncated PBF blob | String-table bounds check | Re-fetch blob, fail block |
| Reversed winding order | Outer ring clockwise | Signed-area sign check | Re-orient to right-hand rule |

Common routines include checking for duplicate node IDs, verifying that every way reference exists in the node index, and ensuring multipolygon rings follow the right-hand rule. When topological inconsistency exceeds a configurable threshold, route affected features to a quarantine table for manual review while letting valid data proceed — the dead-letter branch in the diagram above.

## Spatial & topological considerations

Reconstructing geometry correctly depends on coordinate handling. OSM stores coordinates in unprojected WGS 84 (EPSG:4326); analytical work that measures distance or area needs a projected system. The [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) covers on-the-fly reprojection, datum consistency, and the floating-point precision you must retain when promoting nanodegree integers to doubles. Reproject *after* normalization, not before — projecting raw coordinates and then deduplicating invites floating-point near-misses that defeat exact ID joins.

At extract scale, naive geometry joins are prohibitive. Partitioning work by a spatial key keeps each worker's node-location store bounded; the [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/) describes the R-tree, Quadkey, and H3 structures that make bounding-box filtering and nearest-neighbour lookups tractable. Within the parsing stage, the practical pattern is to assign each fileblock to a tile, resolve node locations within the tile, and reconcile only the ways that cross tile boundaries — turning a global join into many local ones.

## Graph conversion & routing preparation

Normalized OSM data is frequently transformed into directed or undirected graphs for network analysis, isochrone generation, and routing simulation. This conversion requires explicit edge-weight assignment, intersection topology resolution, and turn-restriction parsing. [OSMnx Graph Conversion Techniques](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/) covers translating cleaned tag attributes into NetworkX-compatible graph objects — one-way streets, speed-based travel times, accessibility constraints — and the [OSMnx vs Pyrosm routing benchmarks](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/osmnx-vs-pyrosm-performance-benchmarks-for-routing/) quantify the trade-offs at scale.

During construction, apply edge contraction to remove degree-two nodes that are not real intersections, shrinking the graph without altering routing topology. Turn restrictions encoded in `restriction` relations must be parsed into adjacency rules to prevent illegal manoeuvres in pathfinding. This stage is also where normalization debt comes due: an un-normalized `maxspeed` becomes a missing edge weight, and an un-resolved one-way tag becomes a bidirectional edge that silently produces impossible routes.

## Python tooling survey

No single library spans the whole workflow; choosing correctly per stage is part of the design.

- **pyosmium** wraps the C++ `libosmium` and is the streaming workhorse. Its `SimpleHandler`/`FileProcessor` callbacks process nodes, ways, and relations with a bounded memory footprint, it builds areas from multipolygon relations, and it applies `.osc.gz` diffs. Reach for it for ingestion, diff application, and anything where you cannot hold the file in RAM.
- **pyrosm** is a Cython PBF reader that returns GeoDataFrames directly. It is the fastest path from a regional extract to analysis-ready geometry and the natural front end for [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/). Its ceiling is memory: it materializes frames, so it suits city- to country-sized extracts, not the planet.
- **osmium-tool** is the command-line companion to libosmium — filter by tag or bounding box, merge, convert formats, and apply changes. Use it for the cheap pre-filtering pass that shrinks an extract before Python ever sees it.
- **osmx (OSM Express)** is an LMDB-backed, read-optimized store for random access by ID and spatial range. Reach for it when you need point lookups or repeated geometry resolution rather than a single linear sweep.

A typical production layout uses `osmium-tool` to pre-filter, `pyrosm` or `pyosmium` to parse, pandas/Polars to normalize, and `osmx` where random access dominates. If you are unsure which reader a given job wants, [Choosing an OSM Parser: pyosmium vs pyrosm vs osmium-tool](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/) turns that decision into a matrix of access pattern, memory profile, and output type.

## Production ETL patterns

The choice between **streaming** and **batch** is really a memory-budget decision. Streaming (one feature at a time via pyosmium callbacks) keeps resident memory flat and is mandatory at planet scale; batch (materializing GeoDataFrames via pyrosm) is faster and simpler for bounded regional extracts. Parallelism follows the fileblock boundary: because each PBF fileblock is independently decodable, a `ProcessPoolExecutor` can fan blocks out to workers, with cross-block way reconciliation handled in a final reduce step.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 251" role="img" aria-labelledby="etl-shapes-t etl-shapes-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="etl-shapes-t">Three pipeline shapes and the extract size each one is honest about</title>
  <desc id="etl-shapes-d">Three panels. A single-process stream handles up to a country extract, uses bounded memory, is trivially debuggable, and is limited by one core. A multi-process fan-out over PBF blocks handles a continent, scales with cores, but requires a shared node cache and makes ordering non-deterministic. A distributed job over pre-split extracts handles the planet, scales horizontally, but pays a shuffle to resolve cross-boundary references and needs a scheduler.</desc>
  <rect x="0" y="0" width="880" height="251" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Pick the smallest shape that fits the extract you actually process</text>
  <rect x="26" y="52" width="258" height="157" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Single process, streaming</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Fits: up to a country extract</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Memory: bounded by chunk size</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Cores used: one</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Ordering: deterministic</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Debugging: a normal traceback</text>
  <rect x="310" y="52" width="258" height="157" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="439" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Multi-process over blocks</text>
  <text x="324" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Fits: continent extracts</text>
  <text x="324" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Memory: per worker, plus node cache</text>
  <text x="324" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Cores used: all of them</text>
  <text x="324" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Ordering: non-deterministic</text>
  <text x="324" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Debugging: needs per-worker logs</text>
  <rect x="594" y="52" width="258" height="157" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="723" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Distributed over sub-extracts</text>
  <text x="608" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Fits: the planet</text>
  <text x="608" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Memory: per executor</text>
  <text x="608" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Cores used: a cluster</text>
  <text x="608" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Ordering: none without a sort</text>
  <text x="608" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Debugging: a scheduler UI</text>
  <text x="440" y="235" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">The question that decides it is not how big the planet is — it is how big the extract you run every night is.</text>
</svg>
<figcaption>Each step up buys scale and costs determinism. Most teams need the first, reach for the third, and discover the cross-boundary reference problem the second one already had.</figcaption>
</figure>

Build for idempotency and checkpointing. Normalization should be a pure function of `(extract version, ruleset version)` so retries are safe and a partial failure resumes from the last committed checkpoint rather than restarting. Concrete failure modes to design against: out-of-memory on dense relations (mitigate with chunked reads), unresolved references at extract edges (mitigate with quarantine, not crash), GC thrashing on tens of millions of small tag dicts (mitigate with columnar batching), and silent corruption from a single misread varint in a delta-encoded `DenseNodes` block (mitigate with per-block bounds checks). As volumes grow, distributed frameworks such as Dask or Ray partition normalization across worker nodes while message queues decouple ingestion from transformation; region-specific override files apply localized rules before merge so global outputs stay consistent without erasing legally or culturally significant regional distinctions.

## End-to-end normalization procedure {% raw %}{#howto}{% endraw %}

The following sequence assembles the stages above into a single runnable workflow.

1. **Pre-filter the extract.** Run `osmium tags-filter region.osm.pbf w/highway -o roads.osm.pbf` to discard irrelevant features before parsing.
2. **Stream and harvest.** Parse the filtered extract with `pyosmium` using `locations=True`, emitting raw tag dictionaries with resolved geometry.
3. **Canonicalize keys.** Apply a versioned key dictionary to map deprecated and regional keys onto a controlled vocabulary, preserving unmapped keys for audit.
4. **Standardize values.** Run anchored regex parsers and unit conversion to produce typed, SI-normalized columns.
5. **Validate.** Execute the validation matrix; route defective features to the quarantine table and pass the rest.
6. **Reproject and index.** Promote nanodegree integers to WGS 84 doubles, reproject to the analytical CRS, and assign a spatial index key.
7. **Assemble topology.** Reconstruct way and multipolygon geometry, contract degree-two nodes, and parse turn restrictions for routing.
8. **Persist.** Write valid features to GeoParquet or a graph store with the extract and ruleset versions recorded in metadata.

## Historical versioning & replication

A parsing pipeline rarely runs once. OSM publishes minutely, hourly, and daily change files as `.osc.gz` diffs, each paired with a `state.txt` carrying a monotonic `sequenceNumber`; full-history extracts arrive as `.osh.pbf` with a `visible` flag on every object version. The incremental pattern is: record the last applied `sequenceNumber`, fetch the diffs after it from the replication server, apply them with `osmium apply-changes` (or pyosmium's diff handler), and re-run normalization only on the touched features. Designing temporal snapshots means deciding whether you store the latest visible state or the full version history; the latter lets you reconstruct the map at any timestamp but multiplies storage and forces your validation to handle deleted and superseded objects gracefully. Keeping the sequence number in your checkpoint metadata is what makes the whole pipeline resumable and auditable. The full mechanics of this incremental loop — fetching ordered change files, tracking replication state, and applying diffs to files or a database — are covered in [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/).

## Licensing & compliance

OSM data is published under the Open Database License (ODbL). Two obligations bind any pipeline that redistributes derived data: **attribution** — visibly credit "© OpenStreetMap contributors" wherever the data or a produced work appears — and **share-alike** — if you publicly distribute a derivative *database*, you must offer it under ODbL too. Normalization and tag cleaning produce a derivative database, so automate compliance: stamp every output artifact with an attribution string and a link to the license in its metadata sidecar, and record the source extract URL and timestamp so provenance is reproducible. Produced works (a rendered map tile, a routing answer) carry the attribution requirement but not the share-alike copyleft on the underlying database — a distinction worth encoding in your output policy rather than leaving to interpretation.

## In this section

The guides below build out each stage of the workflow:

- [Choosing an OSM Parser: pyosmium vs pyrosm vs osmium-tool](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/) — a decision matrix that maps each task and data scale to the right tool before you write any parsing code.
- [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/) — concurrent ingestion that streams an extract through a bounded queue without blocking on disk.
- [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) — windowing and lazy evaluation that keep dense extracts inside a fixed memory budget.
- [Batch Attribute Mapping Strategies](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/) — turning raw tag dictionaries into typed, vectorized columns.
- [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/) — anchored pattern matching and unit conversion for consistent values.
- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — isolating malformed geometry and tags without halting the run.
- [OSMnx Graph Conversion Techniques](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/) — converting cleaned attributes into routable network graphs.

## Frequently Asked Questions

### Should I use pyrosm or pyosmium for parsing?

Use pyrosm when you want analysis-ready GeoDataFrames from a regional extract that fits in memory — it is the fastest path to typed geometry. Use pyosmium when you need a flat memory footprint at planet scale, must apply `.osc.gz` diffs, or want fine-grained control over node, way, and relation callbacks. Many pipelines use both: pyosmium for streaming ingestion, pyrosm for downstream analytical slices.

### Why are my decoded coordinates in the wrong place?

Almost always a granularity or offset mistake. PBF stores coordinates as integers that must be scaled by the block `granularity` (default 100 nanodegrees) and shifted by `lat_offset`/`lon_offset`. Apply the full `10⁻⁹ × (offset + granularity × value)` formula, and remember `DenseNodes` are delta-encoded — a single misread varint shifts every subsequent coordinate.

### How do I handle tags that do not exist on a feature?

Treat absence as a typed null, not an empty string, and decide a per-key default policy up front: some keys imply a sensible default (`oneway=no` when unset on most highways), others must stay null to avoid fabricating data. See [Handling Missing Tags in OSM Data Pipelines](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/handling-missing-tags-in-osm-data-pipelines/) for inference rules and null policies.

### What is the right chunk size for parallel parsing?

The natural unit is one PBF fileblock, which is independently decodable and capped near 16 MiB uncompressed. Assign whole fileblocks to worker processes and reconcile cross-block way references in a final reduce step, rather than splitting mid-block where delta-encoding accumulators would break.

### Does normalizing OSM data create share-alike obligations?

Yes. Key canonicalization and value cleaning produce a derivative database, which under ODbL must be offered under ODbL if you distribute it publicly. Rendered maps or routing answers are produced works that require attribution but not database copyleft. Automate both by stamping attribution and provenance into every output artifact.

## Related

- [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/) — the data model and serialization formats this workflow consumes.
- [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) — block-level byte layout behind the parsing stage.
- [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) — the controlled vocabulary normalization aligns to.
- [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) — reprojection after normalization.
- [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/) — partitioning that bounds the node-location store.
- [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — the primitives that flow through every stage.

Up: return to the [OSM data processing home](https://www.osm-data-processing.org/) for the full map of fundamentals, parsing, and quality-assurance workflows.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "End-to-end OSM parsing and tag normalization workflow",
  "description": "Assemble pre-filtering, streaming parse, key canonicalization, value standardization, validation, reprojection, topology assembly, and persistence into one OSM ETL pipeline.",
  "step": [
    { "@type": "HowToStep", "name": "Pre-filter the extract", "text": "Use osmium tags-filter to discard irrelevant features before parsing." },
    { "@type": "HowToStep", "name": "Stream and harvest", "text": "Parse the filtered extract with pyosmium using locations=True to emit raw tag dictionaries with resolved geometry." },
    { "@type": "HowToStep", "name": "Canonicalize keys", "text": "Apply a versioned key dictionary mapping deprecated and regional keys onto a controlled vocabulary, preserving unmapped keys for audit." },
    { "@type": "HowToStep", "name": "Standardize values", "text": "Run anchored regex parsers and unit conversion to produce typed, SI-normalized columns." },
    { "@type": "HowToStep", "name": "Validate", "text": "Execute the validation matrix and route defective features to a quarantine table." },
    { "@type": "HowToStep", "name": "Reproject and index", "text": "Promote nanodegree integers to WGS 84 doubles, reproject to the analytical CRS, and assign a spatial index key." },
    { "@type": "HowToStep", "name": "Assemble topology", "text": "Reconstruct way and multipolygon geometry, contract degree-two nodes, and parse turn restrictions." },
    { "@type": "HowToStep", "name": "Persist", "text": "Write valid features to GeoParquet or a graph store with extract and ruleset versions in metadata." }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    { "@type": "Question", "name": "Should I use pyrosm or pyosmium for parsing?", "acceptedAnswer": { "@type": "Answer", "text": "Use pyrosm for analysis-ready GeoDataFrames from a regional extract that fits in memory; use pyosmium for a flat memory footprint at planet scale, diff application, and fine-grained node/way/relation callbacks. Many pipelines use both." } },
    { "@type": "Question", "name": "Why are my decoded coordinates in the wrong place?", "acceptedAnswer": { "@type": "Answer", "text": "Usually a granularity or offset mistake. PBF stores integers that must be scaled by granularity (default 100 nanodegrees) and shifted by lat_offset/lon_offset, and DenseNodes are delta-encoded so a single misread varint shifts every subsequent coordinate." } },
    { "@type": "Question", "name": "How do I handle tags that do not exist on a feature?", "acceptedAnswer": { "@type": "Answer", "text": "Treat absence as a typed null, not an empty string, and define a per-key default policy: some keys imply a default while others must stay null to avoid fabricating data." } },
    { "@type": "Question", "name": "What is the right chunk size for parallel parsing?", "acceptedAnswer": { "@type": "Answer", "text": "One PBF fileblock, which is independently decodable and capped near 16 MiB uncompressed. Assign whole fileblocks to workers and reconcile cross-block way references in a reduce step." } },
    { "@type": "Question", "name": "Does normalizing OSM data create share-alike obligations?", "acceptedAnswer": { "@type": "Answer", "text": "Yes. Normalization produces a derivative database, which under ODbL must be offered under ODbL if distributed publicly. Rendered maps or routing answers are produced works needing attribution but not database copyleft." } }
  ]
}
</script>
