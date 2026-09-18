---
title: "Rolling Back a Bad OSM Import"
description: "Revert an import you should not have made: identify the changesets, build a reversing osmChange, respect the objects other mappers have touched since, and communicate while you do it."
pageTitle: "Reverting an OSM Import Cleanly and Honestly"
pageDescription: "Undo a bad OSM import changeset by changeset: enumerate the affected objects, skip those edited since, delete only what you created, restore what you modified, and tell people what happened."
slug: rolling-back-a-bad-osm-import
type: article
breadcrumb: "Rolling Back an Import"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Rolling Back a Bad OSM Import

A revert is an admission, an engineering task and a communication in that order. Doing the second without the first and third is how a bad import becomes two bad edits.

## Prerequisites

- [ ] The changeset identifiers from the import, which you recorded at upload time.
- [ ] An account with write access, and the upload machinery from [Uploading an OSM Changeset from Python](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/uploading-an-osm-changeset-from-python/).
- [ ] Python 3.10+ with `requests`.
- [ ] A rehearsal on the development instance, per [Dry-Running a Bulk Edit Against the Dev API](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/dry-running-a-bulk-edit-against-the-dev-api/).
- [ ] A written note of what went wrong, ready to post before the revert starts.

## Conceptual minimum

A revert is not a single operation the API provides; it is a new changeset whose contents undo an earlier one. What "undo" means depends on what the original did.

**An object you created** is deleted — provided nothing else now references it and nobody has edited it since.

**An object you modified** is restored to the version immediately before your edit, which means fetching that version and uploading it as the current state.

**An object you deleted** is recreated, which the API supports by uploading the previous version with its original identifier.

The complication that dominates the work is **intervening edits**. If a mapper has touched an object since your import, reverting it blindly discards their work — and that is a second unwanted edit on top of the first. Every object must be checked, and the ones that moved on must be skipped and listed for human attention rather than forced.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 306" role="img" aria-labelledby="rbi1-t rbi1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="rbi1-t">What to do with each object the import touched</title>
  <desc id="rbi1-d">A decision node examining an object's current version against the version the import produced, with three outcomes. An object still at the version the import left it can be reverted mechanically, which covers the great majority. An object whose version has moved on has been edited by somebody since, so reverting it would discard their work and it must be skipped and listed. An object now referenced by something created later cannot be deleted at all and needs a human to decide whether the reference or the object should go.</desc>
  <defs><marker id="rbi1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="306" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Check every object before touching it</text>
  <rect x="26" y="117" width="250" height="88" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.6"/>
  <text x="151" y="145" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Has it changed since?</text>
  <text x="151" y="167" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Compare current version</text>
  <text x="151" y="185" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Against what you uploaded</text>
  <line x1="276" y1="161" x2="314" y2="161" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="314" y2="239" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="353" y2="83" stroke="currentColor" stroke-width="1.4" marker-end="url(#rbi1-a)"/>
  <rect x="356" y="52" width="498" height="62" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="370" y="77" font-size="12" font-weight="700" fill="currentColor">Unchanged: revert it</text>
  <text x="370" y="97" font-size="10.5" fill="currentColor" opacity="0.88">Still at the version your import left; mechanical</text>
  <line x1="314" y1="161" x2="353" y2="161" stroke="currentColor" stroke-width="1.4" marker-end="url(#rbi1-a)"/>
  <rect x="356" y="130" width="498" height="62" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="370" y="155" font-size="12" font-weight="700" fill="currentColor">Edited since: skip and list</text>
  <text x="370" y="175" font-size="10.5" fill="currentColor" opacity="0.88">Somebody's work would be discarded by a blind revert</text>
  <line x1="314" y1="239" x2="353" y2="239" stroke="currentColor" stroke-width="1.4" marker-end="url(#rbi1-a)"/>
  <rect x="356" y="208" width="498" height="62" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="370" y="233" font-size="12" font-weight="700" fill="currentColor">Now referenced: escalate</text>
  <text x="370" y="253" font-size="10.5" fill="currentColor" opacity="0.88">Cannot delete; a human decides what should go</text>
  <text x="868" y="290" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The middle branch is the whole reason a revert cannot be a single API call: only a per-object check can find it.</text>
</svg>
<figcaption>Skipping is not failure — it is the revert correctly declining to overwrite somebody who looked at the data.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
import os
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

import requests

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.revert")

API = os.environ.get("OSM_API", "https://master.apis.dev.openstreetmap.org/api/0.6")
HEADERS = {
    "Authorization": f"Bearer {os.environ['OSM_OAUTH_TOKEN']}",
    "User-Agent": "osm-pipeline-example/1.0 (contact@example.org)",
}


@dataclass
class Plan:
    delete: list[ET.Element] = field(default_factory=list)
    restore: list[ET.Element] = field(default_factory=list)
    skipped: list[tuple[str, int, str]] = field(default_factory=list)


def changeset_download(changeset_id: int) -> ET.Element:
    """The osmChange document describing what a changeset actually did."""
    response = requests.get(f"{API}/changeset/{changeset_id}/download",
                            headers=HEADERS, timeout=120)
    response.raise_for_status()
    return ET.fromstring(response.content)


def current(osm_type: str, osm_id: int) -> ET.Element | None:
    response = requests.get(f"{API}/{osm_type}/{osm_id}", headers=HEADERS,
                            timeout=30)
    if response.status_code == 410:
        return None                      # already deleted by somebody else
    response.raise_for_status()
    return ET.fromstring(response.content).find(osm_type)


def version_at(osm_type: str, osm_id: int, version: int) -> ET.Element:
    response = requests.get(f"{API}/{osm_type}/{osm_id}/{version}",
                            headers=HEADERS, timeout=30)
    response.raise_for_status()
    return ET.fromstring(response.content).find(osm_type)


def plan_revert(changeset_id: int) -> Plan:
    """Decide, per object, whether it can be reverted without discarding work."""
    document = changeset_download(changeset_id)
    plan = Plan()

    for block in document:                      # create / modify / delete
        action = block.tag
        for element in block:
            osm_type, osm_id = element.tag, int(element.get("id"))
            our_version = int(element.get("version"))
            now = current(osm_type, osm_id)

            if now is None:
                plan.skipped.append((osm_type, osm_id, "already deleted"))
                continue
            if int(now.get("version")) != our_version:
                # Somebody edited it after us. Reverting would discard that.
                plan.skipped.append((osm_type, osm_id, "edited since the import"))
                continue

            if action == "create":
                plan.delete.append(now)
            elif action == "modify":
                if our_version < 2:
                    plan.skipped.append((osm_type, osm_id, "no prior version"))
                    continue
                plan.restore.append(version_at(osm_type, osm_id, our_version - 1))
            elif action == "delete":
                plan.restore.append(version_at(osm_type, osm_id, our_version - 1))

    logger.info("changeset %d: delete %d, restore %d, skip %d",
                changeset_id, len(plan.delete), len(plan.restore),
                len(plan.skipped))
    for osm_type, osm_id, reason in plan.skipped:
        logger.warning("skipping %s/%d: %s", osm_type, osm_id, reason)
    return plan


def build_revert(plan: Plan, changeset_id: int) -> bytes:
    root = ET.Element("osmChange", {"version": "0.6",
                                    "generator": "osm-revert-example"})
    if plan.restore:
        modify = ET.SubElement(root, "modify")
        for element in plan.restore:
            element.set("changeset", str(changeset_id))
            modify.append(element)
    if plan.delete:
        # Deletions last, so a way can go in the same changeset as its nodes.
        delete = ET.SubElement(root, "delete", {"if-unused": "true"})
        for element in plan.delete:
            element.set("changeset", str(changeset_id))
            delete.append(element)
    return ET.tostring(root)


if __name__ == "__main__":
    plan = plan_revert(int(os.environ.get("REVERT_CHANGESET", "0")))
    logger.info("review the skip list before uploading anything")
```

## Step-by-step walkthrough

1. **Work from the changeset download, not from your own records.** The server's account of what a changeset did is authoritative; your pipeline's log may be incomplete or wrong, which is plausible given that the import needs reverting.
2. **Check the current version of every object.** This is the step that distinguishes a revert from vandalism. An object whose version has moved on has been looked at by somebody.
3. **Treat an already-deleted object as skipped.** Somebody has removed it, which is a decision that should stand.
4. **Restore the version before yours.** For a modification or a deletion, the previous version is the state to return to — fetched from the server rather than reconstructed.
5. **Guard the first-version case.** An object whose first version was your modification has no prior state, which usually means the changeset download is being misread.
6. **Put deletions last and use if-unused.** Ordering lets a way and its nodes go together, and the if-unused flag prevents deleting a node that something created later now references.
7. **Review the skip list before uploading.** Skipped objects are the ones needing human attention, and reading that list is the point at which somebody notices the revert is more complicated than assumed.
8. **Revert changeset by changeset.** One revert changeset per original, referencing it in the comment, so the revert is as reviewable as the import should have been.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="rbi2-t rbi2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="rbi2-t">The order of a revert, including the parts that are not code</title>
  <desc id="rbi2-d">Four stages. The announce stage posts what went wrong and that a revert is starting, before any edit, so mappers seeing changes understand them. The plan stage downloads each changeset, checks every object's current version and produces a revert plan with an explicit skip list. The revert stage uploads one reversing changeset per original, with deletions last and the if-unused flag set. The follow-up stage works through the skipped objects with a human and posts a summary of what was and was not undone.</desc>
  <defs><marker id="rbi2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Announce, plan, revert, follow up</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">announce</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">before any edit</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">say what went wrong</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#rbi2-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">plan</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">check every object</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">produce a skip list</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#rbi2-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">revert</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">one per changeset</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">deletions last</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#rbi2-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">follow up</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">skipped objects</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">post a summary</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Announcing first is what stops a second wave of confused edits from mappers watching changes appear with no explanation.</text>
</svg>
<figcaption>Two of these four stages are writing rather than code, and they are the two that decide how the revert is received.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="rbi3-t rbi3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="rbi3-t">What reverting means for each of the three original actions</title>
  <desc id="rbi3-d">A grid of the three actions an import can perform against what the revert does and what can prevent it. A creation is reverted by deleting the object, which is prevented when something created later references it. A modification is reverted by restoring the version immediately before the import, which is prevented when the object has no prior version. A deletion is reverted by recreating the object from its last version before removal, which is prevented when another object has since taken its place.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three actions, three reversals, three obstacles</text>
  <rect x="196" y="48" width="329" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="360" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Revert does</text>
  <rect x="525" y="48" width="329" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="690" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Prevented by</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Created</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="360" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">delete the object</text>
  <text x="690" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a later reference</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Modified</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="360" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">restore the prior version</text>
  <text x="690" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">no prior version</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Deleted</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="360" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">recreate from last version</text>
  <text x="690" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a replacement exists</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Any of them</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="360" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">only if unchanged since</text>
  <text x="690" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">any later edit</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The bottom row applies to all three and is checked first, because no reversal is safe on an object somebody else has touched.</text>
</svg>
<figcaption>Each obstacle produces a skipped object rather than a failed revert, which is why the skip list is the real output.</figcaption>
</figure>

## Verification

- **Skipped objects are genuinely edited.** Spot-check a few and confirm somebody really did change them after the import.
- **Created objects are gone.** Query for a sample of identifiers the import created; they should be deleted or in the skip list.
- **Modified objects match their prior version.** Compare the current tags against the version before the import.
- **Nothing unrelated changed.** The revert changesets should touch only objects the import touched.
- **The rehearsal passed.** The whole procedure should have run against the development instance first, including a deliberately edited object to exercise the skip path.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Mappers' later edits destroyed | Version not checked before reverting | Compare the current version against yours; skip on any difference |
| Deletion fails on a referenced node | Something created later references it | Set the if-unused flag and escalate the remainder |
| Revert itself gets reverted | No announcement before starting | Post what went wrong before the first edit |
| Objects missed | Worked from pipeline logs, not the server | Use the changeset download as the source of truth |
| Revert is unreviewable | One enormous reverting changeset | One revert changeset per original changeset |
| Way deleted before its nodes | Deletions ordered wrongly | Put the delete block last in the document |
| Skip list never examined | Uploaded straight after planning | Make reviewing the skip list a required step |

## Specification reference

> The changeset download endpoint returns an `osmChange` document describing the creations, modifications and deletions a changeset performed. Individual object versions are retrievable by version number, allowing a prior state to be fetched and re-uploaded. A `delete` block may carry an `if-unused` attribute, which causes the server to skip rather than fail when an object is still referenced. See the [OSM API v0.6 documentation](https://wiki.openstreetmap.org/wiki/API_v0.6) for the changeset download format and the deletion semantics.

## Frequently Asked Questions

<details>
<summary>Why not just revert everything the import touched?</summary>

Because some of those objects have been edited since, and reverting them discards the work of whoever did it. That turns one unwanted edit into two, and the second is worse because it destroys a human's deliberate change rather than merely adding unwanted data. Checking each object's current version and skipping the ones that moved on is the difference between a revert and a second bad edit.
</details>

<details>
<summary>Should I announce the revert before or after doing it?</summary>

Before, always. Mappers watching an area will see a wave of changes appear and, with no explanation, will reasonably assume something is wrong and may start reverting your revert. A short note saying what went wrong and that a correction is starting costs minutes and prevents that entirely. It also establishes that the problem was found and acted on by you, which matters for whether the next import is welcomed.
</details>

<details>
<summary>What about objects that cannot be deleted because something references them?</summary>

Set the flag that tells the server to skip rather than fail, then handle the remainder by hand. A node your import created that is now part of a way somebody drew is not yours to remove: the way depends on it, and deleting it would break their work. Those cases are few, and a human deciding whether the reference or the object should go is the only sensible resolution.
</details>

<details>
<summary>How should the revert changesets be structured?</summary>

One reverting changeset per original changeset, with a comment naming the original and explaining the reason. That keeps the revert as reviewable as the import should have been, makes the correspondence obvious to anybody looking at the history, and means a problem with the revert itself can be addressed in the same granular way. A single enormous revert repeats the mistake that made the import hard to undo.
</details>

## Related

- [Conflation QA & Rollback](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/) — the parent topic and the structure that makes this tractable.
- [Preparing an OSM Import](https://www.osm-data-processing.org/osm-conflation-and-enrichment/preparing-an-osm-import/) — the preparation that avoids needing this.
- [Uploading an OSM Changeset from Python](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/uploading-an-osm-changeset-from-python/) — the upload machinery the revert reuses.
- [Reconstructing OSM Features at a Past Date](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/reconstructing-osm-features-at-a-past-date/) — recovering prior state from a history file when the API cannot.
- [Detecting Bulk Deletions in an OSM Diff Stream](https://www.osm-data-processing.org/osm-data-quality-validation/changeset-analysis-and-vandalism-detection/detecting-bulk-deletions-in-an-osm-diff-stream/) — how a revert looks from the monitoring side.

Up one level: [Conflation QA & Rollback](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Rolling Back a Bad OSM Import",
  "description": "Revert an import you should not have made: identify the changesets, build a reversing osmChange, respect the objects other mappers have touched since, and communicate while you do it.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Conflation & Data Enrichment",
  "about": ["changeset revert", "import rollback", "intervening edits"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Conflation & Data Enrichment", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/" },
    { "@type": "ListItem", "position": 3, "name": "Conflation QA & Rollback", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/" },
    { "@type": "ListItem", "position": 4, "name": "Rolling Back a Bad OSM Import", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/rolling-back-a-bad-osm-import/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Revert a bad OpenStreetMap import",
  "description": "Announce the problem, download each changeset from the server, check every object's current version, skip anything edited since, upload one reversing changeset per original with deletions last, and follow up on the skipped objects.",
  "step": [
    { "@type": "HowToStep", "name": "Announce before editing", "text": "Post what went wrong and that a revert is starting, so mappers seeing the changes understand them." },
    { "@type": "HowToStep", "name": "Download the changesets", "text": "Take the server's own account of what each changeset did rather than relying on pipeline logs." },
    { "@type": "HowToStep", "name": "Check every object's version", "text": "Compare the current version against the one your import produced and skip anything that has moved on." },
    { "@type": "HowToStep", "name": "Fetch prior versions", "text": "Retrieve the version immediately before your edit for every object you modified or deleted." },
    { "@type": "HowToStep", "name": "Order the document", "text": "Place restorations before deletions and mark deletions to skip objects still referenced by something else." },
    { "@type": "HowToStep", "name": "Review the skip list", "text": "Read the skipped objects before uploading, since they are the cases needing a human decision." },
    { "@type": "HowToStep", "name": "Follow up publicly", "text": "Resolve the skipped objects with a human and post a summary of what was and was not undone." }
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
      "name": "Why not just revert everything a bad import touched?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because some of those objects have been edited since, and reverting them discards the work of whoever did it. That turns one unwanted edit into two, and the second is worse because it destroys a human's deliberate change. Checking each object's current version and skipping the ones that moved on is the difference between a revert and a second bad edit." }
    },
    {
      "@type": "Question",
      "name": "Should I announce an OSM revert before or after doing it?",
      "acceptedAnswer": { "@type": "Answer", "text": "Before, always. Mappers watching an area will see a wave of changes appear and, with no explanation, may start reverting your revert. A short note saying what went wrong and that a correction is starting costs minutes and prevents that. It also establishes that the problem was found and acted on by you." }
    },
    {
      "@type": "Question",
      "name": "What about objects that cannot be deleted because something references them?",
      "acceptedAnswer": { "@type": "Answer", "text": "Set the flag that tells the server to skip rather than fail, then handle the remainder by hand. A node your import created that is now part of a way somebody drew is not yours to remove. Those cases are few, and a human deciding whether the reference or the object should go is the only sensible resolution." }
    },
    {
      "@type": "Question",
      "name": "How should revert changesets be structured?",
      "acceptedAnswer": { "@type": "Answer", "text": "One reverting changeset per original changeset, with a comment naming the original and explaining the reason. That keeps the revert as reviewable as the import should have been and makes the correspondence obvious in the history. A single enormous revert repeats the mistake that made the import hard to undo." }
    }
  ]
}
</script>
