---
title: "Chaining osmium-tool Commands in a Shell Pipeline"
description: "Compose osmium filters without writing a gigabyte to disk between each one, order the passes so the cheapest reduction runs first, and keep the pipeline restartable."
pageTitle: "Composing osmium-tool Filters Efficiently"
pageDescription: "Chain osmium commands through pipes rather than temporary files, order passes cheapest-first, choose when a materialised intermediate is worth it, and make the pipeline restartable."
slug: chaining-osmium-tool-commands-in-a-shell-pipeline
type: article
breadcrumb: "Chaining osmium"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Chaining osmium-tool Commands in a Shell Pipeline

Three osmium commands in sequence is the most common OSM pipeline there is, and the naive form writes two intermediate gigabyte files that nothing ever reads twice. Most of the time it does not need to.

## Prerequisites

- [ ] `osmium-tool` installed, with a shell that supports process substitution.
- [ ] A regional PBF and a filtering goal.
- [ ] The parser comparison in [Choosing an OSM Parser: pyosmium, pyrosm or osmium-tool](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/).
- [ ] Enough disk for whichever intermediates you decide to keep.
- [ ] A habit of measuring, because the right composition depends on the data.

## Conceptual minimum

Osmium commands read a file and write a file, and most of them can read from standard input and write to standard output when told the format explicitly. That makes piping possible, and piping avoids the intermediate write entirely.

Three rules govern the composition.

**Cheapest reduction first.** Each pass costs roughly its input size, so a pass that removes ninety percent of the data should run before one that removes ten. Spatial cuts are usually the cheapest large reduction, tag filters next, and anything reference-completing last.

**Not every command streams.** Commands that need random access — sorting, reference completion over a whole file, some export modes — must materialise. Piping into one of those gains nothing and can cost, because it may buffer the entire input anyway.

**The format must be declared on a pipe.** A file name carries its format; standard input does not. Omitting the format flag produces an immediate and clear failure, which is the one mistake here that announces itself.

The trade against piping is **restartability**. A pipeline of four piped commands that fails at the third restarts from the beginning; one with a materialised intermediate after the expensive first pass restarts from there. On a pipeline that takes an hour, that matters more than the disk it costs.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="cot1-t cot1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cot1-t">When to pipe and when to materialise between osmium passes</title>
  <desc id="cot1-d">A grid of four situations against whether to pipe or to write an intermediate file. A cheap pass feeding another cheap pass should be piped, since the intermediate would cost more than it saves. An expensive pass whose output several later passes consume should be materialised, so the expensive work happens once. A pass that needs random access cannot be piped into and must read a file. A long pipeline where a late failure is likely benefits from one materialised checkpoint after the most expensive stage.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four situations, two answers</text>
  <rect x="226" y="48" width="314" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="383" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Do this</text>
  <rect x="540" y="48" width="314" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="697" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Because</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Cheap then cheap</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="383" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">pipe</text>
  <text x="697" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">the file costs more</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Expensive, reused</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="383" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">materialise</text>
  <text x="697" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">do it once</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Needs random access</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="383" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">materialise</text>
  <text x="697" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">cannot stream</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Long, failure-prone</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="383" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">one checkpoint</text>
  <text x="697" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">restart from there</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The last row is the one experience teaches: a pipeline that must restart from zero after fifty minutes is worse than one intermediate file.</text>
</svg>
<figcaption>Piping is the default and materialising is the deliberate exception, rather than the other way round.</figcaption>
</figure>

## Runnable solution

```bash
#!/usr/bin/env bash
# Compose osmium passes without writing every intermediate to disk.
set -euo pipefail

EXTRACT="${1:?usage: pipeline.sh <extract.osm.pbf>}"
POLY="${2:?usage: pipeline.sh <extract.osm.pbf> <boundary.poly>}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- The naive form, for comparison: two intermediate files nobody reads twice.
naive () {
  osmium extract --polygon "$POLY" -o "$WORK/a.osm.pbf" "$EXTRACT"
  osmium tags-filter -o "$WORK/b.osm.pbf" "$WORK/a.osm.pbf" \
    w/highway r/route=road
  osmium export -o roads.geojsonseq --output-format=geojsonseq \
    "$WORK/b.osm.pbf"
}

# --- Piped: nothing between the passes touches disk.
#     -F declares the INPUT format; -f declares the OUTPUT format. On a pipe
#     neither can be inferred from a file name, so both must be explicit.
piped () {
  osmium extract --polygon "$POLY" -f pbf -o - "$EXTRACT" \
  | osmium tags-filter -F pbf -f pbf -o - - w/highway r/route=road \
  | osmium export -F pbf --output-format=geojsonseq -o roads.geojsonseq -
}

# --- Checkpointed: one intermediate after the expensive spatial cut, because a
#     failure later should not repeat an hour of work.
checkpointed () {
  local cut="$WORK/cut.osm.pbf"
  if [ ! -s "$cut" ]; then
    osmium extract --polygon "$POLY" -o "$cut" "$EXTRACT"
  fi
  osmium tags-filter -f pbf -o - "$cut" w/highway r/route=road \
  | osmium export -F pbf --output-format=geojsonseq -o roads.geojsonseq -
}

# Choose by input size: below a few hundred megabytes the checkpoint is not
# worth the disk, above it a restart from zero is not worth the time.
SIZE_MB=$(( $(stat -c%s "$EXTRACT") / 1024 / 1024 ))
if [ "$SIZE_MB" -gt 300 ]; then
  echo "input is ${SIZE_MB} MB: checkpointing after the spatial cut" >&2
  checkpointed
else
  echo "input is ${SIZE_MB} MB: fully piped" >&2
  piped
fi

wc -l < roads.geojsonseq
```

```bash
#!/usr/bin/env bash
# Measure whether the ordering you chose is the right one.
set -euo pipefail
EXTRACT="$1"; POLY="$2"

time_pass () { local label="$1"; shift; local start=$SECONDS
  "$@" >/dev/null 2>&1; echo "${label}: $(( SECONDS - start ))s" >&2; }

# Spatial first, then tags — the usual right order.
time_pass "spatial-then-tags" bash -c "
  osmium extract --polygon '$POLY' -f pbf -o - '$EXTRACT' \
  | osmium tags-filter -F pbf -f pbf -o /dev/null - w/highway"

# Tags first, then spatial — reads and rewrites the whole region first.
time_pass "tags-then-spatial" bash -c "
  osmium tags-filter -f pbf -o - '$EXTRACT' w/highway \
  | osmium extract --polygon '$POLY' -F pbf -f pbf -o /dev/null -"
```

## Step-by-step walkthrough

1. **Declare both formats on a pipe.** The input format flag and the output format flag are both needed, because neither end of a pipe carries a file name to infer from.
2. **Use a bare dash for both ends.** Osmium reads standard input and writes standard output when given a dash, which is what makes the composition possible at all.
3. **Put the spatial cut first.** It is usually the largest reduction and the cheapest to compute, so every later pass reads a far smaller stream.
4. **Materialise after the expensive pass, not before.** The point of a checkpoint is to avoid repeating the costly work, so it belongs immediately after it.
5. **Make the checkpoint conditional.** Testing for a non-empty existing file makes the script restartable without any further bookkeeping.
6. **Choose the shape from the input size.** Below a few hundred megabytes the checkpoint costs more in disk and complexity than it saves; above it, a restart from zero is the expensive outcome.
7. **Measure both orderings once.** The rule that spatial comes first is reliable and not universal — a tag filter that removes ninety-nine percent of a file can legitimately come first — and a single timed comparison settles it for your data.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 248" role="img" aria-labelledby="cot2-t cot2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cot2-t">Bytes written to disk by three compositions of the same three passes</title>
  <desc id="cot2-d">Four measurements over the same country extract. The naive form writes two full intermediate files plus the output, totalling several times the final result. The piped form writes only the output, since nothing between the passes touches disk. The checkpointed form writes one intermediate after the spatial cut plus the output. A note observes that the piped form is fastest and the checkpointed form is the one that survives a failure at the last pass.</desc>
  <rect x="0" y="0" width="880" height="248" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Disk written by three compositions</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">Naive: two intermediates</text>
  <rect x="256" y="60" width="478" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">baseline</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">Piped: output only</text>
  <rect x="256" y="100" width="53" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 11%</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">Checkpointed: one file</text>
  <rect x="256" y="140" width="182" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 38%</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">The final output alone</text>
  <rect x="256" y="180" width="53" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">what you wanted</text>
  <text x="868" y="232" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The checkpointed form buys restartability with disk, which on a pipeline measured in hours is usually the right purchase.</text>
</svg>
<figcaption>The naive form's extra writes are pure cost: neither intermediate is ever read more than once.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 239" role="img" aria-labelledby="cot3-t cot3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cot3-t">Three compositions of the same three passes, and what each optimises for</title>
  <desc id="cot3-d">Three panels. The naive form runs each pass against a file and writes two intermediates nobody reads twice, which optimises for nothing but is what people write first. The fully piped form passes data between commands in memory and writes only the final output, which optimises for speed and disk and restarts from zero on any failure. The checkpointed form materialises one intermediate immediately after the expensive stage, which costs disk and makes a late failure cheap to recover from.</desc>
  <rect x="0" y="0" width="880" height="239" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three compositions, three different optimisations</text>
  <rect x="26" y="52" width="259" height="153" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Naive</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">A file between each pass</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Two intermediates written</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Neither read twice</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Optimises for nothing</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">What people write first</text>
  <rect x="311" y="52" width="259" height="153" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Fully piped</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Nothing touches disk</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Only the output written</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Fastest and smallest</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Restarts from zero</text>
  <text x="325" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Right for small inputs</text>
  <rect x="595" y="52" width="259" height="153" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Checkpointed</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">One file after the costly pass</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Disk for restartability</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Late failure is cheap</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Skips work on re-run</text>
  <text x="609" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Right for large inputs</text>
  <text x="868" y="223" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The choice between the second and third is about input size and failure probability rather than about elegance.</text>
</svg>
<figcaption>Nobody should be writing the first form, and almost everybody does until they measure the disk it costs.</figcaption>
</figure>

## Verification

- **Piped and naive agree.** Both forms must produce byte-identical output; a difference means a format flag is wrong.
- **The pipeline restarts.** Delete the output, leave the checkpoint, and re-run; it should skip the expensive pass.
- **Ordering is measured, not assumed.** Time both orderings once on real data and keep the faster.
- **No intermediate survives.** After a successful run the temporary directory should be empty except for any deliberate checkpoint.
- **Failure propagates.** Break a middle command and confirm the script fails rather than producing truncated output.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Osmium refuses to read a pipe | Input format not declared | Pass the input format flag explicitly |
| Osmium refuses to write a pipe | Output format not declared | Pass the output format flag explicitly |
| Pipeline slower than the naive form | Tag filter placed before the spatial cut | Put the largest cheap reduction first |
| Failure produces truncated output | Pipeline errors not propagated | Enable pipefail and errexit in the shell |
| Restart repeats an hour of work | No checkpoint after the expensive pass | Materialise once, immediately after it |
| Disk fills during the run | Every pass materialised | Pipe the cheap passes together |
| A command buffers the whole input | That command needs random access | Materialise before it rather than piping into it |

## Specification reference

> Most osmium-tool commands accept a dash as an input or output file name to read standard input or write standard output, and require the format to be specified explicitly when doing so, since it cannot be inferred from a file name. Some commands require random access to their input and cannot read from a stream. See the [osmium-tool manual](https://osmcode.org/osmium-tool/manual.html) for which commands stream and the format flags each accepts.

## Frequently Asked Questions

<details>
<summary>Why must the format be declared on a pipe?</summary>

Because osmium infers the format from the file name's extension, and a pipe has no name. Reading standard input without a declared format fails immediately with a clear message, which makes this the one mistake in this area that costs nothing to discover. Both ends need it independently: the input format for what is arriving and the output format for what is leaving.
</details>

<details>
<summary>Should the spatial cut always come first?</summary>

Almost always, because it is usually both the largest reduction and the cheapest to compute, so every later pass reads a much smaller stream. The exception is a tag filter so selective that it removes nearly everything — filtering a planet file to a rare key, for instance — where doing that first can win. One timed comparison settles it for your data, and the answer rarely changes afterwards.
</details>

<details>
<summary>When is an intermediate file worth writing?</summary>

When the pass before it is expensive and the passes after it might fail. A pipeline that takes an hour and restarts from zero after a failure in the last command has wasted that hour; one with a checkpoint after the expensive stage restarts in minutes. Below a few hundred megabytes of input the calculation reverses, because the expensive stage is not expensive enough to be worth protecting.
</details>

<details>
<summary>Do all osmium commands stream?</summary>

No. Commands needing random access over the whole input — sorting, some reference-completing modes — must read a file, and piping into them either fails or silently buffers the entire stream, which defeats the purpose. Checking the manual for the command you are about to pipe into is quicker than discovering it from a memory spike.
</details>

## Related

- [Choosing an OSM Parser: pyosmium, pyrosm or osmium-tool](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/) — the parent topic and when the command line is the right tool.
- [Reading OSM PBF with DuckDB Spatial](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/reading-osm-pbf-with-duckdb-spatial/) — the SQL alternative for tag questions.
- [Replacing an Overpass Query with an osmium Filter](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/choosing-between-overpass-and-a-local-extract/replacing-an-overpass-query-with-an-osmium-filter/) — the queries these pipelines usually replace.
- [Clipping an OSM Extract with a .poly Boundary](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/clipping-an-osm-extract-with-a-poly-boundary/) — the spatial pass that goes first.
- [Resuming an Interrupted OSM Import](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/resuming-an-interrupted-osm-import/) — the same restartability argument downstream.

Up one level: [Choosing an OSM Parser: pyosmium, pyrosm or osmium-tool](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Chaining osmium-tool Commands in a Shell Pipeline",
  "description": "Compose osmium filters without writing a gigabyte to disk between each one, order the passes so the cheapest reduction runs first, and keep the pipeline restartable.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Parsing & Tag Normalization Workflows",
  "about": ["osmium pipelines", "streaming composition", "pass ordering"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Parsing & Tag Normalization Workflows", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/" },
    { "@type": "ListItem", "position": 3, "name": "Choosing an OSM Parser: pyosmium, pyrosm or osmium-tool", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/" },
    { "@type": "ListItem", "position": 4, "name": "Chaining osmium-tool Commands in a Shell Pipeline", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/chaining-osmium-tool-commands-in-a-shell-pipeline/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Compose osmium-tool passes into an efficient pipeline",
  "description": "Declare formats on both ends of each pipe, put the largest cheap reduction first, materialise one checkpoint after the expensive pass, make it conditional for restartability, and measure the ordering once.",
  "step": [
    { "@type": "HowToStep", "name": "Declare both formats", "text": "Pass the input and output format flags on every piped command, since a pipe carries no file name to infer from." },
    { "@type": "HowToStep", "name": "Order cheapest reduction first", "text": "Run the spatial cut before tag filtering so every later pass reads a far smaller stream." },
    { "@type": "HowToStep", "name": "Checkpoint after the expensive pass", "text": "Materialise one intermediate immediately after the costly stage so a later failure does not repeat it." },
    { "@type": "HowToStep", "name": "Make the checkpoint conditional", "text": "Skip the expensive pass when a non-empty intermediate already exists, which makes the script restartable." },
    { "@type": "HowToStep", "name": "Choose the shape from input size", "text": "Pipe fully for small inputs and checkpoint for large ones, where a restart from zero is the expensive outcome." },
    { "@type": "HowToStep", "name": "Propagate failures", "text": "Enable pipefail and errexit so a broken middle command stops the pipeline rather than truncating output." },
    { "@type": "HowToStep", "name": "Measure the ordering once", "text": "Time both pass orderings on real data and keep the faster, since the usual rule has real exceptions." }
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
      "name": "Why must the osmium format be declared on a pipe?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because osmium infers the format from the file name's extension, and a pipe has no name. Reading standard input without a declared format fails immediately with a clear message. Both ends need it independently: the input format for what is arriving and the output format for what is leaving." }
    },
    {
      "@type": "Question",
      "name": "Should an osmium spatial cut always come first?",
      "acceptedAnswer": { "@type": "Answer", "text": "Almost always, because it is usually both the largest reduction and the cheapest to compute. The exception is a tag filter so selective that it removes nearly everything, where doing that first can win. One timed comparison settles it for your data, and the answer rarely changes afterwards." }
    },
    {
      "@type": "Question",
      "name": "When is an osmium intermediate file worth writing?",
      "acceptedAnswer": { "@type": "Answer", "text": "When the pass before it is expensive and the passes after it might fail. A pipeline that takes an hour and restarts from zero after a late failure has wasted that hour; one with a checkpoint restarts in minutes. Below a few hundred megabytes the calculation reverses." }
    },
    {
      "@type": "Question",
      "name": "Do all osmium-tool commands stream?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. Commands needing random access over the whole input must read a file, and piping into them either fails or silently buffers the entire stream, defeating the purpose. Checking the manual for the command you are about to pipe into is quicker than discovering it from a memory spike." }
    }
  ]
}
</script>
