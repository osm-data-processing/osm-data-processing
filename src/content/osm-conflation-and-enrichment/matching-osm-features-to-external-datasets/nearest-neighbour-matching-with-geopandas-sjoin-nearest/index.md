---
title: "Nearest-Neighbour Matching with GeoPandas sjoin_nearest"
description: "Generate bounded conflation candidates at scale with a projected spatial join: a source-calibrated radius, a per-record candidate cap, and distances that mean metres rather than degrees."
pageTitle: "Bounded Candidate Generation with sjoin_nearest"
pageDescription: "Use GeoPandas sjoin_nearest for conflation candidate generation with a metric CRS, a calibrated max distance, a per-record cap, and deterministic ordering so runs are reproducible."
slug: nearest-neighbour-matching-with-geopandas-sjoin-nearest
type: article
breadcrumb: "Nearest-Neighbour Candidates"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Nearest-Neighbour Matching with GeoPandas sjoin_nearest

Turn two datasets into a bounded set of plausible pairings, with distances measured in metres, a cap that survives dense city centres, and an output that is identical on every run.

## Prerequisites

- [ ] Python 3.10+ with `geopandas` ≥ 0.14 and `shapely` ≥ 2.0.
- [ ] Both datasets loaded as frames with a declared CRS — an unset CRS is the root of most errors here.
- [ ] A calibrated radius for the external source, per [Matching OSM Features to External Datasets](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/).
- [ ] A metric projection appropriate to the area, from [Picking a UTM Zone for an OSM Extract](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/picking-a-utm-zone-for-an-osm-extract/).
- [ ] Stable identifiers on both sides, so candidate pairs can be joined back to their sources.

## Conceptual minimum

`sjoin_nearest` finds, for each row of the left frame, the nearest rows of the right frame, optionally within a maximum distance. Three properties decide whether it does what you want.

**Distance units follow the CRS.** In a geographic CRS the "distance" is in degrees, which is not a distance: a degree of longitude is 111 kilometres at the equator and 55 at sixty degrees north. A `max_distance` of 0.001 therefore means different things in different parts of one dataset. Reprojecting both frames to a metric CRS first is not an optimisation, it is a correctness requirement.

**It returns the nearest, not all within the radius.** By default it returns the single nearest match per left row. Candidate generation wants *several*, which means either raising the number returned or — more controllably — doing a radius join and ranking afterwards.

**Ties are resolved arbitrarily.** Two features at identical distance produce an order that depends on internal index layout, so two runs over the same data can differ. Sorting explicitly by distance and then by a stable identifier makes the output reproducible.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 306" role="img" aria-labelledby="nnm1-t nnm1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="nnm1-t">Choosing between a nearest join and a radius join for candidate generation</title>
  <desc id="nnm1-d">A decision node about how many candidates each record needs, with three outcomes. When exactly one match per record is wanted and the data is sparse, a nearest join with a maximum distance is simplest. When several candidates per record are needed for scoring, a buffer-and-join approach returns everything within the radius and lets you rank and cap afterwards. When the external side has polygons rather than points, an intersection join is more meaningful than any distance-based approach.</desc>
  <defs><marker id="nnm1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="306" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">How many candidates, and what geometry?</text>
  <rect x="26" y="117" width="250" height="88" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.6"/>
  <text x="151" y="145" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">One match, or several?</text>
  <text x="151" y="167" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Scoring needs several</text>
  <text x="151" y="185" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Cap them afterwards</text>
  <line x1="276" y1="161" x2="314" y2="161" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="314" y2="239" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="353" y2="83" stroke="currentColor" stroke-width="1.4" marker-end="url(#nnm1-a)"/>
  <rect x="356" y="52" width="498" height="62" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="370" y="77" font-size="12" font-weight="700" fill="currentColor">Nearest join</text>
  <text x="370" y="97" font-size="10.5" fill="currentColor" opacity="0.88">One candidate per record, sparse data, simplest code</text>
  <line x1="314" y1="161" x2="353" y2="161" stroke="currentColor" stroke-width="1.4" marker-end="url(#nnm1-a)"/>
  <rect x="356" y="130" width="498" height="62" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="370" y="155" font-size="12" font-weight="700" fill="currentColor">Buffer and join</text>
  <text x="370" y="175" font-size="10.5" fill="currentColor" opacity="0.88">Several candidates per record, ranked and capped after</text>
  <line x1="314" y1="239" x2="353" y2="239" stroke="currentColor" stroke-width="1.4" marker-end="url(#nnm1-a)"/>
  <rect x="356" y="208" width="498" height="62" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="370" y="233" font-size="12" font-weight="700" fill="currentColor">Intersection join</text>
  <text x="370" y="253" font-size="10.5" fill="currentColor" opacity="0.88">Polygon external data; containment beats distance</text>
  <text x="868" y="290" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Scoring on a single candidate throws away the runner-up gap, which is one of the most informative signals available.</text>
</svg>
<figcaption>The middle branch is the default for conflation precisely because the second-best candidate matters.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging

import geopandas as gpd
import pandas as pd

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.conflate.candidates")


def to_metric(frame: gpd.GeoDataFrame, epsg: int) -> gpd.GeoDataFrame:
    """Reproject to a metric CRS. Distances in degrees are not distances."""
    if frame.crs is None:
        raise ValueError("frame has no CRS; set it before reprojecting")
    return frame.to_crs(epsg=epsg)


def candidates(external: gpd.GeoDataFrame, osm: gpd.GeoDataFrame,
               radius_m: float, epsg: int, max_per_record: int = 10,
               left_id: str = "record_id",
               right_id: str = "osm_key") -> pd.DataFrame:
    """Every OSM feature within `radius_m` of each external record, ranked.

    Returns one row per candidate PAIR, with the distance and the rank, so the
    scoring stage can see the runner-up as well as the best candidate.
    """
    left = to_metric(external, epsg)
    right = to_metric(osm, epsg)
    for frame, name, key in ((left, "external", left_id), (right, "osm", right_id)):
        if key not in frame.columns:
            raise ValueError(f"{name} frame is missing the identifier {key!r}")

    # Buffer the left side and join: this returns EVERYTHING within the radius,
    # unlike a nearest join which returns only the closest.
    probe = left.copy()
    probe["geometry"] = probe.geometry.buffer(radius_m)
    pairs = gpd.sjoin(probe[[left_id, "geometry"]], right[[right_id, "geometry"]],
                      how="inner", predicate="intersects")
    logger.info("%d record(s) produced %d raw candidate pair(s)",
                len(left), len(pairs))

    # Recover the true point-to-feature distance; the buffer was only a filter.
    left_geom = left.set_index(left_id).geometry
    right_geom = right.set_index(right_id).geometry
    pairs = pairs.reset_index(drop=True)
    pairs["distance_m"] = [
        left_geom.loc[a].distance(right_geom.loc[b])
        for a, b in zip(pairs[left_id], pairs[right_id])
    ]

    # Deterministic order: distance, then the identifier, so ties never wobble.
    pairs = pairs.sort_values([left_id, "distance_m", right_id],
                              kind="mergesort").reset_index(drop=True)
    pairs["rank"] = pairs.groupby(left_id).cumcount()

    capped = pairs[pairs["rank"] < max_per_record].copy()
    dropped = len(pairs) - len(capped)
    if dropped:
        logger.warning("capped %d pair(s) beyond rank %d — those records are "
                       "dense enough to need review regardless of score",
                       dropped, max_per_record)

    per_record = capped.groupby(left_id).size()
    logger.info("candidates per record: median %.0f, max %d, %d record(s) with none",
                per_record.median() if len(per_record) else 0,
                per_record.max() if len(per_record) else 0,
                len(left) - per_record.shape[0])
    return capped[[left_id, right_id, "distance_m", "rank"]]


if __name__ == "__main__":
    logger.info("call candidates(external, osm, radius_m=120, epsg=32633)")
```

## Step-by-step walkthrough

1. **Refuse a missing CRS.** A frame without a declared CRS cannot be reprojected correctly, and silently treating its coordinates as degrees or metres is the single most damaging assumption available here.
2. **Reproject both sides to the same metric CRS.** Distances then mean metres everywhere in the dataset rather than varying with latitude.
3. **Require identifiers up front.** Checking for them before the expensive join turns a confusing merge error into a clear message.
4. **Buffer and intersect rather than joining nearest.** A nearest join returns one match; buffering the left side and intersecting returns everything within the radius, which is what a scoring stage needs.
5. **Recompute the true distance.** The buffer was only a spatial filter; the distance that matters is from the original point or geometry, not from the buffer's edge.
6. **Sort deterministically before ranking.** Distance first, then the identifier as a tie-break, with a stable sort. Without this, two runs over identical input can rank tied candidates differently.
7. **Cap per record and report it.** A record with more candidates than the cap is, by definition, in a dense area where the matcher is least reliable — the warning marks it for review rather than silently truncating.
8. **Report the distribution.** Median and maximum candidates per record, plus the count of records with none, are the three numbers that tell you whether the radius is sensible before any scoring runs.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 288" role="img" aria-labelledby="nnm2-t nnm2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="nnm2-t">How candidate count per record varies with the radius on one urban dataset</title>
  <desc id="nnm2-d">Five radii with the median number of candidates each produces per external record in an urban area. At twenty five metres the median is about one candidate and many records have none. At fifty metres the median is about two. At one hundred metres the median is about five. At two hundred metres the median is about fourteen. At four hundred metres the median is about forty, at which point the scoring stage is doing most of the work the spatial filter should have done.</desc>
  <rect x="0" y="0" width="880" height="288" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Candidates per record grow roughly with the square of the radius</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">radius 25 m</text>
  <rect x="216" y="60" width="13" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">median 1</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">radius 50 m</text>
  <rect x="216" y="100" width="26" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">median 2</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">radius 100 m</text>
  <rect x="216" y="140" width="65" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">median 5</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">radius 200 m</text>
  <rect x="216" y="180" width="181" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">median 14</text>
  <text x="26" y="234" font-size="11.5" font-weight="600" fill="currentColor">radius 400 m</text>
  <rect x="216" y="220" width="518" height="18" rx="4" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="854" y="234" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">median 40</text>
  <text x="868" y="272" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Area grows with the square of the radius, so doubling it roughly quadruples the pairs the scoring stage has to evaluate.</text>
</svg>
<figcaption>Calibrate the radius from the source's positional error, then let the cap handle the dense outliers.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 262" role="img" aria-labelledby="nnm3-t nnm3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="nnm3-t">The three numbers that tell you whether a candidate radius is right</title>
  <desc id="nnm3-d">Three diagnostic measurements taken before any scoring runs. The median candidates per record should sit in the low single digits: one means the radius is too tight to see rivals, thirty means the scoring stage is being asked to do the spatial filter's job. The share of records with no candidate at all should be small and explainable by genuine absence from the map rather than by a radius problem. The share of records hitting the per-record cap should be small and concentrated in dense urban areas.</desc>
  <rect x="0" y="0" width="880" height="262" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three numbers, read before any scoring</text>
  <rect x="26" y="50" width="828" height="52" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="42" y="72" font-size="12.5" font-weight="700" fill="currentColor">Median candidates</text>
  <text x="42" y="90" font-size="10.5" fill="currentColor" opacity="0.88">Two to six is healthy</text>
  <text x="838" y="82" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">one is too tight</text>
  <rect x="26" y="112" width="828" height="52" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="42" y="134" font-size="12.5" font-weight="700" fill="currentColor">Records with none</text>
  <text x="42" y="152" font-size="10.5" fill="currentColor" opacity="0.88">Small and explainable</text>
  <text x="838" y="144" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">most means a CRS bug</text>
  <rect x="26" y="174" width="828" height="52" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="42" y="196" font-size="12.5" font-weight="700" fill="currentColor">Records at the cap</text>
  <text x="42" y="214" font-size="10.5" fill="currentColor" opacity="0.88">Small and urban</text>
  <text x="838" y="206" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">scattered means trouble</text>
  <text x="868" y="246" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">All three come from the candidate stage alone, which means a mis-set radius is caught before any expensive scoring has run.</text>
</svg>
<figcaption>Reporting these three every run makes a radius regression obvious the first time somebody changes the projection.</figcaption>
</figure>

## Verification

- **Distances are plausible metres.** Spot-check a pair whose separation you can estimate; a value in the thousands where you expected tens means the CRS is wrong.
- **Two runs produce identical output.** Run twice and compare; any difference means the sort is not fully deterministic.
- **The median candidate count is small.** Two to six is a healthy range; a median of thirty means the radius is far too large.
- **Records with no candidates are plausible.** Some is normal; most means the radius is too small or the projections disagree.
- **The capped records are genuinely dense.** Sample a few and confirm they are in city centres rather than scattered arbitrarily.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Distances in the thousandths | Join run in a geographic CRS | Reproject both frames to a metric CRS first |
| Radius behaves differently by latitude | Degrees used as a distance | Same fix: project before measuring |
| Only one candidate per record | Nearest join used instead of a radius join | Buffer the left side and intersect |
| Output differs between runs | Ties broken by index order | Sort by distance then identifier with a stable sort |
| Memory exhausted on a large join | Radius far too large for the density | Calibrate the radius; cap candidates per record |
| Merge fails after the join | Identifier columns missing or renamed | Assert both identifiers exist before joining |
| Every record has zero candidates | The two frames are in different places | Check both CRS declarations and the bounding boxes |

## Specification reference

> `GeoDataFrame.sjoin_nearest` joins each geometry in the left frame to the nearest geometries in the right frame, optionally limited by `max_distance`, and reports the separation in a distance column. Distances are computed in the units of the frames' coordinate reference system, so a geographic CRS yields degrees rather than a metric distance. See the [GeoPandas spatial joins documentation](https://geopandas.org/en/stable/docs/user_guide/mergingdata.html) for the join predicates, the distance column and the CRS requirements.

## Frequently Asked Questions

<details>
<summary>Why reproject before a spatial join?</summary>

Because distance in a geographic CRS is measured in degrees, and a degree is not a fixed distance. A degree of longitude spans about 111 kilometres at the equator and about 55 at sixty degrees north, so a single maximum-distance value silently means two different radii in two parts of the same dataset. Reprojecting both frames to a metric CRS makes the radius mean the same thing everywhere.
</details>

<details>
<summary>Should I use a nearest join or a radius join?</summary>

A radius join, for conflation. A nearest join returns the single closest feature, which discards the runner-up — and the gap between the best and second-best candidate is one of the most informative signals available for deciding whether a match is confident or ambiguous. Buffer the external side, intersect, then rank and cap, which gives the scoring stage everything it needs.
</details>

<details>
<summary>How many candidates per record should I keep?</summary>

Enough to include the true match and its nearest rivals, which in practice is a handful. Ten is a generous cap that costs little. The more useful observation is that a record legitimately exceeding the cap is in a dense area where distance-based matching is least reliable, so those records should be flagged for review regardless of what the scoring eventually says about them.
</details>

<details>
<summary>Why do two runs produce different candidate sets?</summary>

Because ties are being broken by whatever order the spatial index happened to return. Two features at exactly the same distance have no inherent ordering, so the result depends on internal layout that can change between runs or library versions. Sorting explicitly by distance and then by a stable identifier, with a stable sort algorithm, removes the nondeterminism entirely.
</details>

## Related

- [Matching OSM Features to External Datasets](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/) — the parent topic and the calibration behind the radius.
- [Scoring Conflation Candidates with Multiple Signals](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/scoring-conflation-candidates-with-multiple-signals/) — what consumes these candidate pairs.
- [Accelerating Point-in-Polygon Joins on OSM Data](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/accelerating-point-in-polygon-joins-on-osm-data/) — the same indexing techniques for containment rather than proximity.
- [Picking a UTM Zone for an OSM Extract](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/picking-a-utm-zone-for-an-osm-extract/) — choosing the metric CRS this join needs.
- [Building an R-tree Index over OSM Geometries](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/building-an-rtree-index-over-osm-geometries/) — the index a spatial join uses underneath.

Up one level: [Matching OSM Features to External Datasets](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Nearest-Neighbour Matching with GeoPandas sjoin_nearest",
  "description": "Generate bounded conflation candidates at scale with a projected spatial join: a source-calibrated radius, a per-record candidate cap, and distances that mean metres rather than degrees.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Conflation & Data Enrichment",
  "about": ["spatial join", "candidate generation", "metric projection"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Conflation & Data Enrichment", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/" },
    { "@type": "ListItem", "position": 3, "name": "Matching OSM Features to External Datasets", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/" },
    { "@type": "ListItem", "position": 4, "name": "Nearest-Neighbour Matching with GeoPandas sjoin_nearest", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/nearest-neighbour-matching-with-geopandas-sjoin-nearest/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Generate bounded conflation candidates with a spatial join",
  "description": "Reproject both frames to a metric CRS, buffer the external side by a calibrated radius, intersect to collect all nearby features, recompute true distances, sort deterministically and cap per record.",
  "step": [
    { "@type": "HowToStep", "name": "Require and reproject the CRS", "text": "Refuse frames without a declared coordinate reference system and reproject both to the same metric projection." },
    { "@type": "HowToStep", "name": "Assert the identifiers", "text": "Check that both frames carry stable identifier columns before the join, so pairs can be traced back to their sources." },
    { "@type": "HowToStep", "name": "Buffer and intersect", "text": "Buffer the external geometries by the calibrated radius and intersect with the OSM frame to collect every nearby feature." },
    { "@type": "HowToStep", "name": "Recompute true distance", "text": "Measure the separation between the original geometries rather than using the buffer as the distance." },
    { "@type": "HowToStep", "name": "Sort deterministically", "text": "Order by distance then by identifier with a stable sort so tied candidates rank identically on every run." },
    { "@type": "HowToStep", "name": "Cap and report", "text": "Keep a bounded number of candidates per record, flag records that exceeded the cap, and report the candidate-count distribution." }
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
      "name": "Why reproject before a spatial join for conflation?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because distance in a geographic CRS is measured in degrees, and a degree is not a fixed distance. A degree of longitude spans about 111 kilometres at the equator and about 55 at sixty degrees north, so one maximum-distance value silently means two different radii in two parts of the same dataset." }
    },
    {
      "@type": "Question",
      "name": "Should I use a nearest join or a radius join for conflation?",
      "acceptedAnswer": { "@type": "Answer", "text": "A radius join. A nearest join returns the single closest feature, which discards the runner-up — and the gap between the best and second-best candidate is one of the most informative signals for deciding whether a match is confident or ambiguous. Buffer the external side, intersect, then rank and cap." }
    },
    {
      "@type": "Question",
      "name": "How many conflation candidates per record should I keep?",
      "acceptedAnswer": { "@type": "Answer", "text": "Enough to include the true match and its nearest rivals, which in practice is a handful; ten is a generous cap. More usefully, a record legitimately exceeding the cap is in a dense area where distance-based matching is least reliable, so those records should be flagged for review regardless of score." }
    },
    {
      "@type": "Question",
      "name": "Why do two runs produce different candidate sets?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because ties are being broken by whatever order the spatial index happened to return. Two features at exactly the same distance have no inherent ordering, so the result depends on internal layout that can change between runs. Sorting explicitly by distance then by a stable identifier, with a stable sort, removes the nondeterminism." }
    }
  ]
}
</script>
