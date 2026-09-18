---
title: "Validating an OSM Tag Mapping Config with Pydantic"
description: "Catch a broken tag-mapping configuration at load time rather than three hours into a run: typed models, cross-field checks, and the semantic rules a schema alone cannot express."
pageTitle: "Validating a Tag Mapping Configuration Before It Runs"
pageDescription: "Give an OSM tag-mapping config a typed model with cross-field validation, catch shadowed rules and unreachable branches at load time, and fail with a message naming the offending entry."
slug: validating-an-osm-tag-mapping-config-with-pydantic
type: article
breadcrumb: "Validating a Mapping Config"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Validating an OSM Tag Mapping Config with Pydantic

A tag-mapping configuration is code that happens to be written in YAML, and it fails like code — except that without validation it fails three hours into a run, on the one element that reached the broken branch.

## Prerequisites

- [ ] Python 3.10+ with `pydantic` v2 and a YAML parser.
- [ ] An existing mapping configuration, per [Mapping OSM Tags to a Fixed Schema with YAML](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/mapping-osm-tags-to-a-fixed-schema-with-yaml/).
- [ ] The strategies in [Batch Attribute Mapping Strategies](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/).
- [ ] A target schema the mapping must produce, so output fields can be checked against it.
- [ ] A place in the pipeline to load the config before any data is read.

## Conceptual minimum

Validation happens at three levels, and only the first is what people usually mean by it.

**Structural validation** checks that the file parses and that each entry has the fields it should, with the right types. A typed model does this for free and catches typos in field names, which are the most common configuration error by a wide margin.

**Cross-field validation** checks relationships within one entry: a rule with a value list must also name a key; a rule producing a numeric output must declare a numeric type; a default must be of the declared type.

**Semantic validation** checks relationships between entries, and it is the level a schema cannot express. Two rules matching the same tag where the first shadows the second; a rule whose key never appears in the data; an output field no consumer reads; a priority order with ties.

The last level is where the real value is, because those are the failures that produce *wrong output rather than an error*. A shadowed rule does not crash; it silently never fires, and the features it was meant to classify get whatever the earlier rule said.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 250" role="img" aria-labelledby="vmc1-t vmc1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="vmc1-t">Three levels of configuration validation and what each catches</title>
  <desc id="vmc1-d">A grid of three validation levels against what each catches and when the problem would otherwise surface. Structural validation catches misspelled field names and wrong types, which would otherwise surface as an attribute error at the moment the entry is first used. Cross-field validation catches internally inconsistent entries, such as a value list with no key, which would otherwise produce a rule that matches nothing. Semantic validation catches shadowed and unreachable rules, which never raise at all and instead produce silently wrong classifications.</desc>
  <rect x="0" y="0" width="880" height="250" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three levels, and only the third catches silent wrongness</text>
  <rect x="216" y="48" width="319" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="376" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Catches</text>
  <rect x="535" y="48" width="319" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="694" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Would otherwise</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Structural</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">typos and wrong types</text>
  <text x="694" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">fail at first use</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Cross-field</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">inconsistent entries</text>
  <text x="694" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">match nothing</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Semantic</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">shadowed rules</text>
  <text x="694" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">classify wrongly, silently</text>
  <text x="868" y="234" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The first two levels turn a late crash into an early one; the third turns a wrong answer into a crash, which is a bigger win.</text>
</svg>
<figcaption>A typed model gives the first level for nothing, which is why the other two are so often left unwritten.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
from collections import defaultdict
from typing import Annotated, Literal

import yaml
from pydantic import BaseModel, Field, ValidationError, model_validator

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.mapping.validate")

# The fields the target schema actually has. A rule producing anything else
# writes a column nothing reads.
TARGET_FIELDS = {"feature_class", "name", "surface", "speed_kph", "lanes",
                 "access", "layer"}


class Rule(BaseModel):
    model_config = {"extra": "forbid"}     # a misspelled field is an error

    key: str = Field(min_length=1)
    values: list[str] | None = None        # None means "any value"
    output_field: str
    output_value: str | None = None        # None means "use the tag value"
    output_type: Literal["string", "integer", "float", "boolean"] = "string"
    priority: Annotated[int, Field(ge=0, le=1000)] = 100

    @model_validator(mode="after")
    def check_internally_consistent(self) -> "Rule":
        if self.output_field not in TARGET_FIELDS:
            raise ValueError(
                f"output_field {self.output_field!r} is not in the target "
                f"schema; known fields are {sorted(TARGET_FIELDS)}")
        if self.output_type in {"integer", "float"} and self.output_value:
            # A literal output with a numeric type must actually parse.
            try:
                float(self.output_value)
            except ValueError as exc:
                raise ValueError(f"output_value {self.output_value!r} is not "
                                 f"{self.output_type}") from exc
        if self.values is not None and not self.values:
            raise ValueError("values is an empty list; omit it to match any "
                             "value, or list the values you mean")
        return self


class Mapping(BaseModel):
    model_config = {"extra": "forbid"}

    name: str
    rules: list[Rule] = Field(min_length=1)

    @model_validator(mode="after")
    def check_no_shadowing(self) -> "Mapping":
        """Semantic checks: the failures that produce wrong output, not errors."""
        problems: list[str] = []
        by_key: dict[str, list[Rule]] = defaultdict(list)
        for rule in self.rules:
            by_key[rule.key].append(rule)

        for key, rules in by_key.items():
            ordered = sorted(rules, key=lambda r: -r.priority)
            catch_all_at: int | None = None
            for index, rule in enumerate(ordered):
                if rule.values is None:
                    if catch_all_at is None:
                        catch_all_at = index
                elif catch_all_at is not None:
                    # A value-specific rule after a catch-all on the same key
                    # can never fire. It looks fine and silently does nothing.
                    problems.append(
                        f"rule for {key}={rule.values} is shadowed by an "
                        f"earlier catch-all on {key!r} at priority "
                        f"{ordered[catch_all_at].priority}")

            # Two rules claiming the same value for the same key.
            seen: dict[str, int] = {}
            for rule in ordered:
                for value in rule.values or ():
                    if value in seen:
                        problems.append(
                            f"{key}={value} is matched by two rules at "
                            f"priorities {seen[value]} and {rule.priority}")
                    seen[value] = rule.priority

            # Ties in priority make the outcome depend on file order.
            priorities = [r.priority for r in rules]
            if len(set(priorities)) != len(priorities):
                problems.append(
                    f"rules for {key!r} share a priority; the winner would "
                    f"depend on the order they appear in the file")

        if problems:
            raise ValueError("; ".join(problems))
        return self


def load(path: str) -> Mapping:
    raw = yaml.safe_load(open(path, encoding="utf-8"))
    try:
        mapping = Mapping.model_validate(raw)
    except ValidationError as exc:
        # Fail here, before a single element is read, with the entry named.
        logger.error("configuration is invalid:\n%s", exc)
        raise
    logger.info("loaded %d rule(s) across %d key(s)", len(mapping.rules),
                len({r.key for r in mapping.rules}))
    return mapping


def coverage_report(mapping: Mapping, observed_keys: set[str]) -> None:
    """Which rules can never fire against this data?"""
    configured = {r.key for r in mapping.rules}
    unreachable = configured - observed_keys
    unmapped = observed_keys - configured
    if unreachable:
        logger.warning("%d rule key(s) never appear in the data: %s",
                       len(unreachable), sorted(unreachable)[:10])
    logger.info("%d observed key(s) have no rule", len(unmapped))


if __name__ == "__main__":
    logger.info("validate at load time; a shadowed rule never raises at runtime")
```

## Step-by-step walkthrough

1. **Forbid unknown fields.** A misspelled field name is the commonest configuration error, and silently ignoring it produces a rule that behaves nothing like what was written.
2. **Validate output fields against the real schema.** A rule writing to a column the target does not have is either a typo or a plan nobody implemented, and both are worth catching before the run.
3. **Check literal values against their declared type.** A numeric output whose literal does not parse fails at the first matching element, which may be hours in.
4. **Reject an empty value list.** Empty and absent mean opposite things — match nothing and match everything — and the ambiguity is worth refusing rather than resolving.
5. **Detect shadowing per key.** A value-specific rule ordered after a catch-all on the same key can never fire, which is the archetypal silent failure in a priority-ordered mapping.
6. **Detect duplicate value claims.** Two rules matching the same key and value means one of them is dead, and which one depends on ordering that may not be stable.
7. **Refuse tied priorities.** Ties make the outcome depend on the order entries appear in the file, which is not a property anybody intends to rely on.
8. **Report coverage separately.** Which configured keys never appear in the data, and which observed keys have no rule, are findings rather than errors and belong in a report.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="vmc2-t vmc2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="vmc2-t">Three configuration faults and when each one would otherwise be discovered</title>
  <desc id="vmc2-d">Three panels. A misspelled field name is silently ignored by a permissive loader, so the rule behaves differently from what was written and the difference is discovered when somebody notices the output column is empty. A shadowed rule never fires, so the features it was meant to classify receive the earlier rule's answer, which is discovered when somebody queries for a class that has no rows. A tied priority makes the winner depend on the order entries appear in the file, so a harmless reformatting of the configuration silently changes the output.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three faults, three very delayed discoveries</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Misspelled field</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Silently ignored</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Rule does nothing</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Column stays empty</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Found by a query</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Shadowed rule</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Never fires</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Earlier rule answers</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">A class has no rows</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Found much later</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Tied priority</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Winner depends on order</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Reformatting changes output</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Nothing in the diff explains it</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Found by accident</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">None of these raises at runtime, which is why validating the configuration is worth more than validating the data it produces.</text>
</svg>
<figcaption>The third is the worst to diagnose, because the change that broke it looks like a formatting commit.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="vmc3-t vmc3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="vmc3-t">Where each check runs, and how much of a run it saves</title>
  <desc id="vmc3-d">Four stages of a pipeline run. Configuration load happens before any data is read, and a failure there costs seconds. First element processed is where a lazily-checked literal type would fail, costing the pipeline start-up time. First matching element is where a bad output field would fail, which on a rare rule can be most of the way through a run. Completion is where a shadowed rule is never detected at all, because it produces output rather than an error.</desc>
  <defs><marker id="vmc3-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four moments a fault can surface, one of which never does</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">config load</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">validation runs here</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">a failure costs seconds</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#vmc3-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">first element</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">lazy type errors</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">costs start-up</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#vmc3-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">first match</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">bad output field</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">can be hours in</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#vmc3-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">completion</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">shadowing never surfaces</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">output is just wrong</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Moving every check to the first stage is worth the effort entirely because of the fourth, where there is no failure to move.</text>
</svg>
<figcaption>The cost of a fault rises with how late it is found, and the last column has no cost because nothing is ever found.</figcaption>
</figure>

## Verification

- **A misspelled field fails.** Add one and confirm the load raises rather than proceeding.
- **A shadowed rule fails.** Order a specific rule after a catch-all on the same key and confirm the error names both.
- **A tied priority fails.** Give two rules for one key the same priority and confirm the error explains the consequence.
- **The error names the entry.** Every validation failure should identify which rule is at fault, not just that something is.
- **Coverage reports, not fails.** An unreachable key should produce a warning rather than blocking a run, since data varies by region.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Rule silently does nothing | Misspelled field ignored by the loader | Forbid unknown fields in the model |
| A class never appears in output | A rule shadowed by a catch-all | Detect value rules ordered after a catch-all per key |
| Output changes after reformatting | Priorities tied, order decides | Refuse duplicate priorities within a key |
| Run fails hours in | Literal value type checked lazily | Validate literals against the declared type at load |
| Column written that nothing reads | Output field not checked | Validate output fields against the target schema |
| Empty value list matches everything | Empty and absent conflated | Reject an empty list explicitly |
| Config valid, data unmapped | Coverage never reported | Report configured keys absent from the data |

## Specification reference

> Pydantic validates data against typed models, applying field constraints and then any model-level validators, and reports every failure with the path to the offending field. Configuring a model to forbid extra fields turns an unexpected key into a validation error rather than a silently ignored value. See the [Pydantic documentation](https://docs.pydantic.dev/) for model validators and the extra-field configuration.

## Frequently Asked Questions

<details>
<summary>Why forbid unknown fields rather than ignoring them?</summary>

Because a misspelled field name is indistinguishable from an unknown one, and ignoring it produces a rule that silently behaves differently from what its author wrote. A configuration is code, and a typo in code should be an error. The cost is that adding a field to the model becomes necessary before using it, which is a small and appropriate friction.
</details>

<details>
<summary>What is rule shadowing and why does it matter so much?</summary>

It is a value-specific rule placed after a catch-all on the same key, so the catch-all always matches first and the specific rule never fires. It matters because nothing raises: the features the specific rule was meant to classify get the catch-all's answer instead, and the output is complete, plausible and wrong. Detecting it requires comparing rules against each other, which no per-entry schema can do.
</details>

<details>
<summary>Why are tied priorities worth rejecting?</summary>

Because they make the outcome depend on the order entries appear in the file, which is not a property anybody intends to depend on. Somebody reorders the configuration for readability, the output changes, and nothing in the change explains why. Requiring distinct priorities within a key costs one number per rule and removes an entire class of inexplicable behaviour.
</details>

<details>
<summary>Should an unreachable rule fail the load?</summary>

No, report it. A rule whose key never appears in the current extract may be entirely correct for another region, and failing the load would mean maintaining a separate configuration per area. Reporting it tells you the rule is doing nothing here without preventing the run, and a rule unreachable across every region you process is then worth investigating.
</details>

## Related

- [Batch Attribute Mapping Strategies](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/) — the parent topic and the mapping model.
- [Mapping OSM Tags to a Fixed Schema with YAML](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/mapping-osm-tags-to-a-fixed-schema-with-yaml/) — the configuration this validates.
- [Handling Missing Tags in OSM Data Pipelines](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/handling-missing-tags-in-osm-data-pipelines/) — what a catch-all rule is usually for.
- [Designing a Star Schema for OSM Features](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/designing-a-star-schema-for-osm-features/) — the target schema output fields are checked against.
- [Setting Quality Thresholds That Fail a Build](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/setting-quality-thresholds-that-fail-a-build/) — the same fail-early discipline applied to data.

Up one level: [Batch Attribute Mapping Strategies](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Validating an OSM Tag Mapping Config with Pydantic",
  "description": "Catch a broken tag-mapping configuration at load time rather than three hours into a run: typed models, cross-field checks, and the semantic rules a schema alone cannot express.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Parsing & Tag Normalization Workflows",
  "about": ["configuration validation", "rule shadowing", "typed models"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Parsing & Tag Normalization Workflows", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/" },
    { "@type": "ListItem", "position": 3, "name": "Batch Attribute Mapping Strategies", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/" },
    { "@type": "ListItem", "position": 4, "name": "Validating an OSM Tag Mapping Config with Pydantic", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/validating-an-osm-tag-mapping-config-with-pydantic/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Validate an OSM tag mapping configuration before it runs",
  "description": "Model the configuration with forbidden extra fields, validate output fields against the target schema, check literals against declared types, and detect shadowing, duplicate claims and tied priorities across rules.",
  "step": [
    { "@type": "HowToStep", "name": "Forbid unknown fields", "text": "Configure the model to reject extra keys so a misspelled field is an error rather than a silently ignored value." },
    { "@type": "HowToStep", "name": "Check output fields", "text": "Validate every rule's output field against the target schema's real column list." },
    { "@type": "HowToStep", "name": "Check literals against types", "text": "Confirm a literal output value parses as its declared type at load rather than at first match." },
    { "@type": "HowToStep", "name": "Reject empty value lists", "text": "Refuse an empty list, since empty and absent mean opposite things and the ambiguity is not worth resolving silently." },
    { "@type": "HowToStep", "name": "Detect shadowing", "text": "Flag a value-specific rule ordered after a catch-all on the same key, since it can never fire." },
    { "@type": "HowToStep", "name": "Refuse tied priorities", "text": "Require distinct priorities within a key so the outcome does not depend on file order." },
    { "@type": "HowToStep", "name": "Report coverage separately", "text": "Warn about configured keys absent from the data without failing the run, since data varies by region." }
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
      "name": "Why forbid unknown fields in a mapping configuration?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because a misspelled field name is indistinguishable from an unknown one, and ignoring it produces a rule that silently behaves differently from what its author wrote. A configuration is code, and a typo in code should be an error. The cost is a small and appropriate friction when adding fields." }
    },
    {
      "@type": "Question",
      "name": "What is rule shadowing in a tag mapping configuration?",
      "acceptedAnswer": { "@type": "Answer", "text": "It is a value-specific rule placed after a catch-all on the same key, so the catch-all always matches first and the specific rule never fires. Nothing raises: the features it was meant to classify get the catch-all's answer, and the output is complete, plausible and wrong. Detecting it requires comparing rules against each other." }
    },
    {
      "@type": "Question",
      "name": "Why are tied rule priorities worth rejecting?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because they make the outcome depend on the order entries appear in the file, which nobody intends to depend on. Somebody reorders the configuration for readability, the output changes, and nothing in the change explains why. Requiring distinct priorities removes an entire class of inexplicable behaviour." }
    },
    {
      "@type": "Question",
      "name": "Should an unreachable mapping rule fail the load?",
      "acceptedAnswer": { "@type": "Answer", "text": "No, report it. A rule whose key never appears in the current extract may be correct for another region, and failing would mean maintaining a configuration per area. Reporting tells you the rule is doing nothing here, and a rule unreachable across every region is then worth investigating." }
    }
  ]
}
</script>
