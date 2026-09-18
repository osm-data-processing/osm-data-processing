---
title: "Building a .poly File from an OSM Admin Relation"
description: "Turn an administrative boundary relation into the polygon-filter format osmium and osmosis accept, handling multiple rings, holes and the closing-coordinate requirement."
pageTitle: "Generate a .poly Boundary File from an OSM Relation"
pageDescription: "Assemble an administrative relation into rings, emit them in the .poly polygon-filter format with holes marked correctly, and verify the result clips the region you expected."
slug: building-a-poly-file-from-an-osm-admin-relation
type: article
breadcrumb: "Building a .poly File"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Building a .poly File from an OSM Admin Relation

The boundary you want to clip with is already in OpenStreetMap, as a relation. Turning it into the little text format the clipping tools accept is mostly assembly, plus three details that silently produce a file which clips the wrong area.

## Prerequisites

- [ ] Python 3.10+ with `shapely` ≥ 2.0 and a way to fetch relation geometry — `pyosmium` over an extract, or an Overpass query.
- [ ] Relation assembly from [Handling Multipolygon Members with No Role](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/handling-multipolygon-members-with-no-role/), since a boundary relation is assembled the same way.
- [ ] The clipping context from [OSM Extract Clipping & Boundaries](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/).
- [ ] `osmium` installed, to verify the result.
- [ ] A boundary with at least one enclave or island, since those are what expose the mistakes.

## Conceptual minimum

The `.poly` format is a small text file: a name line, then one or more ring sections, then `END`. Each section has a name line of its own, a sequence of coordinate pairs one per line, and an `END`. A section whose name begins with `!` is a **hole** — territory excluded from the region.

Three details decide whether the file works.

**Coordinates are longitude then latitude**, separated by whitespace, in decimal degrees. The order is the opposite of how the pair is usually spoken, and reversing it produces a file that clips an area somewhere else entirely.

**Every ring must be closed**: the last coordinate repeats the first. A ring left open is interpreted unpredictably, and some tools accept it while others produce a filter that excludes everything.

**Multiple outer rings are separate sections**, not one section with a gap. A country with offshore islands has one section per island, and merging them into a single sequence draws a boundary through the sea connecting them.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 226" role="img" aria-labelledby="bpf1-t bpf1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="bpf1-t">The structure of a .poly file with an island and an enclave</title>
  <desc id="bpf1-d">A file laid out top to bottom in four parts. The first line names the region. The second part is a section for the mainland ring, opened by a number, containing one coordinate pair per line as longitude then latitude, and closed by an END. The third part is a section named with a leading exclamation mark, which marks an enclave excluded from the region. The fourth part is a separate section for an offshore island, which must be its own ring rather than being appended to the mainland. A final END closes the file.</desc>
  <rect x="0" y="0" width="880" height="226" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">One file, one section per ring, holes marked with a bang</text>
  <rect x="26" y="56" width="147" height="54" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="99" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">name line</text>
  <text x="99" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">the region</text>
  <text x="99" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">free text</text>
  <text x="99" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">ignored by tools</text>
  <text x="99" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">useful to humans</text>
  <rect x="177" y="56" width="222" height="54" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="287" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">outer ring</text>
  <text x="287" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">section 1</text>
  <text x="287" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">lon then lat</text>
  <text x="287" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">one pair per line</text>
  <text x="287" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">closed, then END</text>
  <rect x="402" y="56" width="222" height="54" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="513" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">hole</text>
  <text x="513" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">!section</text>
  <text x="513" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">leading exclamation</text>
  <text x="513" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">an enclave</text>
  <text x="513" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">excluded territory</text>
  <rect x="628" y="56" width="222" height="54" rx="6" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="739" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">island</text>
  <text x="739" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">section 2</text>
  <text x="739" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">its own ring</text>
  <text x="739" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">never appended</text>
  <text x="739" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">or a line through the sea</text>
  <text x="868" y="210" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The leading exclamation mark is the only syntax that distinguishes a hole, and omitting it silently includes the enclave.</text>
</svg>
<figcaption>Each ring is independent: nothing in the format relates them, so containment is the tool's problem rather than the file's.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
from pathlib import Path

from shapely.geometry import MultiPolygon, Polygon
from shapely.geometry.base import BaseGeometry

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.clip.polyfile")

COORD_FORMAT = "   {lon:.7E}   {lat:.7E}\n"
MIN_RING_POINTS = 4          # three distinct points plus the repeated closer


def _rings(geom: BaseGeometry) -> list[tuple[list[tuple[float, float]], bool]]:
    """Every ring with a flag saying whether it is a hole."""
    polygons: list[Polygon]
    if isinstance(geom, MultiPolygon):
        polygons = list(geom.geoms)
    elif isinstance(geom, Polygon):
        polygons = [geom]
    else:
        raise TypeError(f"cannot build a boundary from {geom.geom_type}")

    out: list[tuple[list[tuple[float, float]], bool]] = []
    for polygon in polygons:
        out.append((list(polygon.exterior.coords), False))
        for interior in polygon.interiors:
            out.append((list(interior.coords), True))
    return out


def _closed(ring: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Ensure the ring repeats its first coordinate at the end."""
    if len(ring) < 3:
        raise ValueError(f"ring has only {len(ring)} point(s)")
    if ring[0] != ring[-1]:
        ring = ring + [ring[0]]
    if len(ring) < MIN_RING_POINTS:
        raise ValueError("ring does not enclose an area")
    return ring


def write_poly(geom: BaseGeometry, name: str, path: Path) -> Path:
    """Write a polygon-filter file. Coordinates are LONGITUDE then latitude."""
    rings = _rings(geom)
    outers = sum(1 for _, hole in rings if not hole)
    holes = len(rings) - outers
    if outers == 0:
        raise ValueError("no outer ring; nothing would be selected")

    with path.open("w", encoding="ascii") as handle:
        handle.write(f"{name}\n")
        outer_index = hole_index = 0
        for ring, is_hole in rings:
            ring = _closed(ring)
            if is_hole:
                hole_index += 1
                # The leading '!' is the ONLY thing marking an exclusion.
                handle.write(f"!{hole_index}\n")
            else:
                outer_index += 1
                handle.write(f"{outer_index}\n")
            for lon, lat in ring:
                if not (-180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0):
                    raise ValueError(f"coordinate out of range: {lon}, {lat} "
                                     f"— are longitude and latitude swapped?")
                handle.write(COORD_FORMAT.format(lon=lon, lat=lat))
            handle.write("END\n")
        handle.write("END\n")

    logger.info("wrote %s: %d outer ring(s), %d hole(s), %d point(s)",
                path.name, outers, holes,
                sum(len(r) for r, _ in rings))
    return path


def sanity_check(geom: BaseGeometry, path: Path) -> None:
    """Re-read the file and compare against the source geometry's extent."""
    lons: list[float] = []
    lats: list[float] = []
    for line in path.read_text(encoding="ascii").splitlines():
        parts = line.split()
        if len(parts) == 2:
            try:
                lon, lat = float(parts[0]), float(parts[1])
            except ValueError:
                continue
            lons.append(lon)
            lats.append(lat)

    written = (min(lons), min(lats), max(lons), max(lats))
    source = geom.bounds
    if max(abs(a - b) for a, b in zip(written, source)) > 1e-6:
        raise ValueError(f"bounds differ: file {written}, geometry {source}")
    logger.info("bounds check passed: %s", written)


if __name__ == "__main__":
    mainland = Polygon([(19.8, 50.0), (20.2, 50.0), (20.2, 50.2), (19.8, 50.2)],
                       [[(19.9, 50.05), (20.0, 50.05), (20.0, 50.1), (19.9, 50.1)]])
    island = Polygon([(20.4, 50.3), (20.5, 50.3), (20.5, 50.4), (20.4, 50.4)])
    region = MultiPolygon([mainland, island])
    out = write_poly(region, "krakow-example", Path("krakow.poly"))
    sanity_check(region, out)
```

## Step-by-step walkthrough

1. **Emit one section per ring.** Exterior rings and interior rings alike become their own sections; nothing in the format groups them, so containment is resolved by the consuming tool.
2. **Mark holes with a leading exclamation mark.** It is the only syntax that distinguishes an exclusion, and omitting it quietly includes an enclave that should have been cut out.
3. **Close every ring explicitly.** Shapely's rings already repeat the first coordinate, but geometry from other sources may not, and an unclosed ring is interpreted differently by different tools.
4. **Reject degenerate rings.** A ring with fewer than three distinct points encloses nothing, and writing it produces a filter whose behaviour nobody can predict.
5. **Validate the coordinate range.** A latitude outside ninety degrees is the unmistakable signature of swapped coordinates, and catching it here saves a confusing empty extract later.
6. **Write longitude first.** This is the detail that most often goes wrong, because the pair is spoken the other way round in almost every other context.
7. **Check the bounds after writing.** Re-reading the file and comparing its extent against the source geometry catches swapped coordinates, dropped rings and formatting errors in one assertion.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="bpf2-t bpf2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="bpf2-t">Four mistakes and what each one does to the clipped extract</title>
  <desc id="bpf2-d">A grid of four mistakes against the symptom each produces when the file is used to clip. Swapping longitude and latitude produces an extract from somewhere else entirely, usually empty, which looks like a clipping failure rather than a file error. Omitting a hole's exclamation mark includes the enclave, producing an extract slightly too large in a way nobody notices. Merging islands into one ring draws a boundary through the sea, including large areas of water and whatever is in them. Leaving a ring unclosed produces behaviour that varies by tool, often excluding everything.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four mistakes, four different wrong extracts</text>
  <rect x="216" y="48" width="319" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="376" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Symptom</text>
  <rect x="535" y="48" width="319" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="694" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">How it is noticed</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Coordinates swapped</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">extract from elsewhere</text>
  <text x="694" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">usually empty</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Hole not marked</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">enclave included</text>
  <text x="694" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">almost never</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Islands merged</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">sea included</text>
  <text x="694" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">size looks wrong</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Ring not closed</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">varies by tool</text>
  <text x="694" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">inconsistent</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Only the first mistake announces itself; the second produces a slightly larger extract that passes every plausible check.</text>
</svg>
<figcaption>A bounds comparison after writing catches the first and third; only reading the file catches the second.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="bpf3-t bpf3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="bpf3-t">From a boundary relation to a verified filter file</title>
  <desc id="bpf3-d">Four steps. The fetch step retrieves the administrative relation and its member ways, either from an extract or from a query. The assemble step stitches the members into closed rings and determines which are exterior and which are holes, using the same geometric containment rule as any multipolygon. The write step emits one section per ring with holes marked, longitude before latitude, and every ring closed. The verify step re-reads the file, compares its extent against the source geometry and runs a trial clip to confirm the extract is plausible.</desc>
  <defs><marker id="bpf3-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Fetch, assemble, write, verify</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">fetch</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">relation and members</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">extract or query</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#bpf3-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">assemble</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">rings and containment</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">same as multipolygon</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#bpf3-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">write</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">one section per ring</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">holes marked, lon first</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#bpf3-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">verify</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">bounds and a trial clip</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">catches most mistakes</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The second step is shared with ordinary multipolygon assembly, so a boundary relation needs no special handling until the file is written.</text>
</svg>
<figcaption>Only the third step is specific to this format, and it is where all four characteristic mistakes live.</figcaption>
</figure>

## Verification

- **The bounds match the source.** Comparing the written coordinates' extent against the relation's geometry catches swaps and dropped rings.
- **Hole sections are present and marked.** Count the sections beginning with an exclamation mark against the number of interior rings.
- **Islands are separate sections.** A region with three islands must produce at least three outer sections.
- **A clip produces a plausible extract.** Run `osmium extract` with the file and compare the output size against the region's expected share.
- **A known point inside is retained.** Pick a feature you know is inside the boundary and confirm it survives the clip.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Clipped extract is empty | Longitude and latitude swapped | Write longitude first and range-check both |
| Extract slightly too large | Hole section not marked | Prefix exclusion sections with an exclamation mark |
| Large sea areas included | Islands merged into one ring | Emit one section per outer ring |
| Behaviour differs between tools | A ring left unclosed | Repeat the first coordinate as the last |
| Tool rejects the file | Missing final END | Close each section and the file itself |
| Enclaves appear in the output | Interior rings not emitted at all | Iterate interiors as well as exteriors |
| Coordinates lose precision | Fixed decimal formatting | Use exponential notation with ample digits |

## Specification reference

> A polygon filter file begins with a name line, followed by one or more sections. Each section begins with an identifier line, contains coordinate pairs as longitude and latitude in decimal degrees one per line, and ends with `END`; a section identifier prefixed with `!` denotes a hole. The file ends with a further `END`. See the [polygon filter file format documentation](https://wiki.openstreetmap.org/wiki/Osmosis/Polygon_Filter_File_Format) for the grammar and the hole convention.

## Frequently Asked Questions

<details>
<summary>Why is the coordinate order longitude first?</summary>

Because the format follows the mathematical convention of x before y, and longitude is the x axis. Almost every other context — spoken directions, most user interfaces, the OSM API's own attributes — puts latitude first, which is why this is the single most common mistake in generating these files. A range check catches it immediately, because a longitude value in a latitude position is usually outside ninety degrees.
</details>

<details>
<summary>What happens if I forget to mark a hole?</summary>

The enclave is included in the region rather than excluded from it, and the resulting extract is slightly larger than intended. This is the most dangerous of the errors here because nothing about it looks wrong: the extract clips, the size is plausible, and the extra territory only matters if somebody happens to check a feature inside the enclave. Counting marked sections against the geometry's interior rings is the check.
</details>

<details>
<summary>Can islands go in the same section as the mainland?</summary>

No. Each section is one ring, and appending an island's coordinates to the mainland's draws a boundary that runs out to the island and back, enclosing the sea between them. The symptom is an extract containing large areas of water and whatever is mapped in them, which is noticeable by size but easy to attribute to the wrong cause. One outer ring, one section.
</details>

<details>
<summary>How precise do the coordinates need to be?</summary>

Precise enough that the boundary does not visibly move, which in practice means about seven decimal places or the equivalent in exponential notation. Boundaries are frequently traced from authoritative sources and their precision is meaningful; rounding to four decimal places moves the line by tens of metres, which is enough to exclude buildings that sit right on a border. The format imposes no limit, so there is no reason to economise.
</details>

## Related

- [OSM Extract Clipping & Boundaries](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/) — the parent topic and what these files are for.
- [Clipping an OSM Extract with a .poly Boundary](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/clipping-an-osm-extract-with-a-poly-boundary/) — using the file this produces.
- [Handling Multipolygon Members with No Role](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/handling-multipolygon-members-with-no-role/) — assembling the relation into rings first.
- [Writing Overpass QL Area and Bounding Box Queries](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/writing-overpass-ql-area-and-bbox-queries/) — fetching the boundary relation.
- [Splitting a Planet File into Regional Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/splitting-a-planet-file-into-regional-extracts/) — where many of these files are consumed at once.

Up one level: [OSM Extract Clipping & Boundaries](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Building a .poly File from an OSM Admin Relation",
  "description": "Turn an administrative boundary relation into the polygon-filter format osmium and osmosis accept, handling multiple rings, holes and the closing-coordinate requirement.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Data Fundamentals & Architecture",
  "about": ["polygon filter file", "boundary relations", "extract clipping"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Fundamentals & Architecture", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/" },
    { "@type": "ListItem", "position": 3, "name": "OSM Extract Clipping & Boundaries", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/" },
    { "@type": "ListItem", "position": 4, "name": "Building a .poly File from an OSM Admin Relation", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/building-a-poly-file-from-an-osm-admin-relation/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Generate a polygon filter file from an OSM boundary relation",
  "description": "Assemble the relation into rings, emit one section per ring with holes marked, close every ring, write longitude before latitude, range-check coordinates, and compare the written bounds against the source.",
  "step": [
    { "@type": "HowToStep", "name": "Assemble the relation into rings", "text": "Build exterior and interior rings from the relation's members before any file is written." },
    { "@type": "HowToStep", "name": "Emit one section per ring", "text": "Write each exterior and interior ring as its own section rather than merging them." },
    { "@type": "HowToStep", "name": "Mark holes explicitly", "text": "Prefix the identifier of each interior ring's section with an exclamation mark, the only syntax denoting exclusion." },
    { "@type": "HowToStep", "name": "Close every ring", "text": "Repeat the first coordinate as the last, and reject rings with too few distinct points to enclose an area." },
    { "@type": "HowToStep", "name": "Write longitude first", "text": "Emit the pair in x then y order and range-check both values to catch a swap immediately." },
    { "@type": "HowToStep", "name": "Compare the bounds", "text": "Re-read the written coordinates and assert their extent matches the source geometry's bounds." }
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
      "name": "Why is the .poly coordinate order longitude first?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because the format follows the mathematical convention of x before y, and longitude is the x axis. Almost every other context puts latitude first, which is why this is the most common mistake in generating these files. A range check catches it immediately, because a longitude value in a latitude position is usually outside ninety degrees." }
    },
    {
      "@type": "Question",
      "name": "What happens if I forget to mark a hole in a .poly file?",
      "acceptedAnswer": { "@type": "Answer", "text": "The enclave is included rather than excluded, and the extract is slightly larger than intended. This is the most dangerous error because nothing looks wrong: the extract clips, the size is plausible, and the extra territory only matters if somebody checks a feature inside the enclave. Counting marked sections against interior rings is the check." }
    },
    {
      "@type": "Question",
      "name": "Can islands go in the same .poly section as the mainland?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. Each section is one ring, and appending an island's coordinates to the mainland's draws a boundary running out to the island and back, enclosing the sea between them. The symptom is an extract containing large areas of water, noticeable by size but easy to attribute to the wrong cause." }
    },
    {
      "@type": "Question",
      "name": "How precise do .poly coordinates need to be?",
      "acceptedAnswer": { "@type": "Answer", "text": "Precise enough that the boundary does not visibly move, which means about seven decimal places. Boundaries are often traced from authoritative sources and their precision is meaningful; rounding to four decimal places moves the line by tens of metres, enough to exclude buildings sitting on a border." }
    }
  ]
}
</script>
