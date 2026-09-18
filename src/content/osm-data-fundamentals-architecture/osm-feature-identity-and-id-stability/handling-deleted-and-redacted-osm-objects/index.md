---
title: "Handling Deleted and Redacted OSM Objects"
description: "Distinguish a deletion from a redaction, understand why a redacted version disappears from history entirely, and make a pipeline that handles both without losing the record of what it knew."
pageTitle: "Deletions and Redactions in OSM: What Each One Means"
pageDescription: "Tell an OSM deletion from a redaction, handle the gap a redaction leaves in an object's history, and keep a pipeline's own record of what it once held without republishing removed data."
slug: handling-deleted-and-redacted-osm-objects
type: article
breadcrumb: "Deletions & Redactions"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Handling Deleted and Redacted OSM Objects

A deleted object is one somebody removed from the map. A redacted version is one that was removed from the *record*, usually because it should never have been there. The two look similar from a distance and need entirely different handling.

## Prerequisites

- [ ] The identity model from [OSM Feature Identity & ID Stability](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/).
- [ ] Python 3.10+ with `requests` for the API path.
- [ ] A history file if you work in bulk, per [Full History .osh.pbf Processing](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/).
- [ ] Stored references whose behaviour on disappearance you care about.
- [ ] A position on what your own systems should retain when upstream removes something.

## Conceptual minimum

**A deletion** is an ordinary edit. The object gains a final version marked not visible, its identifier is retired, and the whole history remains readable. A stored reference resolves to a not-found response, and the history explains what happened and who did it.

**A redaction** removes one or more *versions* from the public history, typically because they contained data that could not be licensed or that should not have been published. The object may still exist with later versions intact; what vanishes is the record of those particular versions. The visible effect is a **gap in the version sequence** — an object whose history jumps from version 3 to version 6.

The distinction matters for three reasons. A deletion is reversible by an ordinary revert and a redaction is not. A deletion leaves the history intact for reconstruction and a redaction deliberately does not. And data your pipeline captured from a since-redacted version is data you may not be entitled to keep, which is a question about your own storage rather than about the map.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 239" role="img" aria-labelledby="hdr1-t hdr1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="hdr1-t">Deletion and redaction compared on what disappears and what remains</title>
  <desc id="hdr1-d">Three panels. A deletion adds a final version marked not visible, retires the identifier, leaves the entire history readable and is reversible by an ordinary revert. A redaction removes specific versions from the public history, leaves a gap in the version numbering, may leave the object otherwise intact, and is not reversible by any editing operation. The third panel covers what a pipeline should do differently: a deletion means the feature left the map and can be recorded as such, while a redaction may mean data you hold should not be retained.</desc>
  <rect x="0" y="0" width="880" height="239" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Two disappearances, two different questions</text>
  <rect x="26" y="52" width="259" height="153" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Deletion</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Final version, not visible</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Identifier retired</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">History stays readable</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Revertible normally</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">The feature left the map</text>
  <rect x="311" y="52" width="259" height="153" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Redaction</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Versions removed entirely</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Gap in the numbering</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Object may still exist</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Not revertible</text>
  <text x="325" y="188" font-size="10.5" fill="currentColor" opacity="0.92">The record was corrected</text>
  <rect x="595" y="52" width="259" height="153" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Your pipeline</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Deletion: record it left</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Redaction: check what you hold</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Content may be unlicensable</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Retention is your question</text>
  <text x="609" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Not the map's problem</text>
  <text x="868" y="223" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Only the third panel requires a decision from you; the first two describe what upstream did and why.</text>
</svg>
<figcaption>A redaction is a statement about what should never have been published, which makes it your storage's problem too.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from enum import Enum

import requests

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.identity.removal")

API = "https://api.openstreetmap.org/api/0.6"
HEADERS = {"User-Agent": "osm-pipeline-example/1.0 (contact@example.org)"}


class State(str, Enum):
    PRESENT = "present"
    DELETED = "deleted"
    REDACTED_VERSIONS = "redacted_versions"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class Status:
    osm_type: str
    osm_id: int
    state: State
    current_version: int | None
    missing_versions: tuple[int, ...]
    detail: str


def fetch_history(osm_type: str, osm_id: int) -> list[ET.Element]:
    response = requests.get(f"{API}/{osm_type}/{osm_id}/history",
                            headers=HEADERS, timeout=60)
    if response.status_code == 404:
        return []
    response.raise_for_status()
    return ET.fromstring(response.content).findall(osm_type)


def assess(osm_type: str, osm_id: int) -> Status:
    elements = fetch_history(osm_type, osm_id)
    if not elements:
        return Status(osm_type, osm_id, State.UNKNOWN, None, (),
                      "no history returned; the object may never have existed")

    versions = sorted(int(e.get("version")) for e in elements)
    highest = versions[-1]
    # A redaction removes versions, leaving holes in an otherwise dense run.
    missing = tuple(v for v in range(1, highest + 1) if v not in set(versions))

    last = max(elements, key=lambda e: int(e.get("version")))
    deleted = last.get("visible", "true") == "false"

    if missing and deleted:
        detail = (f"deleted, and versions {missing} are absent from the history")
        state = State.DELETED
    elif missing:
        detail = f"present, but versions {missing} are absent from the history"
        state = State.REDACTED_VERSIONS
    elif deleted:
        detail = "deleted by an ordinary edit; full history remains"
        state = State.DELETED
    else:
        detail = "present with a complete version sequence"
        state = State.PRESENT

    logger.info("%s/%d: %s (%s)", osm_type, osm_id, state.value, detail)
    return Status(osm_type, osm_id, state, highest, missing, detail)


def handle_stored_reference(status: Status, stored_version: int) -> str:
    """What a pipeline should do about a reference it holds."""
    if status.state is State.PRESENT:
        return "resolve normally"
    if status.state is State.DELETED:
        # The feature left the map. Record that; do not silently drop the row.
        return ("mark the reference as no longer present and keep the record "
                "of when it was; the history explains what happened")
    if status.state is State.REDACTED_VERSIONS:
        if stored_version in status.missing_versions:
            # We captured data from a version that has since been removed.
            return ("REVIEW: the stored version was redacted; re-derive from a "
                    "current version and consider whether the captured content "
                    "may still be retained")
        return "re-resolve against the current version; the gap does not affect us"
    return "investigate: the object cannot be assessed from its history"


if __name__ == "__main__":
    status = assess("way", 4305800)
    logger.info("%s", handle_stored_reference(status, stored_version=3))
```

## Step-by-step walkthrough

1. **Detect a redaction by the gap, not by an error.** Nothing in the API announces a redaction; a missing version number in an otherwise dense sequence is the only signal available.
2. **Check both conditions independently.** An object can be both deleted and have redacted versions, and reporting only the first loses the more consequential fact.
3. **Treat an empty history as unknown, not as deleted.** A not-found response means the identifier was never used or the request was wrong, which is a different situation from an object that existed and was removed.
4. **Decide per stored version.** A redaction only matters to you if the version you captured is one of the removed ones. Otherwise the gap is upstream housekeeping.
5. **Record a deletion rather than dropping the row.** A reference to something that left the map is information; deleting the row loses the fact that you once knew about it and when.
6. **Escalate a redacted stored version to review.** Whether you may keep content captured from a version that has since been removed is a question for somebody, and the pipeline's job is to surface it rather than to decide it.
7. **Use a history file at volume.** Assessing thousands of references one API call at a time is neither fast nor polite.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 306" role="img" aria-labelledby="hdr2-t hdr2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="hdr2-t">What a pipeline should do about a reference whose object disappeared</title>
  <desc id="hdr2-d">A decision node taking the assessed state and the stored version, with three outcomes. An ordinary deletion means the feature left the map, so the reference is marked as no longer present while the record of having held it is retained. A redaction not covering the stored version means the gap is upstream housekeeping and the reference is simply re-resolved against the current version. A redaction covering the stored version means content was captured from a version since removed, which needs a human decision about retention rather than an automated one.</desc>
  <defs><marker id="hdr2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="306" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Disappeared — but in which way?</text>
  <rect x="26" y="117" width="250" height="88" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.6"/>
  <text x="151" y="145" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Deleted, or redacted?</text>
  <text x="151" y="167" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">The stored version decides</text>
  <text x="151" y="185" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Only one needs a human</text>
  <line x1="276" y1="161" x2="314" y2="161" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="314" y2="239" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="353" y2="83" stroke="currentColor" stroke-width="1.4" marker-end="url(#hdr2-a)"/>
  <rect x="356" y="52" width="498" height="62" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="370" y="77" font-size="12" font-weight="700" fill="currentColor">Deleted</text>
  <text x="370" y="97" font-size="10.5" fill="currentColor" opacity="0.88">Mark as gone, keep the record of having held it</text>
  <line x1="314" y1="161" x2="353" y2="161" stroke="currentColor" stroke-width="1.4" marker-end="url(#hdr2-a)"/>
  <rect x="356" y="130" width="498" height="62" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="370" y="155" font-size="12" font-weight="700" fill="currentColor">Redacted elsewhere</text>
  <text x="370" y="175" font-size="10.5" fill="currentColor" opacity="0.88">Re-resolve; the gap does not touch your version</text>
  <line x1="314" y1="239" x2="353" y2="239" stroke="currentColor" stroke-width="1.4" marker-end="url(#hdr2-a)"/>
  <rect x="356" y="208" width="498" height="62" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="370" y="233" font-size="12" font-weight="700" fill="currentColor">Your version redacted</text>
  <text x="370" y="253" font-size="10.5" fill="currentColor" opacity="0.88">Review: retention of the captured content is a decision</text>
  <text x="868" y="290" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Only the third branch needs a human, and conflating it with the first is how a pipeline quietly keeps content that was withdrawn.</text>
</svg>
<figcaption>The distinction costs one comparison and is the difference between housekeeping and a retention question.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 226" role="img" aria-labelledby="hdr3-t hdr3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="hdr3-t">What an object's version sequence looks like in each situation</title>
  <desc id="hdr3-d">Four version sequences shown side by side. A healthy object runs one, two, three, four with no gaps and a visible final version. A deleted object runs one, two, three, four with the final version marked not visible. A redacted object runs one, two, five, six, with versions three and four absent from the sequence entirely and the final version visible. An object that is both shows gaps and a final version marked not visible. A note adds that only the sequence itself distinguishes the third case.</desc>
  <rect x="0" y="0" width="880" height="226" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Read the sequence, not just the last version</text>
  <rect x="26" y="56" width="187" height="54" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="120" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">healthy</text>
  <text x="120" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">1 2 3 4</text>
  <text x="120" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">no gaps</text>
  <text x="120" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">final version visible</text>
  <text x="120" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">nothing to do</text>
  <rect x="217" y="56" width="187" height="54" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="311" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">deleted</text>
  <text x="311" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">1 2 3 4*</text>
  <text x="311" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">no gaps</text>
  <text x="311" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">final not visible</text>
  <text x="311" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">record it left</text>
  <rect x="408" y="56" width="251" height="54" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="534" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">redacted</text>
  <text x="534" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">1 2 _ _ 5 6</text>
  <text x="534" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">gaps present</text>
  <text x="534" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">final still visible</text>
  <text x="534" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">check your version</text>
  <rect x="663" y="56" width="187" height="54" rx="6" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="756" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">both</text>
  <text x="756" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">1 _ 3 4*</text>
  <text x="756" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">gaps and not visible</text>
  <text x="756" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">two facts at once</text>
  <text x="756" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">report both</text>
  <text x="868" y="210" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">A pipeline that reads only the final version sees the first, second and fourth cases and is blind to the third entirely.</text>
</svg>
<figcaption>The asterisk marks a version flagged not visible; the underscores mark versions that are simply absent.</figcaption>
</figure>

## Verification

- **A known deleted object reports deleted.** Pick one and confirm the final version is marked not visible and the history is complete.
- **A gap is detected.** Construct or find an object with a missing version and confirm the assessment reports it.
- **An unused identifier reports unknown.** Query a very high identifier and confirm it is not reported as deleted.
- **Stored-version logic branches correctly.** Assess the same object with a stored version inside and outside the gap and confirm the two recommendations differ.
- **Deleted references are retained, not dropped.** Check that the pipeline marks rather than deletes.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Redactions never noticed | Only current state checked | Look for gaps in the version sequence |
| Unused identifiers reported as deleted | Empty history treated as deletion | Return an unknown state for a not-found history |
| Retention question missed | Redaction handled the same as deletion | Compare the stored version against the missing ones |
| History of a deletion lost | Row dropped when the object disappeared | Mark the reference and keep the record |
| Deleted and redacted conflated | One condition checked, not both | Test visibility and gaps independently |
| Assessment too slow at volume | One API call per reference | Assess in bulk from a history extract |
| Gap reported on a new object | Version numbering assumed to start at one | Compare against the observed range, not an assumption |

## Specification reference

> Deleting an OpenStreetMap object creates a new version marked as not visible; the object's identifier is not reused and its full history remains available. Redaction is a separate administrative action that removes specific object versions from public access, leaving those versions unavailable through the history and data APIs. See the [OSM API v0.6 documentation](https://wiki.openstreetmap.org/wiki/API_v0.6) for the visibility flag and the [redaction documentation](https://wiki.openstreetmap.org/wiki/Redaction) for what a redaction removes and why.

## Frequently Asked Questions

<details>
<summary>How do I detect that a version was redacted?</summary>

By looking for a gap in the version sequence. Nothing in the API announces a redaction explicitly; a redacted version simply is not returned, so an object whose history runs 1, 2, 3, 6, 7 has had versions 4 and 5 removed. That structural check is the only signal available, which is why a pipeline that only looks at the current state will never notice a redaction at all.
</details>

<details>
<summary>Is a redaction the same as a revert?</summary>

No. A revert is an ordinary edit that creates a new version restoring earlier content, and everything involved stays in the history. A redaction removes versions from public access entirely and cannot be undone by editing, because it is an administrative action about what may be published rather than about what the map should say. The two are frequently confused and need completely different handling.
</details>

<details>
<summary>Should I delete data captured from a redacted version?</summary>

That is a decision for somebody rather than for the pipeline, and the pipeline's job is to surface it. A version is usually redacted because its content could not be licensed or should not have been published, which means data you captured from it may be data you are not entitled to keep. Flagging the affected records for review, rather than either silently keeping or silently deleting them, is the honest handling.
</details>

<details>
<summary>What should happen to a reference whose object was deleted?</summary>

Mark it as no longer present and keep the row. Dropping it loses the fact that you once held a reference to that feature and when, which is exactly the information somebody will want when they ask why a count fell. A deletion is also fully explained by the remaining history, so the record can carry who removed it and in which changeset, turning a disappearance into an answerable question.
</details>

## Related

- [OSM Feature Identity & ID Stability](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/) — the parent topic and the identifier guarantees deletion relies on.
- [Tracking an OSM Feature Across Versions](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/tracking-an-osm-feature-across-versions/) — the history walk this assessment extends.
- [Building Stable Surrogate Keys for OSM Features](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/building-stable-surrogate-keys-for-osm-features/) — closing mappings when the objects disappear.
- [Full History .osh.pbf Processing](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/) — the bulk source for assessing many references.
- [Detecting Bulk Deletions in an OSM Diff Stream](https://www.osm-data-processing.org/osm-data-quality-validation/changeset-analysis-and-vandalism-detection/detecting-bulk-deletions-in-an-osm-diff-stream/) — spotting deletions as they arrive rather than on re-resolution.

Up one level: [OSM Feature Identity & ID Stability](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Handling Deleted and Redacted OSM Objects",
  "description": "Distinguish a deletion from a redaction, understand why a redacted version disappears from history entirely, and make a pipeline that handles both without losing the record of what it knew.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Data Fundamentals & Architecture",
  "about": ["OSM deletion", "redaction", "reference handling"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Fundamentals & Architecture", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/" },
    { "@type": "ListItem", "position": 3, "name": "OSM Feature Identity & ID Stability", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/" },
    { "@type": "ListItem", "position": 4, "name": "Handling Deleted and Redacted OSM Objects", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/handling-deleted-and-redacted-osm-objects/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Handle deleted and redacted OSM objects in a pipeline",
  "description": "Fetch the history, detect deletion by the visibility flag and redaction by gaps in the version sequence, compare the stored version against the missing ones, and route only the affected case to review.",
  "step": [
    { "@type": "HowToStep", "name": "Fetch the full history", "text": "Retrieve every available version rather than only the current state, since redactions are invisible otherwise." },
    { "@type": "HowToStep", "name": "Detect deletion by visibility", "text": "Treat a final version marked not visible as an ordinary deletion with an intact history." },
    { "@type": "HowToStep", "name": "Detect redaction by gaps", "text": "Look for missing version numbers in the sequence, which is the only signal a redaction leaves." },
    { "@type": "HowToStep", "name": "Separate unknown from deleted", "text": "Return an unknown state when no history exists at all, rather than assuming the object was removed." },
    { "@type": "HowToStep", "name": "Compare against the stored version", "text": "Escalate only when the version your pipeline captured is among those removed." },
    { "@type": "HowToStep", "name": "Mark rather than drop", "text": "Record that a reference is no longer present instead of deleting the row, preserving what was once known." }
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
      "name": "How do I detect that an OSM version was redacted?",
      "acceptedAnswer": { "@type": "Answer", "text": "By looking for a gap in the version sequence. Nothing in the API announces a redaction explicitly; a redacted version simply is not returned, so an object whose history runs 1, 2, 3, 6, 7 has had versions 4 and 5 removed. A pipeline that only looks at the current state will never notice a redaction at all." }
    },
    {
      "@type": "Question",
      "name": "Is an OSM redaction the same as a revert?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. A revert is an ordinary edit that creates a new version restoring earlier content, and everything stays in the history. A redaction removes versions from public access entirely and cannot be undone by editing, because it is an administrative action about what may be published rather than about what the map should say." }
    },
    {
      "@type": "Question",
      "name": "Should I delete data captured from a redacted OSM version?",
      "acceptedAnswer": { "@type": "Answer", "text": "That is a decision for somebody rather than for the pipeline, and the pipeline's job is to surface it. A version is usually redacted because its content could not be licensed or should not have been published. Flagging the affected records for review, rather than silently keeping or deleting them, is the honest handling." }
    },
    {
      "@type": "Question",
      "name": "What should happen to a reference whose OSM object was deleted?",
      "acceptedAnswer": { "@type": "Answer", "text": "Mark it as no longer present and keep the row. Dropping it loses the fact that you once held a reference and when, which is exactly what somebody will ask about when a count falls. A deletion is fully explained by the remaining history, so the record can carry who removed it and in which changeset." }
    }
  ]
}
</script>
