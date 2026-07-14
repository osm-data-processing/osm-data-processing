<p align="center">
  <a href="https://www.osm-data-processing.org">
    <img src="https://www.osm-data-processing.org/assets/icons/og-image.png" alt="OpenStreetMap Data Processing &amp; QA Pipelines" width="100%">
  </a>
</p>

<h1 align="center">OpenStreetMap Data Processing &amp; QA Pipelines</h1>

<p align="center">
  <strong>A technical reference for engineers building and operating production OpenStreetMap data pipelines.</strong><br>
  PBF/XML parsing · tag normalization · topology cleaning · routing-graph extraction · replication &amp; diff sync · rule-driven validation · Python automation at continental scale.
</p>

<p align="center">
  <a href="https://www.osm-data-processing.org"><strong>Read it at www.osm-data-processing.org →</strong></a>
</p>

---

## What this is

OpenStreetMap has grown from a volunteer mapping project into foundational geospatial
infrastructure — the base layer under routing engines, navigation stacks, urban analytics, and
machine-learning feature stores. Turning its raw, continuously-edited extracts into clean,
reproducible datasets is a real engineering discipline, and this site is a deep, practical
reference for that work.

Every page is written for **mapping engineers, OSM contributors, GIS analysts, and Python ETL
developers** who need deterministic, reproducible workflows at continental scale. Expect
byte-level format dives, memory-aware streaming patterns, runnable Python, and rule-driven quality
assurance you can wire straight into Dask, Ray, or plain multiprocessing — not surface-level
overviews.

## What's inside

The material is organised into four tracks, each an in-depth reference with step-by-step guides,
runnable code, hand-drawn diagrams, and error/remediation tables.

- **[OSM Data Fundamentals &amp; Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/)**
  — the node/way/relation data model, PBF vs XML serialization, the binary block layout,
  coordinate reference systems, spatial indexing (R-tree, H3, Quadkey), tag taxonomy, and ODbL
  licensing.
- **[Parsing &amp; Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/)**
  — choosing a parser (pyosmium vs pyrosm vs osmium-tool), async PBF ingestion, memory-efficient
  chunk processing, batch attribute mapping, regex value cleaning, and routing-graph conversion
  with OSMnx.
- **[OSM Replication &amp; Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/)**
  — keeping local extracts current with `.osc.gz` change files, replication sequence numbers and
  state tracking, full-history `.osh.pbf` processing, and building an automated minutely update
  pipeline.
- **[OSM Data Quality &amp; Validation](https://www.osm-data-processing.org/osm-data-quality-validation/)**
  — authoring validation rules across JOSM, Osmose, and Python; geometry validation and repair;
  routing-graph topology QA; and tag/attribute consistency checking.

## Why read it

- **Spec-grounded, not hand-wavy.** Size ceilings, encoding rules, sequence semantics, and
  winding-order invariants are cited to the OSM Wiki and protobuf spec, so the code matches the
  format.
- **Runnable, production-shaped code.** Python 3.10+ with type hints, a consistent logging
  pattern, streaming-first memory discipline, and quarantine-over-abort error handling.
- **Failure modes up front.** Every guide names the subtle bugs — unreset delta accumulators,
  varint misreads, orphaned references, out-of-order diffs, self-intersecting rings — before they
  cost you a pipeline run.
- **A tight reference graph.** Concepts link to the pages that define them, so you can go as deep
  as a topic needs without losing the thread.

## Built with

A static site generated with [Eleventy](https://www.11ty.dev/), hand-authored inline SVG diagrams,
KaTeX for coordinate math, and Prism for syntax highlighting — deployed on Cloudflare. The source
in this repository is the complete content and templates behind
[www.osm-data-processing.org](https://www.osm-data-processing.org).

## Explore

**[→ Start reading at www.osm-data-processing.org](https://www.osm-data-processing.org)**

More projects from the same author live under the
[osm-data-processing organization](https://github.com/osm-data-processing) on GitHub.
