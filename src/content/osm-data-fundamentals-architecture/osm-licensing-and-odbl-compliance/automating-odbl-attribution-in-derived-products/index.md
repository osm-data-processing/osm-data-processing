---
title: "Automating ODbL Attribution in Derived Products"
description: "Generate the attribution string from the pipeline's own provenance and embed it in every output format, then fail the build when something ships without it."
pageTitle: "Automate OSM Attribution Into Every Pipeline Output"
pageDescription: "Build the ODbL credit from recorded provenance, write it into tile metadata, Parquet schema metadata, database tables and documentation, and gate the build on its presence."
slug: automating-odbl-attribution-in-derived-products
type: article
breadcrumb: "Automating Attribution"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Automating ODbL Attribution in Derived Products

Attribution fails the same way every time: it is a step in a checklist, the checklist is followed for the first three releases, and the fourth ships without it. Making it a property of the build removes the failure mode entirely.

## Prerequisites

- [ ] A provenance record for each input, per [Recording OSM Data Provenance in a Pipeline](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/recording-osm-data-provenance-in-a-pipeline/).
- [ ] Python 3.10+ with `pyarrow` for the Parquet path and `sqlite3` from the standard library for the tile archive path.
- [ ] The classification of each output from [OSM Licensing & ODbL Compliance](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/) — attribution applies to all of them, but placement differs.
- [ ] A list of every artefact the pipeline publishes, which is often longer than anyone remembers.
- [ ] A build step that can fail.

## Conceptual minimum

Attribution has two halves. The **text** is a short credit naming OpenStreetMap and its contributors, conventionally with a link where the medium allows. The **placement** is wherever a user of that artefact will encounter it, which differs per format and is the part that actually requires engineering.

The principle that makes it reliable is that **the credit travels with the data, not with the documentation**. A README is detached from the file the moment somebody copies the file elsewhere; metadata embedded in the artefact is not. Every format in common use has somewhere to put it — tile archives have a metadata table, columnar files have schema metadata, databases have tables, and documentation has headers.

The second principle is that the string is **generated rather than typed**. Deriving it from the provenance record means it names the actual source and date, and it cannot drift out of step with the data when a source changes.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 342" role="img" aria-labelledby="aoa1-t aoa1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="aoa1-t">Where attribution goes in each output format</title>
  <desc id="aoa1-d">A grid of five output formats against where the credit belongs in each and whether it survives a copy. A tile archive carries it in the metadata table and survives. A columnar data file carries it in the schema metadata and survives. A database carries it in a provenance table and survives within that database. A rendered image carries it drawn into the image or in the embedded metadata, and only the drawn form survives. Documentation carries it in a header, which does not survive the file being separated from the document.</desc>
  <rect x="0" y="0" width="880" height="342" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Five formats, five places, two that do not survive</text>
  <rect x="216" y="48" width="319" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="376" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Where it goes</text>
  <rect x="535" y="48" width="319" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="694" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Survives a copy</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Tile archive</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">metadata table</text>
  <text x="694" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">yes</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Columnar file</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">schema metadata</text>
  <text x="694" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">yes</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Database</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">provenance table</text>
  <text x="694" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">within it</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Rendered image</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">drawn, or file metadata</text>
  <text x="694" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">only if drawn</text>
  <text x="30" y="289" font-size="11.5" font-weight="600" fill="currentColor">Documentation</text>
  <line x1="26" y1="308" x2="854" y2="308" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a header</text>
  <text x="694" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">no</text>
  <text x="868" y="326" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The bottom two rows are why documentation alone is not adequate attribution for anything somebody might copy.</text>
</svg>
<figcaption>Every format above has a place for the credit; the engineering is remembering to use all of them.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import json
import logging
import sqlite3
from dataclasses import dataclass
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.licence.attribution")

CREDIT_URL = "https://www.openstreetmap.org/copyright"


class MissingAttribution(RuntimeError):
    """An artefact is about to ship without the credit it owes."""


@dataclass(frozen=True)
class Provenance:
    source_name: str        # e.g. "Geofabrik poland-latest"
    source_date: str        # ISO date the extract describes
    digest: str             # the published checksum actually consumed

    def credit(self) -> str:
        return (f"© OpenStreetMap contributors, {CREDIT_URL} — "
                f"derived from {self.source_name} ({self.source_date}), "
                f"ODbL 1.0")

    def as_metadata(self) -> dict[str, str]:
        return {
            "attribution": self.credit(),
            "licence": "ODbL-1.0",
            "source_name": self.source_name,
            "source_date": self.source_date,
            "source_digest": self.digest,
        }


def tag_mbtiles(path: Path, prov: Provenance) -> None:
    """Tile archives advertise attribution to clients through metadata."""
    conn = sqlite3.connect(path)
    try:
        for key, value in prov.as_metadata().items():
            conn.execute(
                "INSERT INTO metadata (name, value) VALUES (?, ?) "
                "ON CONFLICT(name) DO UPDATE SET value = excluded.value",
                (key, value))
        conn.commit()
    finally:
        conn.close()
    logger.info("tagged %s", path.name)


def tag_parquet(src: Path, dst: Path, prov: Provenance) -> None:
    """Rewrite with schema metadata: the credit travels inside the file."""
    table = pq.read_table(src)
    existing = table.schema.metadata or {}
    merged = dict(existing)
    merged.update({k.encode(): v.encode()
                   for k, v in prov.as_metadata().items()})
    pq.write_table(table.replace_schema_metadata(merged), dst)
    logger.info("wrote %s with schema metadata", dst.name)


def tag_database(conn: sqlite3.Connection, prov: Provenance) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS data_provenance (
            key TEXT PRIMARY KEY, value TEXT NOT NULL,
            recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
        )""")
    for key, value in prov.as_metadata().items():
        conn.execute("INSERT INTO data_provenance (key, value) VALUES (?, ?) "
                     "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                     (key, value))
    conn.commit()


# --- the gate ---------------------------------------------------------------

def check_mbtiles(path: Path) -> bool:
    conn = sqlite3.connect(path)
    try:
        row = conn.execute(
            "SELECT value FROM metadata WHERE name = 'attribution'").fetchone()
    finally:
        conn.close()
    return bool(row and "OpenStreetMap" in row[0])


def check_parquet(path: Path) -> bool:
    meta = pq.read_schema(path).metadata or {}
    value = meta.get(b"attribution", b"").decode()
    return "OpenStreetMap" in value


CHECKS = {".mbtiles": check_mbtiles, ".pmtiles": None, ".parquet": check_parquet}


def gate(artefacts: list[Path]) -> None:
    """Fail the build on anything shipping without a credit."""
    missing: list[Path] = []
    for artefact in artefacts:
        check = CHECKS.get(artefact.suffix)
        if check is None:
            # An unknown format is NOT a pass: it is a gap in this gate.
            logger.error("no attribution check for %s — add one", artefact.name)
            missing.append(artefact)
            continue
        if not check(artefact):
            missing.append(artefact)
    if missing:
        raise MissingAttribution(
            "artefacts without attribution: "
            + ", ".join(p.name for p in missing))
    logger.info("attribution present on all %d artefact(s)", len(artefacts))


if __name__ == "__main__":
    prov = Provenance("Geofabrik poland-latest", "2026-09-16", "a1b2c3d4")
    logger.info(prov.credit())
```

## Step-by-step walkthrough

1. **Derive the credit from provenance.** The string names the actual source and its date, so it cannot describe an extract the pipeline stopped using two releases ago.
2. **Write structured metadata, not just prose.** Alongside the human-readable credit, the licence identifier, source name, date and digest go in as separate keys, so a consumer can process them.
3. **Use each format's own mechanism.** A tile archive's metadata table, a columnar file's schema metadata and a database table are each the place that format's consumers look.
4. **Upsert rather than insert.** Re-running the pipeline should update the credit, not fail on a constraint or append a second one.
5. **Rewrite the columnar file.** Schema metadata cannot be modified in place, so the tagging step produces a new file — which is also a natural place to make the tagging unavoidable.
6. **Treat an unknown format as a failure.** A gate that silently passes formats it does not recognise stops being a gate the first time somebody adds an output type. Failing loudly forces the check to be extended.
7. **Raise, do not warn.** The whole point is that nothing can ship without the credit; a warning on a successful build is not read.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="aoa2-t aoa2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="aoa2-t">Where the credit is generated and where it lands</title>
  <desc id="aoa2-d">Four steps. The provenance record captured at ingestion holds the source name, its date and the checksum actually consumed. The credit step renders that record into a human-readable string and a set of structured metadata keys. The embed step writes both into each artefact using that format's own metadata mechanism rather than into a separate document. The gate step reads every artefact back and fails the build when the credit is absent or when the format has no check defined.</desc>
  <defs><marker id="aoa2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Generated once, embedded everywhere, verified at the end</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">provenance</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">captured at ingestion</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">source, date, digest</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#aoa2-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">credit</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">rendered from it</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">text plus structured keys</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#aoa2-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">embed</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">per-format metadata</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">inside the artefact</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#aoa2-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">gate</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">read it back</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">unknown format fails</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Reading the credit back rather than trusting the write is what catches a format whose metadata mechanism silently discarded it.</text>
</svg>
<figcaption>The last step is the only one that turns this from a convention into a guarantee.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="aoa3-t aoa3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="aoa3-t">Why attribution belongs in the build rather than in a checklist</title>
  <desc id="aoa3-d">Four approaches ranked by how reliably they survive. A verbal convention survives until the person who holds it is on leave. A written checklist survives until somebody ships without reading it, which is usually the third or fourth release. A build step that adds the credit survives unless somebody adds an output the step does not know about. A gate that reads every artefact back and fails on anything missing survives indefinitely, because a new output type without a check is itself a failure.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four approaches, one of which actually holds</text>
  <rect x="26" y="50" width="828" height="52" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="42" y="72" font-size="12.5" font-weight="700" fill="currentColor">A convention</text>
  <text x="42" y="90" font-size="10.5" fill="currentColor" opacity="0.88">Somebody knows to do it</text>
  <text x="838" y="82" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">fails when they are away</text>
  <rect x="26" y="112" width="828" height="52" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="42" y="134" font-size="12.5" font-weight="700" fill="currentColor">A checklist</text>
  <text x="42" y="152" font-size="10.5" fill="currentColor" opacity="0.88">Written down, followed</text>
  <text x="838" y="144" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">fails around release four</text>
  <rect x="26" y="174" width="828" height="52" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="42" y="196" font-size="12.5" font-weight="700" fill="currentColor">A build step</text>
  <text x="42" y="214" font-size="10.5" fill="currentColor" opacity="0.88">Adds the credit automatically</text>
  <text x="838" y="206" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">fails on a new output</text>
  <rect x="26" y="236" width="828" height="52" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="42" y="258" font-size="12.5" font-weight="700" fill="currentColor">A gate</text>
  <text x="42" y="276" font-size="10.5" fill="currentColor" opacity="0.88">Reads it back, fails on absence</text>
  <text x="838" y="268" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">holds indefinitely</text>
  <text x="868" y="308" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Only the last approach turns a new, unhandled output type into a build failure rather than into a silently uncredited artefact.</text>
</svg>
<figcaption>The difference between the third and fourth rows is one function, and it is the difference between usually and always.</figcaption>
</figure>

## Verification

- **Every artefact reports a credit.** Run the gate over a full release and confirm it passes with a count matching the artefact list.
- **A stripped artefact fails.** Remove the metadata from one file and confirm the gate rejects it.
- **An unknown format fails.** Add an artefact with an unhandled extension and confirm the gate refuses rather than passing it.
- **The credit names the right source.** Compare the embedded source name and date against what the pipeline actually consumed.
- **Re-running updates rather than duplicates.** Run the tagging twice and confirm one credit, not two.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Credit missing from a copied file | Attribution only in documentation | Embed it in the artefact's own metadata |
| Credit names a stale source | String hard-coded rather than generated | Render it from the provenance record |
| Gate passes a new output type | Unknown formats treated as fine | Fail on any format without a defined check |
| Second credit appended per run | Insert without conflict handling | Upsert on the metadata key |
| Parquet tagging silently ignored | Schema metadata written to the wrong object | Replace the schema metadata and rewrite the file |
| Build green, artefact uncredited | Gate warns instead of failing | Raise on any missing credit |
| Only one artefact checked | Artefact list assembled by hand | Enumerate the release's outputs programmatically |

## Specification reference

> The Open Database Licence requires that any public use of the database, or of a produced work created from it, is accompanied by a notice attributing the database to OpenStreetMap contributors and identifying the licence. The OSM Foundation's attribution guidance describes acceptable placements for interactive maps, printed products and data distributions. See the [OpenStreetMap copyright page](https://www.openstreetmap.org/copyright) for the credit text and the [attribution guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines) for placement.

## Frequently Asked Questions

<details>
<summary>Is a credit in the README enough?</summary>

Not for anything somebody might copy. A README is detached from the data the moment a file is moved into another system, and the copy then carries no indication of where it came from. Every common format has somewhere to put metadata inside the artefact — a tile archive's metadata table, a columnar file's schema metadata, a database table — and using it means the credit survives the journeys files actually take.
</details>

<details>
<summary>Why generate the credit rather than write it once?</summary>

Because a hard-coded string describes whatever source was current when somebody typed it, and pipelines change sources. Rendering the credit from the provenance record means it names the extract actually consumed, with its date, every time. It also means one fewer thing to remember when a source changes, which is precisely the kind of forgetting that produces a misleading credit.
</details>

<details>
<summary>Should an unrecognised output format pass the gate?</summary>

No. A gate that passes what it does not understand stops being a gate as soon as somebody adds a new output type, and that addition is exactly when a check is most likely to be forgotten. Failing on an unknown extension is mildly annoying once, when the format is introduced, and prevents a silent gap afterwards.
</details>

<details>
<summary>Does attribution have to be visible on a rendered map?</summary>

Yes, on the map itself rather than somewhere a user would have to go looking. The requirement is that people using the work are made aware of its source, and a credit three pages away in a terms document does not achieve that. For an interactive map a corner credit with a link to the copyright page is the established form, and it is what reviewers expect to see.
</details>

## Related

- [OSM Licensing & ODbL Compliance](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/) — the parent topic and what each output owes.
- [Recording OSM Data Provenance in a Pipeline](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/recording-osm-data-provenance-in-a-pipeline/) — producing the record this credit is rendered from.
- [Generating MBTiles from OSM GeoJSON](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/building-tiles-with-tippecanoe/generating-mbtiles-from-osm-geojson/) — a tile archive whose metadata this tags.
- [Writing OSM Features to GeoParquet with PyArrow](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/writing-osm-features-to-geoparquet-with-pyarrow/) — the columnar sink whose schema metadata carries the credit.
- [Setting Quality Thresholds That Fail a Build](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/setting-quality-thresholds-that-fail-a-build/) — the same gating discipline for data quality.

Up one level: [OSM Licensing & ODbL Compliance](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Automating ODbL Attribution in Derived Products",
  "description": "Generate the attribution string from the pipeline's own provenance and embed it in every output format, then fail the build when something ships without it.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Data Fundamentals & Architecture",
  "about": ["attribution automation", "artefact metadata", "build gates"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Fundamentals & Architecture", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/" },
    { "@type": "ListItem", "position": 3, "name": "OSM Licensing & ODbL Compliance", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/" },
    { "@type": "ListItem", "position": 4, "name": "Automating ODbL Attribution in Derived Products", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/automating-odbl-attribution-in-derived-products/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Embed OSM attribution in every pipeline output automatically",
  "description": "Render the credit from the provenance record, write it into each format's own metadata mechanism, upsert on re-runs, and fail the build when any artefact or unrecognised format lacks it.",
  "step": [
    { "@type": "HowToStep", "name": "Render the credit from provenance", "text": "Build the attribution string and structured metadata keys from the recorded source name, date and checksum." },
    { "@type": "HowToStep", "name": "Use each format's metadata", "text": "Write the credit into a tile archive's metadata table, a columnar file's schema metadata and a database provenance table." },
    { "@type": "HowToStep", "name": "Upsert on re-runs", "text": "Update an existing credit rather than appending a second or failing on a constraint." },
    { "@type": "HowToStep", "name": "Rewrite columnar files", "text": "Replace the schema metadata and write a new file, since it cannot be modified in place." },
    { "@type": "HowToStep", "name": "Read the credit back", "text": "Verify each artefact by reading its metadata rather than trusting that the write succeeded." },
    { "@type": "HowToStep", "name": "Fail on unknown formats", "text": "Treat an artefact with no defined check as a failure so the gate cannot silently develop gaps." }
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
      "name": "Is an OSM credit in the README enough?",
      "acceptedAnswer": { "@type": "Answer", "text": "Not for anything somebody might copy. A README is detached from the data the moment a file is moved into another system. Every common format has somewhere to put metadata inside the artefact — a tile archive's metadata table, a columnar file's schema metadata, a database table — and using it means the credit survives the journeys files actually take." }
    },
    {
      "@type": "Question",
      "name": "Why generate the attribution credit rather than write it once?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because a hard-coded string describes whatever source was current when somebody typed it, and pipelines change sources. Rendering the credit from the provenance record means it names the extract actually consumed, with its date, every time, and removes one more thing to remember when a source changes." }
    },
    {
      "@type": "Question",
      "name": "Should an unrecognised output format pass an attribution gate?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. A gate that passes what it does not understand stops being a gate as soon as somebody adds a new output type, which is exactly when a check is most likely to be forgotten. Failing on an unknown extension is mildly annoying once and prevents a silent gap afterwards." }
    },
    {
      "@type": "Question",
      "name": "Does attribution have to be visible on a rendered map?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes, on the map itself rather than somewhere a user would have to go looking. The requirement is that people using the work are made aware of its source, and a credit three pages away in a terms document does not achieve that. A corner credit with a link to the copyright page is the established form." }
    }
  ]
}
</script>
