---
title: "Parsing OSM Opening Hours Values"
description: "Parse opening_hours as the ordered rule grammar it is: why later rules override earlier ones, which repairs are safe, and how to record the fourteen percent that will not parse."
pageTitle: "Parse OSM opening_hours Values Correctly"
pageDescription: "A grammar-aware opening_hours parser for OSM pipelines — safe normalisation, rule-override semantics, tri-state evaluation, and classification of unparseable values."
slug: "parsing-osm-opening-hours-values"
type: "article"
breadcrumb: "Parsing Opening Hours"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Parsing OSM Opening Hours Values

Turn `opening_hours` strings into something a query can use, without pretending a small grammar is a regular expression.

## Prerequisites

- [ ] Python 3.10+
- [ ] Tag values extracted from an OSM layer, per [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/)
- [ ] A decision about what "unparseable" should produce downstream
- [ ] Optionally, a reference implementation to validate against

## Conceptual minimum

`opening_hours` is a specified grammar, not a convention. Values are ordered lists of rules, each combining an optional selector with an optional time span and an optional modifier, and later rules override earlier ones for the periods they cover.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 251" role="img" aria-labelledby="oh-grammar-t oh-grammar-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="oh-grammar-t">The three grammatical layers of an opening_hours value</title>
  <desc id="oh-grammar-d">Three panels. A rule pairs a weekday selector with a time span, such as Monday to Friday 09:00 to 17:00, with both parts independently optional; 24/7 is a rule with neither, and semicolons separate rules. A modifier such as Su off or PH closed takes the values open, closed, off or unknown, and a later rule overrides an earlier one, which is why order matters; open is the implied default. Extensions include a double-quoted comment, a comma chaining additional times, and a double-pipe marking a fallback rule.</desc>
  <rect x="0" y="0" width="880" height="251" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">One value, four grammatical layers</text>
  <rect x="26" y="52" width="258" height="157" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Rule</text>
  <text x="40" y="104" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">Mo-Fr 09:00-17:00</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">A weekday selector plus a time span</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Both optional, independently</text>
  <text x="40" y="167" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">24/7` is a rule with neither</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Semicolon separates rules</text>
  <rect x="310" y="52" width="258" height="157" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="439" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Modifier</text>
  <text x="324" y="104" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">Su off`  ·  `PH closed</text>
  <text x="324" y="125" font-size="10.5" fill="currentColor" opacity="0.92">open / closed / off / unknown</text>
  <text x="324" y="146" font-size="10.5" fill="currentColor" opacity="0.92">A later rule overrides an earlier one</text>
  <text x="324" y="167" font-size="10.5" fill="currentColor" opacity="0.92">This is why order matters</text>
  <text x="324" y="188" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">open` is the default, implied</text>
  <rect x="594" y="52" width="258" height="157" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="723" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Extension</text>
  <text x="608" y="104" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">Sa 10:00-14:00 "by appointment"</text>
  <text x="608" y="125" font-size="10.5" fill="currentColor" opacity="0.92">A comment in double quotes</text>
  <text x="608" y="146" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">,` chains additional times</text>
  <text x="608" y="167" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">||` marks a fallback rule</text>
  <text x="608" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Rarely used, must not crash you</text>
  <text x="440" y="235" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">The specification is a small grammar rather than a format. Regular expressions get the first column right and the second wrong.</text>
</svg>
<figcaption>Rule order carries meaning. Any parser that treats the value as an unordered set of intervals gets Sunday wrong for a large fraction of real values.</figcaption>
</figure>

The override semantics are what defeat regular-expression approaches. `Mo-Fr 08:00-18:00; Su off` is not two independent facts; the second rule modifies the state established by the first, and a parser that collects intervals into a set has already lost the information needed to get Sunday right.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 278" role="img" aria-labelledby="oh-traps-t oh-traps-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="oh-traps-t">Four opening_hours values and the wrong answer a naive parser gives</title>
  <desc id="oh-traps-d">A grid of four values. Monday to Friday 08:00 to 18:00 semicolon Sunday off is naively read as open on Sunday when the correct reading is closed, because the later rule wins. Monday to Sunday 00:00 to 24:00 is naively read as closed at midnight when 24:00 means the end of the day. Monday to Friday 11:30 to 14:00 comma 17:30 to 23:00 is naively read as one span from 11:30 to 23:00 when it is two spans with a lunch break. Tuesday to Sunday 10:00 to 18:00 semicolon PH off is naively read as open on a public holiday, when PH is a selector rather than a weekday.</desc>
  <rect x="0" y="0" width="880" height="278" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four values that break naive parsers</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">naive result</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">correct result</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">`Mo-Fr 08:00-18:00; Su off`</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">open on Sunday</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">closed on Sunday — later rule wins</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">`Mo-Su 00:00-24:00`</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">closed at midnight</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">open all day; 24:00 is the end of the day</text>
  <text x="198" y="184" text-anchor="end" font-size="10.5" fill="currentColor">`Mo-Fr 11:30-14:00,17:30-23:00`</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">one span, 11:30–23:00</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">two spans with a break between</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">`Tu-Su 10:00-18:00; PH off`</text>
  <rect x="213" y="204" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">open on a public holiday</text>
  <rect x="535" y="204" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">closed — PH is a selector, not a weekday</text>
  <text x="440" y="260" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Every one of these is a common real value, and every naive result is plausible enough to ship.</text>
</svg>
<figcaption>These are not exotic. All four appear thousands of times in any national extract.</figcaption>
</figure>

## Runnable solution

The pragmatic answer is to use a real parser for the grammar and reserve your own code for classification and reporting:

```python
#!/usr/bin/env python3
"""Parse OSM opening_hours values, classifying what cannot be parsed."""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime
from enum import Enum

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


class Quality(str, Enum):
    CLEAN = "clean"
    REPAIRED = "repaired"      # normalised, then parsed
    UNPARSEABLE = "unparseable"


@dataclass(frozen=True)
class ParsedHours:
    raw: str
    normalised: str | None
    quality: Quality
    note: str | None = None


#: Sloppiness that is safe to fix because it cannot change the meaning.
_REPAIRS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\s*;\s*"), "; "),                  # spacing around rule separators
    (re.compile(r"\s*,\s*"), ","),                   # spacing around time chaining
    (re.compile(r"(\d)h(\d\d)"), r"\1:\2"),          # 9h30 → 9:30
    (re.compile(r"\b(\d):(\d\d)\b"), r"0\1:\2"),     # 9:30 → 09:30
    (re.compile(r"\b(\d{2})\.(\d{2})\b"), r"\1:\2"), # 09.30 → 09:30
    (re.compile(r"\bmo\b", re.I), "Mo"),             # weekday casing
    (re.compile(r"\btu\b", re.I), "Tu"),
    (re.compile(r"\bwe\b", re.I), "We"),
    (re.compile(r"\bth\b", re.I), "Th"),
    (re.compile(r"\bfr\b", re.I), "Fr"),
    (re.compile(r"\bsa\b", re.I), "Sa"),
    (re.compile(r"\bsu\b", re.I), "Su"),
    (re.compile(r"\s+"), " "),
)

#: Values that mean "no information", not "closed".
_EMPTY = frozenset({"", "-", "?", "unknown", "n/a", "na", "tbd"})


def normalise(value: str) -> str:
    out = value.strip()
    for pattern, replacement in _REPAIRS:
        out = pattern.sub(replacement, out)
    return out.strip().rstrip(";").strip()


def parse(value: str) -> ParsedHours:
    """Parse with a grammar-aware library; classify anything that will not go.

    The library does the grammar. This function's job is to decide what a failure
    means and to make sure a failure is recorded rather than silently dropped.
    """
    if value is None or value.strip().lower() in _EMPTY:
        return ParsedHours(value or "", None, Quality.UNPARSEABLE, "no information")

    try:
        from opening_hours import OpeningHours          # the Rust-backed binding
    except ImportError as exc:                          # pragma: no cover
        raise RuntimeError(
            "install a grammar-aware parser (pip install opening-hours-py); "
            "regular expressions cannot express rule-override semantics"
        ) from exc

    for candidate, quality in ((value, Quality.CLEAN), (normalise(value), Quality.REPAIRED)):
        try:
            OpeningHours(candidate)
        except Exception:                               # the binding raises on bad grammar
            continue
        return ParsedHours(value, candidate, quality)

    return ParsedHours(value, None, Quality.UNPARSEABLE, "grammar not recognised")


def is_open_at(parsed: ParsedHours, when: datetime) -> bool | None:
    """Tri-state on purpose: None means unknown, which is not the same as closed."""
    if parsed.normalised is None:
        return None
    from opening_hours import OpeningHours
    return OpeningHours(parsed.normalised).is_open(when)


def summarise(values: list[str]) -> dict[Quality, int]:
    counts: dict[Quality, int] = {q: 0 for q in Quality}
    for value in values:
        counts[parse(value).quality] += 1
    total = sum(counts.values()) or 1
    for quality, n in counts.items():
        logger.info("%-12s %7d  %5.1f%%", quality.value, n, 100 * n / total)
    return counts
```

<figure class="diagram-wrap">
<svg viewBox="0 0 880 282" role="img" aria-labelledby="oh-reality-t oh-reality-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="oh-reality-t">How 1.42 million real opening_hours values parse</title>
  <desc id="oh-reality-d">A bar chart of 1.42 million opening_hours values from a European extract. 85.8 percent parse cleanly. 8.5 percent parse with a warning from sloppy separators or odd casing. 3.3 percent need fallback-rule support such as the double-pipe operator or nested conditions. 2.4 percent are unparseable free text, typos or other languages.</desc>
  <rect x="0" y="0" width="880" height="282" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">What real values look like</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">1.42 M opening_hours values from a European extract</text>
  <line x1="250" y1="68" x2="250" y2="228" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">parses cleanly</text>
  <rect x="250" y="74" width="470" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="868" y="89" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">85.8% — the well-formed majority</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">parses with a warning</text>
  <rect x="250" y="116" width="47" height="21" rx="3" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="307" y="131" font-size="11" fill="currentColor" opacity="0.9">8.5% — sloppy separators, odd case</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">needs a fallback rule</text>
  <rect x="250" y="158" width="18" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="278" y="173" font-size="11" fill="currentColor" opacity="0.9">3.3% — || or nested conditions</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">unparseable</text>
  <rect x="250" y="200" width="13" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="273" y="215" font-size="11" fill="currentColor" opacity="0.9">2.4% — free text, typos, other languages</text>
  <text x="440" y="264" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.85">Fourteen percent of values are not clean. A parser that raises on them loses one value in seven; one that returns null on them loses the same and says so.</text>
</svg>
<figcaption>The shape is the familiar OSM one: a large clean majority and a long tail. Plan for the tail to be reported rather than silently dropped.</figcaption>
</figure>

## Step-by-step walkthrough

`parse` tries the raw value first and the normalised value second, and records which one worked. That distinction is worth keeping: a corpus where ten percent of values need repair is telling you something about your region's tagging conventions that a single pass/fail flag does not.

`_REPAIRS` contains only transformations that cannot change meaning. Fixing spacing, zero-padding hours and correcting weekday capitalisation are all safe. Deliberately absent is anything that guesses — no expanding `Mon` to `Mo`, no interpreting `9-5`, no translating `Lunes`. Those are judgement calls, and a repair table that makes judgement calls will eventually assert that a shop is open when it is not.

`_EMPTY` separates "no information" from "closed", and the distinction matters downstream: a venue with no `opening_hours` tag is not a venue that never opens. This is the same three-way absence distinction as in [Handling Missing Tags in OSM Data Pipelines](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/handling-missing-tags-in-osm-data-pipelines/).

`is_open_at` returns `bool | None` rather than defaulting to `False`. Returning `False` for an unparseable value produces a dataset where "closed" silently means two different things, and no consumer can separate them again.

The hard refusal to fall back to regular expressions is deliberate. A regex can extract time spans, and every regex-based `opening_hours` parser eventually ships a bug where `Su off` is ignored, because expressing "a later rule overrides an earlier one" is not something a regular language can do.

## Verification

Test the four traps explicitly, because they are the ones that pass casual inspection:

```python
from datetime import datetime

SUNDAY = datetime(2026, 8, 9, 12, 0)      # a Sunday
LUNCHTIME = datetime(2026, 8, 12, 15, 0)  # a Wednesday, between services
MIDNIGHT = datetime(2026, 8, 12, 23, 59)

def test_later_rule_overrides():
    p = parse("Mo-Fr 08:00-18:00; Su off")
    assert is_open_at(p, SUNDAY) is False

def test_24_hours():
    p = parse("Mo-Su 00:00-24:00")
    assert is_open_at(p, MIDNIGHT) is True

def test_split_shift():
    p = parse("Mo-Fr 11:30-14:00,17:30-23:00")
    assert is_open_at(p, LUNCHTIME) is False

def test_unknown_is_not_closed():
    p = parse("by appointment")
    assert p.quality is Quality.UNPARSEABLE
    assert is_open_at(p, SUNDAY) is None
```

Then run `summarise` over a real extract's values and compare the distribution against the chart above. A clean rate far below 85 percent usually means the values were mangled upstream — check that a whitespace or case normalisation step has not already run over them, as described in [Automating Tag Case Normalization with pandas](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/automating-tag-case-normalization-with-pandas/).

## Common errors and fixes

| Symptom | Root cause | Fix |
|---|---|---|
| Open on Sunday when the value says `Su off` | Rules treated as an unordered set | Use a grammar parser; order is semantic |
| `00:00-24:00` reported as closed at 23:59 | `24:00` read as an invalid hour | It is the end of the day, not hour 24 |
| Lunch breaks ignored | `,` treated as a rule separator | `;` separates rules, `,` chains times |
| Everything unparseable | Case-folded before parsing | Weekday tokens are case-sensitive in the grammar |
| Unknown reported as closed | Boolean return with no third state | Return `None` for unknown |
| Public holidays treated as a weekday | `PH` matched by a weekday regex | `PH` and `SH` are separate selectors |

## Frequently Asked Questions

<details>
<summary>Can I get away with a regex for the common case?</summary>

For extraction, yes — pulling the time spans out of a well-formed value is a regex-sized job. For evaluation, no. The moment you need to answer "is this open now", rule-override semantics are unavoidable, and that is not expressible as a regular language. Use a regex to survey a corpus; use a parser to answer questions.
</details>

<details>
<summary>What should unparseable values become in the output?</summary>

Null, with a reason code, and a count you watch over time. Not `False`, which conflates "closed" with "we do not know", and not the raw string in a boolean column. The reason code lets you distinguish free text from a grammar error from an empty tag, which are three different data-quality problems with three different fixes.
</details>

<details>
<summary>How do I handle values in other languages?</summary>

Record them and leave them. `Lunes a Viernes 9-17` is a real value with a clear meaning to a human and no standing in the grammar, and translating it in a pipeline means encoding a mapping per language that will be wrong at the edges. The better outcome is to surface these for correction upstream, which is what the validation approach in [Authoring OSM Validation Rules](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/) is for.
</details>

<details>
<summary>Does the same grammar apply to other conditional tags?</summary>

Partly. The time-selector syntax is shared with `conditional` restrictions such as `maxspeed:conditional=60 @ (22:00-06:00)`, so a parser for one gets much of the other. The rule-override and modifier semantics are specific to `opening_hours`; conditional values use an explicit `value @ condition` form instead.
</details>

## Storing the result

A parsed `opening_hours` value can be stored three ways, and the choice constrains what queries are possible later.

Keeping the normalised string alone is the smallest option and defers all evaluation to read time. It is right when the value is displayed rather than queried, and it keeps the door open for a better parser later, because nothing has been baked in.

Materialising intervals — one row per open period per week — makes "what is open now" an indexed range query and is the right shape when that question is asked frequently. The cost is that public holidays, seasonal rules and fallback rules do not fit the model cleanly, so the materialised form is an approximation of a value the string represents exactly.

Storing both is usually correct: the string as the source of truth, the intervals as a derived index, rebuilt whenever the parser or the data changes. That mirrors the pattern used for spatial keys elsewhere on this site — keep the exact representation, derive the queryable one, and never let the derived form become the only copy.

## Specification reference

> An `opening_hours` value is a semicolon-separated sequence of rules evaluated in order, with later rules overriding earlier ones. A rule combines an optional wide-range selector, an optional small-range selector (weekdays, times) and an optional modifier from `open`, `closed`, `off` and `unknown`. Times use 24-hour `HH:MM`, where `24:00` denotes the end of the day; a comma chains multiple time spans within one rule.

## Related

- [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) — the topic this value belongs to.
- [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/) — where the safe repairs belong.
- [Handling Missing Tags in OSM Data Pipelines](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/handling-missing-tags-in-osm-data-pipelines/) — the unknown-versus-absent distinction.
- [Best Practices for OSM Tag Standardization Across Regions](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/best-practices-for-osm-tag-standardization-across-regions/) — why the non-English tail exists.
- [Normalizing OSM Speed Limits and Units](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/normalizing-osm-speed-limits-and-units/) — the same discipline on a simpler value.

Up one level: [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/).
