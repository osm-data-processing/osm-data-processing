---
title: "Building Python-Based OSM Validation Rules"
description: "Build a small pluggable validation framework over pyosmium: a Rule dataclass with selector, predicate, severity, and message, plus a runner that streams a PBF and yields findings."
pageTitle: "Building a Pluggable Python OSM Validation Framework"
pageDescription: "Design a testable, extensible OSM validation framework over pyosmium with a Rule dataclass and a registry-driven runner that streams a PBF once and emits typed findings."
slug: building-python-based-osm-validation-rules
type: article
breadcrumb: "Python Validation Rules"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# Building Python-Based OSM Validation Rules

Build a tiny, extensible validation framework in Python — a `Rule` you declare once with a selector, a predicate, a severity, and a message — and a runner that streams a `.osm.pbf` a single time and yields a typed finding for every element that fails a rule.

## Prerequisites

Line these up first; a runner that emits nothing usually means the handler never streamed the file or no rule's selector matched.

- [ ] `osmium` (pyosmium) ≥ 3.6 installed (`pip install "osmium>=3.6"`) for the streaming file handler.
- [ ] Python 3.10+ for `dataclasses`, `typing.Protocol`, and the `X | None` union syntax used below.
- [ ] A local `.osm.pbf` extract to validate — a city or regional file is enough to exercise the framework.
- [ ] Familiarity with element tags and geometry from the [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) reference.
- [ ] The tag conventions your rules encode, drawn from [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/).
- [ ] `pytest` if you want to run the unit tests shown in the verification section.
- [ ] The rule-authoring context in [Authoring OSM Validation Rules](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/), so the framework slots into a wider QA strategy.

## Conceptual minimum

A validation framework earns its keep when adding a new check means writing one small object, not editing a monolith. The design here separates three concerns. A **selector** decides whether a rule applies to an element at all — usually a tag test such as "is this `amenity=fuel`?". A **predicate** decides whether an applicable element is *valid* — "does it have a `name`?". A **finding** is what the runner emits when an applicable element fails its predicate, carrying the element's identity, the rule's severity, and a human message. Bundling those into a single `Rule` dataclass makes every check a declarative value you can list, register, and unit-test in isolation, rather than a branch buried in a callback. This is the same separation the editor-time [JOSM validation preset](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/writing-custom-josm-validation-presets/) draws between a selector and its assertion, expressed in Python instead of MapCSS.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 272" role="img" aria-labelledby="pyrule-shape-t pyrule-shape-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="pyrule-shape-t">The interface that makes a Python rule composable</title>
  <desc id="pyrule-shape-d">Two panels. An ad-hoc check is a function that reads the object, prints or logs when something is wrong, and returns nothing, so it cannot be counted, tested in isolation, promoted or disabled without editing code. A rule object declares an identifier, a severity, an applies-to predicate and a check that yields findings, so the runner can count it, test it against fixtures, promote it through severities and switch it off by configuration.</desc>
  <rect x="0" y="0" width="880" height="272" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Yield findings, do not log them</text>
  <rect x="26" y="52" width="401" height="178" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="226" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Ad-hoc check</text>
  <text x="40" y="104" font-size="10.5" font-family="monospace" fill="currentColor" opacity="0.92">def check(obj): ...</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Logs or prints on failure</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Returns nothing</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Cannot be counted per rule</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Cannot be disabled without an edit</text>
  <text x="40" y="209" font-size="10.5" fill="currentColor" opacity="0.92">Cannot be unit-tested in isolation</text>
  <rect x="453" y="52" width="401" height="178" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="653" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Rule object</text>
  <text x="467" y="104" font-size="10.5" font-family="monospace" fill="currentColor" opacity="0.92">id`, `severity`, `applies_to`, `check</text>
  <text x="467" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Yields Finding(id, obj, detail)</text>
  <text x="467" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Runner counts, routes and thresholds</text>
  <text x="467" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Severity changed by configuration</text>
  <text x="467" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Disabled by configuration</text>
  <text x="467" y="209" font-size="10.5" fill="currentColor" opacity="0.92">Tested against a fixture corpus</text>
  <text x="440" y="256" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">The runner then gets everything else for free: shadow mode, per-rule false-positive rates, and a report grouped by rule rather than by log line.</text>
</svg>
<figcaption>The difference is not style. A rule that yields findings can be counted, promoted and disabled by a runner; one that logs can only be edited.</figcaption>
</figure>

The runner is a pyosmium `SimpleHandler`. pyosmium streams a PBF element by element in a single pass — nodes, then ways, then relations — invoking a callback per type, so the whole file is never resident in memory. The runner holds a registry: a list of rules grouped by which element types they care about. For each element the stream delivers, the runner dispatches only the rules whose selector accepts that element, runs each predicate, and yields a finding for every failure. Because dispatch is data-driven off the registry, adding a check is appending a `Rule` to a list; the runner code never changes. That is what makes the framework both extensible and testable — each rule is a pure pair of functions over an element, verifiable without touching a PBF at all. The diagram traces one element through the registry dispatch.

<svg viewBox="0 0 960 340" role="img" aria-label="Registry-driven rule dispatch over a streamed feature. A pyosmium handler streams one element at a time from a PBF. The element enters a rule registry that holds several Rule objects, each pairing a selector with a predicate, a severity, and a message. The registry applies only the rules whose selector accepts the element: a fuel-without-name rule, a highway-without-surface rule, and a deprecated-tag rule are shown. Rules whose selector rejects the element are skipped. For each applicable rule whose predicate fails, the runner yields a finding carrying the element type and id, the severity, and the message. Passing elements yield nothing." xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>Registry-driven rule dispatch over a streamed OSM element</title>
  <desc>A pyosmium handler streams one element at a time into a rule registry of Rule objects; only rules whose selector accepts the element run their predicate, and each failure yields a finding with element id, severity, and message.</desc>
  <defs>
    <marker id="pyvalArrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <rect x="0" y="0" width="960" height="340" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <g fill="currentColor" text-anchor="middle">
    <!-- PBF stream -->
    <rect x="24" y="130" width="150" height="76" rx="6" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-width="1.5"/>
    <text x="99" y="158" font-size="12.5">pyosmium</text>
    <text x="99" y="176" font-size="10" opacity="0.8">streams PBF</text>
    <text x="99" y="192" font-size="9.5" opacity="0.7">one element</text>
    <line x1="174" y1="168" x2="236" y2="168" stroke="currentColor" stroke-width="1.5" marker-end="url(#pyvalArrow)"/>
    <!-- registry -->
    <rect x="238" y="60" width="220" height="220" rx="6" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.5"/>
    <text x="348" y="84" font-size="12.5">rule registry</text>
    <text x="348" y="100" font-size="9.5" opacity="0.7">selector · predicate</text>
    <!-- three rules -->
    <rect x="256" y="112" width="184" height="44" rx="5" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-width="1.2"/>
    <text x="348" y="130" font-size="10.5">fuel → has name?</text>
    <text x="348" y="146" font-size="9" opacity="0.75">selector matches</text>
    <rect x="256" y="164" width="184" height="44" rx="5" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-width="1.2"/>
    <text x="348" y="182" font-size="10.5">highway → surface?</text>
    <text x="348" y="198" font-size="9" opacity="0.75">selector skips</text>
    <rect x="256" y="216" width="184" height="44" rx="5" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-width="1.2"/>
    <text x="348" y="234" font-size="10.5">deprecated tag?</text>
    <text x="348" y="250" font-size="9" opacity="0.75">selector skips</text>
    <!-- dispatch to predicate -->
    <line x1="458" y1="134" x2="520" y2="134" stroke="currentColor" stroke-width="1.5" marker-end="url(#pyvalArrow)"/>
    <text x="489" y="124" font-size="9" opacity="0.7">run</text>
    <!-- predicate eval -->
    <rect x="522" y="108" width="176" height="56" rx="6" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-width="1.5"/>
    <text x="610" y="132" font-size="12">predicate fails</text>
    <text x="610" y="150" font-size="9.5" opacity="0.8">no name present</text>
    <line x1="698" y1="136" x2="760" y2="136" stroke="currentColor" stroke-width="1.5" marker-end="url(#pyvalArrow)"/>
    <text x="729" y="126" font-size="9" opacity="0.7">yield</text>
    <!-- finding -->
    <rect x="762" y="96" width="176" height="84" rx="6" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.5"/>
    <text x="850" y="120" font-size="12">finding</text>
    <text x="850" y="140" font-size="9.5" opacity="0.8">N/123 · warning</text>
    <text x="850" y="156" font-size="9.5" opacity="0.8">"fuel has no name"</text>
    <text x="850" y="172" font-size="9" opacity="0.7">severity + message</text>
    <text x="580" y="300" font-size="10" opacity="0.75">Selectors that reject the element are skipped; only a failing predicate produces a finding.</text>
  </g>
</svg>

## Runnable solution

Save as `osm_validation.py`. It defines the `Rule` dataclass, a small selector/predicate vocabulary, a registry, and a pyosmium-backed runner that yields findings.

```python
from __future__ import annotations

import logging
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from enum import Enum

import osmium

logger = logging.getLogger("osm.validation")

# A read-only view of the element the selector and predicate operate on.
# We snapshot tags and identity so rules stay pure and unit-testable.
@dataclass(frozen=True)
class Element:
    kind: str            # "node" | "way" | "relation"
    id: int
    tags: dict[str, str]
    is_closed: bool = False


class Severity(Enum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


Selector = Callable[[Element], bool]
Predicate = Callable[[Element], bool]


@dataclass(frozen=True)
class Rule:
    """One pluggable check: applies where `selector` is true, passes where `predicate` is true."""
    code: str
    kinds: frozenset[str]          # which element types this rule inspects
    selector: Selector             # does the rule apply to this element?
    predicate: Predicate           # is an applicable element valid?
    severity: Severity
    message: str


@dataclass(frozen=True)
class Finding:
    code: str
    kind: str
    id: int
    severity: Severity
    message: str


# ---- selector / predicate helpers (composable, testable in isolation) ----
def tag_equals(key: str, value: str) -> Selector:
    return lambda e: e.tags.get(key) == value


def has_tag(key: str) -> Predicate:
    return lambda e: key in e.tags


def lacks_tag(key: str) -> Predicate:
    return lambda e: key not in e.tags


# ---- an example rule registry: append a Rule to extend the framework ----
REGISTRY: list[Rule] = [
    Rule(
        code="fuel-without-name",
        kinds=frozenset({"node", "way"}),
        selector=tag_equals("amenity", "fuel"),
        predicate=has_tag("name"),
        severity=Severity.WARNING,
        message="amenity=fuel has no name",
    ),
    Rule(
        code="highway-without-surface",
        kinds=frozenset({"way"}),
        selector=lambda e: "highway" in e.tags and e.is_closed is False,
        predicate=has_tag("surface"),
        severity=Severity.INFO,
        message="highway way has no surface tag",
    ),
]


class ValidationHandler(osmium.SimpleHandler):
    """Stream a PBF once and collect findings from every registered rule."""

    def __init__(self, rules: list[Rule]) -> None:
        super().__init__()
        self.rules = rules
        self.findings: list[Finding] = []

    def _check(self, el: Element) -> None:
        for rule in self.rules:
            if el.kind not in rule.kinds:
                continue
            if not rule.selector(el):
                continue
            if not rule.predicate(el):
                self.findings.append(
                    Finding(rule.code, el.kind, el.id, rule.severity, rule.message)
                )

    def node(self, n: osmium.osm.Node) -> None:
        self._check(Element("node", n.id, dict(n.tags)))

    def way(self, w: osmium.osm.Way) -> None:
        self._check(Element("way", w.id, dict(w.tags), is_closed=w.is_closed()))

    def relation(self, r: osmium.osm.Relation) -> None:
        self._check(Element("relation", r.id, dict(r.tags)))


def validate(path: str, rules: list[Rule] = REGISTRY) -> Iterator[Finding]:
    """Run every rule over the extract and yield findings."""
    handler = ValidationHandler(rules)
    handler.apply_file(path)
    logger.info("validation complete: %d findings", len(handler.findings))
    yield from handler.findings


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    for f in validate("extract.osm.pbf"):
        logger.info("%s %s/%d: %s", f.severity.value, f.kind, f.id, f.message)
```

## Step-by-step walkthrough

1. **The `Element` snapshot.** Rules operate on a frozen `Element` — a copy of the tags plus identity — not on the live pyosmium object. pyosmium reuses its C buffers across callbacks, so snapshotting into a `dict` keeps rules pure and lets you construct test elements by hand.
2. **`Rule` as data.** The frozen dataclass makes a check a value: `code`, the element `kinds` it inspects, a `selector`, a `predicate`, a `severity`, and a `message`. Nothing about a rule references the runner, so rules are portable and unit-testable.
3. **Selector versus predicate.** The split is deliberate: the selector answers "does this rule apply?" and the predicate answers "is the applicable element valid?". Only an element that the selector accepts *and* the predicate rejects becomes a finding.
4. **Composable helpers.** `tag_equals`, `has_tag`, and `lacks_tag` are small closures that return selectors or predicates, so most rules read declaratively without a bespoke lambda; complex rules can still pass an inline `lambda` as the `highway-without-surface` rule does.
5. **The registry.** `REGISTRY` is a plain list. Extending the framework is appending a `Rule` — the runner never changes, which is the extensibility guarantee. Grouping by `kinds` lets the dispatcher skip whole rules before evaluating any selector.
6. **Single-pass dispatch.** `_check` runs once per element and iterates the rules, short-circuiting on `kinds` then `selector` so most rules cost a dictionary membership test. A failing predicate appends a `Finding`; a passing one yields nothing.
7. **One stream, all types.** `apply_file` drives the `node`, `way`, and `relation` callbacks in a single sequential pass, so validating a whole extract costs one read of the file regardless of how many rules the registry holds.
8. **`validate` as a generator.** Returning an iterator of findings lets callers stream results into a report, a CSV, or the quarantine discipline from [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) without buffering everything twice.

## Verification

Confirm the framework behaves before trusting its findings:

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="pyrule-fixture-t pyrule-fixture-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="pyrule-fixture-t">The fixture corpus a rule needs before it can be trusted</title>
  <desc id="pyrule-fixture-d">A left-to-right chain of four fixture categories every rule should be tested against. True positives are objects that genuinely have the defect and must be flagged. True negatives are clean objects that must not be flagged. Known-tricky negatives are legitimately unusual objects that naive rules flag, and are the ones that predict the false-positive rate. Regression cases are real objects the rule got wrong once, kept forever so the fix cannot be undone.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="pfx" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four fixture categories — the third is what predicts the false-positive rate</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">true positives</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">really defective</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">must be flagged</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#pfx)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">true negatives</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">plainly clean</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">must not be flagged</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#pfx)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">tricky negatives</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">legitimately unusual</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">naive rules flag these</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#pfx)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">regressions</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">got it wrong once</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">kept forever</text>
  <text x="440" y="158" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Every false positive a shadow run surfaces should end the day as a tricky negative in the corpus, whether or not the rule changes.</text>
</svg>
<figcaption>The third category is the one that distinguishes a rule that works on your test file from one that survives contact with the planet. Collect these from the false positives your shadow run reports.</figcaption>
</figure>

- **Unit-test a rule with no PBF.** Build an `Element` by hand and assert the rule's outcome, e.g. `Element("node", 1, {"amenity": "fuel"})` should produce a `fuel-without-name` finding while `{"amenity": "fuel", "name": "X"}` should not.
- **Count against a known extract.** Run `validate` on a small file and compare the finding count for one `code` to a manual `osmium tags-filter` count of the same condition.
- **Selector isolation.** Confirm that an element the selector rejects yields nothing regardless of the predicate — pass a `highway=primary` way to the fuel rule and expect zero findings.
- **Severity fidelity.** Assert each `Finding.severity` equals its rule's declared severity, so downstream filtering by `Severity.ERROR` is reliable.
- **Single-pass proof.** Log element counts in each callback and confirm the file is read once; a second `apply_file` call would double them.

```python
def test_fuel_without_name():
    rule = next(r for r in REGISTRY if r.code == "fuel-without-name")
    missing = Element("node", 1, {"amenity": "fuel"})
    named = Element("node", 2, {"amenity": "fuel", "name": "Example"})
    assert rule.selector(missing) and not rule.predicate(missing)
    assert rule.selector(named) and rule.predicate(named)
```

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Runner yields nothing | `apply_file` never called or wrong path | Confirm the path and that `validate` invokes `apply_file`. |
| `RuntimeError` reading tags after callback | Held the live pyosmium object past the callback | Snapshot tags with `dict(el.tags)` into an `Element`. |
| Rule never fires | Selector too strict or wrong `kinds` set | Loosen the selector and include the right element type. |
| Every element flagged | Predicate and selector logic swapped | Selector = applies-to; predicate = is-valid. |
| Memory climbs on planet file | Findings list grows unbounded | Stream findings to disk instead of holding all in RAM. |
| Closed way misclassified | `is_closed` not passed from the way callback | Pass `w.is_closed()` when building the `Element`. |
| Duplicate findings per element | Same rule registered twice | De-duplicate `REGISTRY` by `code` at load. |

For rules that must also run server-side over a whole database, express the same conditions as an [Osmose backend analyser](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/authoring-osmose-rule-dsl-checks/) so a scheduled QA run catches what edits miss.

## Specification reference

> pyosmium exposes OSM data through a `SimpleHandler` whose `node`, `way`, and `relation` methods are invoked once per element during a single streaming pass of `apply_file`; element objects and their tag collections are only valid inside the callback, so any data a rule needs must be copied out. See the [pyosmium documentation](https://docs.osmcode.org/pyosmium/latest/) and its [handler and reader manual](https://docs.osmcode.org/pyosmium/latest/user_manual.html) for the handler contract, buffer-lifetime rules, and the location-store options for geometry-aware checks.

## Frequently Asked Questions

<details>
<summary>Why separate the selector from the predicate instead of one function?</summary>

The split keeps the two questions a check really asks apart: "does this rule apply to this element?" and "is an applicable element valid?". Keeping them separate makes findings precise — you only flag elements the rule was meant to judge — and it makes rules composable, since selectors and predicates can be reused across checks. A single combined function tends to conflate "not applicable" with "valid", which hides real failures.
</details>

<details>
<summary>How do I add a new validation rule?</summary>

Append one `Rule` to the registry list. Give it a code, the element kinds it inspects, a selector that decides applicability, a predicate that decides validity, a severity, and a message. The runner needs no changes because dispatch is driven off the registry. For anything the built-in helpers cannot express, pass an inline lambda as the selector or predicate; it receives the frozen `Element` and returns a bool.
</details>

<details>
<summary>Why copy tags into a frozen Element rather than use the pyosmium object?</summary>

pyosmium reuses its underlying C buffers between callbacks for speed, so the element and tag objects it hands you are only valid inside that single callback. Copying tags into a plain dict on a frozen dataclass decouples rules from that lifetime, prevents a class of use-after-free style bugs, and lets you construct test elements in memory without ever opening a PBF, which is what makes each rule unit-testable.
</details>

<details>
<summary>Can this framework validate geometry, not just tags?</summary>

Yes, with one addition. Enable pyosmium's location store on `apply_file` so way callbacks can resolve node coordinates, then build the geometry inside the callback and hand it to a geometry-aware predicate. The rule structure is unchanged — selector, predicate, severity, message — only the predicate now inspects a shape instead of tags, which is how self-intersection or unclosed-ring checks slot into the same registry.
</details>

## Related

- [Authoring OSM Validation Rules](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/) — the section this Python framework belongs to.
- [Authoring Osmose Rule DSL Checks](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/authoring-osmose-rule-dsl-checks/) — the database-backed analyser for scheduled, whole-region runs.
- [Writing Custom JOSM Validation Presets](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/writing-custom-josm-validation-presets/) — the editor-time expression of the same checks.
- [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) — the vocabulary the selectors and predicates encode.
- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — the quarantine discipline that consumes streamed findings.
- [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/) — the surrounding quality-assurance section.

Up one level: [Authoring OSM Validation Rules](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Building Python-Based OSM Validation Rules",
  "description": "Build a small pluggable validation framework over pyosmium: a Rule dataclass with selector, predicate, severity, and message, plus a runner that streams a PBF and yields findings.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "OSM Data Quality & Validation",
  "about": ["pyosmium validation framework", "pluggable rule engine", "OSM data quality checks"]
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
    { "@type": "ListItem", "position": 4, "name": "Python Validation Rules", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/building-python-based-osm-validation-rules/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Build a pluggable Python OSM validation framework",
  "description": "Design a Rule dataclass with selector, predicate, severity, and message, register rules in a list, and run a pyosmium handler that streams a PBF once and yields a finding per failure.",
  "step": [
    { "@type": "HowToStep", "name": "Define the Rule and Finding dataclasses", "text": "Model a check as a frozen Rule with a code, element kinds, a selector, a predicate, a severity, and a message, and model a failure as a Finding." },
    { "@type": "HowToStep", "name": "Register rules in a list", "text": "Append Rule instances to a registry so adding a check needs no runner changes; group each rule by the element kinds it inspects." },
    { "@type": "HowToStep", "name": "Stream the PBF with a SimpleHandler", "text": "Snapshot each element's tags into a frozen Element and dispatch only the rules whose kinds and selector accept it, appending a finding on predicate failure." },
    { "@type": "HowToStep", "name": "Yield and test findings", "text": "Expose validate as a generator of findings and unit-test each rule by constructing Element instances in memory without opening a PBF." }
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
      "name": "Why separate the selector from the predicate instead of one function?",
      "acceptedAnswer": { "@type": "Answer", "text": "The split keeps the two questions a check really asks apart: does this rule apply to this element, and is an applicable element valid. Keeping them separate makes findings precise because you only flag elements the rule was meant to judge, and it makes rules composable since selectors and predicates can be reused across checks. A single combined function tends to conflate not-applicable with valid, which hides real failures." }
    },
    {
      "@type": "Question",
      "name": "How do I add a new validation rule?",
      "acceptedAnswer": { "@type": "Answer", "text": "Append one Rule to the registry list. Give it a code, the element kinds it inspects, a selector that decides applicability, a predicate that decides validity, a severity, and a message. The runner needs no changes because dispatch is driven off the registry. For anything the built-in helpers cannot express, pass an inline lambda as the selector or predicate; it receives the frozen Element and returns a bool." }
    },
    {
      "@type": "Question",
      "name": "Why copy tags into a frozen Element rather than use the pyosmium object?",
      "acceptedAnswer": { "@type": "Answer", "text": "pyosmium reuses its underlying C buffers between callbacks for speed, so the element and tag objects it hands you are only valid inside that single callback. Copying tags into a plain dict on a frozen dataclass decouples rules from that lifetime, prevents a class of use-after-free style bugs, and lets you construct test elements in memory without ever opening a PBF, which is what makes each rule unit-testable." }
    },
    {
      "@type": "Question",
      "name": "Can this framework validate geometry, not just tags?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes, with one addition. Enable pyosmium's location store on apply_file so way callbacks can resolve node coordinates, then build the geometry inside the callback and hand it to a geometry-aware predicate. The rule structure is unchanged, selector, predicate, severity, message; only the predicate now inspects a shape instead of tags, which is how self-intersection or unclosed-ring checks slot into the same registry." }
    }
  ]
}
</script>
