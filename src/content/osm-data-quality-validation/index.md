---
title: "OSM Data Quality & Validation"
description: "Automated QA for OpenStreetMap pipelines: the selector-predicate-severity-message rule model, JOSM, Osmose and Python rule ecosystems, geometry, topology and tag checks, ETL gates, quarantine policy, and reporting."
pageTitle: "OSM Data Quality & Validation for ETL Pipelines"
pageDescription: "How automated OSM validation works: the rule model, JOSM/Osmose/Python rule engines, geometry and topology QA, tag consistency, ETL gate placement, quarantine-vs-reject policy, and severity reporting."
slug: osm-data-quality-validation
type: overview
breadcrumb: "Data Quality & Validation"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# OSM Data Quality & Validation

<figure class="diagram-wrap">
<svg viewBox="0 0 1060 356" role="img" aria-labelledby="oqv-flow-title oqv-flow-desc" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:1060px;display:block;margin:1.5rem auto;font-family:inherit;color:var(--c-ink)">
  <title id="oqv-flow-title">OSM validation pipeline: parsed features through a rule engine to a report and quarantine</title>
  <desc id="oqv-flow-desc">A horizontal data-flow diagram. Parsed OSM features enter a rule engine that evaluates each feature against a selector then a predicate. The engine fans out to four check families run in parallel: geometry checks, topology checks, tag checks, and schema checks. Their results converge on a verdict stage that separates clean features, which pass through to the report, from flagged features, which are routed to a quarantine store, and every finding is written to the report.</desc>
  <defs>
    <marker id="oqv-arr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker>
  </defs>
  <text x="530" y="22" text-anchor="middle" font-size="15" fill="currentColor" font-weight="700">One rule engine, four check families, two outcomes</text>
  <!-- parsed features -->
  <rect x="24" y="150" width="152" height="60" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="100" y="176" text-anchor="middle" font-size="13" fill="currentColor" font-weight="600">Parsed features</text>
  <text x="100" y="194" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.8">node · way · relation</text>
  <!-- rule engine -->
  <rect x="228" y="150" width="152" height="60" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="304" y="176" text-anchor="middle" font-size="13" fill="currentColor" font-weight="600">Rule engine</text>
  <text x="304" y="194" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.8">selector · predicate</text>
  <line x1="176" y1="180" x2="226" y2="180" stroke="currentColor" stroke-width="1.5" marker-end="url(#oqv-arr)"/>
  <!-- four checks -->
  <rect x="432" y="40" width="164" height="50" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="514" y="61" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="600">Geometry checks</text>
  <text x="514" y="78" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">validity · closure</text>
  <rect x="432" y="106" width="164" height="50" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="514" y="127" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="600">Topology checks</text>
  <text x="514" y="144" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">connectivity</text>
  <rect x="432" y="172" width="164" height="50" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="514" y="193" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="600">Tag checks</text>
  <text x="514" y="210" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">value · deprecation</text>
  <rect x="432" y="238" width="164" height="50" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="514" y="259" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="600">Schema checks</text>
  <text x="514" y="276" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">required keys</text>
  <path d="M380,176 C408,176 404,65 430,65" fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#oqv-arr)"/>
  <path d="M380,178 C408,178 404,131 430,131" fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#oqv-arr)"/>
  <path d="M380,182 C408,182 404,197 430,197" fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#oqv-arr)"/>
  <path d="M380,184 C408,184 404,263 430,263" fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#oqv-arr)"/>
  <!-- verdict -->
  <rect x="648" y="150" width="150" height="60" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="723" y="176" text-anchor="middle" font-size="13" fill="currentColor" font-weight="600">Verdict</text>
  <text x="723" y="194" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.8">pass · flag</text>
  <path d="M596,65 C624,65 620,176 646,176" fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#oqv-arr)"/>
  <path d="M596,131 C624,131 620,178 646,178" fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#oqv-arr)"/>
  <path d="M596,197 C624,197 620,182 646,182" fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#oqv-arr)"/>
  <path d="M596,263 C624,263 620,184 646,184" fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#oqv-arr)"/>
  <!-- outputs -->
  <rect x="864" y="108" width="172" height="52" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="950" y="130" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="600">Report</text>
  <text x="950" y="148" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">every finding logged</text>
  <rect x="864" y="200" width="172" height="52" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="950" y="222" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="600">Quarantine</text>
  <text x="950" y="240" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">held, not dropped</text>
  <path d="M798,174 C832,174 834,134 862,134" fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#oqv-arr)"/>
  <path d="M798,188 C832,188 834,226 862,226" fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#oqv-arr)"/>
  <text x="836" y="150" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">pass</text>
  <text x="836" y="212" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">flag</text>
</svg>
<figcaption>Automated OSM validation: features are matched by selectors, tested by predicates across geometry, topology, tag, and schema families, and each verdict is written to a report while flagged records are held in quarantine rather than silently dropped.</figcaption>
</figure>

Data quality is the difference between an OpenStreetMap pipeline that produces trustworthy routing graphs, address layers, and analytics tables and one that quietly ships broken geometry into a customer-facing product. Because OSM is edited continuously by hundreds of thousands of contributors with no central schema enforcement, every extract you ingest contains a predictable population of defects: rings that never close, roads that stop one metre short of the junction they should meet, `maxspeed=fixme` where a number belongs, and deprecated tags that a renderer stopped honouring years ago. This guide is the quality-assurance layer of the site — it explains how to turn those defects from surprises discovered in production into findings caught by an automated gate, using a rule model that is portable across the three validation ecosystems the OSM community actually runs.

The scope here is deliberately the *checking* layer, not the *fixing* layer. Validation answers a narrow question for every feature — does this record satisfy the rules we care about, and if not, how badly — and records the answer in a way a human or a downstream stage can act on. It sits on top of the parsing and normalization work covered in [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/) and depends on the structural guarantees established in [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/): you cannot validate a geometry you have not first reconstructed, and you cannot judge a tag without knowing the schema it is measured against. Treat this section as the place you return to whenever "the data looked fine" turns out to mean "nothing checked it."

## The Validation-Rule Model

Every practical OSM check, regardless of which tool runs it, decomposes into four parts. A **selector** narrows the stream to the features a rule cares about — `highway=*` ways, closed `natural=water` areas, nodes tagged `amenity`. A **predicate** is the boolean test applied to each selected feature: is the ring closed, does the value parse as an integer, does the way connect to the network. A **severity** classifies the consequence of a failing predicate so that consumers can triage — a self-intersecting administrative boundary is not the same class of problem as a missing `name:en`. Finally a **message** (and ideally a fix-hint) explains the finding in terms a mapper or an engineer can act on, ideally naming the element and the offending value.

Holding this four-part model in mind is what makes validation portable. The JOSM validator, the Osmose backend, and a hand-written Python checker all express the same underlying `(selector, predicate, severity, message)` tuple; they differ only in the language you write it in and where it runs. When you internalise the model, "porting a check from Osmose to your pipeline" stops being a rewrite and becomes a translation of four known slots. The companion guide on [Authoring OSM Validation Rules](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/) builds a single Python rule engine around exactly this decomposition and shows how the same rule intent maps onto each ecosystem.

A useful discipline is to keep the selector cheap and the predicate expensive. Selection should be a fast tag or type test that rejects the overwhelming majority of features before any geometric or network computation runs, because geometry and topology predicates are orders of magnitude more costly than a dictionary lookup. A rule that runs an intersection test on every node in the planet because its selector was too loose will dominate your validation budget for no benefit.

## Three Rule Ecosystems

There is no single canonical OSM validator; there are three overlapping systems, and a mature pipeline borrows from all of them rather than reinventing their accumulated rule sets.

- **JOSM validator and presets.** The JOSM editor ships a built-in validator that runs at edit time — before a changeset is ever uploaded — catching crossing ways, duplicate nodes, untagged features, and unclosed areas. Its checks are partly hard-coded and partly expressed as MapCSS selectors, and its presets constrain what values a key may take. This is the earliest possible gate: it stops defects at the source, in the contributor's editor. The details of writing your own live in [Writing Custom JOSM Validation Presets](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/writing-custom-josm-validation-presets/).
- **Osmose backend rule DSL.** Osmose is a server-side quality-assurance system that scans OSM data on a schedule and publishes geolocated issues on a map. Its analysers are configured through a rule model — SQL-backed selectors and parameterised checks — that produces stable issue classes with item and class numbers, severities, and localised messages. Because Osmose runs over whole countries continuously, its rule catalogue is a battle-tested inventory of real defect patterns worth mirroring in your own gates; [Authoring Osmose Rule DSL Checks](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/authoring-osmose-rule-dsl-checks/) covers its structure.
- **Python custom rules.** For pipeline-specific invariants that no general tool knows about — "every `addr:housenumber` in this region must have an `addr:street` that matches our gazetteer" — you write rules in Python over [pyosmium](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/) handlers or a `geopandas` frame. This is where your organisation's domain knowledge lives, and it is the layer that runs inside your ETL rather than in an editor or an external service. [Building Python-Based OSM Validation Rules](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/building-python-based-osm-validation-rules/) develops this end to end.

The three are complementary in *when* and *where* they run. JOSM validates at authoring time and prevents defects; Osmose validates continuously and surfaces the community's backlog; Python rules validate at ingestion time and enforce the contract your specific consumers depend on. A defect that slips past the first two must still be caught by the third before it reaches your product, which is why the pipeline gate is non-negotiable even when upstream QA is excellent.

## Geometry Validation & Repair

Geometry is the first check family because a downstream stage that trusts an invalid geometry produces subtly wrong answers rather than loud failures. The predicates here operate on reconstructed shapes: a way becomes a `LineString` or, when its first and last node references coincide, a `Polygon`, and a multipolygon relation becomes a set of assembled rings. The core validity tests are whether a polygon is simple (non-self-intersecting), whether its rings are correctly closed, whether inner rings actually sit inside their outer ring, and whether winding follows the orientation GIS engines expect.

Under the OGC Simple Features model that `shapely` implements, a polygon is *valid* only if its boundary does not cross itself and its holes lie within and do not touch the shell except at isolated points. OSM data violates this constantly — a mapper drags a node across an edge and creates a bow-tie, or a large water body's outer ring is digitised as a figure-eight. Detecting these is a call to `is_valid`; the harder half is repair, because the standard `buffer(0)` fix can silently change area or drop a lobe on pathological input, so a repaired geometry must be compared against its original before it is trusted. The full detection-and-repair workflow, including self-intersection classification and unclosed-way reconstruction, is the subject of [Geometry Validation & Repair](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/), which also draws on the ring-assembly rules in [Understanding OSM Multipolygon Relations for GIS](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/understanding-osm-multipolygon-relations-for-gis/).

A pipeline should treat geometry validity as a gate with three outcomes rather than a boolean: valid geometries pass, trivially repairable ones (a self-touch removable by `buffer(0)` with negligible area change) are repaired and annotated, and geometries whose repair changes area beyond a tolerance are quarantined for review. Silently repairing everything is how a lake loses an island.

## Routing-Graph Topology QA

Topology QA asks a different question from geometry: not "is this shape well-formed?" but "does this network connect the way a router needs?" A road can be a perfectly valid `LineString` and still be useless — because it ends a hair short of the junction it should join, because a bridge way shares coordinates with the road beneath it but no shared node, or because a one-way loop traps a router with no legal exit. These defects are invisible to geometry checks and only appear once you build the graph.

The canonical topology predicates are connectivity and reachability. After converting ways into a routable graph — the translation covered in [OSMnx Graph Conversion Techniques](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/) — you decompose it into connected components and flag every component that is not part of the giant one, since a healthy road network for a region is overwhelmingly a single connected mass and the small islands are almost always errors: an unsnapped node, a missing `highway` tag on a connector, or a routing barrier tagged without an access exception. Near-miss junctions (endpoints within a few metres but not sharing a node) are detected with a spatial index over endpoints, and turn-restriction relations are validated for members that actually form a `from`-`via`-`to` chain. The disconnected-component hunt is walked through in [Finding Disconnected Road Network Components](https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/finding-disconnected-road-network-components/); the broader stage is [Routing-Graph Topology QA](https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/).

## Tag & Attribute Consistency

The third family checks the attribute schema rather than the shape. OSM's open key-value model, described in [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/), means nothing structurally prevents a contributor from writing `maxspeed=50 mph` in one place, `maxspeed=50mph` in another, and `maxspeed=fifty` in a third. Tag consistency checks encode the conventions the format itself does not enforce.

The recurring predicate types are: **value-domain** checks (does `oneway` hold one of `yes`, `no`, `-1`, `reversible`?), **type/unit** checks (does `maxspeed` parse as a number with an optional recognised unit?), **co-occurrence** checks (a feature tagged `addr:housenumber` should carry `addr:street` or be inside an `associatedStreet` relation), and **deprecation** checks (is this key one the community has retired in favour of a replacement?). Deprecation is a moving target — the retired-tag list grows every year — so a pipeline hard-codes it at its peril; [Flagging Deprecated OSM Tags in a Pipeline](https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/flagging-deprecated-osm-tags-in-a-pipeline/) treats the deprecation map as versioned data, and [Tag & Attribute Consistency Checks](https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/) covers the family in full. Because tags arrive from many editors and locales, running these checks after the normalization stage — not before — avoids drowning in false positives from mere casing and whitespace noise.

## Where Validation Gates Sit in the ETL

Placement matters as much as the rules themselves. A validation gate that runs after data has already been loaded into the serving store catches nothing useful; it only tells you what you already shipped. Effective pipelines run validation at three distinct points, each with a different mandate.

The first is a **structural gate** immediately after parsing, sharing the spec-compliance checks described in the [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/) reference: header features, reference closure, size ceilings. A failure here is fatal to the batch because the bytes themselves cannot be trusted. The second is a **semantic gate** after reconstruction and normalization, where geometry, topology, and tag rules run against fully-formed features; this is where the bulk of the rule catalogue lives and where quarantine, not abort, is the right response. The third is an **output gate** just before publication, asserting invariants on the finished product — row counts within expected bounds, no null geometries in the routing table, attribution metadata present — so a regression in an upstream stage cannot silently ship.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Add an automated validation gate to an OSM pipeline",
  "description": "Place and run a rule-based quality-assurance gate over reconstructed OpenStreetMap features so defects are caught, classified, and quarantined before publication.",
  "step": [
    { "@type": "HowToStep", "name": "Reconstruct features first", "text": "Resolve node references into geometries and normalize tags before validating, because you cannot test a geometry or a value that has not been assembled and cleaned." },
    { "@type": "HowToStep", "name": "Define rules as selector and predicate", "text": "Express each check as a cheap selector that narrows the feature stream and an expensive predicate that tests the survivors, so geometry and topology work runs only where it can matter." },
    { "@type": "HowToStep", "name": "Assign a severity to every rule", "text": "Classify each rule as error, warning, or info so downstream consumers can decide what blocks publication and what is merely logged." },
    { "@type": "HowToStep", "name": "Route findings to report and quarantine", "text": "Write every finding to a report and move features that fail an error-severity rule to a quarantine store keyed on the element type and id rather than dropping them." },
    { "@type": "HowToStep", "name": "Assert output invariants before publishing", "text": "Run a final gate that checks row counts, null geometries, and attribution metadata on the finished dataset so an upstream regression cannot ship silently." }
  ]
}
</script>

## Quarantine vs Reject Policy

When a feature fails a rule, a pipeline has three options and choosing well is a design decision, not an accident. It can **reject** — drop the record and continue; it can **quarantine** — set the record aside in a dead-letter store with enough context to review or reprocess it; or it can **abort** — stop the whole run. The right choice is a function of severity and blast radius.

Aborting is correct only for structural failures that poison everything downstream: an unreadable header, a required feature the parser does not implement, a checksum mismatch. For per-feature defects, aborting is a denial-of-service on your own pipeline — one bad polygon in a continental extract should never stop the other tens of millions of good features from flowing. Rejecting is tempting because it is simple, but a silently dropped feature is a silently missing road, and the absence is far harder to debug than a logged rejection. Quarantine is the default for anything error-severity: move the offending record to a table keyed on `(type, id)` with the failing rule, the offending value, the source extract version, and a timestamp, so the record can be remediated with the playbook in [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) and reprocessed once fixed. Warnings and informational findings need no quarantine at all — they are logged to the report and the feature passes through, because blocking on a missing `name:en` would quarantine half the planet.

## A Severity Taxonomy

Severity is the field that makes a validation report actionable, and an inconsistent taxonomy makes it noise. Borrowing the vocabulary the major QA tools already share keeps your reports legible to anyone who has used them.

| Severity | Meaning | Pipeline action | Example |
| --- | --- | --- | --- |
| Error | Data is wrong or unusable for its purpose | Quarantine the feature | Self-intersecting boundary; way with an invalid node ref |
| Warning | Likely a defect, but the feature may still be usable | Pass, flag in report | `highway` way disconnected from the network |
| Info | Convention or completeness nudge, not a defect | Pass, log only | Missing `name:en` on a named feature |
| Fixme | Contributor explicitly marked it unfinished | Pass, route to review queue | `maxspeed=fixme`, `fixme=*` present |

Two rules keep a taxonomy healthy. First, severity is a property of the *rule*, not the feature — the same missing tag is an error in a routing pipeline and info in a rendering one, so severity is configured per consumer rather than baked into the checker. Second, resist severity inflation: if every rule is an error, the error class stops meaning "must quarantine" and reviewers start ignoring it. Reserve error for defects that genuinely make the data unfit, and let the long list of stylistic and completeness issues sit at warning or info.

## Reporting

A validation run that produces a pass/fail bit and nothing else is nearly useless; the value is in the structured findings. Each finding should carry the element identity as a `(type, id)` pair, the rule identifier, the severity, a human-readable message, and — for geolocated review — a coordinate so an issue can be dropped on a map the way Osmose does. Emitting findings as newline-delimited JSON or a GeoJSON `FeatureCollection` makes them equally consumable by a dashboard, a diffing job that tracks whether quality is improving release over release, and a mapper who wants to fix the source data.

The single most valuable reporting practice is trend tracking. A one-off report tells you the current defect count; a report compared against the previous run tells you whether a code change or an upstream edit made things better or worse, and it turns quality from a static audit into a regression signal. Key findings on `(type, id, rule)` so the same defect is stable across runs, count new versus resolved issues per release, and alert on a spike in any error-severity class. The mechanics of shaping a `ValidationIssue` into these outputs are where this section's checking model becomes an operational tool:

```python
import logging
from dataclasses import dataclass, field
from enum import Enum

logger = logging.getLogger(__name__)


class Severity(str, Enum):
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"
    FIXME = "fixme"


@dataclass(slots=True)
class ValidationIssue:
    """A single finding emitted by any rule, portable across engines."""

    osm_type: str          # "node" | "way" | "relation"
    osm_id: int
    rule_id: str           # stable id, e.g. "geometry.self_intersection"
    severity: Severity
    message: str
    lon: float | None = None
    lat: float | None = None
    context: dict[str, str] = field(default_factory=dict)

    @property
    def key(self) -> tuple[str, int, str]:
        """Stable identity for de-duplication and run-over-run diffing."""
        return (self.osm_type, self.osm_id, self.rule_id)

    def blocks_publication(self) -> bool:
        """Only error-severity findings quarantine a feature."""
        return self.severity is Severity.ERROR


def summarize(issues: list[ValidationIssue]) -> dict[str, int]:
    counts: dict[str, int] = {s.value: 0 for s in Severity}
    for issue in issues:
        counts[issue.severity.value] += 1
    logger.info("validation summary: %s", counts)
    return counts
```

This `ValidationIssue` is the lingua franca of the section: whether a finding originates from a JOSM-style MapCSS test, an Osmose analyser, or a bespoke Python predicate, normalising it into this shape lets one reporting and quarantine path serve every rule engine.

## Explore Data Quality & Validation in Depth

Each guide below drills into one part of the checking layer introduced above:

- [Authoring OSM Validation Rules](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/) — how to write rules across the JOSM, Osmose, and Python ecosystems around one unified rule model, with a runnable engine skeleton.
- [Geometry Validation & Repair](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/) — detecting invalid polygons, self-intersections, and unclosed ways, and repairing them without silently corrupting area.
- [Routing-Graph Topology QA](https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/) — connectivity, reachability, and near-miss junction checks that only surface once ways become a routable graph.
- [Tag & Attribute Consistency Checks](https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/) — value-domain, unit, co-occurrence, and deprecation rules that enforce the conventions OSM's open schema leaves unpoliced.

## Frequently Asked Questions

<details>
<summary>What is the difference between JOSM, Osmose, and Python validation?</summary>

They differ in where and when they run. The JOSM validator checks data inside the editor at authoring time and prevents defects before upload. Osmose is a server-side system that scans whole regions on a schedule and publishes geolocated issues. Python custom rules run inside your own ETL at ingestion time and enforce invariants specific to your consumers. A mature pipeline uses all three because each catches problems the others cannot.
</details>

<details>
<summary>Should a failing feature stop the whole pipeline?</summary>

Almost never. Aborting is correct only for structural failures that poison the entire batch, such as an unreadable header or a checksum mismatch. Per-feature defects should be quarantined — moved to a dead-letter store keyed on element type and id with the failing rule and source version — so the millions of valid features keep flowing while the defect is reviewed and reprocessed.
</details>

<details>
<summary>Where should validation gates sit in an OSM ETL?</summary>

At three points. A structural gate right after parsing checks header features, reference closure, and size ceilings, and its failures are fatal. A semantic gate after reconstruction and normalization runs the geometry, topology, and tag rules and quarantines rather than aborts. An output gate just before publication asserts row counts, absence of null geometries, and presence of attribution metadata so an upstream regression cannot ship silently.
</details>

<details>
<summary>Why not just repair every invalid geometry automatically?</summary>

Because automatic repair can silently change the data. The common zero-width buffer fix removes self-touches, but on pathological rings it can drop a lobe or merge separate parts, so a lake can lose an island without any error. Treat geometry validity as a three-way gate: pass valid shapes, repair-and-annotate trivial cases where area barely changes, and quarantine geometries whose repair shifts area beyond a tolerance.
</details>

<details>
<summary>How do I keep a deprecated-tag check from going stale?</summary>

Treat the deprecation map as versioned data, not hard-coded logic. The community retires and replaces keys every year, so a list embedded in code drifts out of date and starts producing both false negatives and false positives. Load the deprecated-to-replacement mapping from a dated configuration file, record which version a run used, and update it on a schedule alongside the rest of your rule catalogue.
</details>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What is the difference between JOSM, Osmose, and Python validation?",
      "acceptedAnswer": { "@type": "Answer", "text": "They differ in where and when they run. The JOSM validator checks data inside the editor at authoring time and prevents defects before upload. Osmose is a server-side system that scans whole regions on a schedule and publishes geolocated issues. Python custom rules run inside your own ETL at ingestion time and enforce invariants specific to your consumers. A mature pipeline uses all three because each catches problems the others cannot." }
    },
    {
      "@type": "Question",
      "name": "Should a failing feature stop the whole pipeline?",
      "acceptedAnswer": { "@type": "Answer", "text": "Almost never. Aborting is correct only for structural failures that poison the entire batch, such as an unreadable header or a checksum mismatch. Per-feature defects should be quarantined, moved to a dead-letter store keyed on element type and id with the failing rule and source version, so the millions of valid features keep flowing while the defect is reviewed and reprocessed." }
    },
    {
      "@type": "Question",
      "name": "Where should validation gates sit in an OSM ETL?",
      "acceptedAnswer": { "@type": "Answer", "text": "At three points. A structural gate right after parsing checks header features, reference closure, and size ceilings, and its failures are fatal. A semantic gate after reconstruction and normalization runs the geometry, topology, and tag rules and quarantines rather than aborts. An output gate just before publication asserts row counts, absence of null geometries, and presence of attribution metadata so an upstream regression cannot ship silently." }
    },
    {
      "@type": "Question",
      "name": "Why not just repair every invalid geometry automatically?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because automatic repair can silently change the data. The common zero-width buffer fix removes self-touches, but on pathological rings it can drop a lobe or merge separate parts, so a lake can lose an island without any error. Treat geometry validity as a three-way gate: pass valid shapes, repair and annotate trivial cases where area barely changes, and quarantine geometries whose repair shifts area beyond a tolerance." }
    },
    {
      "@type": "Question",
      "name": "How do I keep a deprecated-tag check from going stale?",
      "acceptedAnswer": { "@type": "Answer", "text": "Treat the deprecation map as versioned data, not hard-coded logic. The community retires and replaces keys every year, so a list embedded in code drifts out of date and starts producing both false negatives and false positives. Load the deprecated-to-replacement mapping from a dated configuration file, record which version a run used, and update it on a schedule alongside the rest of your rule catalogue." }
    }
  ]
}
</script>

## Related

- [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/) — the spec-compliance gates and structural invariants validation builds on.
- [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — the primitives whose reconstruction must precede any geometry or topology check.
- [Understanding OSM Multipolygon Relations for GIS](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/understanding-osm-multipolygon-relations-for-gis/) — ring assembly and winding, the source of most geometry-validity findings.
- [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) — the schema that tag-consistency rules measure against.
- [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/) — the upstream stage that must run before validation to avoid false positives.
- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — the quarantine and remediation playbook for features this layer flags.

This guide anchors the quality-assurance layer of the knowledge base; return to the [site home](https://www.osm-data-processing.org/) to explore the fundamentals, parsing, and replication sections that surround it.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "OSM Data Quality & Validation",
  "description": "Automated QA for OpenStreetMap pipelines: the selector-predicate-severity-message rule model, the JOSM, Osmose, and Python rule ecosystems, geometry, topology, and tag checks, ETL gate placement, quarantine policy, and reporting.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "OSM Data Quality & Validation",
  "about": ["OpenStreetMap data quality", "OSM validation rules", "geospatial QA pipelines"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Quality & Validation", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/" }
  ]
}
</script>
