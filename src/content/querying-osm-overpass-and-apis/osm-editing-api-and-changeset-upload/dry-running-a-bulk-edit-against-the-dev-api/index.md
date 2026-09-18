---
title: "Dry-Running a Bulk Edit Against the Dev API"
description: "Rehearse an automated OSM edit end to end on the development instance: seed the fixtures, run the real pipeline, diff the before and after, and produce the evidence a community review will ask for."
pageTitle: "Rehearse an OSM Bulk Edit on the Development API"
pageDescription: "Run the whole bulk-edit pipeline against the OSM development instance, seed realistic fixtures, capture a before-and-after diff, and publish the numbers a community review needs."
slug: dry-running-a-bulk-edit-against-the-dev-api
type: article
breadcrumb: "Dry Run on the Dev API"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Dry-Running a Bulk Edit Against the Dev API

Rehearse an automated edit on a throwaway copy of OpenStreetMap so that the first time your script touches the real map, nothing about its behaviour is a surprise to you or to the people reviewing it.

## Prerequisites

- [ ] A separate account on the development API instance — accounts are not shared with the live map, so you must register there specifically.
- [ ] An OAuth 2 token issued by that instance with write scope.
- [ ] The upload code from [Uploading an OSM Changeset from Python](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/uploading-an-osm-changeset-from-python/), with its endpoint configurable rather than hard-coded.
- [ ] The list of objects the real edit would touch, extracted from live data.
- [ ] Somewhere to publish the resulting evidence — a wiki page or a repository the community discussion can point at.

## Conceptual minimum

The development instance is a complete, separate deployment of the OpenStreetMap API. It has its own database, its own accounts, and — critically — **its own object identifiers**. An object with id 12345 there has no relationship to id 12345 on the live map.

That single fact shapes the whole rehearsal. You cannot simply point your script at the development endpoint and run it against live ids: the ids will either not exist or, worse, will exist and refer to something entirely unrelated. A meaningful dry run therefore has three parts: **seed** fixtures that resemble the real objects, **run** the genuine pipeline against them, and **diff** the result against what you predicted.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="dbe1-t dbe1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="dbe1-t">The four phases of a dry run and what each one proves</title>
  <desc id="dbe1-d">Four phases. The extract phase pulls the real objects the edit would touch from live data, without modifying them. The seed phase recreates equivalent objects on the development instance and records the mapping from live identifiers to development identifiers. The run phase executes the genuine pipeline against the development endpoint, exercising the same code paths including conflict handling. The diff phase compares the before and after states of every seeded object and produces the counts and samples a reviewer will ask for.</desc>
  <defs><marker id="dbe1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four phases, and only the third one is your normal code</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">extract</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">real objects, read only</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">the live map is untouched</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#dbe1-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">seed</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">recreate on dev</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">record the id mapping</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#dbe1-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">run</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">the genuine pipeline</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">same code, same paths</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#dbe1-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">diff</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">before versus after</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">counts and samples</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Seeding is the phase teams skip, and skipping it reduces the rehearsal to proving that HTTP works.</text>
</svg>
<figcaption>Without realistic fixtures a dry run tests the client library; with them it tests the edit.</figcaption>
</figure>

The fourth thing a dry run produces is not technical at all: **evidence**. A community discussion about a bulk edit goes very differently when you can say "here is the exact object count, here are twenty representative before-and-after pairs, and here is the changeset comment every upload will carry" than when you can only describe your intentions.

## Runnable solution

```python
from __future__ import annotations

import json
import logging
import os
import xml.etree.ElementTree as ET
from dataclasses import dataclass, asdict
from pathlib import Path

import requests

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.api.dryrun")

LIVE = "https://api.openstreetmap.org/api/0.6"
DEV = "https://master.apis.dev.openstreetmap.org/api/0.6"
DEV_TOKEN = os.environ["OSM_DEV_TOKEN"]
UA = "osm-pipeline-example/1.0 (contact@example.org)"


@dataclass
class SeedResult:
    live_id: int
    dev_id: int
    before_tags: dict[str, str]


def read_live_node(node_id: int) -> ET.Element:
    """Read only — the live map is never written during a rehearsal."""
    response = requests.get(f"{LIVE}/node/{node_id}",
                            headers={"User-Agent": UA}, timeout=30)
    response.raise_for_status()
    return ET.fromstring(response.content).find("node")


def seed_node(changeset_id: int, source: ET.Element) -> int:
    """Recreate an equivalent node on the dev instance; return its dev id."""
    root = ET.Element("osm")
    node = ET.SubElement(root, "node", {
        "changeset": str(changeset_id),
        "lat": source.get("lat"), "lon": source.get("lon"),
    })
    for tag in source.findall("tag"):
        ET.SubElement(node, "tag", {"k": tag.get("k"), "v": tag.get("v")})
    response = requests.put(
        f"{DEV}/node/create",
        headers={"Authorization": f"Bearer {DEV_TOKEN}", "User-Agent": UA},
        data=ET.tostring(root), timeout=30)
    response.raise_for_status()
    return int(response.text.strip())


def seed_fixtures(live_ids: list[int], changeset_id: int,
                  out: Path) -> list[SeedResult]:
    results: list[SeedResult] = []
    for live_id in live_ids:
        source = read_live_node(live_id)
        tags = {t.get("k"): t.get("v") for t in source.findall("tag")}
        dev_id = seed_node(changeset_id, source)
        results.append(SeedResult(live_id, dev_id, tags))
        logger.info("seeded live node %d as dev node %d", live_id, dev_id)
    out.write_text(json.dumps([asdict(r) for r in results], indent=2),
                   encoding="utf-8")
    return results


def diff_after_run(results: list[SeedResult]) -> dict[str, int]:
    """Compare every seeded object's current dev state against its before state."""
    counts = {"changed": 0, "unchanged": 0, "unexpected": 0}
    for result in results:
        response = requests.get(f"{DEV}/node/{result.dev_id}",
                                headers={"User-Agent": UA}, timeout=30)
        response.raise_for_status()
        node = ET.fromstring(response.content).find("node")
        after = {t.get("k"): t.get("v") for t in node.findall("tag")}
        if after == result.before_tags:
            counts["unchanged"] += 1
            continue
        removed = set(result.before_tags) - set(after)
        # Any key removed that the edit did not intend to remove is a red flag.
        if removed - {"shop"}:
            logger.error("dev node %d lost unexpected keys: %s",
                         result.dev_id, sorted(removed - {"shop"}))
            counts["unexpected"] += 1
        else:
            counts["changed"] += 1
    logger.info("dry-run diff: %s", counts)
    return counts


if __name__ == "__main__":
    logger.info("seed fixtures, run the real pipeline against DEV, then diff")
```

## Step-by-step walkthrough

1. **Read live, write dev.** The extraction reads the production API without authentication and never writes to it. Every write in the script targets the development endpoint.
2. **Recreate rather than assume.** Each fixture is created on the development instance from the live object's coordinates and tags, so the pipeline encounters realistic input including the messy tags real objects carry.
3. **Persist the id mapping.** The live-to-development id mapping is written to disk, because without it the diff cannot connect a development object back to the real one it stands for.
4. **Snapshot the before state.** Tags are captured at seed time. Reading them back after the run is the only way to know what the edit actually did rather than what it reported doing.
5. **Run the unmodified pipeline.** The point of the rehearsal is to exercise the real code, including its changeset metadata, its batching and its conflict path. A special dry-run mode inside the pipeline tests the dry-run mode, not the pipeline.
6. **Classify the diff three ways.** Changed as intended, unchanged, and — the important one — changed in a way that was not intended. The third bucket is where a partial-modify bug that strips tags shows up, and it must be zero.
7. **Publish the numbers.** The counts and a sample of before-and-after pairs are the evidence for the community discussion. They are also the baseline you compare the real run against.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="dbe2-t dbe2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="dbe2-t">What a dry run can and cannot tell you about a bulk edit</title>
  <desc id="dbe2-d">A grid of four questions against whether the dry run answers them. Whether the code works mechanically is fully answered. Whether the edit preserves untouched tags is fully answered by the before and after diff. Whether the tagging decision is correct for the region is not answered at all and needs community review. Whether concurrent editors will conflict is only partly answered, because the development instance has almost no other activity.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">A rehearsal answers two of these four questions</text>
  <rect x="256" y="48" width="299" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="406" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Dry run answers it?</text>
  <rect x="555" y="48" width="299" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="704" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">What closes the gap</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Does the code work?</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="406" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">fully</text>
  <text x="704" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">nothing else needed</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Are other tags preserved?</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="406" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">fully</text>
  <text x="704" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">the before/after diff</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Is the tagging correct?</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="406" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">not at all</text>
  <text x="704" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">community review</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Will edits conflict?</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="406" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">partly</text>
  <text x="704" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a small live pilot</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The bottom two rows are why a dry run is a prerequisite for a discussion rather than a substitute for one.</text>
</svg>
<figcaption>A green dry run proves the script is safe to run; it says nothing about whether the edit is a good idea.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 288" role="img" aria-labelledby="dbe3-t dbe3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="dbe3-t">Where a rehearsal typically finds its defects, by category</title>
  <desc id="dbe3-d">Five categories of defect ranked by how often a first dry run surfaces them. Incomplete modify elements that strip untouched tags are the most common finding. Selection queries that include or exclude objects the author did not expect come next. Changeset metadata templates that render empty or uninformative follow. Non-idempotent edits that keep changing objects on every run come next. Conflict handling that bumps the version is rarest but the most serious when present.</desc>
  <rect x="0" y="0" width="880" height="288" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">What a first dry run actually catches</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">Modify strips other tags</text>
  <rect x="286" y="60" width="448" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">most common</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">Selection off by a filter</text>
  <rect x="286" y="100" width="343" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">very common</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">Empty changeset comment</text>
  <rect x="286" y="140" width="237" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">common</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">Edit is not idempotent</text>
  <rect x="286" y="180" width="184" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">occasional</text>
  <text x="26" y="234" font-size="11.5" font-weight="600" fill="currentColor">Conflict handler bumps version</text>
  <rect x="286" y="220" width="105" height="18" rx="4" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="854" y="234" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">rare, worst</text>
  <text x="868" y="272" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The bottom row is rare because it only fires under concurrency, which is exactly why it survives into production when there is no rehearsal.</text>
</svg>
<figcaption>Four of these five produce no error at all when they happen — they simply change more, or less, than intended.</figcaption>
</figure>

## Verification

- **The unexpected-change count is zero.** Any object that lost a key the edit did not intend to remove is a blocking defect, not a curiosity.
- **The changed count matches the prediction.** Predict the number before running; a mismatch means the selection query and the edit disagree.
- **A second run changes nothing.** Re-running against the same fixtures should report everything unchanged, proving the edit is idempotent.
- **Changeset metadata is present on the dev changesets.** Fetch one and read the comment as a stranger would; if it does not explain the edit, fix the template now.
- **The conflict path fires.** Edit a seeded object through the development web interface mid-run and confirm the pipeline raises rather than overwriting.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Object not found on dev | Live ids used directly against the dev API | Seed fixtures and use the recorded id mapping |
| HTTP 401 against dev | Live token used on the development instance | Register separately and issue a dev-instance token |
| Dry run passes, live run fails | Pipeline has a special dry-run branch | Exercise the real code path; change only the endpoint |
| No difference detected | Before state never captured | Snapshot tags at seed time and diff after the run |
| Unexpected key removals | Partial tag set in the modify element | Rebuild elements from the complete merged tag set |
| Second run keeps editing | Edit is not idempotent | Skip objects whose merged state equals the current one |
| Reviewers still object | Evidence never published | Publish counts and before-and-after samples with the proposal |

## Specification reference

> The OpenStreetMap development API instance is a separate deployment intended for testing editing software. It requires its own user account and API tokens, its database is unrelated to the production database, and object identifiers assigned there have no correspondence to production identifiers. See the [OSM development API documentation](https://wiki.openstreetmap.org/wiki/API_v0.6) and the community's [automated edits code of conduct](https://wiki.openstreetmap.org/wiki/Automated_Edits_code_of_conduct) for the testing and discussion expectations that apply to bulk edits.

## Frequently Asked Questions

<details>
<summary>Can I use my normal OSM account on the development API?</summary>

No. The development instance has an entirely separate user database, so you must register an account there and issue tokens from it. This trips people up because the login page looks identical, and the resulting error is an unhelpful authentication failure rather than anything that names the cause. Keep the two sets of credentials in clearly distinct environment variables so the wrong one cannot be picked up by accident.
</details>

<details>
<summary>Why not just add a dry-run flag to the pipeline instead?</summary>

Because a flag that skips the upload tests everything except the part that actually changes data. The bugs that matter in a bulk edit — a modify element missing tags, a conflict handler that bumps the version, a changeset comment template that renders empty — all live in the code the flag would skip. Changing only the endpoint keeps every code path live while directing the consequences somewhere harmless.
</details>

<details>
<summary>How many fixtures should I seed?</summary>

Enough to cover the variety in the real selection rather than enough to be statistically large. Include the ordinary case, the objects with unusual extra tags, the ones with tags in non-Latin scripts, and any object your selection query only just includes or only just excludes. Fifty carefully chosen fixtures find more problems than a thousand copies of the same easy case.
</details>

<details>
<summary>Does a clean dry run mean the edit is ready?</summary>

It means the script is safe to run, which is necessary and not sufficient. A dry run cannot tell you whether the tagging change is correct for that region, whether local mappers have a convention you are about to flatten, or whether the source data is good enough to import. Those questions are answered by publishing the evidence the dry run produced and letting people who know the area respond.
</details>

## Related

- [The OSM Editing API & Changeset Upload](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/) — the parent topic and the review expectations a dry run feeds.
- [Uploading an OSM Changeset from Python](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/uploading-an-osm-changeset-from-python/) — the pipeline this rehearsal exercises unchanged.
- [Auditing a Conflation Run Before Upload](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/auditing-a-conflation-run-before-upload/) — the equivalent evidence pack for a conflation-driven edit.
- [Rolling Back a Bad OSM Import](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/rolling-back-a-bad-osm-import/) — the recovery path a dry run is meant to make unnecessary.
- [Setting Quality Thresholds That Fail a Build](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/setting-quality-thresholds-that-fail-a-build/) — turning the dry-run counts into an automated gate.

Up one level: [The OSM Editing API & Changeset Upload](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Dry-Running a Bulk Edit Against the Dev API",
  "description": "Rehearse an automated OSM edit end to end on the development instance: seed the fixtures, run the real pipeline, diff the before and after, and produce the evidence a community review will ask for.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Querying OSM: Overpass, Nominatim & APIs",
  "about": ["OSM development API", "bulk edit rehearsal", "automated edit review"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Querying OSM: Overpass, Nominatim & APIs", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/" },
    { "@type": "ListItem", "position": 3, "name": "The OSM Editing API & Changeset Upload", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/" },
    { "@type": "ListItem", "position": 4, "name": "Dry-Running a Bulk Edit Against the Dev API", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/dry-running-a-bulk-edit-against-the-dev-api/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Rehearse an OSM bulk edit on the development API",
  "description": "Extract the real target objects read-only, recreate them as fixtures on the development instance, run the unmodified pipeline against that endpoint, and diff before and after to produce review evidence.",
  "step": [
    { "@type": "HowToStep", "name": "Register separately", "text": "Create an account and issue an API token on the development instance, which shares nothing with the live map." },
    { "@type": "HowToStep", "name": "Extract the real objects", "text": "Read the objects the edit would touch from the production API without writing anything to it." },
    { "@type": "HowToStep", "name": "Seed realistic fixtures", "text": "Recreate equivalent objects on the development instance from their real coordinates and tags, and persist the identifier mapping." },
    { "@type": "HowToStep", "name": "Snapshot the before state", "text": "Record every fixture's tag set at seed time so the diff afterwards measures what the edit actually did." },
    { "@type": "HowToStep", "name": "Run the unmodified pipeline", "text": "Point the real code at the development endpoint through configuration, changing nothing else, so every code path is exercised." },
    { "@type": "HowToStep", "name": "Diff and classify", "text": "Compare each fixture's current state against its snapshot and count changed, unchanged and unexpectedly changed objects." },
    { "@type": "HowToStep", "name": "Publish the evidence", "text": "Share the counts, representative before-and-after pairs and the changeset comment template with the community discussion." }
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
      "name": "Can I use my normal OSM account on the development API?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. The development instance has an entirely separate user database, so you must register an account there and issue tokens from it. This trips people up because the login page looks identical, and the resulting error is an unhelpful authentication failure rather than anything that names the cause. Keep the two sets of credentials in clearly distinct environment variables." }
    },
    {
      "@type": "Question",
      "name": "Why not just add a dry-run flag to the pipeline instead?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because a flag that skips the upload tests everything except the part that actually changes data. The bugs that matter in a bulk edit — a modify element missing tags, a conflict handler that bumps the version, an empty changeset comment — all live in the code the flag would skip. Changing only the endpoint keeps every code path live while directing the consequences somewhere harmless." }
    },
    {
      "@type": "Question",
      "name": "How many fixtures should I seed for a dry run?",
      "acceptedAnswer": { "@type": "Answer", "text": "Enough to cover the variety in the real selection rather than enough to be statistically large. Include the ordinary case, the objects with unusual extra tags, the ones with tags in non-Latin scripts, and any object your selection query only just includes or excludes. Fifty carefully chosen fixtures find more problems than a thousand copies of the same easy case." }
    },
    {
      "@type": "Question",
      "name": "Does a clean dry run mean the edit is ready?",
      "acceptedAnswer": { "@type": "Answer", "text": "It means the script is safe to run, which is necessary and not sufficient. A dry run cannot tell you whether the tagging change is correct for that region, whether local mappers have a convention you are about to flatten, or whether the source data is good enough to import. Those questions are answered by publishing the evidence and letting people who know the area respond." }
    }
  ]
}
</script>
