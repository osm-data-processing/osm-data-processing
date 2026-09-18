---
title: "Running Planetiler on a Regional Extract"
description: "Size memory, node storage and the temporary feature store for a Planetiler build, run it against a regional extract, and read its progress output well enough to know what to fix."
pageTitle: "Run Planetiler on a Regional OSM Extract"
pageDescription: "Provision node storage and temporary disk for a Planetiler run, launch the build with the right storage flags, and interpret its per-phase progress output to diagnose a slow or failing build."
slug: running-planetiler-on-a-regional-extract
type: article
breadcrumb: "Running Planetiler"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Running Planetiler on a Regional Extract

Get a complete tile archive out of a country-sized extract in one run, on hardware you actually have, by sizing the two storage decisions before you start rather than discovering them at hour four.

## Prerequisites

- [ ] A Java 21 runtime and the Planetiler distribution.
- [ ] A verified regional extract, per [Automating Geofabrik Extract Downloads with Checksums](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/automating-geofabrik-extract-downloads-with-checksums/).
- [ ] Fast local disk with room for the node store and the temporary feature store — several times the extract size.
- [ ] A decision about maximum zoom, from [OSM Vector Tiles & Rendering Pipelines](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/), because it dominates the render phase.
- [ ] The tool's model from [Planetiler & Tilemaker Workflows](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/planetiler-and-tilemaker-workflows/).

## Conceptual minimum

A Planetiler run has two storage decisions and everything else follows from them.

**Node location storage.** Building way geometry needs every referenced node's coordinate. Planetiler can hold that map on the Java heap, in off-heap memory-mapped files, or in a direct memory-mapped array indexed by node identifier. The array is the fastest and is sized by the *highest node identifier in the planet*, not by your region — which is why a small country extract still wants tens of gigabytes of address space. Memory mapping makes that workable: the operating system pages in what is touched.

**The temporary feature store.** Every feature the profile emits is written to a temporary store, sorted spatially, then read back per tile. This is sequential-write then sequential-read, so it wants throughput rather than low latency, and it wants room — typically a few times the extract size.

Neither decision is about the tile output. Both are about whether the build completes.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="rpr1-t rpr1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="rpr1-t">The four phases of a Planetiler run and what each one is limited by</title>
  <desc id="rpr1-d">Four stacked phases. The read phase streams the extract and runs the profile per element, limited by profile cost and by node store access. The sort phase orders the temporary feature store spatially, limited by disk throughput and available memory for the merge. The render phase reads the sorted store and encodes tiles, limited by CPU and by the maximum zoom. The write phase appends tiles to the archive, limited by disk and by the archive format's write pattern.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four phases, four different bottlenecks</text>
  <rect x="26" y="50" width="828" height="52" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="42" y="72" font-size="12.5" font-weight="700" fill="currentColor">Read</text>
  <text x="42" y="90" font-size="10.5" fill="currentColor" opacity="0.88">Stream elements, run the profile</text>
  <text x="838" y="82" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">profile and node store</text>
  <rect x="26" y="112" width="828" height="52" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="42" y="134" font-size="12.5" font-weight="700" fill="currentColor">Sort</text>
  <text x="42" y="152" font-size="10.5" fill="currentColor" opacity="0.88">Order the feature store spatially</text>
  <text x="838" y="144" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">disk throughput</text>
  <rect x="26" y="174" width="828" height="52" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="42" y="196" font-size="12.5" font-weight="700" fill="currentColor">Render</text>
  <text x="42" y="214" font-size="10.5" fill="currentColor" opacity="0.88">Encode tiles from the sorted store</text>
  <text x="838" y="206" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">CPU and maximum zoom</text>
  <rect x="26" y="236" width="828" height="52" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="42" y="258" font-size="12.5" font-weight="700" fill="currentColor">Write</text>
  <text x="42" y="276" font-size="10.5" fill="currentColor" opacity="0.88">Append tiles to the archive</text>
  <text x="838" y="268" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">disk write pattern</text>
  <text x="868" y="308" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Because each phase has a different limit, a build that is slow tells you which resource to add only once you know which phase is slow.</text>
</svg>
<figcaption>Watching which phase dominates is faster than guessing, and the progress output names each one as it runs.</figcaption>
</figure>

## Runnable solution

```bash
#!/usr/bin/env bash
# Build a regional tile archive with Planetiler.
set -euo pipefail

EXTRACT="${1:?usage: build.sh <extract.osm.pbf>}"
AREA="$(basename "$EXTRACT" .osm.pbf)"
TMP="/fast-local/planetiler-tmp"       # MUST be local disk, not network
OUT="${AREA}.pmtiles"
MAXZOOM=14

mkdir -p "$TMP"
FREE_KB="$(df -Pk "$TMP" | awk 'NR==2 {print $4}')"
EXTRACT_KB="$(du -k "$EXTRACT" | cut -f1)"
# The temporary store plus the node store want several times the extract.
if [ "$FREE_KB" -lt $(( EXTRACT_KB * 6 )) ]; then
  echo "need ~$(( EXTRACT_KB * 6 / 1024 / 1024 )) GiB free on $TMP, have $(( FREE_KB / 1024 / 1024 ))" >&2
  exit 1
fi

java -Xmx8g \
  -jar planetiler.jar \
  --osm-path="$EXTRACT" \
  --output="$OUT" \
  --maxzoom="$MAXZOOM" \
  --tmpdir="$TMP" \
  --nodemap-type=array \
  --nodemap-storage=mmap \
  --force \
  2>&1 | tee "build-${AREA}.log"

# The log records per-phase timings; keep it beside the archive.
grep -E "^\s*(read|sort|render|write)" "build-${AREA}.log" || true
```

```python
from __future__ import annotations

import logging
import re
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.planetiler.log")

# Planetiler prints a line per phase with an elapsed time, e.g. "  read: 12m34s".
PHASE_RE = re.compile(r"^\s*(\w+)\s*:\s*(?:(\d+)m)?(\d+(?:\.\d+)?)s", re.M)


def parse_phases(log: str) -> dict[str, float]:
    phases: dict[str, float] = {}
    for name, minutes, seconds in PHASE_RE.findall(log):
        phases[name] = float(minutes or 0) * 60 + float(seconds)
    return phases


def diagnose(log_path: Path) -> str:
    phases = parse_phases(log_path.read_text(encoding="utf-8"))
    if not phases:
        return "no phase timings found — did the build finish?"
    total = sum(phases.values())
    for name, seconds in sorted(phases.items(), key=lambda kv: -kv[1]):
        logger.info("%-8s %6.0fs  %4.1f%%", name, seconds, 100 * seconds / total)

    worst = max(phases, key=phases.get)
    share = phases[worst] / total
    if worst == "read" and share > 0.55:
        return "READ dominates: the profile is doing too much work per element"
    if worst == "sort" and share > 0.45:
        return "SORT dominates: give the temporary store faster disk or more memory"
    if worst == "render" and share > 0.45:
        return "RENDER dominates: lower the maximum zoom or add cores"
    return f"balanced; {worst} is largest at {share:.0%}"


if __name__ == "__main__":
    logger.info("verdict: %s", diagnose(Path(sys.argv[1])))
```

## Step-by-step walkthrough

1. **Check the disk before launching.** The script refuses to start when free space is under roughly six times the extract, because failing at the start costs seconds and failing at hour four costs the whole run.
2. **Keep the temporary directory local.** The feature store is written and read at high throughput; a network volume turns a two-hour build into an overnight one.
3. **Choose the array node map with memory mapping.** The array is indexed directly by node identifier, which is the fastest lookup available, and memory mapping means the address space it reserves is not resident memory.
4. **Keep the heap modest.** Planetiler does most of its heavy storage off-heap, so an enormous heap does not help and takes memory the page cache would use better.
5. **Cap the maximum zoom deliberately.** The render phase scales with tile count, which quadruples per level; this is the single largest lever on that phase.
6. **Tee the log.** Per-phase timings are the only cheap diagnostic, and they are gone if the output is not kept.
7. **Diagnose from the phase shares.** The parser turns the log into a verdict naming the resource to change, rather than a wall of numbers.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 306" role="img" aria-labelledby="rpr2-t rpr2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="rpr2-t">Reading a Planetiler build's phase timings to decide what to change</title>
  <desc id="rpr2-d">A decision node taking the dominant phase as input, with three outcomes. When the read phase dominates, the profile is doing too much work per element and needs its lookups precomputed. When the sort phase dominates, the temporary feature store is limited by disk throughput or by memory available for the merge. When the render phase dominates, the maximum zoom is too high for the available cores, and lowering it or adding cores is the fix.</desc>
  <defs><marker id="rpr2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="306" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Which phase dominated the build?</text>
  <rect x="26" y="117" width="250" height="88" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.6"/>
  <text x="151" y="145" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Read the phase shares first</text>
  <text x="151" y="167" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">The log names every phase</text>
  <text x="151" y="185" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">One usually stands out</text>
  <line x1="276" y1="161" x2="314" y2="161" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="314" y2="239" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="353" y2="83" stroke="currentColor" stroke-width="1.4" marker-end="url(#rpr2-a)"/>
  <rect x="356" y="52" width="498" height="62" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="370" y="77" font-size="12" font-weight="700" fill="currentColor">Read dominates</text>
  <text x="370" y="97" font-size="10.5" fill="currentColor" opacity="0.88">Profile cost per element; precompute its lookups</text>
  <line x1="314" y1="161" x2="353" y2="161" stroke="currentColor" stroke-width="1.4" marker-end="url(#rpr2-a)"/>
  <rect x="356" y="130" width="498" height="62" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="370" y="155" font-size="12" font-weight="700" fill="currentColor">Sort dominates</text>
  <text x="370" y="175" font-size="10.5" fill="currentColor" opacity="0.88">Temporary store disk throughput or merge memory</text>
  <line x1="314" y1="239" x2="353" y2="239" stroke="currentColor" stroke-width="1.4" marker-end="url(#rpr2-a)"/>
  <rect x="356" y="208" width="498" height="62" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="370" y="233" font-size="12" font-weight="700" fill="currentColor">Render dominates</text>
  <text x="370" y="253" font-size="10.5" fill="currentColor" opacity="0.88">Maximum zoom too high for the cores available</text>
  <text x="868" y="290" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">A balanced build with no phase above half is already close to the hardware's limit, and the next gain is a bigger machine.</text>
</svg>
<figcaption>Each branch points at a different resource, which is why adding RAM to a render-bound build changes nothing.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 239" role="img" aria-labelledby="rpr3-t rpr3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="rpr3-t">The three node map storage options and what each one trades</title>
  <desc id="rpr3-d">Three panels. A sorted table keyed on node identifier uses the least space because it stores only nodes that exist, but every lookup is a binary search. A direct array indexed by identifier gives constant-time lookup but reserves space for every possible identifier up to the planet maximum. Memory mapping either structure moves the reservation from resident memory to address space, letting the operating system page in what is touched, at the cost of depending on fast local disk.</desc>
  <rect x="0" y="0" width="880" height="239" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three storage options, one of them is really two</text>
  <rect x="26" y="52" width="259" height="153" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Sorted table</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Stores only existing nodes</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Smallest footprint</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Binary search per lookup</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Good on a small machine</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Slower read phase</text>
  <rect x="311" y="52" width="259" height="153" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Direct array</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Indexed by identifier</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Constant-time lookup</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Sized by the planet maximum</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Fastest read phase</text>
  <text x="325" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Needs the space reserved</text>
  <rect x="595" y="52" width="259" height="153" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Memory mapping</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Applies to either above</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Address space, not RAM</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">OS pages in what is used</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Needs fast local disk</text>
  <text x="609" y="188" font-size="10.5" fill="currentColor" opacity="0.92">The usual production choice</text>
  <text x="868" y="223" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Memory mapping an array is what makes a country build fit on an ordinary machine, provided the temporary directory is local.</text>
</svg>
<figcaption>The third panel is not a third structure; it is how the first two become affordable.</figcaption>
</figure>

## Verification

- **The archive opens and declares the expected zoom range.** Read its metadata before anybody points a client at it.
- **A dense tile is non-trivial in size.** Fetch a city-centre tile at the maximum zoom; a few kilobytes means the profile matched almost nothing.
- **Every expected layer appears.** Decode a sample tile and compare the layer set against the profile.
- **Phase timings look sane.** No phase should be over about three-quarters of the total on a well-provisioned machine.
- **The temporary directory is empty afterwards.** Left-over files mean the run did not finish cleanly, whatever the exit status said.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Build fails hours in, out of disk | Temporary store under-provisioned | Check for several times the extract size before starting |
| Build far slower than expected | Temporary directory on a network volume | Point it at local disk |
| Read phase dominates | Profile doing per-element lookups | Precompute into an immutable structure before the run |
| Render phase dominates | Maximum zoom set too deep | Lower it and rely on client overzoom |
| Out of memory with a large heap | Heap taking memory the page cache needs | Reduce the heap; storage is mostly off-heap |
| Tiles nearly empty | Profile matches almost nothing | Log per-layer match counts during a short run |
| Archive missing layers | Profile branch never reached | Assert each layer produced features before shipping |

## Specification reference

> Planetiler builds a vector tile archive from an OSM extract in a single process, storing node locations in a configurable map — on the Java heap, in off-heap memory, or in a memory-mapped array indexed by node identifier — and writing intermediate features to a temporary directory that is sorted and read back during rendering. See the [Planetiler documentation](https://github.com/onthegomap/planetiler) for the storage options, their memory implications, and the per-phase progress output.

## Frequently Asked Questions

<details>
<summary>Why does a small country extract need so much address space?</summary>

Because the array node map is indexed by node identifier, and identifiers are assigned globally across the whole planet rather than per region. A recently created node in a small country can carry an identifier in the billions, so the array must be large enough to index it. Memory mapping is what makes this practical: the reservation is address space rather than resident memory, and the operating system pages in only the parts actually touched.
</details>

<details>
<summary>Should I give the process a very large heap?</summary>

No. Planetiler deliberately keeps its heavy storage off-heap and memory-mapped, so a large heap mostly takes memory away from the page cache that the node map and feature store rely on. A modest heap with plenty of free system memory for caching usually outperforms a configuration that hands most of the machine to the runtime.
</details>

<details>
<summary>How do I tell whether my profile is the bottleneck?</summary>

Read the phase timings. Profile cost lands entirely in the read phase, so a read phase taking well over half the total run is a strong signal that the per-element path is doing more than it should. The usual culprits are compiling patterns, allocating collections, or consulting a large lookup structure inside the callback — all of which are multiplied by the element count.
</details>

<details>
<summary>Can I run it against the full planet on one machine?</summary>

Yes, and that is what it is designed for, though it wants a substantial machine: a lot of memory, many cores and fast local storage for the temporary feature store. The build is vertical rather than distributed, which in practice is simpler and cheaper than a cluster for something that runs in hours. Size the temporary directory generously; it is the constraint that fails builds latest and most expensively.
</details>

## Related

- [Planetiler & Tilemaker Workflows](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/planetiler-and-tilemaker-workflows/) — the parent topic and the comparison behind this choice.
- [Writing a Tilemaker Lua Profile for OSM Tags](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/planetiler-and-tilemaker-workflows/writing-a-tilemaker-lua-profile-for-osm-tags/) — the sibling tool with a scripted profile.
- [Serving PMTiles from Object Storage](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/serving-and-invalidating-osm-tiles/serving-pmtiles-from-object-storage/) — publishing the archive this run produces.
- [Sizing PBF Chunk Batches to a Memory Budget](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/sizing-pbf-chunk-batches-to-a-memory-budget/) — the same storage arithmetic in a parsing pipeline.
- [Profiling Peak Memory of an OSM Parser](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/profiling-peak-memory-of-an-osm-parser/) — measuring rather than estimating the node store.

Up one level: [Planetiler & Tilemaker Workflows](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/planetiler-and-tilemaker-workflows/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Running Planetiler on a Regional Extract",
  "description": "Size memory, node storage and the temporary feature store for a Planetiler build, run it against a regional extract, and read its progress output well enough to know what to fix.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Vector Tiles & Rendering Pipelines",
  "about": ["Planetiler", "node location storage", "build phase diagnostics"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Vector Tiles & Rendering Pipelines", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/" },
    { "@type": "ListItem", "position": 3, "name": "Planetiler & Tilemaker Workflows", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/planetiler-and-tilemaker-workflows/" },
    { "@type": "ListItem", "position": 4, "name": "Running Planetiler on a Regional Extract", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/planetiler-and-tilemaker-workflows/running-planetiler-on-a-regional-extract/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Run Planetiler against a regional OSM extract",
  "description": "Verify free disk before launching, keep the temporary store on local disk, choose a memory-mapped array node map, cap the maximum zoom, and diagnose the run from its per-phase timings.",
  "step": [
    { "@type": "HowToStep", "name": "Check disk before launching", "text": "Refuse to start unless free space is several times the extract size, since the build fails late and expensively otherwise." },
    { "@type": "HowToStep", "name": "Keep the temporary store local", "text": "Point the temporary directory at fast local disk, because the feature store is written and read at high throughput." },
    { "@type": "HowToStep", "name": "Select a memory-mapped array node map", "text": "Use the array indexed by node identifier with memory mapping so the reservation is address space rather than resident memory." },
    { "@type": "HowToStep", "name": "Keep the heap modest", "text": "Leave most system memory to the page cache, since the heavy storage is off-heap." },
    { "@type": "HowToStep", "name": "Cap the maximum zoom", "text": "Set the deepest zoom deliberately, as the render phase scales with tile count." },
    { "@type": "HowToStep", "name": "Diagnose from phase shares", "text": "Parse the per-phase timings and change the resource the dominant phase is limited by." }
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
      "name": "Why does a small OSM extract need so much address space for node storage?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because the array node map is indexed by node identifier, and identifiers are assigned globally across the whole planet rather than per region. A recently created node in a small country can carry an identifier in the billions. Memory mapping makes this practical: the reservation is address space rather than resident memory, and the operating system pages in only what is touched." }
    },
    {
      "@type": "Question",
      "name": "Should I give Planetiler a very large heap?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. It deliberately keeps its heavy storage off-heap and memory-mapped, so a large heap mostly takes memory away from the page cache that the node map and feature store rely on. A modest heap with plenty of free system memory for caching usually outperforms a configuration that hands most of the machine to the runtime." }
    },
    {
      "@type": "Question",
      "name": "How do I tell whether my tile profile is the bottleneck?",
      "acceptedAnswer": { "@type": "Answer", "text": "Read the phase timings. Profile cost lands entirely in the read phase, so a read phase taking well over half the total run is a strong signal that the per-element path is doing more than it should. The usual culprits are compiling patterns, allocating collections, or consulting a large lookup inside the callback." }
    },
    {
      "@type": "Question",
      "name": "Can Planetiler run against the full planet on one machine?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes, and that is what it is designed for, though it wants a substantial machine: a lot of memory, many cores and fast local storage for the temporary feature store. The build is vertical rather than distributed, which in practice is simpler and cheaper than a cluster for something that runs in hours." }
    }
  ]
}
</script>
