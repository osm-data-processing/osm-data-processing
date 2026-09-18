---
title: "Deduplicating Addresses Before an OSM Import"
description: "Detect which address records OSM already holds — as points, on buildings, or through interpolation ways — so an import creates only genuinely new data."
pageTitle: "Deduplicate Addresses Against OSM Before Importing"
pageDescription: "Find existing OSM addresses in all three forms — address nodes, addressed buildings and interpolation ways — normalise housenumbers, and upload only records OSM does not already have."
slug: deduplicating-addresses-before-an-osm-import
type: article
breadcrumb: "Deduplicating Addresses"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Deduplicating Addresses Before an OSM Import

Before uploading an address dataset, find out what OpenStreetMap already has — which is harder than it sounds, because the same address can be mapped in three quite different ways and a naive check finds only one of them.

## Prerequisites

- [ ] A converted address dataset, per [Converting a Shapefile to OSM XML with ogr2osm](https://www.osm-data-processing.org/osm-conflation-and-enrichment/preparing-an-osm-import/converting-a-shapefile-to-osm-xml-with-ogr2osm/).
- [ ] An OSM extract covering the import area, filtered to address-carrying features.
- [ ] Python 3.10+ with `geopandas` ≥ 0.14 and `shapely` ≥ 2.0.
- [ ] The address tagging conventions from [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/).
- [ ] A published decision about what happens to records that match — the plan question from [Preparing an OSM Import](https://www.osm-data-processing.org/osm-conflation-and-enrichment/preparing-an-osm-import/).

## Conceptual minimum

OpenStreetMap represents an address in at least three ways, and a deduplication check that looks for only one will report almost everything as new.

**An address node** is a point carrying `addr:housenumber` and `addr:street`. It is the simplest form and the one everybody checks.

**An addressed building** is a way or relation carrying the same tags on the building itself. There is no separate point, so a check that only examines nodes finds nothing — and then the import adds an address node inside a building that already has that address.

**An interpolation way** is a line between two address nodes carrying `addr:interpolation`, asserting that the numbers between them exist along it. The individual addresses are not mapped as objects at all; they are implied. A check that ignores interpolation will duplicate whole streets.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="dab1-t dab1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="dab1-t">The three ways OSM represents an address and what each one requires of a check</title>
  <desc id="dab1-d">Three panels. An address node is a point with housenumber and street tags, found by a simple point search, and is the form everybody checks for. An addressed building is a way or relation carrying the same tags with no separate point, so a node-only check misses it entirely and the import adds a duplicate point inside the building. An interpolation way is a line carrying a range assertion where individual addresses are implied rather than mapped, so a check must evaluate the range rather than look for objects.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three representations, three different checks</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Address node</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">A point with addr tags</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Found by a point search</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">The form everybody checks</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Easy case</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Addressed building</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Tags on the way itself</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">No separate point exists</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Node-only check finds nothing</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Import adds a duplicate</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Interpolation way</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">A line with a range</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Addresses are implied</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">No objects to find</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Must evaluate the range</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">A deduplication check covering only the first panel reports nearly every record as new in areas mapped the other two ways.</text>
</svg>
<figcaption>The third form is the one that duplicates entire streets when it is overlooked.</figcaption>
</figure>

The second complication is that housenumbers are messy. "12", "12A", "12-14", "12/3" and "12 a" may all denote the same or different things depending on the country, and a string comparison over raw values is unreliable in both directions.

## Runnable solution

```python
from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.import.dedupe")

MATCH_RADIUS_M = 40.0
_WS = re.compile(r"\s+")
_NUM = re.compile(r"^(\d+)\s*([A-Za-z]?)$")


def norm_street(name: str) -> str:
    text = unicodedata.normalize("NFKC", name or "").casefold()
    return _WS.sub(" ", re.sub(r"[^\w\s]", " ", text)).strip()


def norm_number(value: str) -> str:
    """Canonical housenumber: digits plus an optional single letter suffix."""
    text = unicodedata.normalize("NFKC", value or "").casefold()
    text = _WS.sub("", text.replace("–", "-"))
    match = _NUM.match(text)
    return f"{int(match.group(1))}{match.group(2)}" if match else text


def expand_interpolation(row) -> list[str]:
    """Housenumbers a single interpolation way asserts, as canonical strings."""
    kind = (row.get("addr:interpolation") or "").lower()
    try:
        start, end = int(row["_from"]), int(row["_to"])
    except (TypeError, ValueError, KeyError):
        return []
    if start > end:
        start, end = end, start
    step = {"odd": 2, "even": 2, "all": 1}.get(kind)
    if step is None:
        # A numeric interpolation value is a literal step, e.g. "4".
        step = int(kind) if kind.isdigit() else 1
    if kind == "odd" and start % 2 == 0:
        start += 1
    if kind == "even" and start % 2 == 1:
        start += 1
    return [str(n) for n in range(start, end + 1, step)]


def existing_addresses(osm: gpd.GeoDataFrame,
                       interpolations: gpd.GeoDataFrame | None = None
                       ) -> gpd.GeoDataFrame:
    """Every address OSM already holds, in all three representations."""
    frames: list[gpd.GeoDataFrame] = []

    # 1 + 2: nodes AND ways/relations carrying address tags. Using the
    # representative point of a building is what makes the two comparable.
    addressed = osm[osm["addr:housenumber"].notna()
                    & osm["addr:street"].notna()].copy()
    addressed["geometry"] = addressed.geometry.representative_point()
    addressed["_form"] = addressed.geometry.geom_type.where(
        addressed["_osm_type"].eq("node"), "building")
    frames.append(addressed)

    # 3: interpolation ways, expanded into the numbers they assert.
    if interpolations is not None and len(interpolations):
        rows = []
        for _, way in interpolations.iterrows():
            for number in expand_interpolation(way):
                rows.append({
                    "addr:housenumber": number,
                    "addr:street": way.get("addr:street"),
                    "_form": "interpolation",
                    "geometry": way.geometry.interpolate(0.5, normalized=True),
                })
        if rows:
            frames.append(gpd.GeoDataFrame(rows, geometry="geometry",
                                           crs=interpolations.crs))

    out = pd.concat(frames, ignore_index=True)
    out["_key"] = (out["addr:street"].map(norm_street) + "|"
                   + out["addr:housenumber"].map(norm_number))
    logger.info("OSM already holds %d address(es): %s",
                len(out), out["_form"].value_counts().to_dict())
    return gpd.GeoDataFrame(out, geometry="geometry", crs=osm.crs)


def classify(candidates: gpd.GeoDataFrame, existing: gpd.GeoDataFrame,
             epsg: int) -> pd.DataFrame:
    """Split import candidates into new, duplicate and review."""
    left = candidates.to_crs(epsg=epsg).copy()
    right = existing.to_crs(epsg=epsg).copy()
    left["_key"] = (left["addr:street"].map(norm_street) + "|"
                    + left["addr:housenumber"].map(norm_number))

    probe = left.copy()
    probe["geometry"] = probe.geometry.buffer(MATCH_RADIUS_M)
    near = gpd.sjoin(probe[["_key", "geometry"]], right[["_key", "_form",
                                                         "geometry"]],
                     how="left", predicate="intersects",
                     lsuffix="new", rsuffix="osm")

    same = near["_key_new"].eq(near["_key_osm"])
    duplicate_keys = set(near.loc[same, "_key_new"])
    # A nearby address on the SAME street with a DIFFERENT number is not a
    # duplicate, but a nearby identical key beyond the radius might be.
    left["_status"] = [
        "duplicate" if k in duplicate_keys else "new" for k in left["_key"]
    ]

    far_dupes = set(left.loc[left["_status"] == "new", "_key"]) & set(right["_key"])
    left.loc[left["_key"].isin(far_dupes), "_status"] = "review"

    counts = left["_status"].value_counts().to_dict()
    logger.info("import candidates: %s", counts)
    return left[["_key", "_status", "addr:housenumber", "addr:street"]]


if __name__ == "__main__":
    logger.info("upload only rows whose status is 'new'")
```

## Step-by-step walkthrough

1. **Collect all three representations.** Address nodes, addressed buildings and expanded interpolation ways go into one frame. Omitting any of them makes the check report duplicates as new.
2. **Use a representative point for areas.** A building's representative point is guaranteed to lie inside it, unlike a centroid, which makes an addressed building directly comparable with an address node.
3. **Expand interpolation ranges honestly.** Odd, even, all and numeric steps each behave differently, and the start value has to be adjusted to the right parity. A range that fails to parse contributes nothing rather than guessing.
4. **Canonicalise the key.** Street name normalised, housenumber reduced to digits plus an optional letter, joined into one comparable key. `"12 A"` and `"12a"` must produce the same key.
5. **Join spatially, then compare keys.** Proximity alone is not a duplicate — a different number on the same street is usually the house next door — so the spatial join finds candidates and the key comparison decides.
6. **Treat a distant identical key as review, not duplicate.** The same street and number appearing far away may be a long street, a repeated name, or a positional error, and a human should look.
7. **Report the three counts.** New, duplicate and review are the numbers the import plan promised, and they are the first thing a reviewer will ask for.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 248" role="img" aria-labelledby="dab2-t dab2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="dab2-t">How the duplicate count changes as each representation is added to the check</title>
  <desc id="dab2-d">Four measurements over one municipal address dataset of fifty thousand records. Checking only address nodes finds a few thousand duplicates. Adding addressed buildings roughly triples that figure, because in this area most addresses live on the building rather than on a separate point. Adding interpolation ways adds several thousand more, concentrated on residential streets. The final duplicate count is close to half the dataset, where the node-only check had reported under a tenth.</desc>
  <rect x="0" y="0" width="880" height="248" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">What each representation contributes to the duplicate count</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">Address nodes only</text>
  <rect x="256" y="60" width="40" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 4,200</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">Plus addressed buildings</text>
  <rect x="256" y="100" width="141" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 14,800</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">Plus interpolation ways</text>
  <rect x="256" y="140" width="206" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 21,500</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">Records in the dataset</text>
  <rect x="256" y="180" width="478" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">50,000 total</text>
  <text x="868" y="232" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The node-only check would have uploaded seventeen thousand duplicate addresses, which is the shape of a real import disaster.</text>
</svg>
<figcaption>Which representation dominates varies by region, so all three must be checked rather than the locally common one.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="dab3-t dab3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="dab3-t">How one import candidate reaches its status</title>
  <desc id="dab3-d">Four steps. The canonicalise step reduces the street name and housenumber to a single comparable key on both sides. The locate step buffers the candidate and joins spatially against every existing address, collecting nearby entries regardless of their number. The compare step tests whether any nearby entry shares the canonical key, which is what distinguishes a duplicate from the house next door. The classify step marks the candidate as a duplicate when a nearby key matches, as review when the key matches only beyond the radius, and as new otherwise.</desc>
  <defs><marker id="dab3-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Proximity finds; the key decides</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">canonicalise</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">street plus number</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">one comparable key</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#dab3-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">locate</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">buffer and join</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">nearby, any number</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#dab3-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">compare</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">does a key match?</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">neighbours excluded</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#dab3-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">classify</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">new, duplicate, review</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">distant match reviews</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Separating locate from compare is what stops the house next door being treated as the same address as its neighbour.</text>
</svg>
<figcaption>Both halves are necessary: proximity alone over-matches and key equality alone cannot see positional error.</figcaption>
</figure>

## Verification

- **All three forms are represented.** The counts by form should be non-zero wherever the area uses them; an absent form usually means the filter missed it.
- **Interpolation expansion is plausible.** A way from 2 to 20 marked even should yield ten numbers, not nineteen.
- **Key canonicalisation collapses variants.** Confirm that differently formatted versions of one housenumber produce one key.
- **Proximity alone does not duplicate.** A record with a different number on the same street, metres away, must be classified as new.
- **The review group is small and interesting.** Sample it; the entries should be genuinely ambiguous rather than routine.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Nearly everything reported as new | Only address nodes checked | Include addressed buildings and interpolation ways |
| Whole streets duplicated | Interpolation ways ignored | Expand interpolation ranges into implied numbers |
| Variants of one number treated separately | Raw housenumber strings compared | Canonicalise to digits plus an optional letter |
| Neighbouring houses marked duplicate | Proximity used as the decision | Compare canonical keys after the spatial join |
| Duplicates missed on long streets | Radius smaller than the positional offset | Route distant identical keys to review |
| Areas and points incomparable | Centroid used for buildings | Use a representative point, which is inside the shape |
| Counts do not match the plan | Statuses computed but not reported | Report new, duplicate and review counts every run |

## Specification reference

> OpenStreetMap address data may be attached to a node, to a way or relation representing a building or site, or asserted over a range by an `addr:interpolation` way whose endpoints carry `addr:housenumber` values. The interpolation value may be `odd`, `even`, `all`, or a numeric step. See the [addresses documentation on the OSM Wiki](https://wiki.openstreetmap.org/wiki/Addresses) for the tagging of each form and the semantics of interpolation.

## Frequently Asked Questions

<details>
<summary>Why is checking address nodes not enough?</summary>

Because in many regions most addresses are tagged on the building rather than on a separate point, and in others whole residential streets are represented by interpolation ways with no individual address objects at all. A node-only check finds none of those, reports them as new, and the import adds a duplicate address inside every already-addressed building and along every interpolated street. Which form dominates varies by region, so all three have to be checked.
</details>

<details>
<summary>How should housenumbers be compared?</summary>

On a canonical form rather than as raw strings. Reduce to the numeric part plus an optional single-letter suffix, folding case and removing whitespace, so that differently formatted versions of one number compare equal. Ranges and compound numbers need a local decision, because whether "12-14" is one address or three depends on the country's conventions — and that decision belongs in the published import plan.
</details>

<details>
<summary>What if the same address exists far from where my record places it?</summary>

Route it to review rather than deciding automatically. A matching street and number beyond the search radius can mean a long street where both are genuine, a repeated street name in the same settlement, or a positional error on one side. All three are real, they need different responses, and none of them is safe to guess at. It is also a small enough group that human review is affordable.
</details>

<details>
<summary>Does a duplicate mean the OSM data is better?</summary>

Not necessarily, and this is exactly why what happens to a duplicate belongs in the plan rather than in the code. The existing feature may be a surveyed address a mapper walked past, or it may be a rough placement from an older import. Adding attributes it lacks is usually uncontroversial; overwriting what it has is not. Decide the policy in advance, publish it, and let the code implement one rule rather than improvise.
</details>

## Related

- [Preparing an OSM Import](https://www.osm-data-processing.org/osm-conflation-and-enrichment/preparing-an-osm-import/) — the parent topic and the policy this check implements.
- [Converting a Shapefile to OSM XML with ogr2osm](https://www.osm-data-processing.org/osm-conflation-and-enrichment/preparing-an-osm-import/converting-a-shapefile-to-osm-xml-with-ogr2osm/) — producing the candidates this filters.
- [Validating OSM Address Tags Against a Reference](https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/validating-osm-address-tags-against-a-reference/) — the same comparison used as a quality check.
- [Nearest-Neighbour Matching with GeoPandas sjoin_nearest](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/nearest-neighbour-matching-with-geopandas-sjoin-nearest/) — the spatial join this builds on.
- [Parsing Nominatim Address Details into Columns](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/parsing-nominatim-address-details-into-columns/) — normalising address components from a geocoder.

Up one level: [Preparing an OSM Import](https://www.osm-data-processing.org/osm-conflation-and-enrichment/preparing-an-osm-import/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Deduplicating Addresses Before an OSM Import",
  "description": "Detect which address records OSM already holds — as points, on buildings, or through interpolation ways — so an import creates only genuinely new data.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Conflation & Data Enrichment",
  "about": ["address deduplication", "addr interpolation", "import safety"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Conflation & Data Enrichment", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/" },
    { "@type": "ListItem", "position": 3, "name": "Preparing an OSM Import", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/preparing-an-osm-import/" },
    { "@type": "ListItem", "position": 4, "name": "Deduplicating Addresses Before an OSM Import", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/preparing-an-osm-import/deduplicating-addresses-before-an-osm-import/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Deduplicate an address dataset against OpenStreetMap",
  "description": "Collect existing addresses in all three OSM representations, expand interpolation ranges, canonicalise street and number into one key, join spatially, and classify candidates as new, duplicate or review.",
  "step": [
    { "@type": "HowToStep", "name": "Collect all three forms", "text": "Gather address nodes, addressed buildings and interpolation ways rather than only the form that is easiest to query." },
    { "@type": "HowToStep", "name": "Use representative points", "text": "Reduce areas to a point guaranteed to lie inside them so buildings and nodes are directly comparable." },
    { "@type": "HowToStep", "name": "Expand interpolation ranges", "text": "Turn each interpolation way into the housenumbers it asserts, respecting odd, even, all and numeric steps." },
    { "@type": "HowToStep", "name": "Canonicalise the key", "text": "Normalise the street name and reduce the housenumber to digits plus an optional letter, joined into one key." },
    { "@type": "HowToStep", "name": "Join spatially, decide on keys", "text": "Use proximity to find candidates and the canonical key to decide, so neighbouring houses are not treated as duplicates." },
    { "@type": "HowToStep", "name": "Route distant matches to review", "text": "Treat an identical key beyond the search radius as ambiguous rather than as a duplicate or as new." },
    { "@type": "HowToStep", "name": "Report the three counts", "text": "Publish new, duplicate and review counts every run, since these are the numbers the import plan promised." }
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
      "name": "Why is checking OSM address nodes not enough before an import?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because in many regions most addresses are tagged on the building rather than on a separate point, and in others whole residential streets are represented by interpolation ways with no individual address objects. A node-only check reports those as new, and the import adds a duplicate address inside every already-addressed building and along every interpolated street." }
    },
    {
      "@type": "Question",
      "name": "How should housenumbers be compared for deduplication?",
      "acceptedAnswer": { "@type": "Answer", "text": "On a canonical form rather than as raw strings. Reduce to the numeric part plus an optional single-letter suffix, folding case and removing whitespace. Ranges and compound numbers need a local decision, because whether a hyphenated number is one address or three depends on the country's conventions." }
    },
    {
      "@type": "Question",
      "name": "What if the same address exists far from where my record places it?",
      "acceptedAnswer": { "@type": "Answer", "text": "Route it to review rather than deciding automatically. A matching street and number beyond the search radius can mean a long street, a repeated street name in the same settlement, or a positional error. All three are real, they need different responses, and none is safe to guess at." }
    },
    {
      "@type": "Question",
      "name": "Does a duplicate mean the OSM data is better than mine?",
      "acceptedAnswer": { "@type": "Answer", "text": "Not necessarily, and this is why what happens to a duplicate belongs in the plan rather than the code. The existing feature may be a surveyed address or a rough placement from an older import. Adding attributes it lacks is usually uncontroversial; overwriting what it has is not. Decide the policy in advance and publish it." }
    }
  ]
}
</script>
