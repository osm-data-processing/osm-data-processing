---
title: "Authoring OSM Validation Rules"
description: "Write portable OSM validation rules across JOSM, Osmose, and Python: a unified selector-predicate-severity-message model, a runnable Python rule-engine skeleton, pipeline-scale execution, and false-positive management."
pageTitle: "Authoring OSM Validation Rules Across JOSM, Osmose & Python"
pageDescription: "Author OpenStreetMap validation rules once and map them to JOSM MapCSS tests, Osmose analysers, and pyosmium/geopandas Python checks, with a runnable rule-engine skeleton and false-positive control."
slug: authoring-osm-validation-rules
type: guide
breadcrumb: "Authoring Validation Rules"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# Authoring OSM Validation Rules

Picture the on-call page nobody wants: a routing product starts sending drivers down a footpath because a contributor retagged a service road, and the defect sailed through ingestion because no rule in your pipeline knew that `highway=footway` should never carry car traffic. The fix is not a heroic patch; it is a validation rule you should have authored months earlier. Authoring rules is the craft at the centre of the [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/) layer — turning "we should check for that" into a durable, testable predicate that runs on every extract. The difficulty is that OSM has three different rule ecosystems, each with its own language and runtime, and teams waste enormous effort porting a check from one to another because they never separated the *intent* of a rule from its *expression*. This guide fixes that by grounding every ecosystem in one portable rule model and giving you a Python engine that runs it at pipeline scale.

<svg viewBox="0 0 1000 344" role="img" aria-labelledby="aov-title aov-desc" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:1000px;display:block;margin:1.5rem auto;font-family:inherit;">
  <title id="aov-title">One unified rule model dispatched across three OSM validation engines</title>
  <desc id="aov-desc">On the left, a unified rule model box lists four slots: selector, predicate, severity, and message. An arrow fans the single model out to three engine boxes on the right: the JOSM validator running MapCSS tests at edit time, the Osmose analyser running the rule DSL on a schedule, and Python rules running pyosmium and geopandas checks inside the pipeline. All three engines converge on a single issue report emitted as normalized findings.</desc>
  <defs>
    <marker id="aov-arr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker>
  </defs>
  <text x="500" y="22" text-anchor="middle" font-size="15" fill="currentColor" font-weight="700">Author the intent once, express it in three engines</text>
  <!-- rule model -->
  <rect x="28" y="104" width="196" height="150" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="126" y="128" text-anchor="middle" font-size="13" fill="currentColor" font-weight="700">Unified rule model</text>
  <line x1="44" y1="138" x2="208" y2="138" stroke="currentColor" stroke-width="1" opacity="0.35"/>
  <text x="46" y="162" font-size="12" fill="currentColor">selector</text>
  <text x="46" y="186" font-size="12" fill="currentColor">predicate</text>
  <text x="46" y="210" font-size="12" fill="currentColor">severity</text>
  <text x="46" y="234" font-size="12" fill="currentColor">message · fix-hint</text>
  <!-- fan bus -->
  <line x1="224" y1="179" x2="272" y2="179" stroke="currentColor" stroke-width="1.5"/>
  <line x1="272" y1="62" x2="272" y2="288" stroke="currentColor" stroke-width="1.5"/>
  <!-- JOSM -->
  <line x1="272" y1="62" x2="404" y2="62" stroke="currentColor" stroke-width="1.5" marker-end="url(#aov-arr)"/>
  <rect x="406" y="36" width="268" height="52" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="422" y="60" font-size="12.5" text-anchor="start" fill="currentColor" font-weight="600">JOSM validator</text>
  <text x="422" y="78" font-size="10" text-anchor="start" fill="currentColor" opacity="0.8">MapCSS tests · edit time</text>
  <!-- Osmose -->
  <line x1="272" y1="179" x2="404" y2="179" stroke="currentColor" stroke-width="1.5" marker-end="url(#aov-arr)"/>
  <rect x="406" y="153" width="268" height="52" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="422" y="177" font-size="12.5" text-anchor="start" fill="currentColor" font-weight="600">Osmose analyser</text>
  <text x="422" y="195" font-size="10" text-anchor="start" fill="currentColor" opacity="0.8">rule DSL · scheduled scan</text>
  <!-- Python -->
  <line x1="272" y1="288" x2="404" y2="288" stroke="currentColor" stroke-width="1.5" marker-end="url(#aov-arr)"/>
  <rect x="406" y="262" width="268" height="52" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="422" y="286" font-size="12.5" text-anchor="start" fill="currentColor" font-weight="600">Python rules</text>
  <text x="422" y="304" font-size="10" text-anchor="start" fill="currentColor" opacity="0.8">pyosmium · geopandas · pipeline</text>
  <!-- converge -->
  <line x1="674" y1="62" x2="726" y2="62" stroke="currentColor" stroke-width="1.5"/>
  <line x1="674" y1="179" x2="726" y2="179" stroke="currentColor" stroke-width="1.5"/>
  <line x1="674" y1="288" x2="726" y2="288" stroke="currentColor" stroke-width="1.5"/>
  <line x1="726" y1="62" x2="726" y2="288" stroke="currentColor" stroke-width="1.5"/>
  <line x1="726" y1="175" x2="778" y2="175" stroke="currentColor" stroke-width="1.5" marker-end="url(#aov-arr)"/>
  <rect x="780" y="140" width="192" height="72" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="876" y="170" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="600">Issue report</text>
  <text x="876" y="190" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">normalized findings</text>
</svg>

## Prerequisites

Before authoring rules, three foundations should be in place. First, read the parent [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/) overview for the severity taxonomy and quarantine policy this guide assumes — rules produce findings, and findings only mean something inside that framework. Second, be comfortable with the [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) reference, because most selectors and many predicates are expressed in terms of keys and their expected value domains. Third, your input must already be parsed and normalized: validating raw, un-normalized tags floods every rule with false positives from casing and whitespace variants, so the normalization stage runs first and the checks here run on its output.

## The Unified Rule Model

Every rule this guide authors, in any engine, is the same four-slot record. Naming the slots explicitly is what makes a rule portable rather than trapped in the tool it was first written for.

| Slot | Role | JOSM expression | Osmose expression | Python expression |
| --- | --- | --- | --- | --- |
| Selector | Narrow the stream to relevant features | MapCSS selector (`way[highway]`) | SQL / tag filter in the analyser | tag/type test in the handler |
| Predicate | Boolean test on each selected feature | `set` / assertion clause | parameterised check | a callable returning pass/fail |
| Severity | Consequence class of a failing predicate | `throwError` / `throwWarning` | `level` 1–3 | a `Severity` enum value |
| Message | Human-readable finding + fix-hint | MapCSS `throwWarning: tr(...)` | localised class title | a formatted string |

Two design rules apply regardless of engine. The selector must be **cheap and specific** — a fast tag or geometry-type test that discards the vast majority of features before any expensive predicate runs, because a loose selector that admits every node to an intersection test will dominate your runtime for no benefit. The predicate must be **pure and total** — it returns a verdict for every input including the awkward ones (missing tag, empty geometry, `<NA>` value) rather than throwing, so one malformed feature never aborts the run. A rule that raises on unexpected input is a latent pipeline outage.

## The Three Engines Compared

Each ecosystem occupies a different point in the data's lifecycle, and knowing which to reach for is half of authoring well.

- **JOSM validator (MapCSS).** Runs inside the editor at authoring time, so its rules *prevent* defects before a changeset is ever uploaded. You express checks as MapCSS selectors with `throwError`/`throwWarning` actions, and validator presets constrain the allowed values for a key. This is the right home for rules that a mapper can and should fix on the spot — crossing ways, an unclosed `building`, a nonsensical value. The full authoring workflow is in [Writing Custom JOSM Validation Presets](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/writing-custom-josm-validation-presets/).
- **Osmose rule DSL.** Runs server-side on a schedule over whole countries, so its rules *surface* the community's standing backlog on a map. Analysers are configured as parameterised checks with stable item and class numbers, per-class severity levels, and localised titles. Because Osmose has been run against the planet for years, its rule catalogue is an inventory of real, recurring defect patterns worth mirroring; [Authoring Osmose Rule DSL Checks](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/authoring-osmose-rule-dsl-checks/) covers its analyser structure and output format.
- **Python custom rules.** Run inside your ETL over [pyosmium](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/) handlers or a `geopandas` frame, so they *enforce* the contract your specific consumers depend on. This is where domain rules live — gazetteer cross-checks, region-specific tagging policy, invariants no general tool could know. It is also the only layer you fully control end to end, which is why it is the backstop for anything the first two miss. [Building Python-Based OSM Validation Rules](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/building-python-based-osm-validation-rules/) develops production versions of the skeleton below.

The practical workflow is to prototype a rule's *intent* against your data in Python, where iteration is fastest and you have a debugger, then decide whether it also belongs upstream in JOSM (to prevent the defect) or in an Osmose-style scan (to crowd-source the fix). The intent — the four slots — is identical; only the expression changes.

## Step-by-Step: A Runnable Python Rule Engine

The following skeleton turns the unified model into working code. A `Rule` bundles a selector, a predicate, a severity, and a message template; a `RuleEngine` dispatches every feature through the rules whose selector matches and collects `ValidationIssue` findings. It uses Python 3.10+ type hints and the project logger pattern, and it is deliberately engine-agnostic so a rule authored here reads the same whether its logic mirrors a JOSM test or an Osmose check.

1. **Model a feature uniformly.** Wrap each parsed element in a lightweight view exposing `osm_type`, `osm_id`, `tags`, and an optional reconstructed `geometry`, so selectors and predicates never touch pyosmium internals directly and the same rules run over a `geopandas` frame.
2. **Author each rule as data.** A `Rule` is a selector callable, a predicate callable, a severity, and a message template — no control flow, so rules are trivially unit-tested in isolation.
3. **Dispatch through the engine.** For each feature, run only the rules whose selector matches, evaluate the predicate, and on failure emit a finding; wrap each predicate so an unexpected exception becomes a logged internal error rather than a crashed run.
4. **Collect and hand off.** Return a list of `ValidationIssue` records for the reporting and quarantine path defined in the parent section.

```python
from __future__ import annotations

import logging
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from enum import Enum

logger = logging.getLogger(__name__)


class Severity(str, Enum):
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


@dataclass(slots=True)
class Feature:
    """Engine-agnostic view of one OSM element."""

    osm_type: str
    osm_id: int
    tags: dict[str, str]
    geometry: object | None = None  # a shapely geometry once reconstructed


@dataclass(slots=True)
class Issue:
    osm_type: str
    osm_id: int
    rule_id: str
    severity: Severity
    message: str


# A selector answers "does this rule apply?"; a predicate answers "is it valid?".
Selector = Callable[[Feature], bool]
Predicate = Callable[[Feature], bool]


@dataclass(slots=True)
class Rule:
    """The unified rule model: selector, predicate, severity, message."""

    rule_id: str
    selector: Selector
    predicate: Predicate           # returns True when the feature is VALID
    severity: Severity
    message: str                   # may reference {id}

    def check(self, feature: Feature) -> Issue | None:
        if not self.selector(feature):
            return None            # rule does not apply to this feature
        try:
            ok = self.predicate(feature)
        except Exception as exc:   # a bad feature must never abort the run
            logger.error("rule %s raised on %s/%s: %s",
                         self.rule_id, feature.osm_type, feature.osm_id, exc)
            return None
        if ok:
            return None
        return Issue(
            osm_type=feature.osm_type,
            osm_id=feature.osm_id,
            rule_id=self.rule_id,
            severity=self.severity,
            message=self.message.format(id=feature.osm_id),
        )


@dataclass(slots=True)
class RuleEngine:
    rules: list[Rule] = field(default_factory=list)

    def run(self, features: Iterable[Feature]) -> list[Issue]:
        issues: list[Issue] = []
        checked = 0
        for feature in features:
            checked += 1
            for rule in self.rules:
                issue = rule.check(feature)
                if issue is not None:
                    issues.append(issue)
        logger.info("checked %d features, %d issues found", checked, len(issues))
        return issues


# --- Authoring three rules against the shared model ---------------------------

VALID_ONEWAY = {"yes", "no", "-1", "reversible", "alternating"}


def _has(key: str) -> Selector:
    return lambda f: key in f.tags


engine = RuleEngine(rules=[
    Rule(
        rule_id="tag.oneway_domain",
        selector=_has("oneway"),
        predicate=lambda f: f.tags["oneway"] in VALID_ONEWAY,
        severity=Severity.WARNING,
        message="way {id}: oneway has an unrecognised value",
    ),
    Rule(
        rule_id="tag.maxspeed_numeric",
        selector=_has("maxspeed"),
        predicate=lambda f: f.tags["maxspeed"].split()[0].isdigit()
                            or f.tags["maxspeed"] in {"none", "walk"},
        severity=Severity.WARNING,
        message="way {id}: maxspeed does not parse as a speed",
    ),
    Rule(
        rule_id="tag.addr_needs_street",
        selector=_has("addr:housenumber"),
        predicate=lambda f: "addr:street" in f.tags,
        severity=Severity.INFO,
        message="feature {id}: addr:housenumber without addr:street",
    ),
])
```

Feeding this engine a stream of `Feature` objects — built from a pyosmium handler for planet-scale streaming, or from `GeoDataFrame.itertuples()` for a regional frame — yields a flat list of findings ready for the report and quarantine path. Because a `Rule` is pure data plus two callables, each one is unit-tested by constructing a single `Feature` and asserting the returned `Issue`, which is how a rule catalogue stays trustworthy as it grows to hundreds of entries.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Author a portable OSM validation rule and run it at scale",
  "description": "Express an OpenStreetMap validation check as a selector, predicate, severity, and message, then run it over an extract with a Python rule engine that quarantines rather than aborts.",
  "step": [
    { "@type": "HowToStep", "name": "Wrap features uniformly", "text": "Expose each parsed element as an engine-agnostic view with osm_type, osm_id, tags, and an optional reconstructed geometry so rules never touch parser internals." },
    { "@type": "HowToStep", "name": "Write the rule as data", "text": "Bundle a cheap selector callable, a pure predicate callable that returns True when valid, a severity, and a message template into a Rule record with no control flow." },
    { "@type": "HowToStep", "name": "Guard the predicate", "text": "Run the predicate inside a try/except so an unexpected input logs an internal error and skips rather than aborting the whole validation run." },
    { "@type": "HowToStep", "name": "Dispatch through the engine", "text": "For each feature, evaluate only the rules whose selector matches, emit an Issue on a failing predicate, and collect the findings into a list." },
    { "@type": "HowToStep", "name": "Hand findings to reporting", "text": "Return the Issue list to the shared report and quarantine path, keyed on element type, id, and rule id so findings de-duplicate and diff across runs." }
  ]
}
</script>

## Running Rules at Pipeline Scale

A rule catalogue that runs in seconds on a city extract can take hours on a continent if it is applied naively, and the fix is structural rather than a matter of faster hardware. Three levers dominate.

First, **evaluate selectors before predicates and cheapest-first within a rule**. The engine above already short-circuits on the selector; go further by ordering a compound predicate so the tag test that rejects 99% of candidates runs before the geometry test. Second, **index once, reuse everywhere**. Rules that need spatial neighbours — near-miss junctions, features crossing a boundary — should share a single R-tree built once per batch, following the pattern in the fundamentals layer, rather than each rebuilding its own. Third, **partition on PBF blocks, not rules**. Because blocks are independent, you parallelise by feeding disjoint geographic partitions to separate `RuleEngine` workers and merging their findings, keeping memory bounded the same way the [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) stage does; rules that need global context (connected components over the whole graph) run in a dedicated non-partitioned pass.

The measurement that matters is per-rule cost. Instrument the engine to record how long each `rule_id` spends and how many features it touched, and the expensive outliers — almost always a rule with a loose selector or a redundant geometry rebuild — reveal themselves immediately.

## Validation & Error-Handling Matrix

Authoring rules has its own failure modes, distinct from the defects the rules detect. Each row is a real problem seen when building a rule catalogue.

| Error condition | Root cause | Detection | Fix |
| --- | --- | --- | --- |
| Rule matches nothing | Selector typo or wrong key case | Zero findings *and* zero features selected | Assert selector hit-count in a unit test against known data |
| Rule flags everything | Predicate inverted (returns True on invalid) | Finding count ≈ selected count | Predicate must return True when the feature is VALID |
| Run aborts mid-batch | Predicate raises on a missing tag or null geom | Traceback, not an Issue | Guard with try/except; make predicates total |
| Runtime explodes | Loose selector admits every feature to a costly test | Per-rule timing outlier | Tighten the selector to a cheap tag/type test first |
| Duplicate findings | Same defect emitted by two overlapping rules | Identical (type, id) at different rule_ids | Consolidate rules or de-duplicate on the issue key |
| False positives on casing | Rules run before normalization | Findings vanish after normalizing input | Order validation after the normalization stage |
| Non-reproducible report | Findings ordered by nondeterministic iteration | Diff of two runs reorders rows | Sort findings by (type, id, rule_id) before emitting |

## Failure Modes & Gotchas

- **Predicate polarity.** By convention here a predicate returns `True` for a *valid* feature, so a finding is emitted when it returns `False`. Mixing this with a "return True if broken" helper is the single most common authoring bug and it silently inverts a whole rule.
- **Selectors on missing keys.** `f.tags["oneway"]` raises `KeyError` if the selector let a feature through without the key; always gate the predicate behind a selector that guarantees the key, or use `.get`.
- **Unit-carrying values.** `maxspeed`, `width`, and `maxheight` may carry units (`30 mph`, `3.5 m`); a naive `isdigit()` predicate flags every legitimate unit-qualified value. Parse the numeric head and validate the unit against an allow-list.
- **Locale and script.** Name and value predicates that assume ASCII flag perfectly valid non-Latin data. Rules over `name:*` must be script-aware or scoped to a specific language key.
- **Severity drift.** Copying a rule and forgetting to reset its severity is how an informational nudge becomes an error that quarantines valid features. Review severity whenever you clone a rule.
- **Global-context rules in a partitioned run.** A connectivity rule evaluated per-partition reports every partition boundary as a disconnection. Route such rules to a dedicated whole-graph pass.

## False-Positive Management

The fastest way to get a validation gate ignored is to let it cry wolf. A rule that fires on legitimate data trains reviewers to dismiss its class entirely, and the one real defect hidden among a hundred false alarms ships. Managing false positives is therefore a first-class authoring task, not an afterthought.

Three practices keep the signal high. **Version and test every rule against a golden sample** — a small, hand-verified extract where you know the correct finding count, so a change that inflates false positives is caught before deploy. **Support suppression as data**: some findings are known-and-accepted (a genuinely disconnected private driveway, a valid but unusual tag combination), and a rule engine needs an allow-list keyed on `(type, id, rule_id)` so an acknowledged finding stops re-alerting without weakening the rule for everyone else. **Track the false-positive rate per rule** using reviewer feedback, and retire or tighten any rule whose findings are dismissed more often than actioned. A rule that is wrong more than it is right is worse than no rule, because it consumes attention that a good rule needs.

## Integration Points

The rule engine's output is a stream of `Issue` records, and its job ends there — routing them is the parent section's responsibility. Error-severity findings drive quarantine; warnings and info flow to the report. The wiring is a thin adapter that partitions findings by whether they block publication:

```python
def route_findings(issues: list[Issue]) -> tuple[list[Issue], list[Issue]]:
    """Split findings into blocking (quarantine) and advisory (report only)."""
    blocking = [i for i in issues if i.severity is Severity.ERROR]
    advisory = [i for i in issues if i.severity is not Severity.ERROR]
    logger.info("%d blocking, %d advisory findings", len(blocking), len(advisory))
    # blocking → quarantine keyed on (osm_type, osm_id); advisory → report sink
    return blocking, advisory
```

Upstream, the engine consumes the reconstructed, normalized features produced by the [parsing and tag-normalization workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/); downstream, its findings feed the same quarantine table described in [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/). Geometry-specific rules authored here hand off to the deeper detection-and-repair logic in [Geometry Validation & Repair](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/), which the engine calls as just another predicate.

## Rule-Authoring Guides in Depth

Each guide below takes one engine from the model above and develops production rules in it:

- [Writing Custom JOSM Validation Presets](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/writing-custom-josm-validation-presets/) — MapCSS validator tests and value-constraining presets that catch defects in the editor before upload.
- [Authoring Osmose Rule DSL Checks](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/authoring-osmose-rule-dsl-checks/) — the Osmose analyser rule model, item and class numbering, and the geolocated issue output it produces.
- [Building Python-Based OSM Validation Rules](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/building-python-based-osm-validation-rules/) — production rules over pyosmium and geopandas that extend the engine skeleton on this page.

## Frequently Asked Questions

<details>
<summary>Do I have to write every rule in all three engines?</summary>

No. Author the rule's intent once as the four-slot model, then place its expression where it does the most good. Defects a mapper can fix on the spot belong in JOSM so they are prevented at authoring time; standing community backlog belongs in an Osmose-style scan; contract invariants your consumers depend on belong in Python inside your pipeline. Most rules live in exactly one engine, and only a few high-value checks are worth expressing in more than one.
</details>

<details>
<summary>Should a predicate return true for valid or for broken features?</summary>

In the engine on this page a predicate returns true when the feature is valid, and the engine emits a finding when it returns false. Pick one convention and hold it across the whole catalogue, because mixing "true means valid" with "true means broken" silently inverts rules and is the most common authoring bug. Encode the choice in the base class or a unit-test template so a new rule cannot get it wrong.
</details>

<details>
<summary>How do I stop a validation gate from producing too many false positives?</summary>

Test every rule against a golden sample with a known correct finding count so an inflating change is caught before deploy, support a suppression allow-list keyed on element type, id, and rule id for known-and-accepted findings, and track each rule's dismissal rate. Retire or tighten any rule whose findings are ignored more often than actioned, because a rule that is wrong more than right trains reviewers to dismiss its entire class.
</details>

<details>
<summary>Why must validation run after normalization rather than before?</summary>

Un-normalized OSM tags arrive with casing and whitespace variants from many editors, so a value-domain predicate run on raw input flags legitimate data like Asphalt and asphalt as two distinct problems. Running the rule catalogue after the normalization stage collapses those variants first, so findings reflect genuine defects rather than cosmetic noise and reviewers are not buried in false alarms.
</details>

<details>
<summary>How do I keep rules fast on a continental extract?</summary>

Gate every expensive predicate behind a cheap, specific selector so the vast majority of features are discarded on a tag or type test before any geometry runs, share one spatial index across all rules that need neighbours instead of rebuilding it per rule, and partition the work on independent PBF blocks across engine workers. Instrument per-rule time and feature counts so the loose-selector outliers that dominate runtime are obvious and fixable.
</details>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Do I have to write every rule in all three engines?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. Author the rule's intent once as the four-slot model, then place its expression where it does the most good. Defects a mapper can fix on the spot belong in JOSM so they are prevented at authoring time; standing community backlog belongs in an Osmose-style scan; contract invariants your consumers depend on belong in Python inside your pipeline. Most rules live in exactly one engine." }
    },
    {
      "@type": "Question",
      "name": "Should a predicate return true for valid or for broken features?",
      "acceptedAnswer": { "@type": "Answer", "text": "In the engine on this page a predicate returns true when the feature is valid, and the engine emits a finding when it returns false. Pick one convention and hold it across the whole catalogue, because mixing true-means-valid with true-means-broken silently inverts rules and is the most common authoring bug. Encode the choice in the base class or a unit-test template so a new rule cannot get it wrong." }
    },
    {
      "@type": "Question",
      "name": "How do I stop a validation gate from producing too many false positives?",
      "acceptedAnswer": { "@type": "Answer", "text": "Test every rule against a golden sample with a known correct finding count so an inflating change is caught before deploy, support a suppression allow-list keyed on element type, id, and rule id for known-and-accepted findings, and track each rule's dismissal rate. Retire or tighten any rule whose findings are ignored more often than actioned, because a rule that is wrong more than right trains reviewers to dismiss its entire class." }
    },
    {
      "@type": "Question",
      "name": "Why must validation run after normalization rather than before?",
      "acceptedAnswer": { "@type": "Answer", "text": "Un-normalized OSM tags arrive with casing and whitespace variants from many editors, so a value-domain predicate run on raw input flags legitimate data like Asphalt and asphalt as two distinct problems. Running the rule catalogue after the normalization stage collapses those variants first, so findings reflect genuine defects rather than cosmetic noise and reviewers are not buried in false alarms." }
    },
    {
      "@type": "Question",
      "name": "How do I keep rules fast on a continental extract?",
      "acceptedAnswer": { "@type": "Answer", "text": "Gate every expensive predicate behind a cheap, specific selector so the vast majority of features are discarded on a tag or type test before any geometry runs, share one spatial index across all rules that need neighbours instead of rebuilding it per rule, and partition the work on independent PBF blocks across engine workers. Instrument per-rule time and feature counts so the loose-selector outliers that dominate runtime are obvious and fixable." }
    }
  ]
}
</script>

## Related

- [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/) — the parent section with the severity taxonomy, quarantine policy, and reporting model these rules feed.
- [Geometry Validation & Repair](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/) — the sibling stage whose detection logic a geometry rule calls as its predicate.
- [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) — the key-value reference selectors and value-domain predicates are written against.
- [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/) — the upstream stage producing the reconstructed, normalized features the engine consumes.
- [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) — the block-partitioning discipline behind running rules at planet scale.
- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — the quarantine and remediation path error-severity findings are routed to.

Up one level: [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Authoring OSM Validation Rules",
  "description": "Write portable OSM validation rules across JOSM, Osmose, and Python around a unified selector-predicate-severity-message model, with a runnable Python rule-engine skeleton, pipeline-scale execution, and false-positive management.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "OSM Data Quality & Validation",
  "about": ["OSM validation rules", "JOSM Osmose Python QA", "geospatial rule engine"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Quality & Validation", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/" },
    { "@type": "ListItem", "position": 3, "name": "Authoring OSM Validation Rules", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/" }
  ]
}
</script>
