---
title: "Splitting a Planet File into Regional Extracts"
description: "Cut many regions from one OSM parent file in a single pass with an osmium extract config — bbox, poly and GeoJSON entries, disk and memory budgeting, and verifying every output rather than the last."
pageTitle: "Split a Planet File into Many OSM Regional Extracts"
pageDescription: "Use an osmium extract JSON config to produce many regional .osm.pbf files from one read of the parent, with per-output verification and a disk budget that holds."
slug: splitting-a-planet-file-into-regional-extracts
type: article
breadcrumb: "Splitting into Regional Extracts"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Splitting a Planet File into Regional Extracts

Produce a dozen regional `.osm.pbf` files from one parent extract in a single pass, instead of reading the parent once per region and turning a twenty-minute job into a four-hour one.

## Prerequisites

- [ ] `osmium-tool` 1.14 or later
- [ ] A parent file — a planet or continent `.osm.pbf`
- [ ] One boundary per region, as `.poly`, GeoJSON, or a bounding box
- [ ] Free disk for the sum of all outputs plus 10 percent
- [ ] Memory headroom: roughly 1 GB per concurrently-cut region with `smart`

## Conceptual minimum

`osmium extract` accepts a `--config` file listing many outputs. It reads the parent once and writes every output as it goes, which is the entire point: the extraction arithmetic is cheap and reading tens of gigabytes off disk is not.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 240" role="img" aria-labelledby="split-io-t split-io-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="split-io-t">Bytes read and wall-clock for three ways of cutting twelve regions</title>
  <desc id="split-io-d">A bar chart. Twelve separate osmium extract runs read 341 gigabytes and take four hours twelve minutes. Three batched runs of four regions each read 85 gigabytes and take one hour four minutes. One configured run reads 28.4 gigabytes and takes twenty-two minutes.</desc>
  <rect x="0" y="0" width="880" height="240" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Reads scale with runs, not with outputs</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">cutting 12 regions from a 28.4 GB parent</text>
  <line x1="250" y1="68" x2="250" y2="186" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">12 separate runs</text>
  <rect x="250" y="74" width="470" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="730" y="89" font-size="11" fill="currentColor" opacity="0.9">341 GB read · 4 h 12 m</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">3 batched runs of 4</text>
  <rect x="250" y="116" width="117" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="377" y="131" font-size="11" fill="currentColor" opacity="0.9">85 GB read · 1 h 04 m</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">1 configured run</text>
  <rect x="250" y="158" width="39" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="299" y="173" font-size="11" fill="currentColor" opacity="0.9">28.4 GB read · 22 m</text>
  <text x="440" y="222" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">The extraction work is identical in all three. The only thing that changes is how many times the parent is read off disk.</text>
</svg>
<figcaption>One pass, many outputs. The configured run does the same extraction work and reads the parent once instead of twelve times.</figcaption>
</figure>

The saving is linear in the number of regions, and it is the difference between a job that fits in a nightly window and one that does not. It also removes a subtler cost — twelve runs against a network-mounted parent transfer the file twelve times.

## The config format

```json
{
  "directory": "/data/extracts",
  "extracts": [
    {
      "output": "ireland.osm.pbf",
      "description": "Republic of Ireland",
      "polygon": { "file_name": "/data/boundaries/ireland.poly", "file_type": "poly" }
    },
    {
      "output": "scotland.osm.pbf",
      "polygon": { "file_name": "/data/boundaries/scotland.geojson", "file_type": "geojson" }
    },
    {
      "output": "greater-london.osm.pbf",
      "bbox": [-0.51, 51.28, 0.33, 51.69]
    }
  ]
}
```

`directory` is the shared output directory; each `output` is a filename within it. Region geometry comes from one of three keys, and the choice is the same one discussed in the parent topic, [Extract Clipping & Boundary Polygons](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/).

<figure class="diagram-wrap">
<svg viewBox="0 0 880 251" role="img" aria-labelledby="split-config-t split-config-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="split-config-t">Three region descriptions available in an osmium extract config</title>
  <desc id="split-config-d">Three panels. A bbox entry takes west, south, east and north, is the cheapest per-node test, suits tiles and test cuts, is wrong for border-shaped regions and needs no separate file. A poly entry names a file with type poly, the OSM-native boundary format, suited to countries and regions, and should be version-controlled. A geojson entry names a file with type geojson, comes straight out of GIS tools, suits generated boundaries, and must be a single Feature rather than a collection.</desc>
  <rect x="0" y="0" width="880" height="251" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three ways to describe a region in the config, and when each fits</text>
  <rect x="26" y="52" width="258" height="157" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">bbox</text>
  <text x="40" y="104" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">"bbox": [w, s, e, n]</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Cheapest test per node</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Right for tiles and test cuts</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Wrong for anything border-shaped</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">No file to keep in sync</text>
  <rect x="310" y="52" width="258" height="157" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="439" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">poly</text>
  <text x="324" y="104" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">"polygon": {"file_name": …,</text>
  <text x="324" y="125" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">             "file_type": "poly"}</text>
  <text x="324" y="146" font-size="10.5" fill="currentColor" opacity="0.92">The OSM-native boundary format</text>
  <text x="324" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Right for countries and regions</text>
  <text x="324" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Keep the .poly under version control</text>
  <rect x="594" y="52" width="258" height="157" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="723" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">geojson</text>
  <text x="608" y="104" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">"polygon": {"file_name": …,</text>
  <text x="608" y="125" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">             "file_type": "geojson"}</text>
  <text x="608" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Comes straight out of GIS tools</text>
  <text x="608" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Right when boundaries are generated</text>
  <text x="608" y="188" font-size="10.5" fill="currentColor" opacity="0.92">One Feature, not a collection</text>
  <text x="440" y="235" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.85">A FeatureCollection with several features is read as several regions, not as one multi-part boundary — a distinction that silently changes what you get.</text>
</svg>
<figcaption>The FeatureCollection caveat is the one that bites: several features are read as several regions, which quietly changes the shape of the output.</figcaption>
</figure>

Two config details matter more than they look. The strategy is set once on the command line and applies to every extract in the run, so a batch that mixes regions needing `smart` with regions where `complete_ways` would do must either use `smart` throughout or be split into two runs. And `description` is not decoration: it is written into the output file's header, which is the only place the reason for a cut survives.

## Runnable solution

```python
#!/usr/bin/env python3
"""Cut many regions from one parent in a single osmium pass, then verify each output."""
from __future__ import annotations

import json
import logging
import shutil
import subprocess
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# Rough output size as a fraction of the parent, used only for the disk pre-flight.
SIZE_FRACTION = 0.05


def preflight(config: dict, parent: Path) -> None:
    """Refuse to start a run that cannot finish for want of disk."""
    out_dir = Path(config["directory"])
    out_dir.mkdir(parents=True, exist_ok=True)
    n = len(config["extracts"])
    need = int(parent.stat().st_size * SIZE_FRACTION * n * 1.1)
    free = shutil.disk_usage(out_dir).free
    logger.info("pre-flight: %d region(s), ~%.1f GB needed, %.1f GB free",
                n, need / 1e9, free / 1e9)
    if free < need:
        raise RuntimeError(f"insufficient disk: need ~{need/1e9:.1f} GB, have {free/1e9:.1f} GB")
    for e in config["extracts"]:
        poly = e.get("polygon", {}).get("file_name")
        if poly and not Path(poly).exists():
            raise FileNotFoundError(f"boundary missing for {e['output']}: {poly}")


def split(config_path: Path, parent: Path, strategy: str = "smart") -> None:
    subprocess.run(
        ["osmium", "extract", "--config", str(config_path),
         "--strategy", strategy, "--overwrite", str(parent)],
        check=True,
    )


def verify_all(config: dict) -> None:
    """Every output, not just the last one — a batch run hides a single bad boundary."""
    out_dir = Path(config["directory"])
    failures: list[str] = []
    for entry in config["extracts"]:
        path = out_dir / entry["output"]
        if not path.exists():
            failures.append(f"{entry['output']}: not written")
            continue
        info = json.loads(subprocess.run(
            ["osmium", "fileinfo", "--extended", "--json", str(path)],
            capture_output=True, text=True, check=True,
        ).stdout)
        nodes = info["data"]["count"]["nodes"]
        if nodes == 0:
            failures.append(f"{entry['output']}: zero nodes — check the boundary")
        else:
            logger.info("%-28s %12d nodes  %8.1f MB",
                        entry["output"], nodes, path.stat().st_size / 1e6)
    if failures:
        raise RuntimeError("verification failed:\n  " + "\n  ".join(failures))


if __name__ == "__main__":
    cfg_path = Path("extracts.json")
    cfg = json.loads(cfg_path.read_text())
    parent_file = Path("planet-latest.osm.pbf")
    preflight(cfg, parent_file)
    split(cfg_path, parent_file)
    verify_all(cfg)
```

## Step-by-step walkthrough

`preflight` does two things that turn a class of overnight failures into an immediate one. It estimates total output size and compares it against free disk, and it checks that every boundary file named in the config exists. Both failures otherwise appear hours into the run, after most of the work is done, and `osmium` will have written partial outputs by then.

`split` is one subprocess call. `--strategy` on the command line applies to every entry; `--overwrite` is needed for a repeatable job, since `osmium` will not clobber an existing output.

`verify_all` is the part most implementations omit. A batch run exits zero as a whole, so a region whose boundary was written in the wrong axis order produces an empty file that nothing complains about. Iterating every declared output and asserting a non-zero node count catches it before the next stage consumes it.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 278" role="img" aria-labelledby="split-fail-t split-fail-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="split-fail-t">Four failure modes of a batched extract run</title>
  <desc id="split-fail-d">A grid of four failures. Disk filling mid-run leaves partial outputs with no error on the remainder, fixed by pre-flighting the total size and writing to a scratch volume. One wrong boundary produces a single empty file among good ones, fixed by verifying every output rather than the last. Duplicate output names cause files to overwrite each other, fixed by ensuring unique names since the directory is shared. An out-of-memory kill after hours is fixed by fewer regions per run, because the smart strategy holds an identifier set per region.</desc>
  <rect x="0" y="0" width="880" height="278" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Where a multi-extract run actually fails</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">symptom</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">fix</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">disk fills mid-run</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">partial outputs, no error on the rest</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">pre-flight the total, write to a scratch volume</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">one boundary is wrong</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">one empty file among eleven good ones</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">verify every output, not the last one</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">outputs overwrite each other</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">fewer files than regions</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">unique output names; directory is shared</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">run killed by the OOM killer</text>
  <rect x="213" y="204" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">no output at all after hours</text>
  <rect x="535" y="204" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="224" text-anchor="middle" font-size="9.5" fill="currentColor">fewer regions per run; smart holds an id set per region</text>
  <text x="440" y="260" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">The second row is the one to design for: a batch run reports success as a whole, so a single bad boundary hides among good outputs.</text>
</svg>
<figcaption>A batch run succeeds or fails as a whole, which is precisely why per-output verification has to be explicit.</figcaption>
</figure>

## Verification

Expect one log line per region with a plausible node count and file size. Two patterns in that output indicate a problem: a region whose node count is orders of magnitude away from its neighbours of similar area, and a file size close to zero. Both mean a bad boundary rather than a sparse region.

```bash
ls -la /data/extracts/*.osm.pbf | awk '{print $5, $9}' | sort -n | head -3
```

If the smallest outputs are a few hundred bytes, those boundaries are wrong. A genuinely small region still produces a file in the megabytes.

## Common errors and fixes

| Symptom | Root cause | Fix |
|---|---|---|
| Some outputs missing, no error | Disk filled part-way through | Pre-flight the total; write to a dedicated volume |
| One empty file among many good ones | That boundary has swapped axes | Verify every output; fix the boundary |
| `Config file error` at startup | Trailing comma or a `file_type` typo | Validate the JSON before invoking `osmium` |
| Fewer files than regions | Two entries share an `output` name | Make output names unique |
| Killed after hours with no output | `smart` holds an id set per region | Split into several runs of fewer regions |
| Every output is tiny | Parent does not cover the boundaries | Check the parent's own bbox first |

## Specification reference

> `osmium extract --config FILE` reads a JSON document with an optional `directory` and a list of `extracts`. Each entry needs an `output` and exactly one of `bbox`, `polygon` or `multipolygon`. The input is read once and all extracts are written concurrently; `--strategy` applies to the whole run.

## Budgeting a split

Two resources bound a multi-region run, and they bind in opposite directions, which is why a run that fits on one machine fails on another with more disk.

Disk is the easy one. Regional extracts add up to well under the parent — a planet file split into every country produces roughly 55 to 65 percent of the planet's own size, because the strategies duplicate only the objects near boundaries. Estimating five percent of the parent per country-sized region, as the pre-flight above does, is deliberately generous and errs toward refusing a run that would in fact have fitted. That is the right direction to err: a refusal costs a minute, and a disk that fills two hours in costs the run.

Memory is the harder one because it does not scale with output size. Under the `smart` strategy each region under construction holds a set of the object identifiers it has decided to keep, and that set is sized by the number of objects near that region's boundary. A compact region with a short boundary is cheap; a long coastal country, or an administrative area with many enclaves, is not. Twenty regions cut concurrently from a continent will sit comfortably in tens of gigabytes; the same twenty cut from the planet will not, because every identifier set is drawn from a hundred times as many candidate objects.

The practical consequence is a two-stage split for anything planet-scale. Cut the planet into continents once, in a run of six or seven regions, then cut countries from their continent in separate runs. The parent is read eight times rather than once, but each read is of a much smaller file and no run holds more than a handful of identifier sets. On the measurements above that shape runs in about ninety minutes for a full country-level split of the planet, against a single-stage run that does not complete at all on a 64 GB machine.

One further economy is worth knowing. If the same regions are cut every week, keeping the continent-level intermediates means the weekly job never touches the planet file: only the continents that actually changed need re-cutting from a fresh planet, and everything downstream of an unchanged continent can be skipped entirely. That turns a full split into an incremental one without any additional tooling.

## Frequently Asked Questions

<details>
<summary>How many regions can go in one run?</summary>

Disk and memory decide it, not the tool. Every region being cut concurrently holds its own identifier set under `smart`, so budget roughly a gigabyte per region on a continent-sized parent and rather more on a planet. Twelve to twenty regions in a run is comfortable on a machine with 64 GB; beyond that, splitting into several runs still reads the parent far fewer times than cutting each region separately.
</details>

<details>
<summary>Can I cut overlapping regions in the same run?</summary>

Yes. The regions are independent — an object inside two boundaries is written to both outputs — so overlapping extracts such as a country and one of its cities cost no more than disjoint ones. This is often the cheapest way to produce a nested set of extracts, because the alternative is cutting the city out of the country afterwards, which reads the country file again.
</details>

<details>
<summary>Should I cut the regions I need from the planet, or from continents first?</summary>

From continents, if you need more than a handful of regions per continent. A two-stage split — planet to continents once, then continents to countries — reads the planet once and each continent once, whereas cutting fifty countries directly from the planet in one configured run also reads the planet once but holds fifty identifier sets in memory at the same time. The two-stage version trades a little extra disk for a much lower memory ceiling.
</details>

<details>
<summary>Does a batched run write outputs incrementally or at the end?</summary>

Incrementally, as the parent is read. That is why a run interrupted by a full disk leaves several complete-looking files behind: they are not truncated, they are simply missing everything that came after the failure point. Nothing in the file marks it as partial, which is exactly why the verification step compares node counts rather than trusting the exit code.
</details>

## Related

- [Extract Clipping & Boundary Polygons](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/) — the topic this procedure belongs to.
- [Clipping an OSM Extract with a .poly Boundary](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/clipping-an-osm-extract-with-a-poly-boundary/) — the single-region case, with the boundary writer.
- [Choosing complete_ways vs smart in osmium extract](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/choosing-complete-ways-vs-smart-in-osmium-extract/) — the strategy that applies to the whole run.
- [Extracting Metadata from OSM Planet Files](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/extracting-metadata-from-osm-planet-files/) — checking the parent's coverage before cutting.
- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — how a partial batch should be reported.

Up one level: [Extract Clipping & Boundary Polygons](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/).
