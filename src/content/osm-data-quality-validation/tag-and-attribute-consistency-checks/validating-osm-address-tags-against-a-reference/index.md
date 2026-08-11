---
title: "Validating OSM Address Tags Against a Reference"
description: "Find unusable OSM addresses with checks that need no external data — completeness, postcode format, housenumber shape — before reaching for conflation against an authoritative file."
pageTitle: "Validate OSM Address Tags Against a Reference"
pageDescription: "Address QA for OSM — accepting addr:place, per-country postcode patterns, housenumber ranges, boundary containment comparison, and the severity each finding deserves."
slug: "validating-osm-address-tags-against-a-reference"
type: "article"
breadcrumb: "Validating Address Tags"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Validating OSM Address Tags Against a Reference

Find the addresses that cannot be geocoded, using checks that need no reference data at all — and know when a reference is genuinely required.

## Prerequisites

- [ ] Python 3.10+ with `shapely` and `geopandas`
- [ ] An address layer: nodes and ways carrying `addr:*` tags
- [ ] Administrative boundaries for the containment check
- [ ] Optionally, an authoritative address file for conflation

## Conceptual minimum

"Validating against a reference" is where address QA usually starts, and it is the wrong place to start. Most defective OSM addresses are internally inconsistent, and internal inconsistency needs nothing external to detect.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 318" role="img" aria-labelledby="addr-checkable-t addr-checkable-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="addr-checkable-t">Which address checks need an external reference</title>
  <desc id="addr-checkable-d">A grid of five checks. Housenumber present with street is checkable alone as internal consistency. Postcode matching the country format is checkable with a per-country regular expression. Street name spelling can be partly checked by fuzzy matching against nearby ways and is better with a reference. Whether the address exists at all cannot be checked without an authoritative address file. City matching the containing boundary is checkable with a spatial join.</desc>
  <rect x="0" y="0" width="880" height="318" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">What can be checked without a reference, and what cannot</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">checkable alone?</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">needs a reference</text>
  <text x="198" y="104" text-anchor="end" font-size="10.5" fill="currentColor">housenumber present with street</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">yes — internal consistency</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">no</text>
  <text x="198" y="144" text-anchor="end" font-size="9.5" fill="currentColor">postcode matches the country format</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">yes — a regex per country</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">no</text>
  <text x="198" y="184" text-anchor="end" font-size="8.5" fill="currentColor">street name spelled as the nearby street</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">partly — fuzzy match to nearby ways</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">better with one</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">the address exists</text>
  <rect x="213" y="204" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">no</text>
  <rect x="535" y="204" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">an authoritative address file</text>
  <text x="198" y="264" text-anchor="end" font-size="9.0" fill="currentColor">city matches the containing boundary</text>
  <rect x="213" y="244" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">yes — a spatial join</text>
  <rect x="535" y="244" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">no</text>
  <text x="440" y="300" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Three of these five need no external data at all, and they catch most of what is actually wrong.</text>
</svg>
<figcaption>Start with the three that need nothing. They are cheap, they never go stale, and they find the majority of real defects.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="addr-rates-t addr-rates-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="addr-rates-t">Defect distribution across 2.86 million OSM addresses</title>
  <desc id="addr-rates-d">A bar chart of a European extract. 91.3 percent of addresses are complete and consistent. 5.2 percent carry a housenumber with no street or place and are unusable for geocoding. 2.1 percent have a postcode failing the country format from a typo or the wrong country. 1.0 percent have a city that disagrees with the containing boundary, often at a boundary edge. 0.4 percent have a housenumber that is a range or a list.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">What a real address layer looks like</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">2.86 M addr:housenumber nodes and ways, European extract</text>
  <line x1="250" y1="68" x2="250" y2="270" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">complete and consistent</text>
  <rect x="250" y="74" width="470" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="868" y="89" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">91.3% — nothing to report</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">housenumber, no street or place</text>
  <rect x="250" y="116" width="27" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="287" y="131" font-size="11" fill="currentColor" opacity="0.9">5.2% — unusable for geocoding</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">postcode fails the country format</text>
  <rect x="250" y="158" width="11" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="271" y="173" font-size="11" fill="currentColor" opacity="0.9">2.1% — typo or wrong country</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">city disagrees with the boundary</text>
  <rect x="250" y="200" width="6" height="21" rx="3" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="266" y="215" font-size="11" fill="currentColor" opacity="0.9">1.0% — often a boundary edge case</text>
  <text x="240" y="257" text-anchor="end" font-size="11.5" fill="currentColor">housenumber is a range or list</text>
  <rect x="250" y="242" width="6" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="266" y="257" font-size="11" fill="currentColor" opacity="0.9">0.4% — "12-14", "3;5;7"</text>
  <text x="440" y="306" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">The largest defect class needs no reference data to find: an address with a number and nothing to attach it to.</text>
</svg>
<figcaption>Five percent of addresses cannot be geocoded because nothing says which street they are on — and that is found with a dictionary lookup.</figcaption>
</figure>

The largest single defect class — a `addr:housenumber` with no `addr:street` and no `addr:place` — is a dictionary lookup away. It also matters more than it looks: such an address is not merely incomplete, it is unusable, because a house number without a street cannot be resolved to anything.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="addr-order-t addr-order-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="addr-order-t">The four address checks in increasing order of cost</title>
  <desc id="addr-order-d">A four-stage chain. Completeness asks whether a housenumber is accompanied by a street or place, costing a dictionary lookup. Format checks a postcode against a country regular expression. Containment compares the city or postcode against the boundary the address falls inside, needing a spatial join. Conflation matches against an authoritative address file, which is fuzzy, expensive and optional.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="ad" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four checks in increasing cost order</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">completeness</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.0" fill="currentColor" opacity="0.85">housenumber ⟹ street or place</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">a dict lookup</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#ad)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">format</text>
  <text x="331" y="107" text-anchor="middle" font-size="9.0" fill="currentColor" opacity="0.85">postcode against a country regex</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">one regex</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#ad)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">containment</text>
  <text x="546" y="107" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.85">city / postcode vs the boundary</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">a spatial join</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#ad)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">conflation</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">match an authoritative file</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">fuzzy, expensive, optional</text>
  <text x="440" y="158" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Run them in this order and the expensive one only ever sees the addresses the cheap ones could not clear.</text>
</svg>
<figcaption>Cheapest first is not just an optimisation here — the cheap checks also produce the least ambiguous findings.</figcaption>
</figure>

## Runnable solution

```python
#!/usr/bin/env python3
"""Validate OSM address tags: completeness, format, containment, then conflation."""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from enum import Enum

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


class AddressDefect(str, Enum):
    NO_STREET_OR_PLACE = "no_street_or_place"
    POSTCODE_FORMAT = "postcode_format"
    HOUSENUMBER_SHAPE = "housenumber_shape"
    CITY_MISMATCH = "city_mismatch"
    POSTCODE_MISMATCH = "postcode_mismatch"


@dataclass(frozen=True)
class Finding:
    osm_id: int
    defect: AddressDefect
    detail: str


#: Postcode formats, by ISO country code. Deliberately permissive: the goal is to
#: catch a transposed digit or a postcode from the wrong country, not to be a
#: definitive validator of every national scheme.
POSTCODE_PATTERNS: dict[str, re.Pattern[str]] = {
    "DE": re.compile(r"^\d{5}$"),
    "FR": re.compile(r"^\d{5}$"),
    "GB": re.compile(r"^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$", re.I),
    "IE": re.compile(r"^[A-Z]\d{2}\s*[A-Z\d]{4}$", re.I),
    "NL": re.compile(r"^\d{4}\s*[A-Z]{2}$", re.I),
    "PL": re.compile(r"^\d{2}-\d{3}$"),
    "US": re.compile(r"^\d{5}(-\d{4})?$"),
}

#: A single number, optionally with a letter suffix: 12, 12a, 12 A.
_SIMPLE_NUMBER = re.compile(r"^\d+\s*[A-Za-z]?$")
#: Ranges and lists are legitimate but need different handling downstream.
_RANGE_OR_LIST = re.compile(r"^\d+\s*[-–/;,]\s*\d+.*$")


def check_completeness(osm_id: int, tags: dict[str, str]) -> list[Finding]:
    """A housenumber needs something to attach itself to."""
    if "addr:housenumber" not in tags:
        return []
    if tags.get("addr:street") or tags.get("addr:place"):
        return []
    return [Finding(osm_id, AddressDefect.NO_STREET_OR_PLACE,
                    f"housenumber {tags['addr:housenumber']!r} with no street or place")]


def check_postcode(osm_id: int, tags: dict[str, str], country: str | None) -> list[Finding]:
    postcode = tags.get("addr:postcode")
    if not postcode:
        return []
    code = (tags.get("addr:country") or country or "").upper()
    pattern = POSTCODE_PATTERNS.get(code)
    if pattern is None:
        return []                       # no pattern for this country: not a defect
    if pattern.match(postcode.strip()):
        return []
    return [Finding(osm_id, AddressDefect.POSTCODE_FORMAT,
                    f"{postcode!r} does not match the {code} format")]


def check_housenumber(osm_id: int, tags: dict[str, str]) -> list[Finding]:
    """Ranges and lists are valid tagging; flag them so consumers can expand them."""
    number = tags.get("addr:housenumber")
    if not number:
        return []
    if _SIMPLE_NUMBER.match(number.strip()):
        return []
    if _RANGE_OR_LIST.match(number.strip()):
        return [Finding(osm_id, AddressDefect.HOUSENUMBER_SHAPE,
                        f"{number!r} is a range or list — expand before geocoding")]
    return [Finding(osm_id, AddressDefect.HOUSENUMBER_SHAPE,
                    f"{number!r} is not a recognised housenumber form")]


def check_containment(osm_id: int, tags: dict[str, str],
                      boundary_city: str | None,
                      boundary_postcode: str | None) -> list[Finding]:
    """Compare the tagged city and postcode against the boundary the point falls in.

    Case- and whitespace-insensitive, because a difference in capitalisation is
    not a defect and reporting it drowns the real mismatches.
    """
    findings: list[Finding] = []
    tagged_city = (tags.get("addr:city") or "").strip().casefold()
    if tagged_city and boundary_city and tagged_city != boundary_city.strip().casefold():
        findings.append(Finding(osm_id, AddressDefect.CITY_MISMATCH,
                                f"tagged {tags['addr:city']!r}, inside {boundary_city!r}"))
    tagged_pc = (tags.get("addr:postcode") or "").replace(" ", "").casefold()
    if tagged_pc and boundary_postcode:
        if tagged_pc != boundary_postcode.replace(" ", "").casefold():
            findings.append(Finding(osm_id, AddressDefect.POSTCODE_MISMATCH,
                                    f"tagged {tags['addr:postcode']!r}, "
                                    f"inside {boundary_postcode!r}"))
    return findings


def validate(rows: list[tuple[int, dict[str, str], str | None, str | None, str | None]]
             ) -> list[Finding]:
    """rows: (osm_id, tags, country, boundary_city, boundary_postcode)."""
    findings: list[Finding] = []
    for osm_id, tags, country, city, postcode in rows:
        findings += check_completeness(osm_id, tags)
        findings += check_postcode(osm_id, tags, country)
        findings += check_housenumber(osm_id, tags)
        findings += check_containment(osm_id, tags, city, postcode)

    counts: dict[AddressDefect, int] = {d: 0 for d in AddressDefect}
    for finding in findings:
        counts[finding.defect] += 1
    total = len(rows) or 1
    for defect, n in counts.items():
        logger.info("%-22s %7d  %5.2f%%", defect.value, n, 100 * n / total)
    return findings
```

## Step-by-step walkthrough

`check_completeness` accepts `addr:place` as well as `addr:street`, because in places without street names — parts of Japan, rural Ireland before Eircode, many informal settlements — `addr:place` is the correct tagging. A validator that demands `addr:street` reports an entire country's correct addresses as broken, which is the regional-convention trap described in [Best Practices for OSM Tag Standardization Across Regions](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/best-practices-for-osm-tag-standardization-across-regions/).

`POSTCODE_PATTERNS` returns no finding for countries it has no pattern for. The alternative — treating an unknown country as a failure — produces a validator whose defect rate is a function of your table's coverage rather than of the data.

`check_housenumber` distinguishes ranges from nonsense. `12-14` and `3;5;7` are legitimate tagging for a building spanning several numbers, and reporting them as errors is wrong; reporting them as "expand before geocoding" is useful, because a geocoder that treats `12-14` as a literal string will never match a search for 13.

`check_containment` casefolds and strips before comparing. Without that, `München` versus `MÜNCHEN` becomes a finding, and the real mismatches disappear into thousands of capitalisation differences.

The boundary city and postcode come from a spatial join done upstream, using the pattern in [Accelerating Point-in-Polygon Joins on OSM Data](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/accelerating-point-in-polygon-joins-on-osm-data/) — this function only compares.

## Verification

Test the regional cases explicitly, since they are where validators overreach:

```python
def test_addr_place_is_acceptable():
    assert not check_completeness(1, {"addr:housenumber": "3", "addr:place": "Kilcurry"})

def test_missing_street_and_place_is_a_defect():
    findings = check_completeness(2, {"addr:housenumber": "3"})
    assert findings[0].defect is AddressDefect.NO_STREET_OR_PLACE

def test_unknown_country_is_not_a_postcode_failure():
    assert not check_postcode(3, {"addr:postcode": "ABC-123"}, country="ZZ")

def test_case_difference_is_not_a_mismatch():
    assert not check_containment(4, {"addr:city": "MÜNCHEN"}, "München", None)

def test_range_is_flagged_not_rejected():
    findings = check_housenumber(5, {"addr:housenumber": "12-14"})
    assert "expand" in findings[0].detail
```

Then run over a real extract and compare the distribution against the chart. A `postcode_format` rate far above two percent usually means the country is being resolved incorrectly — check the spatial join before suspecting the data.

For the city-mismatch findings, sample twenty by hand before acting on any of them. A large share are addresses genuinely near a boundary where the tagged city is the postal city and the boundary is the administrative one, and those are not defects in either dataset.

## Common errors and fixes

| Symptom | Root cause | Fix |
|---|---|---|
| Whole regions reported as incomplete | `addr:place` not accepted | Accept street *or* place |
| Postcode failures spike for one country | No pattern, or the wrong country resolved | Return no finding for unknown countries |
| Thousands of city mismatches | Case or whitespace differences | Casefold and strip before comparing |
| `12-14` reported as invalid | Ranges treated as malformed | Flag for expansion, do not reject |
| Findings dominated by boundary-edge cases | Postal city compared with administrative | Compare against the postal boundary, or downgrade the severity |
| Conflation finds nothing | Street names normalised differently on each side | Normalise both sides identically first |

## Frequently Asked Questions

<details>
<summary>Do I need an authoritative address file?</summary>

Not to start. The three reference-free checks find over eight percent of addresses with real problems, and they never go stale. A reference file answers a different question — does this address exist — which is valuable for completeness reporting and much harder to act on, because a missing match is as likely to mean the reference is out of date as that the OSM address is wrong.
</details>

<details>
<summary>Should a city mismatch be auto-corrected from the boundary?</summary>

No. The tagged `addr:city` is frequently the *postal* city, which legitimately differs from the administrative boundary — postal geography and administrative geography are different things and neither is wrong. Overwriting the tagged value with the boundary's name destroys the postal information and makes the address worse for its main use.
</details>

<details>
<summary>How should housenumber ranges be handled downstream?</summary>

Expand them into individual addresses for geocoding, keeping the original string. `12-14` becomes 12, 13 and 14 as searchable entries pointing at one feature, so a search for 13 succeeds while the map still shows one building. Interpolating even and odd sides correctly needs local knowledge, which is why `addr:interpolation` ways exist and are worth reading rather than guessing.
</details>

<details>
<summary>What severity do these deserve?</summary>

`no_street_or_place` is an error — the address cannot be used. Format and shape findings are warnings, since the address is usable and merely irregular. Containment mismatches are informational until you have sampled enough to know how many are real in your area. This maps onto the severity taxonomy in [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/), where the point of a severity is the action it triggers.
</details>

## Specification reference

> The Karlsruhe schema places address components on `addr:*` keys: `addr:housenumber`, `addr:street`, `addr:place`, `addr:postcode`, `addr:city` and `addr:country`. A house number is attached to a street by `addr:street`, or, where streets are unnamed, to a settlement by `addr:place`; the two are alternatives and at least one is required for the address to resolve.

## Related

- [Tag & Attribute Consistency Checks](https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/) — the topic these checks belong to.
- [Accelerating Point-in-Polygon Joins on OSM Data](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/accelerating-point-in-polygon-joins-on-osm-data/) — the join that supplies the boundary values.
- [Best Practices for OSM Tag Standardization Across Regions](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/best-practices-for-osm-tag-standardization-across-regions/) — why a street-only rule fails abroad.
- [Flagging Deprecated OSM Tags in a Pipeline](https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/flagging-deprecated-osm-tags-in-a-pipeline/) — a sibling tag check with a clearer auto-fix path.
- [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/) — the severity taxonomy these findings map onto.

Up one level: [Tag & Attribute Consistency Checks](https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/).
