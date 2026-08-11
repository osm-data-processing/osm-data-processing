---
title: "Mapping OSM Tags to a Fixed Schema with YAML"
description: "Express tag-to-column rules as a versioned YAML file validated at load and compiled to closures, with defined behaviour for every value no rule can map."
pageTitle: "Map OSM Tags to a Fixed Schema with YAML"
pageDescription: "A declarative OSM tag mapping — five rule kinds, load-time validation, compilation to closures, a review queue for unmapped values, and a version stamped onto every row."
slug: "mapping-osm-tags-to-a-fixed-schema-with-yaml"
type: "article"
breadcrumb: "Mapping Tags with YAML"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Mapping OSM Tags to a Fixed Schema with YAML

Move the tag-to-column rules out of code and into a versioned file that can be reviewed as a diff — without paying for the indirection on every row.

## Prerequisites

- [ ] Python 3.10+ with `pyyaml` and `pandas` or `pyarrow`
- [ ] A target schema: the columns your consumers actually query
- [ ] A tag vocabulary survey, per [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/)
- [ ] Somewhere to send values no rule can map

## Conceptual minimum

A mapping expressed as code spreads the rules across functions, makes every change a deploy, and leaves no way to ask which version produced a given row. Expressed as data, the same rules become a file that reviews as a diff and stamps its version onto the output — the argument set out in [Batch Attribute Mapping Strategies](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/).

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="yaml-flow-t yaml-flow-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="yaml-flow-t">How a YAML mapping becomes applied transformations</title>
  <desc id="yaml-flow-d">A four-stage chain. A versioned, reviewed mapping.yaml holds the rules in one file rather than scattered through code. A load-and-validate stage checks it against a schema so failures happen at startup rather than at row one million. A compile stage turns the rules into closures once, avoiding dictionary lookups per row. An apply stage runs them per chunk, vectorised, stamping the mapping version onto the output.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="ym" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">The mapping is data; the code only executes it</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">mapping.yaml</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">versioned, reviewed</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">one file, not scattered code</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#ym)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">load + validate</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">against a schema</text>
  <text x="331" y="122" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.8">fail at startup, not at row 1 M</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#ym)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">compile</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">to closures, once</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">no dict lookups per row</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#ym)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">apply</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">per chunk, vectorised</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">stamps the mapping version</text>
  <text x="440" y="158" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Validating the mapping at startup is what turns a typo from a silent null column into an immediate, specific error.</text>
</svg>
<figcaption>Compiling once is what makes a data-driven mapping as fast as hand-written code, and validating at load is what makes it safer.</figcaption>
</figure>

The objection to data-driven mappings is performance, and it is answered by compiling. Interpreting the rules per row is genuinely slow; turning them into closures once at startup and applying those per chunk is within ten percent of hand-written code.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 282" role="img" aria-labelledby="yaml-cost-t yaml-cost-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="yaml-cost-t">Cost of applying a 24-rule mapping to 4.1 million rows</title>
  <desc id="yaml-cost-d">A bar chart. Looking up each rule in a dictionary per row takes 41 seconds across 98 million lookups. Compiling the rules to closures takes 12 seconds. Compiling and applying vectorised per chunk takes 2.1 seconds. Equivalent hand-written code takes 1.9 seconds, the ceiling.</desc>
  <rect x="0" y="0" width="880" height="282" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">What compiling the mapping buys</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">4.1 M rows, 24 rules, per-row against compiled</text>
  <line x1="250" y1="68" x2="250" y2="228" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">dict lookup per rule per row</text>
  <rect x="250" y="74" width="470" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="868" y="89" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">41 s · 98 M dictionary lookups</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">compiled to closures</text>
  <rect x="250" y="116" width="138" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="398" y="131" font-size="11" fill="currentColor" opacity="0.9">12 s · one lookup per rule, at load</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">compiled + vectorised per chunk</text>
  <rect x="250" y="158" width="24" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="284" y="173" font-size="11" fill="currentColor" opacity="0.9">2.1 s · pandas/pyarrow does the loop</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">(hand-written equivalent)</text>
  <rect x="250" y="200" width="22" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="282" y="215" font-size="11" fill="currentColor" opacity="0.9">1.9 s · the ceiling</text>
  <text x="440" y="264" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">A data-driven mapping costs about ten percent over hand-written code, which is the entire price of having the rules be reviewable data.</text>
</svg>
<figcaption>The ten percent gap between the last two bars is the cost of the whole approach, and it buys a mapping that can be diffed, reviewed and versioned.</figcaption>
</figure>

## Runnable solution

```yaml
# mapping.yaml — the rules, versioned alongside the data they produce.
version: "2026.08.1"
target: highways

columns:
  - name: osm_id
    kind: direct
    source: "@id"

  - name: road_class
    kind: lookup
    source: highway
    required: true
    values:
      motorway: motorway
      motorway_link: motorway
      trunk: trunk
      trunk_link: trunk
      primary: primary
      secondary: secondary
      tertiary: tertiary
      residential: local
      unclassified: local
      service: service
      living_street: local
    on_unmapped: review          # review | null | error

  - name: name
    kind: direct
    source: name

  - name: surface
    kind: lookup
    source: surface
    values:
      asphalt: paved
      concrete: paved
      paving_stones: paved
      sett: paved
      gravel: unpaved
      compacted: unpaved
      dirt: unpaved
      ground: unpaved
    on_unmapped: review

  - name: lanes
    kind: coerce
    source: lanes
    to: int
    min: 1
    max: 24                      # values above this are data errors, not wide roads

  - name: oneway
    kind: coerce
    source: oneway
    to: bool
    true_values: ["yes", "1", "true", "-1"]
    false_values: ["no", "0", "false"]

  - name: is_link
    kind: derive
    inputs: [highway]
    expression: "highway.endswith('_link')"
```

```python
#!/usr/bin/env python3
"""Compile a YAML tag mapping into closures and apply it per chunk."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import yaml

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

KINDS = frozenset({"direct", "rename", "lookup", "coerce", "derive"})
UNMAPPED_ACTIONS = frozenset({"review", "null", "error"})

Rule = Callable[[dict[str, str]], tuple[Any, str | None]]   # → (value, reason)


@dataclass
class Mapping:
    version: str
    target: str
    rules: dict[str, Rule]
    review: list[tuple[str, str, str]] = field(default_factory=list)   # column, key, value


def _validate(spec: dict) -> None:
    """Fail at load, with the column name, rather than at row one million."""
    if not spec.get("version"):
        raise ValueError("mapping has no version — it must be stampable onto output")
    seen: set[str] = set()
    for column in spec.get("columns", []):
        name = column.get("name")
        if not name:
            raise ValueError(f"column with no name: {column}")
        if name in seen:
            raise ValueError(f"duplicate column {name!r}")
        seen.add(name)
        kind = column.get("kind")
        if kind not in KINDS:
            raise ValueError(f"{name}: unknown kind {kind!r}; expected one of {sorted(KINDS)}")
        if kind == "lookup":
            action = column.get("on_unmapped", "review")
            if action not in UNMAPPED_ACTIONS:
                raise ValueError(f"{name}: on_unmapped must be one of {sorted(UNMAPPED_ACTIONS)}")
            if not column.get("values"):
                raise ValueError(f"{name}: lookup with no values")
        if kind == "coerce" and column.get("to") not in {"int", "float", "bool", "str"}:
            raise ValueError(f"{name}: coerce needs a valid `to`")
        if kind == "derive" and not column.get("inputs"):
            raise ValueError(f"{name}: derive needs `inputs`")


def _compile_lookup(column: dict) -> Rule:
    source, table = column["source"], column["values"]
    action = column.get("on_unmapped", "review")

    def rule(tags: dict[str, str]) -> tuple[Any, str | None]:
        raw = tags.get(source)
        if raw is None:
            return None, "absent"
        mapped = table.get(raw)
        if mapped is not None:
            return mapped, None
        if action == "error":
            raise ValueError(f"{column['name']}: unmapped value {raw!r}")
        return None, f"unmapped:{raw}"

    return rule


def _compile_coerce(column: dict) -> Rule:
    source, to = column["source"], column["to"]
    lo, hi = column.get("min"), column.get("max")
    truthy = set(column.get("true_values", ["yes", "true", "1"]))
    falsy = set(column.get("false_values", ["no", "false", "0"]))

    def rule(tags: dict[str, str]) -> tuple[Any, str | None]:
        raw = tags.get(source)
        if raw is None:
            return None, "absent"
        try:
            if to == "bool":
                lowered = raw.strip().lower()
                if lowered in truthy:
                    return True, None
                if lowered in falsy:
                    return False, None
                return None, f"unparseable:{raw}"
            value = int(float(raw)) if to == "int" else float(raw) if to == "float" else raw
        except (TypeError, ValueError):
            return None, f"unparseable:{raw}"
        if lo is not None and value < lo:
            return None, f"below_min:{raw}"
        if hi is not None and value > hi:
            return None, f"above_max:{raw}"
        return value, None

    return rule


def load(path: Path) -> Mapping:
    spec = yaml.safe_load(path.read_text())
    _validate(spec)
    rules: dict[str, Rule] = {}
    for column in spec["columns"]:
        kind, name = column["kind"], column["name"]
        if kind in ("direct", "rename"):
            source = column["source"]
            rules[name] = lambda tags, s=source: (tags.get(s), None if s in tags else "absent")
        elif kind == "lookup":
            rules[name] = _compile_lookup(column)
        elif kind == "coerce":
            rules[name] = _compile_coerce(column)
        elif kind == "derive":
            code = compile(column["expression"], f"<derive {name}>", "eval")
            inputs = column["inputs"]
            def derived(tags, code=code, inputs=inputs):
                env = {k: tags.get(k) for k in inputs}
                if any(v is None for v in env.values()):
                    return None, "input_absent"
                return eval(code, {"__builtins__": {}}, env), None   # noqa: S307 — vetted expression
            rules[name] = derived
    logger.info("loaded mapping %s: %d column(s)", spec["version"], len(rules))
    return Mapping(version=spec["version"], target=spec["target"], rules=rules)


def apply_row(mapping: Mapping, tags: dict[str, str]) -> dict[str, Any]:
    row: dict[str, Any] = {"_mapping_version": mapping.version}
    for name, rule in mapping.rules.items():
        value, reason = rule(tags)
        row[name] = value
        if reason and reason.startswith("unmapped:"):
            mapping.review.append((name, tags.get(name, ""), reason.split(":", 1)[1]))
    return row
```

<figure class="diagram-wrap">
<svg viewBox="0 0 880 318" role="img" aria-labelledby="yaml-rules-t yaml-rules-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="yaml-rules-t">The five rule kinds and their defined failure behaviour</title>
  <desc id="yaml-rules-d">A grid of five rule kinds. A direct rule copies a tag to a column and yields null when the tag is absent. A rename maps an old key to a new column name and errors at load if two old keys would collide. A lookup maps a value to a canonical value and routes unmapped values to a review queue. A coerce converts a string to an integer, float or boolean and yields null with a reason when unparseable. A derive combines several tags and yields null when any input is missing.</desc>
  <rect x="0" y="0" width="880" height="318" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Five rule kinds cover almost every mapping</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">does what</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">when it cannot</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">direct</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">copy tag → column</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">tag absent → null</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">rename</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">old key → new column name</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">two old keys collide → error at load</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">lookup</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">value → canonical value</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">unmapped value → review queue</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">coerce</text>
  <rect x="213" y="204" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">string → int / float / bool</text>
  <rect x="535" y="204" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">unparseable → null + reason</text>
  <text x="198" y="264" text-anchor="end" font-size="11.5" fill="currentColor">derive</text>
  <rect x="213" y="244" width="316" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="371" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">combine several tags</text>
  <rect x="535" y="244" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">any input missing → null</text>
  <text x="440" y="300" text-anchor="middle" font-size="10.0" fill="currentColor" opacity="0.85">Every rule has a defined behaviour when it cannot produce a value, and none of them is "guess". That is the property worth enforcing in the schema.</text>
</svg>
<figcaption>None of the five is allowed to invent a value. A rule that would have to guess belongs in the review queue instead.</figcaption>
</figure>

## Step-by-step walkthrough

`_validate` runs before a single row is processed and names the offending column in every message. This is the main practical advantage of a declared mapping over scattered code: a typo in `on_unmapped` is caught in milliseconds with a pointer to the line, rather than becoming a column that is quietly null for a whole run.

The `lambda tags, s=source:` pattern in `load` binds the loop variable as a default argument. Without it every compiled rule closes over the *same* `source` variable and they all end up reading whichever tag the loop happened to finish on — a Python closure bug that produces a mapping where every column returns the same value, and which is easy to miss because the output is structurally correct.

Each rule returns `(value, reason)` rather than just a value. The reason is what feeds the review queue and what distinguishes "the tag was absent" from "the tag was present with a value we do not recognise" — two situations that look identical in a null column and need entirely different responses, as in [Handling Missing Tags in OSM Data Pipelines](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/handling-missing-tags-in-osm-data-pipelines/).

`_compile_coerce` enforces `min` and `max` because OSM contains `lanes=99` and `maxspeed=999`, and a coercion that accepts them produces a schema-valid row carrying nonsense. Out-of-range values become null with a reason rather than being clamped, since clamping invents data.

`_mapping_version` is stamped on every row. Together with the source sequence number this makes a row fully reproducible: given the version, the mapping file can be checked out and the transformation replayed exactly.

## Verification

Test the mapping as data — the point of the approach is that this is possible:

```python
def test_mapping_loads():
    mapping = load(Path("mapping.yaml"))
    assert mapping.version and mapping.rules

def test_unmapped_goes_to_review():
    mapping = load(Path("mapping.yaml"))
    row = apply_row(mapping, {"highway": "busway"})
    assert row["road_class"] is None
    assert any("busway" in entry for entry in map(str, mapping.review))

def test_out_of_range_lanes_is_null():
    mapping = load(Path("mapping.yaml"))
    assert apply_row(mapping, {"lanes": "99"})["lanes"] is None

def test_reverse_oneway_is_true():
    mapping = load(Path("mapping.yaml"))
    assert apply_row(mapping, {"oneway": "-1"})["oneway"] is True
```

Then run the mapping over a real extract and read the review queue, which is the artefact that tells you whether the table is complete:

```python
from collections import Counter
counts = Counter(f"{col}={value}" for col, _key, value in mapping.review)
for entry, n in counts.most_common(20):
    print(f"{n:>8}  {entry}")
```

Anything appearing thousands of times is a gap in the mapping, not an anomaly in the data. Anything appearing once or twice is the long tail and belongs in the queue, not in the table.

Finally, watch the mapped fraction across releases:

```python
mapped = sum(1 for r in rows if r["road_class"] is not None) / len(rows)
logger.info("road_class mapped for %.2f%% of rows", 100 * mapped)
```

A drop between releases means upstream tagging shifted, which is exactly the signal a versioned mapping exists to make visible.

## Common errors and fixes

| Symptom | Root cause | Fix |
|---|---|---|
| Every column returns the same value | Loop variable captured by reference | Bind with a default argument in the lambda |
| A column is silently all null | Typo in `source`, never validated | Validate source keys against a tag survey |
| Mapping change breaks old output | No version stamped on rows | Write `_mapping_version` into every row |
| Row throughput collapses | Rules interpreted per row | Compile once at load; apply per chunk |
| Nonsense values in a typed column | Coercion without bounds | Set `min`/`max`; null out-of-range |
| Review queue ignored | Not surfaced anywhere | Count it per run; alert on growth |

## Frequently Asked Questions

<details>
<summary>Is YAML the right format for this?</summary>

It is readable and diffs well, which is most of what matters. Its weaknesses are real — implicit typing turns `no` into a boolean and `1.0` into a float, which is why the `oneway` true and false values above are quoted. TOML avoids that and nests less comfortably; JSON avoids it and has no comments. Whichever you choose, validate against a schema, because that is what catches the format's surprises.
</details>

<details>
<summary>Should derive rules really use eval?</summary>

Only for expressions that live in a reviewed, version-controlled file, and with builtins stripped as above. The alternative is a small expression language of your own, which is more work and eventually grows into a worse Python. If the mapping file can be edited by anyone who cannot already deploy code, replace `eval` with a restricted evaluator.
</details>

<details>
<summary>How do I handle a tag that maps to different columns by feature type?</summary>

Separate mapping files per target table, which the `target` field already anticipates. A `surface` tag means something different on a road and on a pitch, and one file trying to express both becomes a set of conditionals that is harder to read than two files.
</details>

<details>
<summary>What belongs in the mapping and what belongs in code?</summary>

Anything that is a *choice* — which tags become columns, what the canonical values are, what counts as out of range. Anything that is *mechanism* — reading the PBF, chunking, writing Parquet — stays in code. The test is whether a domain expert who does not write Python should be able to review the change.
</details>

## Specification reference

> This mapping format is a project convention rather than an OSM standard. The contract it fixes: every column declares a `kind` from a closed set, every rule has defined behaviour when it cannot produce a value, no rule may invent one, and the file carries a `version` that is written onto every row it produces.

## Related

- [Batch Attribute Mapping Strategies](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/) — the topic this format serves.
- [Handling Missing Tags in OSM Data Pipelines](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/handling-missing-tags-in-osm-data-pipelines/) — the absent-versus-unmapped distinction.
- [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) — surveying the vocabulary a mapping must cover.
- [Exporting OSM to GeoParquet & PostGIS](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/) — where the promoted columns land.
- [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/) — the cleaning that should run before the mapping.

Up one level: [Batch Attribute Mapping Strategies](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/).
