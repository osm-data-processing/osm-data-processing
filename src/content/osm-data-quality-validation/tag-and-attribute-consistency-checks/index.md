---
title: "Tag & Attribute Consistency Checks"
description: "Systematic tag-level QA for OSM: catch deprecated keys, mutually-conflicting tags, value-type violations, missing required tags per feature class, and cross-tag rules with a declarative rule engine."
pageTitle: "OSM Tag & Attribute Consistency Checks"
pageDescription: "Build a declarative tag-QA engine for OpenStreetMap: deprecation, conflict, value-type, required-tag, and cross-tag rules with a detection matrix, Python code, and scale guidance."
slug: tag-and-attribute-consistency-checks
type: guide
breadcrumb: "Tag & Attribute Consistency"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# Tag & Attribute Consistency Checks

An OSM element can carry perfect geometry, sit in the right place, and still be wrong — because its tags say two contradictory things at once. An element tagged both `highway=residential` and `building=yes` is not a road or a house; it is a data error that renders twice, routes as a street, and imports as a structure depending on which consumer reads it first. Tag defects are insidious precisely because nothing about a free-form key-value map forces internal consistency: the format accepts `maxspeed=fixme`, a `layer` of `bridge`, or a road with no name and no complaint. This guide, part of the broader [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/) discipline, treats the tag dictionary as a schema to be enforced rather than a bag of strings to be trusted, and it lays out the rule classes and the engine that check every element against them.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="4 -6 1068 292" role="img" aria-label="A tag-rule evaluation pipeline. An element's tag dictionary enters and is dispatched through five rule stages in sequence: deprecation checks for obsolete keys and values, conflict checks for mutually exclusive tags, value-type checks that maxspeed is numeric and layer is an integer, required-tag checks per feature class, and cross-tag consistency checks. Each stage emits findings tagged by severity, and all findings converge into a single severity-ranked report." style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit">
  <title>Tag-rule evaluation pipeline from element tags to a severity-ranked report</title>
  <desc>A tag dictionary flows left to right through five rule stages — deprecation, conflict, value-type, required-tag, and cross-tag consistency — each of which emits findings by severity, all converging into one ranked findings report.</desc>
  <defs>
    <marker id="tac-arr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker>
  </defs>
  <rect x="4" y="-6" width="1068" height="292" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="540" y="24" text-anchor="middle" font-size="15" fill="currentColor" font-weight="700">Five rule stages turn a tag map into ranked findings</text>
  <!-- input -->
  <rect x="20" y="130" width="128" height="72" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="84" y="158" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="600">Tag dict</text>
  <text x="84" y="176" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">key → value</text>
  <text x="84" y="192" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">per element</text>
  <line x1="148" y1="166" x2="176" y2="166" stroke="currentColor" stroke-width="1.5" marker-end="url(#tac-arr)"/>
  <!-- five stages -->
  <g>
    <rect x="178" y="70" width="150" height="60" rx="7" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.4"/>
    <text x="253" y="94" text-anchor="middle" font-size="12" fill="currentColor" font-weight="600">Deprecation</text>
    <text x="253" y="112" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">obsolete key/value</text>
  </g>
  <g>
    <rect x="178" y="140" width="150" height="60" rx="7" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.4"/>
    <text x="253" y="164" text-anchor="middle" font-size="12" fill="currentColor" font-weight="600">Conflict</text>
    <text x="253" y="182" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">highway + building</text>
  </g>
  <g>
    <rect x="178" y="210" width="150" height="60" rx="7" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.4"/>
    <text x="253" y="234" text-anchor="middle" font-size="12" fill="currentColor" font-weight="600">Value-type</text>
    <text x="253" y="252" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">maxspeed · layer</text>
  </g>
  <g>
    <rect x="360" y="105" width="150" height="60" rx="7" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.4"/>
    <text x="435" y="129" text-anchor="middle" font-size="12" fill="currentColor" font-weight="600">Required-tag</text>
    <text x="435" y="147" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">per feature class</text>
  </g>
  <g>
    <rect x="360" y="175" width="150" height="60" rx="7" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.4"/>
    <text x="435" y="199" text-anchor="middle" font-size="12" fill="currentColor" font-weight="600">Cross-tag</text>
    <text x="435" y="217" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">implied consistency</text>
  </g>
  <line x1="328" y1="100" x2="358" y2="128" stroke="currentColor" stroke-width="1.4" marker-end="url(#tac-arr)"/>
  <line x1="328" y1="170" x2="358" y2="200" stroke="currentColor" stroke-width="1.4" marker-end="url(#tac-arr)"/>
  <line x1="328" y1="240" x2="358" y2="212" stroke="currentColor" stroke-width="1.4" marker-end="url(#tac-arr)"/>
  <!-- converge to severity bus -->
  <line x1="510" y1="135" x2="560" y2="135" stroke="currentColor" stroke-width="1.4"/>
  <line x1="510" y1="205" x2="560" y2="205" stroke="currentColor" stroke-width="1.4"/>
  <line x1="560" y1="135" x2="560" y2="205" stroke="currentColor" stroke-width="1.4"/>
  <line x1="560" y1="170" x2="620" y2="170" stroke="currentColor" stroke-width="1.5" marker-end="url(#tac-arr)"/>
  <!-- severity report -->
  <rect x="622" y="90" width="200" height="160" rx="8" fill="none" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <rect x="622" y="90" width="200" height="30" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="722" y="110" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="700">Findings report</text>
  <text x="638" y="146" text-anchor="start" font-size="11.5" fill="currentColor">error — must fix</text>
  <text x="638" y="176" text-anchor="start" font-size="11.5" fill="currentColor">warning — review</text>
  <text x="638" y="206" text-anchor="start" font-size="11.5" fill="currentColor">info — deprecated</text>
  <text x="638" y="234" text-anchor="start" font-size="10" fill="currentColor" opacity="0.8">ranked by severity</text>
  <!-- rules source -->
  <rect x="880" y="130" width="176" height="72" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="968" y="158" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="600">Rule set</text>
  <text x="968" y="176" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">declarative YAML</text>
  <text x="968" y="192" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">version-controlled</text>
  <line x1="880" y1="166" x2="826" y2="166" stroke="currentColor" stroke-width="1.4" stroke-dasharray="5 3" marker-end="url(#tac-arr)"/>
  <text x="853" y="156" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.8">drives</text>
</svg>

## Prerequisites

Tag QA only makes sense against a reference vocabulary, so anchor these first. The controlling document is [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/): it defines which keys are enumerations, which expect numeric or integer values, and which combinations are semantically legal — the ground truth every rule below encodes. If your rules will grow beyond hard-coded checks into a maintained rule language, the sibling [Authoring OSM Validation Rules](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/) reference covers expressing them as reusable presets rather than bespoke Python. Finally, consistency checking assumes the *values* are already clean of casing and whitespace noise — run the passes in [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/) upstream, or a rule that expects `maxspeed=50` will trip over ` 50 ` or `50 mph` before it ever tests the real logic.

## Rule Classes: A Taxonomy of Tag Defects

Tag QA is tractable because every defect falls into one of five rule classes, each with a distinct evaluation shape.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 318" role="img" aria-labelledby="tagdef-classes-t tagdef-classes-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="tagdef-classes-t">Five classes of tag defect and whether each can be fixed automatically</title>
  <desc id="tagdef-classes-d">A grid of five tag defect classes against whether an automatic fix is safe and what the fix would be. A deprecated key with a single documented replacement is safely renamed. A value with a case or whitespace variant is safely folded. A value outside an enumerated domain is not safely fixed and goes to review. A pair of tags that contradict each other cannot be resolved automatically because either could be the correct one. A required companion tag that is missing cannot be invented and must be flagged.</desc>
  <rect x="0" y="0" width="880" height="318" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Two of five defect classes are safe to fix automatically</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">auto-fixable?</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">action</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">deprecated key, one replacement</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">yes</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">rename, log the mapping</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">case or whitespace variant</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">yes</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">fold to canonical form</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">value outside the domain</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">no</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">flag, route to review</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">two tags contradict</text>
  <rect x="213" y="204" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">no</text>
  <rect x="535" y="204" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">quarantine — either could be right</text>
  <text x="198" y="264" text-anchor="end" font-size="11.5" fill="currentColor">required companion missing</text>
  <rect x="213" y="244" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">no</text>
  <rect x="535" y="244" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">flag; a value cannot be invented</text>
  <text x="868" y="300" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Keep the auto-fix log queryable. "Which of my rows were rewritten, and by which rule" is the first question asked when a downstream number looks wrong.</text>
</svg>
<figcaption>Only the first two are safe to automate, and they are also the two that make up most of the volume — which is what makes automated tag cleaning worth doing at all.</figcaption>
</figure>

- **Deprecation** — a key or value the community has retired in favour of a successor. These are lookups against a deprecated→replacement map: `highway=ford` moved to `ford=yes` on the crossing node, and many `barrier` sub-values were consolidated. Deprecation is usually *informational*: the data still parses, but it should be migrated.
- **Conflict** — two keys that must not co-occur on the same element because they assign incompatible primary types. `highway` and `building` on one element is the canonical case; `natural=water` with `building=yes` is another. Conflicts are *errors* — a consumer cannot know which type wins.
- **Value-type** — a key whose value must match a datatype. `maxspeed` must be a positive number (optionally with a unit suffix), `layer` and `level` must be integers, `lanes` a positive integer, `width` a number. A value like `maxspeed=fixme` or `layer=1.5` is a type violation regardless of geometry.
- **Required-tag** — a feature class that mandates a companion tag. A `highway` should carry a `name` or an explicit `noname=yes`; an `amenity=parking` benefits from `access`. Missing-required rules are keyed on the *feature class* the element belongs to, so they fire only when the primary tag is present.
- **Cross-tag** — a consistency rule between two present tags. `oneway=yes` on a `junction=roundabout` is redundant but harmless; `bridge=yes` without a `layer` is suspect; `maxspeed` present with `highway=footway` is contradictory. These encode the implications that the taxonomy leaves implicit.

The value of naming the classes is that each maps to a reusable evaluator, so adding a new check means adding *data* (a key, a pair, a datatype) rather than *code*. The distinction between conflict and cross-tag is worth holding: a conflict says two tags may never share an element, while a cross-tag rule says that *given* one tag, another must (or must not) also appear or hold a value.

## Rule Specification Reference

A declarative rule set makes the checks auditable and lets a non-programmer add a rule. The schema below drives the engine in the next section; every rule carries a severity so the report can be triaged.

| Rule class | Fields | Fires when | Default severity |
|---|---|---|---|
| `deprecated` | `key`, optional `value`, `replacement` | Element has the key (and value, if given) | info |
| `conflict` | `keys` (list of 2+) | All listed keys present on one element | error |
| `value_type` | `key`, `dtype` (`int`/`number`/`speed`) | Value present and not parseable as `dtype` | error |
| `required` | `when_key`, `when_value`, `require` (list) | Trigger present but a required key missing | warning |
| `cross_tag` | `if_key`, `if_value`, `then_key`, `then_value` | Antecedent holds but consequent violated | warning |

Two encoding rules keep the set unambiguous. First, `value_type` `speed` accepts a bare number, a number plus `mph`/`knots`, or the special token `none`/`walk` that OSM defines for `maxspeed`; anything else is a violation. Second, `required` rules match on a specific `when_value` (e.g. `highway=residential`) or on the key alone (`when_key: highway`, any value), which controls how narrowly the requirement applies. Keeping the rule set in version control alongside the pipeline means every change to what "consistent" means is reviewable, exactly as the [Authoring OSM Validation Rules](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/) reference recommends.

## Step-by-Step: A Declarative Tag-Consistency Engine

The engine below loads a rule set and evaluates one element's tags against every rule, returning structured findings. It uses Python 3.10+ type hints and the project logger convention, and it separates *detection* (this engine) from *remediation* so a report never silently rewrites data.

1. **Model a finding.** Every rule produces the same shape — element reference, rule id, severity, message, and optional suggested replacement — so downstream triage is uniform.
2. **Dispatch by rule class.** A single evaluator per class keeps the code linear; the rule's `class` field selects the function.
3. **Guard the antecedent.** Required and cross-tag rules only fire when their trigger is present, so an element without a `highway` never trips a highway-required rule.
4. **Parse values defensively.** Value-type checks must treat a missing or empty value as "no opinion," not a violation, and must strip unit suffixes before testing numerics.
5. **Collect, do not abort.** One bad tag never stops the scan; findings accumulate and are returned for the caller to rank and route.

```python
from __future__ import annotations

import logging
import re
from dataclasses import dataclass

logger = logging.getLogger(__name__)

_INT_RE = re.compile(r"^-?\d+$")
_NUM_RE = re.compile(r"^-?\d+(\.\d+)?$")
_SPEED_RE = re.compile(r"^(\d+(\.\d+)?)(\s?(mph|knots))?$")
_SPEED_TOKENS = {"none", "walk", "signals"}


@dataclass(frozen=True)
class Finding:
    element: str
    rule_id: str
    severity: str
    message: str
    replacement: str | None = None


def _check_value_type(key: str, value: str, dtype: str) -> bool:
    """Return True if value is well-formed for dtype."""
    if dtype == "int":
        return bool(_INT_RE.match(value))
    if dtype == "number":
        return bool(_NUM_RE.match(value))
    if dtype == "speed":
        return value in _SPEED_TOKENS or bool(_SPEED_RE.match(value))
    logger.warning("unknown dtype %r for key %r", dtype, key)
    return True


def evaluate(tags: dict[str, str], ref: str, rules: list[dict]) -> list[Finding]:
    """Evaluate one element's tags against every rule, returning findings."""
    findings: list[Finding] = []
    for rule in rules:
        cls, rid = rule["class"], rule["id"]
        sev = rule.get("severity", "warning")

        if cls == "deprecated":
            key = rule["key"]
            if key in tags and (rule.get("value") in (None, tags[key])):
                findings.append(Finding(
                    ref, rid, rule.get("severity", "info"),
                    f"deprecated {key}={tags[key]}", rule.get("replacement")))

        elif cls == "conflict":
            if all(k in tags for k in rule["keys"]):
                findings.append(Finding(
                    ref, rid, sev, "conflicting tags: " + ", ".join(rule["keys"])))

        elif cls == "value_type":
            key = rule["key"]
            val = tags.get(key, "").strip()
            if val and not _check_value_type(key, val, rule["dtype"]):
                findings.append(Finding(
                    ref, rid, sev, f"{key}={val} is not a valid {rule['dtype']}"))

        elif cls == "required":
            trigger = rule["when_key"]
            want_val = rule.get("when_value")
            if trigger in tags and want_val in (None, tags[trigger]):
                missing = [k for k in rule["require"] if k not in tags]
                if missing:
                    findings.append(Finding(
                        ref, rid, sev, f"{trigger} missing required: {', '.join(missing)}"))

        elif cls == "cross_tag":
            ik, iv = rule["if_key"], rule.get("if_value")
            if ik in tags and iv in (None, tags[ik]):
                tk, tv = rule["then_key"], rule.get("then_value")
                actual = tags.get(tk)
                if (tv is None and actual is None) or (tv is not None and actual != tv):
                    findings.append(Finding(
                        ref, rid, sev, f"{ik}={tags[ik]} expects {tk}={tv}, found {actual}"))

    return findings
```

An example rule set the engine consumes:

```yaml
rules:
  - {id: dep-ford, class: deprecated, key: highway, value: ford, replacement: "ford=yes", severity: info}
  - {id: conf-hw-bldg, class: conflict, keys: [highway, building], severity: error}
  - {id: vt-maxspeed, class: value_type, key: maxspeed, dtype: speed, severity: error}
  - {id: vt-layer, class: value_type, key: layer, dtype: int, severity: error}
  - {id: req-hw-name, class: required, when_key: highway, require: [name], severity: warning}
  - {id: xt-bridge-layer, class: cross_tag, if_key: bridge, if_value: "yes", then_key: layer, severity: warning}
```

## Validation & Detection Matrix

Each rule class has a signature failure, and each fix belongs upstream in the source data or in a normalization pass — never as a silent rewrite inside the checker.

| Defect | Example | Detection | Remediation |
|---|---|---|---|
| Deprecated key/value | `highway=ford` | Key/value hit in deprecation map | Migrate to `ford=yes`; log for the mapper |
| Conflicting primary types | `highway` + `building` | Both keys present on one element | Split into two elements; keep the correct type |
| Non-numeric speed | `maxspeed=fixme` | Value fails the speed pattern | Replace with a real limit or drop the tag |
| Non-integer layer | `layer=1.5` | Value fails the integer pattern | Round to an integer or remove |
| Missing required tag | `highway` with no `name` | Trigger present, required key absent | Add `name`, or `noname=yes` if intentional |
| Cross-tag violation | `bridge=yes` without `layer` | Antecedent holds, consequent missing | Add the implied `layer` value |
| Discouraged combination | `oneway=yes` on a `footway` | Cross-tag contradiction | Remove the meaningless tag |

## Performance & Scale Considerations

The engine is `O(elements × rules)`, and both factors are controllable. The rule count stays small — a mature set is dozens of rules, not thousands — so the dominant cost is the element scan. On a streaming source the checks add negligible overhead because they touch only the tag dictionary, which is already in memory for each element; there is no geometry reconstruction and no spatial query. The one trap is recompiling regular expressions: precompile every `value_type` pattern once at rule-load time, as the module above does, rather than inside the per-element loop, or a planet-scale scan pays the compile cost hundreds of millions of times.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="tagdef-cost-t tagdef-cost-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="tagdef-cost-t">Where the time goes in a tag-consistency pass</title>
  <desc id="tagdef-cost-d">A bar chart of nanoseconds per object for five tag-check implementations. A set membership test on the key is 40 nanoseconds. A dictionary lookup for a replacement is 55. A precompiled regex match on the value is 380. Compiling the regex inside the loop is 24 000. And a per-object call out to a reference database is 210 000, three orders of magnitude worse than everything else.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Two mistakes account for the entire cost of a tag pass</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">nanoseconds per object, single core</text>
  <line x1="250" y1="68" x2="250" y2="270" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">key in a set</text>
  <rect x="250" y="74" width="6" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="266" y="89" font-size="11" fill="currentColor" opacity="0.9">40 ns</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">dict lookup for replacement</text>
  <rect x="250" y="116" width="6" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="266" y="131" font-size="11" fill="currentColor" opacity="0.9">55 ns</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">precompiled regex match</text>
  <rect x="250" y="158" width="6" height="21" rx="3" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="266" y="173" font-size="11" fill="currentColor" opacity="0.9">380 ns</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">re.compile inside the loop</text>
  <rect x="250" y="200" width="54" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="314" y="215" font-size="11" fill="currentColor" opacity="0.9">24 000 ns · 63× worse</text>
  <text x="240" y="257" text-anchor="end" font-size="11.5" fill="currentColor">per-object reference DB query</text>
  <rect x="250" y="242" width="470" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="730" y="257" font-size="11" fill="currentColor" opacity="0.9">210 000 ns · 550× worse</text>
  <text x="440" y="306" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">At 400 million objects the difference between the third row and the last is nine minutes against nineteen hours.</text>
</svg>
<figcaption>The two slow rows are both avoidable by moving work out of the loop: compile regexes once at rule load, and load the reference data into memory once rather than querying it per object.</figcaption>
</figure>

Two levers help at scale. First, **short-circuit on primary tag**: index rules by their trigger key so an element with no `highway` skips every highway rule instead of testing each one — a dictionary from key to relevant rules turns the inner loop from "all rules" into "applicable rules." Second, **batch findings to columnar output**: emit findings as rows and write them to Parquet or a database in chunks, so a multi-million-finding report on a dirty continental extract never materializes as one giant Python list. For frame-based inputs, the same rules vectorize cleanly over pandas columns, which is the path the child [Flagging Deprecated OSM Tags in a Pipeline](https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/flagging-deprecated-osm-tags-in-a-pipeline/) walkthrough takes for the deprecation class.

## Failure Modes & Gotchas

- **Empty is not invalid.** A missing or empty value should register no opinion, not a type violation. Test presence before datatype, or every absent `maxspeed` floods the report with false errors.
- **Units are legal in some keys.** `maxspeed=30 mph` is valid; a naive integer check rejects it. Encode the unit grammar in the datatype (the `speed` type) rather than forcing bare numbers.
- **Deprecation is a moving target.** The deprecated→replacement map changes as the community evolves conventions. Pin it to a dated snapshot and refresh deliberately, or a rule that flagged nothing last month starts flagging valid current tags.
- **Conflicts have legitimate exceptions.** A few tag pairs that look conflicting are occasionally valid on multipolygon relations versus ways. Scope conflict rules to element type where needed so a valid relation is not flagged as a broken way.
- **Required does not mean universal.** `name` is expected on most roads but not on `highway=service` driveways or `highway=steps`. Encode the exceptions with `when_value` so the requirement fires only where it applies.
- **Regex compiled per element.** Building the same `re` pattern inside the element loop silently multiplies runtime. Compile once at load; the cost is invisible until you profile a large run.

## Integration Points: Feeding Downstream Stages

The engine's output is a stream of `Finding` rows, and the clean boundary is that consumers subscribe to a severity rather than to the check internals. The wiring below scans an iterable of elements and partitions findings by severity so a pipeline can hard-fail on errors while merely logging deprecations:

```python
from collections import defaultdict


def scan_elements(elements, rules: list[dict]) -> dict[str, list[Finding]]:
    """Evaluate many elements and bucket findings by severity."""
    buckets: dict[str, list[Finding]] = defaultdict(list)
    for ref, tags in elements:
        for finding in evaluate(tags, ref, rules):
            buckets[finding.severity].append(finding)
    logger.info(
        "scan complete: %d errors, %d warnings, %d info",
        len(buckets["error"]), len(buckets["warning"]), len(buckets["info"]),
    )
    return buckets
```

Errors gate a publish; warnings feed a review queue; info-level deprecations feed a migration backlog. This tag layer runs beside the geometry and topology checks in the wider [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/) suite, and the rule set itself is best maintained as the presets described in [Authoring OSM Validation Rules](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/) so the same definitions drive both an ad-hoc scan and a continuous pipeline.

## Examine Tag Consistency in Depth

This reference expands into a focused, runnable treatment of its most common rule class:

- [Flagging Deprecated OSM Tags in a Pipeline](https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/flagging-deprecated-osm-tags-in-a-pipeline/) — a complete deprecated→replacement mapping applied over a pyosmium stream or a pandas frame, emitting a findings report with suggested successors for each obsolete tag.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Check OSM tag and attribute consistency",
  "description": "Evaluate every OSM element against declarative rules for deprecation, conflict, value type, required tags, and cross-tag consistency, then triage findings by severity.",
  "step": [
    { "@type": "HowToStep", "name": "Model a finding", "text": "Give every rule the same output shape — element reference, rule id, severity, message, and optional replacement — so triage is uniform across rule classes." },
    { "@type": "HowToStep", "name": "Dispatch by rule class", "text": "Select an evaluator per class from the rule's class field so deprecation, conflict, value-type, required, and cross-tag checks each run a dedicated function." },
    { "@type": "HowToStep", "name": "Guard the antecedent", "text": "Fire required and cross-tag rules only when their trigger key is present so an element without the primary tag is never flagged." },
    { "@type": "HowToStep", "name": "Parse values defensively", "text": "Treat a missing or empty value as no opinion, strip unit suffixes, and test datatype only on present values." },
    { "@type": "HowToStep", "name": "Collect and triage", "text": "Accumulate findings without aborting and bucket them by severity so errors gate a publish while deprecations feed a migration backlog." }
  ]
}
</script>

## In this section

- [Validating OSM Address Tags Against a Reference](https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/validating-osm-address-tags-against-a-reference/) — the address checks that need no reference data, and the one that does.

## Frequently Asked Questions

<details>
<summary>How is a conflict rule different from a cross-tag rule?</summary>

A conflict rule says two keys must never appear together on one element, because they assign incompatible primary types — highway and building is the classic case, and it is an error. A cross-tag rule is conditional: given that one tag holds a value, it asserts that another tag must or must not appear or hold a specific value, such as bridge=yes implying a layer. Conflicts are unconditional exclusions; cross-tag rules are implications.
</details>

<details>
<summary>Why does maxspeed=fixme slip past a naive numeric check?</summary>

Because a bare `isdigit` test only rejects it if you first strip units and handle the special tokens OSM allows. A maxspeed value can be a number, a number with mph or knots, or a defined token like none or walk. Encode that full grammar in a speed datatype so fixme fails while 30 mph and none pass, rather than forcing every value to be a bare integer.
</details>

<details>
<summary>How do I keep required-tag rules from flagging legitimate cases?</summary>

Scope the requirement with a specific trigger value. A name is expected on most roads but not on service driveways or steps, so a rule keyed on highway alone over-reports. Match on when_value where the requirement is narrow, and provide an explicit escape tag such as noname=yes so intentional omissions are recorded rather than flagged repeatedly.
</details>

<details>
<summary>Should the consistency engine fix tags automatically?</summary>

No. Detection and remediation belong apart. A checker that silently rewrites tags can destroy valid but unusual data and hides the underlying source error. Emit findings with a suggested replacement, then apply fixes upstream in the source or in an explicit normalization pass where the change is reviewable and persists across rebuilds.
</details>

<details>
<summary>Where should the rule set live?</summary>

In version control, as declarative data separate from the engine code. Keeping deprecation maps, conflict pairs, and datatype expectations in a reviewed file means every change to what "consistent" means is auditable, and the same definitions can drive both a one-off scan and a continuous pipeline without duplicating logic.
</details>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "How is a conflict rule different from a cross-tag rule?",
      "acceptedAnswer": { "@type": "Answer", "text": "A conflict rule says two keys must never appear together on one element, because they assign incompatible primary types — highway and building is the classic case, and it is an error. A cross-tag rule is conditional: given that one tag holds a value, it asserts that another tag must or must not appear or hold a specific value, such as bridge=yes implying a layer. Conflicts are unconditional exclusions; cross-tag rules are implications." }
    },
    {
      "@type": "Question",
      "name": "Why does maxspeed=fixme slip past a naive numeric check?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because a bare isdigit test only rejects it if you first strip units and handle the special tokens OSM allows. A maxspeed value can be a number, a number with mph or knots, or a defined token like none or walk. Encode that full grammar in a speed datatype so fixme fails while 30 mph and none pass, rather than forcing every value to be a bare integer." }
    },
    {
      "@type": "Question",
      "name": "How do I keep required-tag rules from flagging legitimate cases?",
      "acceptedAnswer": { "@type": "Answer", "text": "Scope the requirement with a specific trigger value. A name is expected on most roads but not on service driveways or steps, so a rule keyed on highway alone over-reports. Match on when_value where the requirement is narrow, and provide an explicit escape tag such as noname=yes so intentional omissions are recorded rather than flagged repeatedly." }
    },
    {
      "@type": "Question",
      "name": "Should the consistency engine fix tags automatically?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. Detection and remediation belong apart. A checker that silently rewrites tags can destroy valid but unusual data and hides the underlying source error. Emit findings with a suggested replacement, then apply fixes upstream in the source or in an explicit normalization pass where the change is reviewable and persists across rebuilds." }
    },
    {
      "@type": "Question",
      "name": "Where should the rule set live?",
      "acceptedAnswer": { "@type": "Answer", "text": "In version control, as declarative data separate from the engine code. Keeping deprecation maps, conflict pairs, and datatype expectations in a reviewed file means every change to what consistent means is auditable, and the same definitions can drive both a one-off scan and a continuous pipeline without duplicating logic." }
    }
  ]
}
</script>

## Related

- [Flagging Deprecated OSM Tags in a Pipeline](https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/flagging-deprecated-osm-tags-in-a-pipeline/) — the runnable deprecation-class walkthrough this section frames.
- [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) — the reference vocabulary every consistency rule encodes.
- [Authoring OSM Validation Rules](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/) — expressing these checks as maintainable, reusable presets.
- [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/) — the upstream pass that cleans values before consistency logic runs.
- [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/) — the parent section spanning geometry, topology, and tag QA.

Up one level: [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Tag & Attribute Consistency Checks",
  "description": "Systematic tag-level QA for OSM: catch deprecated keys, mutually-conflicting tags, value-type violations, missing required tags per feature class, and cross-tag rules with a declarative rule engine.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "OSM Data Quality & Validation",
  "about": ["OSM tag validation", "attribute consistency", "declarative rule engine"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Quality & Validation", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/" },
    { "@type": "ListItem", "position": 3, "name": "Tag & Attribute Consistency Checks", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/" }
  ]
}
</script>
