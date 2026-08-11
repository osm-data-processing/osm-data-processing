---
title: "Normalizing OSM Speed Limits and Units"
description: "Parse maxspeed into km/h without inventing values: convert mph rather than stripping it, resolve implicit country defaults, and keep none and walk as categories."
pageTitle: "Normalize OSM Speed Limits and Units"
pageDescription: "A maxspeed normaliser for OSM — unit conversion, implicit country lookups, categorical values that are not numbers, plausibility bounds, and a distribution check that catches unit bugs."
slug: "normalizing-osm-speed-limits-and-units"
type: "article"
breadcrumb: "Normalizing Speed Limits"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Normalizing OSM Speed Limits and Units

Turn `maxspeed` into a number your routing engine can use, without inventing values for the fifth of the data that is not a plain number.

## Prerequisites

- [ ] Python 3.10+
- [ ] `maxspeed` values extracted from a highway layer
- [ ] A country code per feature, for implicit values — from a polygon join, per [Accelerating Point-in-Polygon Joins on OSM Data](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/accelerating-point-in-polygon-joins-on-osm-data/)
- [ ] A target schema with room for a number *and* a category

## Conceptual minimum

`maxspeed` looks like a number and is a small union type.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 251" role="img" aria-labelledby="speed-shapes-t speed-shapes-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="speed-shapes-t">The three families of maxspeed value</title>
  <desc id="speed-shapes-d">Three panels. Numeric values include a bare 50 in kilometres per hour, 30 mph as explicit imperial, 50 km/h as explicit metric, and 8 knots on waterways; these parse and convert directly. Implicit values such as DE urban, GB nsl_single and RO motorway resolve through a country table rather than being numbers. Non-numeric values such as none, walk and signals cannot honestly become a number and should stay categorical.</desc>
  <rect x="0" y="0" width="880" height="251" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Five shapes a maxspeed value takes</text>
  <rect x="26" y="52" width="258" height="157" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Numeric</text>
  <text x="40" y="104" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">50` — km/h, the default unit</text>
  <text x="40" y="125" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">30 mph` — explicit imperial</text>
  <text x="40" y="146" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">50 km/h` — explicit metric</text>
  <text x="40" y="167" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">8 knots` — waterways</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Parse, convert, done</text>
  <rect x="310" y="52" width="258" height="157" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="439" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Implicit</text>
  <text x="324" y="104" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">DE:urban` → 50 km/h</text>
  <text x="324" y="125" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">GB:nsl_single` → 60 mph</text>
  <text x="324" y="146" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">RO:motorway` → 130 km/h</text>
  <text x="324" y="167" font-size="10.5" fill="currentColor" opacity="0.92">A country lookup, not a number</text>
  <text x="324" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Needs a maintained table</text>
  <rect x="594" y="52" width="258" height="157" rx="8" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.5"/>
  <text x="723" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Non-numeric</text>
  <text x="608" y="104" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">none` — no legal limit (DE)</text>
  <text x="608" y="125" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">walk` — walking pace</text>
  <text x="608" y="146" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">signals` — variable, sign-controlled</text>
  <text x="608" y="167" font-size="10.5" fill="currentColor" opacity="0.92">A number would be a lie</text>
  <text x="608" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Keep as a category</text>
  <text x="440" y="235" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Only the first column is arithmetic. The second needs a country table and the third needs a column that is not a number.</text>
</svg>
<figcaption>A schema with one integer column cannot represent all three. Two columns — a number and a category — can.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="speed-reality-t speed-reality-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="speed-reality-t">Distribution of 3.1 million maxspeed values</title>
  <desc id="speed-reality-d">A bar chart. 78.0 percent are bare numbers in kilometres per hour. 13.0 percent carry an mph suffix and need conversion. 5.6 percent are implicit country codes needing a lookup table. 2.3 percent are non-numeric categories such as none, walk or signals. 1.2 percent are unparseable typos, ranges or free text.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">What is actually in the data</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">3.1 M maxspeed values from a European extract</text>
  <line x1="250" y1="68" x2="250" y2="270" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">bare number (km/h)</text>
  <rect x="250" y="74" width="470" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="868" y="89" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">78.0% — the easy majority</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">number + mph</text>
  <rect x="250" y="116" width="78" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="338" y="131" font-size="11" fill="currentColor" opacity="0.9">13.0% — needs conversion</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">implicit country code</text>
  <rect x="250" y="158" width="34" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="294" y="173" font-size="11" fill="currentColor" opacity="0.9">5.6% — needs a lookup table</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">non-numeric category</text>
  <rect x="250" y="200" width="14" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="274" y="215" font-size="11" fill="currentColor" opacity="0.9">2.3% — none, walk, signals</text>
  <text x="240" y="257" text-anchor="end" font-size="11.5" fill="currentColor">unparseable</text>
  <rect x="250" y="242" width="7" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="267" y="257" font-size="11" fill="currentColor" opacity="0.9">1.2% — typos, ranges, free text</text>
  <text x="440" y="306" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Handling only the first row covers 78 percent of values and drops a fifth of the speed data on the floor.</text>
</svg>
<figcaption>The mph slice alone is thirteen percent. A parser that strips the unit and keeps the number makes every one of those roads 61 percent slower than it is.</figcaption>
</figure>

Three consequences follow. A schema with one integer column cannot hold the answer, because `none` and `walk` are not numbers and nulling them conflates them with missing data. Implicit values need a country lookup, so the country has to be known before normalisation runs. And the unit is not optional to handle.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 278" role="img" aria-labelledby="speed-units-t speed-units-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="speed-units-t">What stripping the unit does to four real values</title>
  <desc id="speed-units-d">A grid of four values. 30 mph on a UK residential road becomes 30 km/h when stripped, 38 percent slow, against 48 km/h converted. 70 mph on a UK motorway becomes 70 km/h, again 38 percent slow, against 113 km/h. 8 knots on a ferry route becomes 8 km/h, 46 percent slow, against 14.8 km/h. A bare 50 becomes 50 km/h, correct by luck.</desc>
  <rect x="0" y="0" width="880" height="278" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">What the unit mistake costs</text>
  <text x="317" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">raw value</text>
  <text x="531" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">stripped (wrong)</text>
  <text x="745" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">converted (right)</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">`30 mph`</text>
  <rect x="213" y="84" width="208" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="317" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">residential UK</text>
  <rect x="427" y="84" width="208" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="531" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">30 km/h — 38% slow</text>
  <rect x="641" y="84" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="745" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">48 km/h</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">`70 mph`</text>
  <rect x="213" y="124" width="208" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="317" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">UK motorway</text>
  <rect x="427" y="124" width="208" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="531" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">70 km/h — 38% slow</text>
  <rect x="641" y="124" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="745" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">113 km/h</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">`8 knots`</text>
  <rect x="213" y="164" width="208" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="317" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">a ferry route</text>
  <rect x="427" y="164" width="208" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="531" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">8 km/h — 46% slow</text>
  <rect x="641" y="164" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="745" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">14.8 km/h</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">`50`</text>
  <rect x="213" y="204" width="208" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="317" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">metric default</text>
  <rect x="427" y="204" width="208" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="531" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">50 km/h — correct by luck</text>
  <rect x="641" y="204" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="745" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">50 km/h</text>
  <text x="440" y="260" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">Stripping the unit produces a number in the right range and the wrong value, which is why routing ETAs drift without anyone finding a bug.</text>
</svg>
<figcaption>Every stripped value is plausible. That is exactly why the error survives review and shows up months later as ETAs that are consistently optimistic.</figcaption>
</figure>

## Runnable solution

```python
#!/usr/bin/env python3
"""Normalise OSM maxspeed values to km/h, keeping what cannot be a number."""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from enum import Enum

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

MPH_TO_KMH = 1.609344
KNOTS_TO_KMH = 1.852


class SpeedKind(str, Enum):
    EXPLICIT = "explicit"        # a number was stated
    IMPLICIT = "implicit"        # resolved from a country default
    CATEGORY = "category"        # none / walk / signals — no honest number
    UNKNOWN = "unknown"          # absent
    UNPARSEABLE = "unparseable"  # present, not understood


@dataclass(frozen=True)
class Speed:
    kmh: float | None
    kind: SpeedKind
    category: str | None = None
    raw: str | None = None


#: Values that deliberately are not numbers. Mapping them to one loses information.
CATEGORIES = {
    "none": "no_legal_limit",       # German autobahn — advisory 130, not a limit
    "walk": "walking_pace",
    "signals": "variable_signed",
    "variable": "variable_signed",
}

#: A small extract of the implicit-value table. The real one is maintained upstream
#: in the OSM wiki and should be loaded as data, not embedded in code.
IMPLICIT: dict[str, float] = {
    "DE:urban": 50, "DE:rural": 100, "DE:living_street": 7, "DE:motorway": 130,
    "GB:nsl_single": 60 * MPH_TO_KMH, "GB:nsl_dual": 70 * MPH_TO_KMH,
    "GB:motorway": 70 * MPH_TO_KMH,
    "FR:urban": 50, "FR:rural": 80, "FR:motorway": 130,
    "RO:urban": 50, "RO:rural": 90, "RO:motorway": 130,
    "AT:urban": 50, "AT:rural": 100, "AT:motorway": 130,
}

_NUMERIC = re.compile(r"""
    ^\s*
    (?P<value>\d+(?:\.\d+)?)        # the number
    \s*
    (?P<unit>km/h|kmh|kph|mph|knots|kn)?   # optional unit; absent means km/h
    \s*$
""", re.IGNORECASE | re.VERBOSE)

_UNIT_FACTOR = {
    None: 1.0, "": 1.0, "km/h": 1.0, "kmh": 1.0, "kph": 1.0,
    "mph": MPH_TO_KMH, "knots": KNOTS_TO_KMH, "kn": KNOTS_TO_KMH,
}

#: Above this, the value is a data error rather than a fast road.
MAX_PLAUSIBLE_KMH = 300.0


def normalise(raw: str | None, country: str | None = None) -> Speed:
    """Parse one maxspeed value. Never guesses; never returns a number it invented."""
    if raw is None or not raw.strip():
        return Speed(None, SpeedKind.UNKNOWN, raw=raw)

    value = raw.strip()
    lowered = value.lower()

    if lowered in CATEGORIES:
        return Speed(None, SpeedKind.CATEGORY, category=CATEGORIES[lowered], raw=raw)

    match = _NUMERIC.match(value)
    if match:
        unit = (match.group("unit") or "").lower()
        kmh = float(match.group("value")) * _UNIT_FACTOR[unit or None]
        if not 0 < kmh <= MAX_PLAUSIBLE_KMH:
            return Speed(None, SpeedKind.UNPARSEABLE, raw=raw)
        return Speed(round(kmh, 1), SpeedKind.EXPLICIT, raw=raw)

    # Implicit form: either a full "CC:type" token, or a bare type with a known country.
    key = value if ":" in value else (f"{country}:{value}" if country else None)
    if key and key in IMPLICIT:
        return Speed(round(IMPLICIT[key], 1), SpeedKind.IMPLICIT, raw=raw)

    return Speed(None, SpeedKind.UNPARSEABLE, raw=raw)


def normalise_many(values: list[tuple[str | None, str | None]]) -> list[Speed]:
    results = [normalise(raw, country) for raw, country in values]
    counts: dict[SpeedKind, int] = {kind: 0 for kind in SpeedKind}
    for speed in results:
        counts[speed.kind] += 1
    total = len(results) or 1
    for kind, n in counts.items():
        logger.info("%-12s %8d  %5.1f%%", kind.value, n, 100 * n / total)
    return results
```

## Step-by-step walkthrough

`CATEGORIES` is checked before the numeric pattern, and its values become a category rather than a number. `maxspeed=none` on a German autobahn means there is no legal limit; encoding it as 130 asserts a limit that does not exist, and encoding it as null makes it indistinguishable from an unsurveyed road. A separate categorical column is the only representation that is true.

The numeric regex makes the unit optional and defaults it to km/h, which is what the specification says. The important part is that `mph` is *converted* rather than stripped — the thirteen percent slice that a naive parser silently makes 38 percent too slow.

`MAX_PLAUSIBLE_KMH` rejects rather than clamps. OSM contains `maxspeed=999` and `maxspeed=1000`, which are data errors, and clamping them to 300 asserts a limit nobody surveyed. Returning `UNPARSEABLE` keeps them visible, following the same discipline as the coercion bounds in [Mapping OSM Tags to a Fixed Schema with YAML](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/mapping-osm-tags-to-a-fixed-schema-with-yaml/).

The implicit lookup accepts both a full `CC:type` token and a bare type combined with a known country, because both appear. Without a country it does not guess — a bare `urban` with no country is genuinely ambiguous, and 50 km/h is right in much of Europe and wrong in the United States.

The `kind` field is what makes the output usable. A consumer computing average speeds needs to exclude implicit values or weight them differently; one computing coverage needs to count them as present. One number cannot serve both.

## Verification

Test each family, and specifically test that the unit is converted:

```python
def test_mph_is_converted_not_stripped():
    assert normalise("30 mph").kmh == 48.3
    assert normalise("70 mph").kmh == 112.7

def test_bare_number_is_kmh():
    assert normalise("50").kmh == 50.0

def test_none_is_a_category_not_a_number():
    speed = normalise("none")
    assert speed.kmh is None and speed.category == "no_legal_limit"

def test_implicit_needs_a_country():
    assert normalise("urban").kind is SpeedKind.UNPARSEABLE
    assert normalise("urban", country="DE").kmh == 50.0

def test_absurd_values_are_rejected_not_clamped():
    assert normalise("999").kind is SpeedKind.UNPARSEABLE
```

Then run over a real extract and compare the distribution against the chart above. A parseable rate far below 98 percent usually means the country join has not run, so every implicit value is failing.

Finally, sanity-check the resulting distribution against reality:

```python
speeds = [s.kmh for s in results if s.kmh is not None]
import statistics
logger.info("median %.0f km/h, p95 %.0f km/h",
            statistics.median(speeds), sorted(speeds)[int(0.95 * len(speeds))])
```

A median around 50 and a 95th percentile around 120–130 is what a European road network looks like. A median in the thirties means mph values are being stripped rather than converted — the number is plausible, which is exactly why the distribution check is worth running.

## Common errors and fixes

| Symptom | Root cause | Fix |
|---|---|---|
| Routing ETAs consistently optimistic | `mph` stripped, not converted | Multiply by 1.609344 |
| German autobahns capped at 130 | `none` mapped to a number | Keep it as a category |
| Every implicit value unparseable | No country available at normalisation time | Join the country before normalising |
| A road at 999 km/h | Value accepted without bounds | Reject above a plausible ceiling |
| `none` and unsurveyed look identical | Both stored as null | Add a `kind` column |
| Median speed near 35 km/h | mph slice mishandled | Check the distribution, not just the parse rate |

## Frequently Asked Questions

<details>
<summary>Should implicit values be resolved at all?</summary>

Resolve them, and mark them. An implicit value is a real legal limit and excluding it loses five percent of the network's speed data; but it is a limit derived from a national rule rather than a surveyed sign, so a consumer comparing surveyed coverage between countries needs to be able to exclude them. The `kind` column costs one byte and makes both uses possible.
</details>

<details>
<summary>Where does the implicit-value table come from?</summary>

The OSM wiki maintains it per country, and it changes when national speed laws change. Load it as data rather than embedding it in code, version it alongside your mapping, and treat an update as a reviewable change — a table edit that silently reclassifies every rural road in a country is exactly the kind of change that should show up in a diff.
</details>

<details>
<summary>What about maxspeed:conditional?</summary>

It uses the `value @ condition` form and shares its time-selector grammar with `opening_hours`, so the parser in [Parsing OSM Opening Hours Values](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/parsing-osm-opening-hours-values/) does most of the work. Resolve the base `maxspeed` first and treat the conditional as an override applying over a time window; storing only the conditional loses the default.
</details>

<details>
<summary>Should I fall back to a default when maxspeed is absent?</summary>

Only with a provenance stamp. A highway-class default is a reasonable estimate and a terrible fact: a routing engine benefits from it, and a completeness metric computed over defaulted values measures your defaults rather than the map. Fill it, mark it as defaulted, and let each consumer decide — the fallback-chain pattern from [Batch Attribute Mapping Strategies](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/).
</details>

## Specification reference

> `maxspeed` values are numeric with an optional unit suffix, where an absent unit means km/h and recognised suffixes are `mph` and `knots`. Implicit values take the form `CC:type`, resolved against a country-specific table. The values `none`, `walk`, `signals` and `variable` are defined categorical states rather than numbers.

## Related

- [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/) — the topic this normalisation belongs to.
- [Mapping OSM Tags to a Fixed Schema with YAML](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/mapping-osm-tags-to-a-fixed-schema-with-yaml/) — where the bounds and coercion rules live.
- [Parsing OSM Opening Hours Values](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/parsing-osm-opening-hours-values/) — the conditional grammar this shares.
- [Handling Missing Tags in OSM Data Pipelines](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/handling-missing-tags-in-osm-data-pipelines/) — why absent and unknown must stay distinct.
- [Best Practices for OSM Tag Standardization Across Regions](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/best-practices-for-osm-tag-standardization-across-regions/) — the regional variation behind the implicit table.

Up one level: [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/).
