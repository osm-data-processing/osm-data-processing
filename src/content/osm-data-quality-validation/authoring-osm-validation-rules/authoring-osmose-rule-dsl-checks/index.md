---
title: "Authoring Osmose Rule DSL Checks"
description: "Write an Osmose backend analyser that runs a SQL query against the osmosis schema and emits an issue class so the offending features surface on the Osmose QA map."
pageTitle: "Authoring Osmose Backend Analyser Checks with SQL"
pageDescription: "Build an Osmose Analyser_Osmosis class that selects offending OSM features with SQL, emits self.error with a class_id, item, and level, and publishes the issue to the Osmose QA map."
slug: authoring-osmose-rule-dsl-checks
type: article
breadcrumb: "Osmose Rule DSL"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# Authoring Osmose Rule DSL Checks

Surface a data-quality issue on the Osmose QA map — for example every `amenity=fuel` node with no `name` — by writing a backend analyser that selects the offending features with SQL and emits a typed error class the frontend can render as map markers.

## Prerequisites

Have each of these in place; an analyser that runs cleanly but produces zero markers is nearly always a schema-name or class-registration slip below.

- [ ] A local Osmose backend checkout with its Python dependencies installed and `psycopg2` available.
- [ ] A PostgreSQL database loaded from a PBF extract via `osmosis` into the `osmosis` snapshot schema the analysers query.
- [ ] Python 3.10+ for the type hints and dictionary syntax used in the analyser class.
- [ ] Working knowledge of the OSM primitives you are querying, from the [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) reference.
- [ ] The tag conventions your check enforces, aligned with [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/).
- [ ] The broader rule-authoring context in [Authoring OSM Validation Rules](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/), so the class fits a coherent QA catalogue.

## Conceptual minimum

Osmose is a server-side quality-assurance system: it ingests an OSM extract into PostgreSQL, runs a battery of analysers over the database, and publishes each analyser's findings as issue markers on a web map. An analyser is a Python class, and the two families that matter are the `Analyser_Osmosis` base, which runs raw SQL against the `osmosis` snapshot schema, and the `Analyser_Merge` family, which cross-references OSM against an external open dataset. This page uses the `Analyser_Osmosis` pattern because most house rules are expressible as a query: the offending features are exactly the rows a `SELECT` returns, and the analyser's job is to turn each returned row into a typed error. Unlike the editor-time checks in a [JOSM validation preset](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/writing-custom-josm-validation-presets/), an Osmose check runs over the whole database on a schedule, so it catches issues in data nobody is actively editing.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="osmose-parts-t osmose-parts-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="osmose-parts-t">The four parts every Osmose rule declares</title>
  <desc id="osmose-parts-d">A left-to-right chain of the four declarations an Osmose analyser rule must make. A selector narrows the objects considered, usually by tag presence. A condition expresses the defect itself as SQL or a predicate. A class assigns a stable numeric identifier and a severity level, which is what the front end groups issues by. And a localised text explains the problem to a mapper in their own language. Omitting the class means the issue cannot be tracked across runs.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="osp" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Selector, condition, class, text — the class is the one that must be stable</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">selector</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">which objects</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">tag presence, type</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#osp)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">condition</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">what is wrong</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">SQL or predicate</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#osp)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">class</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">stable id + level</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">never renumber it</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#osp)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">text</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">per-language message</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">what the mapper should do</text>
  <text x="440" y="158" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Renumbering a class silently resets every false-positive mark mappers have made against it — treat the number as an API.</text>
</svg>
<figcaption>The class identifier is the part that is easy to treat as bookkeeping and is actually load-bearing: it is how the same defect found next week is recognised as the same defect, and how a mapper marks one as a false positive.</figcaption>
</figure>

Every issue Osmose raises is identified by a small set of fields that the frontend keys on. `class_id` is a number unique within the analyser; it groups all instances of one problem so mappers can filter by it. `item` is a broad category number (for example the ranges used for tagging, geometry, or routing problems) that colours and groups issues across analysers. `level` is severity from 1 (most serious) to 3 (minor). The analyser declares each class once in its constructor with a translated title, then, for every offending row the SQL returns, calls `self.error` with that `class_id` and the feature's type, id, and coordinates. The backend writes those errors to its issue tables; the frontend reads them and drops a marker at each feature's location. The pipeline below shows that path end to end.

<svg viewBox="14 40 952 198" role="img" aria-label="The Osmose analyser pipeline. A PostgreSQL database holding the osmosis snapshot schema, loaded from a PBF extract, feeds a SQL rule inside an Analyser_Osmosis class. The query selects offending features, for example fuel nodes with no name. Each returned row is turned into a typed issue class carrying a class_id, item category, and severity level through a self.error call. The backend writes these to its issue tables, and the Osmose frontend renders each issue as a marker on the QA map." xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>Osmose analyser pipeline from database to QA map</title>
  <desc>A PostgreSQL osmosis schema feeds a SQL rule in an Analyser_Osmosis class, whose returned rows become a typed issue class via self.error, which the backend stores and the frontend renders as markers on the QA map.</desc>
  <defs>
    <marker id="osmoseArrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <rect x="14" y="40" width="952" height="198" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <g fill="currentColor" text-anchor="middle">
    <!-- DB cylinder -->
    <ellipse cx="90" cy="70" rx="60" ry="14" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.5"/>
    <path d="M30,70 V190 A60,14 0 0 0 150,190 V70" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.5"/>
    <text x="90" y="120" font-size="12.5">PostgreSQL</text>
    <text x="90" y="138" font-size="10" opacity="0.8">osmosis schema</text>
    <text x="90" y="154" font-size="9.5" opacity="0.7">from PBF</text>
    <line x1="150" y1="130" x2="212" y2="130" stroke="currentColor" stroke-width="1.5" marker-end="url(#osmoseArrow)"/>
    <!-- SQL rule -->
    <rect x="214" y="94" width="190" height="72" rx="6" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-width="1.5"/>
    <text x="309" y="118" font-size="12.5">SQL rule</text>
    <text x="309" y="136" font-size="9.5" opacity="0.8">Analyser_Osmosis</text>
    <text x="309" y="152" font-size="9.5" opacity="0.8">SELECT offending rows</text>
    <line x1="404" y1="130" x2="466" y2="130" stroke="currentColor" stroke-width="1.5" marker-end="url(#osmoseArrow)"/>
    <text x="435" y="120" font-size="9" opacity="0.7">rows</text>
    <!-- issue class -->
    <rect x="468" y="94" width="196" height="72" rx="6" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-width="1.5"/>
    <text x="566" y="116" font-size="12.5">issue class</text>
    <text x="566" y="134" font-size="9.5" opacity="0.8">self.error(...)</text>
    <text x="566" y="150" font-size="9.5" opacity="0.8">class_id · item · level</text>
    <line x1="664" y1="130" x2="726" y2="130" stroke="currentColor" stroke-width="1.5" marker-end="url(#osmoseArrow)"/>
    <text x="695" y="120" font-size="9" opacity="0.7">store</text>
    <!-- map -->
    <rect x="728" y="86" width="222" height="88" rx="6" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.5"/>
    <text x="839" y="112" font-size="12.5">Osmose QA map</text>
    <text x="839" y="132" font-size="9.5" opacity="0.8">one marker per row</text>
    <circle cx="792" cy="150" r="5" fill="currentColor" fill-opacity="0.5" stroke="currentColor" stroke-width="1.2"/>
    <circle cx="839" cy="156" r="5" fill="currentColor" fill-opacity="0.5" stroke="currentColor" stroke-width="1.2"/>
    <circle cx="886" cy="149" r="5" fill="currentColor" fill-opacity="0.5" stroke="currentColor" stroke-width="1.2"/>
    <text x="490" y="220" font-size="10" text-anchor="start" opacity="0.75">Each returned row → one self.error() call → one map marker at the feature's coordinates.</text>
  </g>
</svg>

## Runnable solution

Save this as `analyser_merge_fuel_name.py` under the Osmose backend `analysers/` directory. It declares one issue class and selects every fuel node lacking a `name`, emitting an error per row.

```python
import logging

from modules.OsmoseTranslation import T_
from Analyser_Osmosis import Analyser_Osmosis

logger = logging.getLogger(__name__)

# SQL that selects offending features from the osmosis snapshot schema.
# nodes.tags is an hstore column; the ? operator tests key presence.
SQL_FUEL_WITHOUT_NAME = """
SELECT
    nodes.id,
    ST_X(nodes.geom) AS lon,
    ST_Y(nodes.geom) AS lat
FROM
    nodes
WHERE
    nodes.tags ? 'amenity'
    AND nodes.tags -> 'amenity' = 'fuel'
    AND NOT (nodes.tags ? 'name')
"""


class Analyser_Merge_Fuel_Name(Analyser_Osmosis):
    """Flag fuel stations (amenity=fuel) that are missing a name tag."""

    def __init__(self, config, logger=None):
        super().__init__(config, logger)
        # class_id: unique within this analyser. item: broad tagging category.
        self.classs[1] = self.def_class(
            item=3220,
            level=3,
            tags=["fuel", "fix:survey"],
            title=T_("Fuel station without a name"),
            detail=T_("This amenity=fuel node carries no name tag."),
            fix=T_("Survey the station and add its name."),
        )

    def analyser_osmosis_common(self):
        self.run(SQL_FUEL_WITHOUT_NAME, self._emit)

    def _emit(self, res):
        node_id, lon, lat = res[0], res[1], res[2]
        # self.error groups by class_id and positions the marker at (lon, lat).
        self.error(
            self.classs[1],
            {"self": lambda r: {"en": T_("Fuel station without a name")}},
            subclass=1,
            osm_id={"N": node_id},
            geom={"position": [{"lat": lat, "lon": lon}]},
        )
```

Run it against the loaded database from the backend root:

```bash
python osmose_run.py --analyser=merge_fuel_name --country=my-extract
```

## Step-by-step walkthrough

1. **Imports and base class.** `Analyser_Osmosis` provides `self.run` (execute SQL and iterate rows) and `self.error` (emit an issue). `T_` marks strings for translation, which the frontend uses to localise titles.
2. **The SQL contract.** The query must return the columns the emit callback expects — here `id`, `lon`, `lat`. Selecting the geometry as `ST_X`/`ST_Y` gives the marker coordinates directly; without them the frontend has nowhere to place the issue.
3. **hstore presence tests.** In the `osmosis` schema, tags live in an hstore column: `tags ? 'name'` tests key presence, and `tags -> 'amenity'` reads a value. `NOT (tags ? 'name')` is the SQL equivalent of the editor rule's `[!name]` absence test.
4. **Declaring the class.** `self.classs[1] = self.def_class(...)` registers one issue class. `item=3220` places it in the tagging-issue band, `level=3` marks it minor, and `title` is the label mappers read on the map. Declaring the class in the constructor means it exists even when a run finds zero issues.
5. **`analyser_osmosis_common`.** This is the entry point Osmose calls for a database analyser. `self.run(sql, callback)` streams each result row into the callback rather than materialising the whole result set, which keeps memory bounded on continental extracts.
6. **Emitting an error.** `self.error` writes one issue: `subclass` disambiguates variants within a class, `osm_id={"N": node_id}` links the marker to the node so JOSM can open it, and `geom={"position": [...]}` fixes the marker's map location.
7. **The item numbering.** `item` values are shared conventions across all Osmose analysers so the frontend can group and colour by category; reusing an established band keeps your check consistent with the rest of the catalogue rather than inventing an orphan category.
8. **Running and re-running.** The command loads no data itself; it assumes the `osmosis` schema is already populated, so a re-run after fixing tags in the database re-evaluates the same SQL and clears resolved markers.

## Verification

Confirm the check produces the markers you expect:

- **Class exists.** After a run, the analyser's `class` table must contain a row for `class_id` 1 with your title, even on a clean extract — proof the constructor registered it.
- **Row count matches errors.** Run `SQL_FUEL_WITHOUT_NAME` by hand in `psql`; the number of returned rows must equal the number of issues Osmose emitted for that class.
- **Marker placement.** Open the generated issue output and confirm each marker's `lat`/`lon` sits on the corresponding fuel node, not at `(0, 0)` — a `(0, 0)` marker means the geometry columns were missing from the SELECT.
- **Severity renders.** The issue should appear at level 3 (minor) styling on the map; a wrong `level` argument shows up as the wrong colour band.
- **Idempotent re-run.** Add `name` to one node in the database, re-run, and confirm that node's marker disappears while the others remain.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Analyser runs, zero markers | Query returns nothing due to wrong schema/table | Confirm the `osmosis` schema is loaded and `nodes` is populated. |
| `KeyError` on `self.classs` | `self.error` used a `class_id` never declared | Register every class in `__init__` via `def_class`. |
| All markers at `(0, 0)` | Geometry not selected or `geom` position empty | Select `ST_X`/`ST_Y` and pass them in `geom["position"]`. |
| `operator does not exist: hstore ? unknown` | hstore extension not enabled | `CREATE EXTENSION hstore;` in the target database. |
| Title shows as raw msgid | String not wrapped for translation | Wrap user-facing text in `T_(...)`. |
| Duplicate markers per feature | Callback emits inside a loop over joined rows | Ensure the SQL returns one row per offending feature. |
| Wrong colour grouping on map | `item` category number outside its band | Reuse an established `item` band for the issue type. |

<figure class="diagram-wrap">
<svg viewBox="0 0 880 238" role="img" aria-labelledby="osmose-err-t osmose-err-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="osmose-err-t">Three Osmose rule mistakes and the effect each has on mappers</title>
  <desc id="osmose-err-d">A grid of three authoring mistakes against their effect and the fix. A selector that is too broad produces thousands of issues and mappers stop opening the layer, fixed by narrowing the selector rather than raising the severity. A condition that encodes a regional convention as a global rule flags correct mapping in other countries, fixed by scoping to a country. A message that states the defect without saying what to do produces issues nobody actions, fixed by naming the corrective edit.</desc>
  <rect x="0" y="0" width="880" height="238" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">A correct rule that nobody acts on has not found anything</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">what mappers experience</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">the fix</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">selector too broad</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">thousands of issues, layer ignored</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">narrow the selector</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">regional convention as global rule</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">correct mapping flagged abroad</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">scope the rule by country</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">message states the defect only</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">issue read, nothing done</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">name the corrective edit</text>
  <text x="440" y="220" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Write the mapper-facing text first. If you cannot say what edit fixes it, the rule is not ready.</text>
</svg>
<figcaption>All three produce a technically correct rule that fails at the only thing that matters — a mapper making the fix.</figcaption>
</figure>

For issues that also need catching while a mapper edits, pair this server-side class with the editor guardrail in [Writing Custom JOSM Validation Presets](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/writing-custom-josm-validation-presets/) so both the live and the batch path enforce the same rule.

## Specification reference

> An Osmose backend analyser subclasses `Analyser_Osmosis` and runs SQL against the `osmosis` snapshot schema; each issue class is registered with `def_class` carrying an `item` category, a `level` from 1 to 3, and a translated `title`, and each offending feature is reported with `self.error` naming the class, the `osm_id`, and a `geom` position. See the [Osmose overview on the OSM Wiki](https://wiki.openstreetmap.org/wiki/Osmose) and the [Osmose backend source and analyser docs](https://github.com/osm-fr/osmose-backend) for the analyser API, the `item` numbering conventions, and the translation helpers.

## Frequently Asked Questions

<details>
<summary>When should I use Analyser_Osmosis versus Analyser_Merge?</summary>

Use `Analyser_Osmosis` when the offending features are fully describable by a SQL query over the OSM snapshot alone — missing tags, bad geometry relationships, inconsistent attributes. Reach for the `Analyser_Merge` family when the check compares OSM against an external open dataset, such as matching official addresses or public facility registries, because that family handles fetching, conflating, and diffing the reference source for you.
</details>

<details>
<summary>What do class_id, item, and level actually control?</summary>

`class_id` is unique within one analyser and groups every instance of a single problem so mappers can filter by it. `item` is a broad category number shared across all analysers that the frontend uses to colour and group issue types. `level` is severity from 1, the most serious, to 3, minor. Together they decide how an issue is labelled, coloured, grouped, and prioritised on the QA map.
</details>

<details>
<summary>Why does my analyser produce no markers even though the SQL looks right?</summary>

The usual cause is that the database was never loaded into the `osmosis` schema the analyser queries, so the tables are empty and the query returns nothing. Run the SELECT directly in psql first; if it returns zero rows there, the problem is the data load or the schema name, not the analyser. If psql returns rows but Osmose shows none, check that the emit callback passes valid geometry positions.
</details>

<details>
<summary>How do markers get their location on the map?</summary>

Each `self.error` call includes a `geom` argument with a `position` list of latitude and longitude pairs. Those coordinates come straight from the SQL, typically as `ST_X(geom)` and `ST_Y(geom)` for a node. The frontend drops one marker per emitted error at that position. If you omit the geometry columns from the SELECT, the markers collapse onto null-island at zero-zero.
</details>

## Related

- [Authoring OSM Validation Rules](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/) — the section that frames server-side and editor-side checks together.
- [Writing Custom JOSM Validation Presets](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/writing-custom-josm-validation-presets/) — the editor-time counterpart to this batch analyser.
- [Building Python-Based OSM Validation Rules](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/building-python-based-osm-validation-rules/) — a lighter-weight streaming framework when a full Osmose backend is overkill.
- [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) — the tag conventions the SQL conditions encode.
- [Flagging Deprecated OSM Tags in a Pipeline](https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/flagging-deprecated-osm-tags-in-a-pipeline/) — a related tag-consistency check expressed as a pipeline step.
- [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/) — the surrounding quality-assurance section.

Up one level: [Authoring OSM Validation Rules](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Authoring Osmose Rule DSL Checks",
  "description": "Write an Osmose backend analyser that runs a SQL query against the osmosis schema and emits an issue class so the offending features surface on the Osmose QA map.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "OSM Data Quality & Validation",
  "about": ["Osmose backend analyser", "OSM quality assurance", "SQL data validation"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Quality & Validation", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/" },
    { "@type": "ListItem", "position": 3, "name": "Authoring OSM Validation Rules", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/" },
    { "@type": "ListItem", "position": 4, "name": "Osmose Rule DSL", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/authoring-osmose-rule-dsl-checks/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Author an Osmose backend analyser check",
  "description": "Write an Analyser_Osmosis class that selects offending OSM features with SQL, declares an issue class with class_id, item, and level, and emits errors so they render on the Osmose QA map.",
  "step": [
    { "@type": "HowToStep", "name": "Write the SQL that selects offending features", "text": "Query the osmosis snapshot schema with hstore presence tests to return the id and coordinates of every feature that violates the rule." },
    { "@type": "HowToStep", "name": "Declare the issue class", "text": "In the constructor call def_class with an item category, a level from 1 to 3, and a translated title so the class exists even on a clean extract." },
    { "@type": "HowToStep", "name": "Emit an error per row", "text": "In the analyser callback call self.error with the class, the osm_id, and a geom position taken from the SQL coordinates." },
    { "@type": "HowToStep", "name": "Run and verify on the QA map", "text": "Run the analyser against the loaded database and confirm one marker appears at each offending feature's coordinates." }
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
      "name": "When should I use Analyser_Osmosis versus Analyser_Merge?",
      "acceptedAnswer": { "@type": "Answer", "text": "Use Analyser_Osmosis when the offending features are fully describable by a SQL query over the OSM snapshot alone, such as missing tags, bad geometry relationships, or inconsistent attributes. Reach for the Analyser_Merge family when the check compares OSM against an external open dataset, because that family handles fetching, conflating, and diffing the reference source for you." }
    },
    {
      "@type": "Question",
      "name": "What do class_id, item, and level actually control?",
      "acceptedAnswer": { "@type": "Answer", "text": "class_id is unique within one analyser and groups every instance of a single problem so mappers can filter by it. item is a broad category number shared across all analysers that the frontend uses to colour and group issue types. level is severity from 1, the most serious, to 3, minor. Together they decide how an issue is labelled, coloured, grouped, and prioritised on the QA map." }
    },
    {
      "@type": "Question",
      "name": "Why does my analyser produce no markers even though the SQL looks right?",
      "acceptedAnswer": { "@type": "Answer", "text": "The usual cause is that the database was never loaded into the osmosis schema the analyser queries, so the tables are empty and the query returns nothing. Run the SELECT directly in psql first; if it returns zero rows there, the problem is the data load or the schema name, not the analyser. If psql returns rows but Osmose shows none, check that the emit callback passes valid geometry positions." }
    },
    {
      "@type": "Question",
      "name": "How do markers get their location on the map?",
      "acceptedAnswer": { "@type": "Answer", "text": "Each self.error call includes a geom argument with a position list of latitude and longitude pairs. Those coordinates come straight from the SQL, typically as ST_X of geom and ST_Y of geom for a node. The frontend drops one marker per emitted error at that position. If you omit the geometry columns from the SELECT, the markers collapse onto null-island at zero-zero." }
    }
  ]
}
</script>
