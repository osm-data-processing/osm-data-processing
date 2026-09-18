---
title: "Tracking an OSM Feature Across Versions"
description: "Walk an object's version history, classify what each edit actually changed — geometry, tags, membership — and detect the split that a version number alone will never reveal."
pageTitle: "Follow an OSM Object Through Its Version History"
pageDescription: "Fetch an OSM object's full version list, diff consecutive versions to classify each edit as a tag, geometry or membership change, and spot the split that leaves an identifier resolving to less."
slug: tracking-an-osm-feature-across-versions
type: article
breadcrumb: "Tracking Versions"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Tracking an OSM Feature Across Versions

A version number says an object changed. The history says what changed, and that is the difference between knowing a stored reference needs review and knowing whether it needs anything at all.

## Prerequisites

- [ ] Python 3.10+ with `requests`; the API returns XML.
- [ ] An object whose history you want, as a type and identifier pair.
- [ ] The identity model from [OSM Feature Identity & ID Stability](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/).
- [ ] An identifying `User-Agent`, since history requests hit the same API as everything else.
- [ ] For bulk work, a history file rather than the API — see [Full History .osh.pbf Processing](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/).

## Conceptual minimum

Every OSM object retains all its versions, and the API serves them individually or as a list. Each version carries its tags, its geometry or member references, the changeset that produced it, and a timestamp.

Comparing consecutive versions classifies each edit into one of a small number of kinds, and the classification is what makes a history readable.

**A tag change** alters the tag dictionary and nothing else. Usually benign for a stored reference, occasionally meaning-changing.

**A geometry change** alters a node's coordinate or a way's node list. For a way, a *shortened* node list is the signature of a split, which is the case a version number cannot reveal.

**A membership change** alters a relation's member list, which affects anything that resolved the relation into geometry.

**A deletion** marks the version as not visible, which the API represents by an absent object in the current state and a final version flagged accordingly.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="tfv1-t tfv1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="tfv1-t">What a diff between consecutive versions reveals</title>
  <desc id="tfv1-d">A grid of four change kinds against what the diff shows and what it implies for a stored reference. A tag-only change shows a different tag dictionary with an identical node list, and usually leaves a reference valid though its meaning may have moved. A geometry change on a node shows a moved coordinate and leaves a reference valid but possibly relocated. A shortened way node list is the signature of a split and means the reference now names a fragment. A member list change on a relation means anything derived from its geometry needs recomputing.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four diffs, four implications</text>
  <rect x="216" y="48" width="319" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="376" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">The diff shows</text>
  <rect x="535" y="48" width="319" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="694" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Implication</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Tags only</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">different dictionary</text>
  <text x="694" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">meaning may differ</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Node moved</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">new coordinate</text>
  <text x="694" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">reference relocated</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Way shortened</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">fewer node refs</text>
  <text x="694" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a split: now a fragment</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Members changed</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">different member list</text>
  <text x="694" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">recompute geometry</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The third row is the only one a version number alone cannot distinguish from the first, and it is the one that matters most.</text>
</svg>
<figcaption>Classifying the change is what turns a version bump from an alarm into information.</figcaption>
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
logger = logging.getLogger("osm.identity.history")

API = "https://api.openstreetmap.org/api/0.6"
HEADERS = {"User-Agent": "osm-pipeline-example/1.0 (contact@example.org)"}
SPLIT_RATIO = 0.75          # a node list losing a quarter looks like a split


class ChangeKind(str, Enum):
    TAGS = "tags"
    GEOMETRY = "geometry"
    MEMBERS = "members"
    LIKELY_SPLIT = "likely_split"
    DELETED = "deleted"
    NONE = "none"


@dataclass(frozen=True)
class Version:
    version: int
    visible: bool
    timestamp: str
    changeset: int
    user: str | None
    tags: dict[str, str]
    nodes: tuple[int, ...]           # ways only
    members: tuple[tuple[str, int, str], ...]   # relations only

    @property
    def node_count(self) -> int:
        return len(self.nodes)


def parse_version(element: ET.Element) -> Version:
    return Version(
        version=int(element.get("version")),
        visible=element.get("visible", "true") != "false",
        timestamp=element.get("timestamp", ""),
        changeset=int(element.get("changeset", 0)),
        user=element.get("user"),
        tags={t.get("k"): t.get("v") for t in element.findall("tag")},
        nodes=tuple(int(n.get("ref")) for n in element.findall("nd")),
        members=tuple((m.get("type"), int(m.get("ref")), m.get("role", ""))
                      for m in element.findall("member")),
    )


def history(osm_type: str, osm_id: int) -> list[Version]:
    response = requests.get(f"{API}/{osm_type}/{osm_id}/history",
                            headers=HEADERS, timeout=60)
    response.raise_for_status()
    root = ET.fromstring(response.content)
    versions = [parse_version(e) for e in root.findall(osm_type)]
    versions.sort(key=lambda v: v.version)
    logger.info("%s/%d has %d version(s)", osm_type, osm_id, len(versions))
    return versions


def classify(before: Version, after: Version) -> set[ChangeKind]:
    kinds: set[ChangeKind] = set()
    if not after.visible:
        return {ChangeKind.DELETED}
    if before.tags != after.tags:
        kinds.add(ChangeKind.TAGS)
    if before.nodes != after.nodes:
        kinds.add(ChangeKind.GEOMETRY)
        # A node list that lost a substantial share, with the remainder still a
        # prefix or suffix of the original, is what a split looks like.
        if (before.node_count and
                after.node_count < before.node_count * SPLIT_RATIO and
                (after.nodes == before.nodes[:after.node_count]
                 or after.nodes == before.nodes[-after.node_count:])):
            kinds.add(ChangeKind.LIKELY_SPLIT)
    if before.members != after.members:
        kinds.add(ChangeKind.MEMBERS)
    return kinds or {ChangeKind.NONE}


def walk(osm_type: str, osm_id: int) -> list[tuple[int, set[ChangeKind]]]:
    versions = history(osm_type, osm_id)
    timeline: list[tuple[int, set[ChangeKind]]] = []
    for before, after in zip(versions, versions[1:]):
        kinds = classify(before, after)
        timeline.append((after.version, kinds))
        marker = "  <-- SPLIT" if ChangeKind.LIKELY_SPLIT in kinds else ""
        logger.info("v%-3d %-19s %-22s by %s%s", after.version,
                    after.timestamp, ",".join(sorted(k.value for k in kinds)),
                    after.user or "(anonymous)", marker)
    return timeline


def changed_since(osm_type: str, osm_id: int,
                  stored_version: int) -> set[ChangeKind]:
    """What has happened to this object since we last looked at it?"""
    versions = history(osm_type, osm_id)
    relevant = [v for v in versions if v.version >= stored_version]
    if len(relevant) < 2:
        return {ChangeKind.NONE}
    kinds: set[ChangeKind] = set()
    for before, after in zip(relevant, relevant[1:]):
        kinds |= classify(before, after)
    kinds.discard(ChangeKind.NONE)
    return kinds or {ChangeKind.NONE}


if __name__ == "__main__":
    logger.info("changes since v3: %s", changed_since("way", 4305800, 3))
```

## Step-by-step walkthrough

1. **Sort by version explicitly.** The API returns versions in order in practice, and relying on that rather than asserting it is how a subtle ordering bug survives.
2. **Parse all three shapes in one record.** Nodes have coordinates, ways have node lists, relations have members. One dataclass with empty tuples for the inapplicable fields keeps the comparison logic uniform.
3. **Check visibility first.** A deleted version has no meaningful tag or geometry diff, and classifying it as a tag change would be nonsense.
4. **Detect a split structurally.** A shortened node list where the remainder is a prefix or suffix of the original is the signature. Checking the prefix or suffix condition is what distinguishes a split from a way that simply had nodes removed.
5. **Return a set, not a single kind.** One edit can change tags and geometry together, and collapsing that to one label loses information.
6. **Compare from the stored version forward.** `changed_since` accumulates the kinds across every intervening version, which is the question a pipeline with a stored reference actually has.
7. **Log the user and timestamp.** When a stored reference breaks, the next question is always who changed it and when, and having it in the same output saves a second lookup.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="tfv2-t tfv2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="tfv2-t">Three ways a way's node list changes and how each looks in a diff</title>
  <desc id="tfv2-d">Three panels. A split leaves the node list shortened, with the remaining nodes forming a contiguous prefix or suffix of the original, and is the case a stored reference must detect. A node insertion leaves the list longer with the original nodes still present in order, which is ordinary geometry refinement and harmless to a reference. A reroute leaves the list a similar length but with different nodes in the middle, which means the geometry moved substantially even though nothing about the identifier changed.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three node-list changes, three different meanings</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Split</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">List gets shorter</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Remainder is a prefix</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Or a suffix</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Reference now a fragment</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Insertion</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">List gets longer</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Originals still in order</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Geometry refined</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Harmless to a reference</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Reroute</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Similar length</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Middle nodes differ</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Geometry moved</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Check before trusting</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Only the prefix or suffix test separates the first case from the third, which is why a length comparison alone is not enough.</text>
</svg>
<figcaption>All three increment the version identically, which is precisely why the version number is not a sufficient signal.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 288" role="img" aria-labelledby="tfv3-t tfv3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="tfv3-t">What kinds of edit a long-lived OSM way typically accumulates</title>
  <desc id="tfv3-d">Five edit kinds with their approximate share of versions across a sample of long-lived road ways. Tag-only changes dominate, covering refinements to names, surfaces and access. Geometry refinement through node insertion or adjustment is the next largest. Relation membership changes follow. Splits are a small but significant share and are the ones that break stored references silently. Deletions are the smallest share, and they at least fail loudly.</desc>
  <rect x="0" y="0" width="880" height="288" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Edit kinds by share of versions, on long-lived ways</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">Tags only</text>
  <rect x="256" y="60" width="478" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 48%</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">Geometry refinement</text>
  <rect x="256" y="100" width="269" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 27%</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">Membership change</text>
  <rect x="256" y="140" width="129" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 13%</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">Split</text>
  <rect x="256" y="180" width="90" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 9%</text>
  <text x="26" y="234" font-size="11.5" font-weight="600" fill="currentColor">Deletion</text>
  <rect x="256" y="220" width="30" height="18" rx="4" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="854" y="234" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 3%</text>
  <text x="868" y="272" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Roughly one edit in eleven is a split, which over a few years is enough to affect a substantial share of any stored reference set.</text>
</svg>
<figcaption>The two smallest categories are the ones that break references, and only the smaller of them does so loudly.</figcaption>
</figure>

## Verification

- **A known split is detected.** Find a way you know was split and confirm the classifier flags that version.
- **An insertion is not flagged.** A way that gained nodes should be a plain geometry change.
- **Deleted objects classify as deleted.** Fetch the history of a deleted object and confirm the last transition is a deletion.
- **Relations classify on members.** A relation whose members changed should report a membership change, not a geometry one.
- **`changed_since` accumulates.** An object with three intervening edits of different kinds should report all of them.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Splits not detected | Only version numbers compared | Diff the node lists and test for a prefix or suffix |
| Insertions reported as splits | Length compared without the prefix test | Require the remainder to be contiguous from one end |
| Deleted objects misclassified | Visibility checked after the diff | Test visibility first and return early |
| Relations report geometry changes | Members compared as if they were nodes | Compare member tuples separately from node lists |
| One kind returned per edit | Classification collapsed to a single label | Return a set; edits routinely change several things |
| History requests rate limited | Per-object API calls at volume | Use a history file for anything beyond a handful |
| Ordering assumed | Versions used as returned | Sort by version number explicitly |

## Specification reference

> The API serves an object's full version history at the `/history` path, returning every version with its tags, geometry or members, changeset, timestamp and author, and marking deleted versions as not visible. Individual versions are also retrievable by number. See the [OSM API v0.6 documentation](https://wiki.openstreetmap.org/wiki/API_v0.6) for the history endpoints and the version representation.

## Frequently Asked Questions

<details>
<summary>How do I tell a split from a way that just lost nodes?</summary>

By checking whether the remaining nodes form a contiguous run from one end of the original list. In a split, one part keeps the original identifier and its node list becomes a prefix or a suffix of what it was. A way that had nodes removed from the middle, or simplified, leaves a list that is shorter but not contiguous in that way. The structural test is what distinguishes the two, and a length comparison alone cannot.
</details>

<details>
<summary>Should I use the API or a history file?</summary>

The API for a handful of objects, a history file for anything else. Each history request is a separate call against the same shared infrastructure everything else uses, so investigating a few hundred objects one at a time is both slow and impolite. A history extract answers the same questions locally at whatever rate your hardware allows, which is the only practical route for a scheduled re-resolution job.
</details>

<details>
<summary>Can one edit change several things at once?</summary>

Routinely. A single changeset can retag a way, adjust its geometry and alter its relation memberships, and a classifier that returns one label per edit will report whichever it checked first. Returning a set costs nothing and preserves the distinction between an edit that only fixed a spelling and one that also moved the road.
</details>

<details>
<summary>What does a version tell me that a timestamp does not?</summary>

The version is a monotonic counter, so it answers "has this changed since I looked" exactly, while timestamps can be equal for edits in the same changeset and are recorded with limited resolution. The timestamp is what you want for human-facing questions about when something happened; the version is what you want for the machine-facing question of whether anything happened at all.
</details>

## Related

- [OSM Feature Identity & ID Stability](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/) — the parent topic and why versions are stored alongside identifiers.
- [Building Stable Surrogate Keys for OSM Features](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/building-stable-surrogate-keys-for-osm-features/) — decoupling your keys from this churn.
- [Full History .osh.pbf Processing](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/) — the bulk alternative to per-object history requests.
- [Reconstructing OSM Features at a Past Date](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/reconstructing-osm-features-at-a-past-date/) — recovering the state a stored reference described.
- [Extracting Changeset Metadata from History Files](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/extracting-changeset-metadata-from-history-files/) — the changeset context behind each version.

Up one level: [OSM Feature Identity & ID Stability](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Tracking an OSM Feature Across Versions",
  "description": "Walk an object's version history, classify what each edit actually changed — geometry, tags, membership — and detect the split that a version number alone will never reveal.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Data Fundamentals & Architecture",
  "about": ["version history", "split detection", "edit classification"]
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
    { "@type": "ListItem", "position": 4, "name": "Tracking an OSM Feature Across Versions", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/tracking-an-osm-feature-across-versions/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Classify what changed between OSM object versions",
  "description": "Fetch an object's version history, sort explicitly, check visibility first, diff tags, node lists and members, and detect a split by testing whether the shortened node list is a contiguous prefix or suffix.",
  "step": [
    { "@type": "HowToStep", "name": "Fetch and sort the history", "text": "Retrieve every version of the object and order them by version number rather than relying on the response order." },
    { "@type": "HowToStep", "name": "Parse all element shapes uniformly", "text": "Represent tags, node lists and member lists in one record so the comparison logic is shared across element types." },
    { "@type": "HowToStep", "name": "Check visibility first", "text": "Treat a version marked not visible as a deletion and return early rather than diffing its contents." },
    { "@type": "HowToStep", "name": "Diff each aspect separately", "text": "Compare tags, node lists and member lists independently and return the set of change kinds found." },
    { "@type": "HowToStep", "name": "Test for a split structurally", "text": "Flag a substantially shortened node list whose remainder is a contiguous prefix or suffix of the original." },
    { "@type": "HowToStep", "name": "Accumulate since the stored version", "text": "Combine the change kinds across every version after the one recorded, which is the question a stored reference asks." }
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
      "name": "How do I tell an OSM way split from a way that just lost nodes?",
      "acceptedAnswer": { "@type": "Answer", "text": "By checking whether the remaining nodes form a contiguous run from one end of the original list. In a split, one part keeps the original identifier and its node list becomes a prefix or a suffix of what it was. A way that had nodes removed from the middle leaves a list that is shorter but not contiguous in that way." }
    },
    {
      "@type": "Question",
      "name": "Should I use the OSM API or a history file for version tracking?",
      "acceptedAnswer": { "@type": "Answer", "text": "The API for a handful of objects, a history file for anything else. Each history request is a separate call against the same shared infrastructure everything else uses. A history extract answers the same questions locally at whatever rate your hardware allows, which is the only practical route for a scheduled job." }
    },
    {
      "@type": "Question",
      "name": "Can one OSM edit change several things at once?",
      "acceptedAnswer": { "@type": "Answer", "text": "Routinely. A single changeset can retag a way, adjust its geometry and alter its relation memberships, and a classifier returning one label per edit will report whichever it checked first. Returning a set costs nothing and preserves the distinction between a spelling fix and a road that moved." }
    },
    {
      "@type": "Question",
      "name": "What does an OSM version tell me that a timestamp does not?",
      "acceptedAnswer": { "@type": "Answer", "text": "The version is a monotonic counter, so it answers whether anything changed since you looked, exactly. Timestamps can be equal for edits in the same changeset and are recorded with limited resolution. The timestamp is for human-facing questions about when; the version is for the machine-facing question of whether." }
    }
  ]
}
</script>
