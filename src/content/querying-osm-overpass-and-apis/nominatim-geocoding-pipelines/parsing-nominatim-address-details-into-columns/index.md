---
title: "Parsing Nominatim Address Details into Columns"
description: "Flatten the Nominatim address object into a stable typed table, coping with keys that vary by country, and assert that the components you queried actually matched."
pageTitle: "Flatten Nominatim Address Details into a Typed Table"
pageDescription: "Turn the variable Nominatim address object into fixed columns with a country-aware key fallback chain, then assert the queried street and city components really matched."
slug: parsing-nominatim-address-details-into-columns
type: article
breadcrumb: "Address Details to Columns"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Parsing Nominatim Address Details into Columns

Turn the address object Nominatim returns — whose keys change from country to country — into a fixed set of columns you can assert on, join on, and put in a schema.

## Prerequisites

- [ ] Geocoding results fetched with address details requested, as produced in [Batch Geocoding with Nominatim Without Getting Blocked](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/batch-geocoding-with-nominatim-without-getting-blocked/).
- [ ] Python 3.10+ with `pandas`; nothing else is required.
- [ ] The ranking model from [Nominatim Geocoding Pipelines](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/), because the assertions below compare what you asked for against what came back.
- [ ] A sample of results from every country in your data — the key variation is the whole problem.

## Conceptual minimum

The `address` object in a Nominatim response is not a fixed schema. It contains whichever administrative levels the geocoder used to build that particular place's hierarchy, and those differ by country and by how the region is mapped. A German result may carry `city`; a British one may carry `town`, `village` or `suburb` instead and no `city` at all; a rural result may carry `hamlet` and `county` but nothing in between.

Treating that object as a fixed record — reading `address["city"]` directly — produces a `KeyError` in some countries and a silently empty column in others. The correct model is a **fallback chain per output column**: one ordered list of candidate keys per concept, taking the first that is present.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="pna1-t pna1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="pna1-t">Which address keys carry the same concept in different places</title>
  <desc id="pna1-d">A grid mapping four output columns to the response keys that may carry them. The settlement column may arrive as city, town, village or hamlet depending on size and country. The district column may arrive as suburb, city district, borough or neighbourhood. The region column may arrive as state, province, region or county. The road column is comparatively stable but may arrive as road, pedestrian or footway for addresses on a path. A note warns that a fixed key read produces a silently empty column rather than an error.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">One concept, several possible keys</text>
  <rect x="176" y="48" width="226" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="289" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Primary key</text>
  <rect x="402" y="48" width="226" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="515" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Common alternates</text>
  <rect x="628" y="48" width="226" height="30" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="741" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">When it varies</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Settlement</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="289" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">city</text>
  <text x="515" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">town, village, hamlet</text>
  <text x="741" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">by size and country</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">District</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="289" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">suburb</text>
  <text x="515" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">city_district, borough</text>
  <text x="741" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">by mapping style</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Region</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="289" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">state</text>
  <text x="515" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">province, region, county</text>
  <text x="741" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">by country</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Road</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="289" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">road</text>
  <text x="515" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">pedestrian, footway</text>
  <text x="741" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">by way type</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Reading one fixed key per concept gives an empty column in every country that names it differently, and no error anywhere.</text>
</svg>
<figcaption>The variation is not noise: each alternate key is the correct term for that kind of place in that country.</figcaption>
</figure>

The second half of the problem is **assertion**. A geocode that fell back to a settlement centroid still returns a complete-looking address object — it simply has no `house_number` and no `road`. Comparing what you queried against what the address object contains is the only reliable way to know whether the match is at the level you needed, and it is far more trustworthy than reading the human-readable display name.

## Runnable solution

```python
from __future__ import annotations

import logging
from typing import Any

import pandas as pd

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.nominatim.address")

# One ordered fallback chain per output column. First present key wins.
CHAINS: dict[str, tuple[str, ...]] = {
    "house_number": ("house_number",),
    "road":         ("road", "pedestrian", "footway", "path"),
    "district":     ("suburb", "city_district", "borough", "neighbourhood",
                     "quarter", "residential"),
    "settlement":   ("city", "town", "village", "municipality", "hamlet"),
    "county":       ("county", "state_district"),
    "region":       ("state", "province", "region"),
    "postcode":     ("postcode",),
    "country":      ("country",),
    "country_code": ("country_code",),
}

# place_rank thresholds: the scale runs coarse (continent) to fine (address point).
RANK_HOUSE = 30
RANK_STREET = 26


def flatten_address(address: dict[str, Any]) -> dict[str, str | None]:
    """Collapse the variable address object onto a fixed set of columns."""
    row: dict[str, str | None] = {}
    for column, keys in CHAINS.items():
        row[column] = next((address[k] for k in keys if k in address), None)
    # Keep anything the chains did not claim, so nothing is silently discarded.
    claimed = {k for keys in CHAINS.values() for k in keys}
    leftover = {k: v for k, v in address.items() if k not in claimed}
    if leftover:
        logger.debug("unmapped address keys: %s", sorted(leftover))
    row["extra_keys"] = ";".join(sorted(leftover)) or None
    return row


def match_quality(queried_street: str | None, queried_city: str | None,
                  row: dict[str, str | None], place_rank: int) -> str:
    """Classify the match against what was actually asked for."""
    if place_rank >= RANK_HOUSE and row["house_number"]:
        level = "house"
    elif place_rank >= RANK_STREET and row["road"]:
        level = "street"
    elif row["settlement"]:
        level = "settlement"
    else:
        level = "coarse"

    # A street was asked for but the answer has none: this is a fallback, not a match.
    if queried_street and level in {"settlement", "coarse"}:
        return f"fallback_{level}"
    # The settlement came back different from the one asked for: probably wrong place.
    if queried_city and row["settlement"] and \
            queried_city.casefold() not in row["settlement"].casefold():
        return "settlement_mismatch"
    return level


def to_frame(results: list[dict[str, Any]]) -> pd.DataFrame:
    """Build a typed table from stored Nominatim results."""
    rows: list[dict[str, Any]] = []
    for result in results:
        flat = flatten_address(result.get("address", {}))
        rank = int(result.get("place_rank", -1))
        flat.update({
            "lat": float(result["lat"]),
            "lon": float(result["lon"]),
            "osm_key": f"{result.get('osm_type')}/{result.get('osm_id')}",
            "place_rank": rank,
            "quality": match_quality(result.get("_queried_street"),
                                     result.get("_queried_city"), flat, rank),
        })
        rows.append(flat)

    frame = pd.DataFrame(rows)
    # Every column is a string except the coordinates and the rank; be explicit,
    # or pandas will infer object dtype for postcodes with leading zeros.
    text_cols = [c for c in frame.columns
                 if c not in {"lat", "lon", "place_rank"}]
    frame[text_cols] = frame[text_cols].astype("string")
    counts = frame["quality"].value_counts().to_dict()
    logger.info("match quality: %s", counts)
    return frame


if __name__ == "__main__":
    sample = [{
        "lat": "50.0617", "lon": "19.9373", "osm_type": "way", "osm_id": 123,
        "place_rank": 26,
        "_queried_street": "Rynek Główny", "_queried_city": "Kraków",
        "address": {"road": "Rynek Główny", "suburb": "Stare Miasto",
                    "city": "Kraków", "postcode": "31-042",
                    "country": "Polska", "country_code": "pl"},
    }]
    logger.info("\n%s", to_frame(sample)[["road", "settlement", "quality"]])
```

## Step-by-step walkthrough

1. **One chain per concept.** Each output column names an ordered tuple of candidate keys. The first present key wins, so a British `town` and a German `city` both land in `settlement`.
2. **Order the chains by specificity, not alphabetically.** `city` before `town` before `village` before `hamlet` means a result carrying two of them picks the more specific, which is what a human would do.
3. **Never discard silently.** Keys no chain claimed are recorded in `extra_keys` and logged at debug level. That list is how you discover a country whose hierarchy you had not seen before.
4. **Classify rather than score.** `match_quality` returns a label — `house`, `street`, `settlement`, `fallback_settlement`, `settlement_mismatch` — because a label is actionable in a pipeline and a numeric confidence is not.
5. **Compare against what was queried.** A street-level query that comes back with only a settlement is a fallback, and the label says so. This is the assertion the whole page exists for.
6. **Catch the wrong-place case.** If the returned settlement does not contain the queried city as a substring, the result is probably in the wrong place even though it looks complete.
7. **Set dtypes explicitly.** Postcodes with leading zeros become integers under type inference and lose the zeros. Declaring string dtype on every non-numeric column prevents a whole family of quiet data loss.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="pna2-t pna2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="pna2-t">How a raw address object becomes an assertable row</title>
  <desc id="pna2-d">Four steps. The chain step resolves each output column by taking the first present key from an ordered candidate list. The capture step records any keys no chain claimed, so an unfamiliar country hierarchy is discovered rather than dropped. The classify step compares the resolved row and the place rank against what was originally queried and assigns a match label. The type step declares explicit string types so postcodes with leading zeros survive.</desc>
  <defs><marker id="pna2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four steps, and only the third one is a judgement</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">chain</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">first present key wins</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">ordered by specificity</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#pna2-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">capture</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">keep unclaimed keys</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">discovers new countries</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#pna2-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">classify</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">queried vs returned</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">a label, not a score</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#pna2-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">type</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">explicit string dtypes</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">leading zeros survive</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Step two is what keeps this code honest over time: without it, a country you have never seen just produces empty columns.</text>
</svg>
<figcaption>Only the classification is a judgement call, and it is deliberately a label so downstream code can branch on it.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 239" role="img" aria-labelledby="pna3-t pna3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="pna3-t">The five match labels this parser emits and what each one means for the pipeline</title>
  <desc id="pna3-d">Three panels grouping the match labels. The accepted group covers house and street level matches, where the queried component appears in the returned address and the place rank is fine enough. The review group covers settlement level matches and fallbacks, where the geocoder answered with a containing place because nothing finer matched, so the coordinate is a centroid rather than a location. The reject group covers settlement mismatches and coarse results, where the returned place does not correspond to what was asked for at all.</desc>
  <rect x="0" y="0" width="880" height="239" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Labels, not scores, so downstream code can branch</text>
  <rect x="26" y="52" width="259" height="153" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Accept</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">house: number and road present</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">street: road present, fine rank</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Queried component came back</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Coordinate is a real location</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Safe to store and join on</text>
  <rect x="311" y="52" width="259" height="153" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Review</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">settlement: only a place matched</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">fallback_settlement: street asked</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Coordinate is a centroid</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Not the address you wanted</text>
  <text x="325" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Route to a human or reject</text>
  <rect x="595" y="52" width="259" height="153" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Reject</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">settlement_mismatch: wrong place</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">coarse: nothing usable matched</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Looks complete, is not</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Storing these poisons joins</text>
  <text x="609" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Fail the row explicitly</text>
  <text x="868" y="223" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The middle group is the dangerous one: a settlement centroid is a valid coordinate that is simply not the answer to the question asked.</text>
</svg>
<figcaption>Splitting into three actions rather than a single confidence number is what lets the pipeline route rows without a threshold argument.</figcaption>
</figure>

## Verification

- **No column is entirely empty for a country.** Group by `country_code` and count non-null values per column; an all-null `settlement` for one country means a missing key in the chain.
- **`extra_keys` is usually empty.** A high rate of unmapped keys means the chains need extending for a region in your data.
- **Fallback labels are a small minority.** A large share of `fallback_settlement` means the queries were more specific than the available data, which is a data question, not a parsing one.
- **Postcodes retain leading zeros.** Check a known postcode that starts with zero; if it lost the zero, the dtype declaration is not being applied.
- **`settlement_mismatch` rows are genuinely wrong.** Spot-check a handful; if they are actually correct, the substring comparison is too strict for that country's naming.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| `KeyError: 'city'` | Fixed key read against a variable object | Use an ordered fallback chain per column |
| Settlement column empty for one country | That country uses `town` or `village` | Extend the chain and re-run over stored results |
| Postcodes lost leading zeros | Pandas inferred an integer dtype | Declare string dtype on every non-numeric column |
| Every row labelled `house` | Rank threshold compared against the wrong scale | Read the place rank scale before setting thresholds |
| Fallbacks stored as real matches | No comparison against the queried components | Classify each row against what was actually asked |
| `settlement_mismatch` on correct rows | Substring test too strict for local naming | Compare on a normalised form, or relax to a token test |
| Unmapped keys never noticed | Leftovers dropped rather than recorded | Record unclaimed keys in a column and review them |

## Specification reference

> With `addressdetails` enabled, a Nominatim result includes an `address` object whose members are the elements of the computed address hierarchy for that place. Which members are present depends on the administrative structure of the country and on what is mapped, so consumers must treat the object as a variable set of keys rather than a fixed record. See the [Nominatim search API documentation](https://nominatim.org/release-docs/latest/api/Search/) for the response structure and the `addressdetails` parameter.

## Frequently Asked Questions

<details>
<summary>Why does the address object have different keys in different countries?</summary>

Because it reflects the administrative hierarchy that actually exists where the place is, and those hierarchies genuinely differ. A settlement that is a city in one country is a town or a village in another, and some countries have an intermediate level between the city and the region that others do not. The variation is correct; what is incorrect is consuming code that assumes one fixed shape. Resolve each concept through an ordered list of candidate keys instead.
</details>

<details>
<summary>How do I know whether a result actually matched the street I asked for?</summary>

Compare what you queried against what the address object contains, and read the place rank alongside it. A street-level query that returns an address object with no road member, or a rank coarser than street level, has fallen back to a containing settlement. Both signals are available on every result and neither is visible in the display name, which is why the display name should not be the basis of the decision.
</details>

<details>
<summary>Should I keep the display name at all?</summary>

Keep it for human review and never for logic. It is a formatted string assembled for presentation, its composition varies with the result type and the requested language, and parsing it back into components reintroduces exactly the ambiguity the structured address object exists to remove. Store it, show it to reviewers, and branch on the parsed columns.
</details>

<details>
<summary>What should I do with address keys my chains do not cover?</summary>

Record them rather than dropping them. A column listing the unclaimed keys per row costs almost nothing and is the only way you will notice that a new country in your data uses a level you have never handled. Review it periodically, extend the chains when a pattern appears, and re-run the flattening over the stored results — which is free, because the geocoding itself was already cached.
</details>

## Related

- [Nominatim Geocoding Pipelines](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/) — the parent topic and the ranking model these assertions read.
- [Batch Geocoding with Nominatim Without Getting Blocked](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/batch-geocoding-with-nominatim-without-getting-blocked/) — where the stored results this page flattens come from.
- [Validating OSM Address Tags Against a Reference](https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/validating-osm-address-tags-against-a-reference/) — the quality check that consumes this table.
- [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) — the address namespace the hierarchy is built from.
- [Mapping OSM Tags to a Fixed Schema with YAML](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/mapping-osm-tags-to-a-fixed-schema-with-yaml/) — the same fallback-chain idea applied to tags.

Up one level: [Nominatim Geocoding Pipelines](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Parsing Nominatim Address Details into Columns",
  "description": "Flatten the Nominatim address object into a stable typed table, coping with keys that vary by country, and assert that the components you queried actually matched.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Querying OSM: Overpass, Nominatim & APIs",
  "about": ["Nominatim address details", "schema flattening", "geocode assertion"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Querying OSM: Overpass, Nominatim & APIs", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/" },
    { "@type": "ListItem", "position": 3, "name": "Nominatim Geocoding Pipelines", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/" },
    { "@type": "ListItem", "position": 4, "name": "Parsing Nominatim Address Details into Columns", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/parsing-nominatim-address-details-into-columns/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Flatten Nominatim address details into assertable columns",
  "description": "Resolve each output column through an ordered chain of candidate address keys, record unclaimed keys, classify the match against what was queried, and declare explicit string types.",
  "step": [
    { "@type": "HowToStep", "name": "Define a chain per concept", "text": "Give each output column an ordered tuple of candidate address keys and take the first one present." },
    { "@type": "HowToStep", "name": "Order by specificity", "text": "Place the more specific key first so a result carrying several levels resolves to the finest one." },
    { "@type": "HowToStep", "name": "Record unclaimed keys", "text": "Store the address keys no chain matched in their own column so unfamiliar hierarchies are discovered rather than dropped." },
    { "@type": "HowToStep", "name": "Classify the match", "text": "Compare the resolved components and the place rank against the queried street and city and emit a label such as house, street, fallback or mismatch." },
    { "@type": "HowToStep", "name": "Declare dtypes explicitly", "text": "Set string dtype on every non-numeric column so postcodes with leading zeros are not converted to integers." },
    { "@type": "HowToStep", "name": "Review by country", "text": "Group by country code and check that no column is entirely empty for any country in the data." }
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
      "name": "Why does the Nominatim address object have different keys in different countries?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because it reflects the administrative hierarchy that actually exists where the place is, and those hierarchies genuinely differ. A settlement that is a city in one country is a town or a village in another, and some countries have an intermediate level others do not. The variation is correct; what is incorrect is consuming code that assumes one fixed shape." }
    },
    {
      "@type": "Question",
      "name": "How do I know whether a result actually matched the street I asked for?",
      "acceptedAnswer": { "@type": "Answer", "text": "Compare what you queried against what the address object contains, and read the place rank alongside it. A street-level query that returns an address object with no road member, or a rank coarser than street level, has fallen back to a containing settlement. Both signals are available on every result and neither is visible in the display name." }
    },
    {
      "@type": "Question",
      "name": "Should I keep the Nominatim display name at all?",
      "acceptedAnswer": { "@type": "Answer", "text": "Keep it for human review and never for logic. It is a formatted string assembled for presentation, its composition varies with the result type and the requested language, and parsing it back into components reintroduces exactly the ambiguity the structured address object exists to remove." }
    },
    {
      "@type": "Question",
      "name": "What should I do with address keys my chains do not cover?",
      "acceptedAnswer": { "@type": "Answer", "text": "Record them rather than dropping them. A column listing the unclaimed keys per row costs almost nothing and is the only way you will notice that a new country in your data uses a level you have never handled. Review it periodically, extend the chains when a pattern appears, and re-run the flattening over the stored results." }
    }
  ]
}
</script>
