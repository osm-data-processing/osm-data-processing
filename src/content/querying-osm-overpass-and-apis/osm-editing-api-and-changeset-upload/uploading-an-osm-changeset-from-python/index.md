---
title: "Uploading an OSM Changeset from Python"
description: "Open a changeset, read current object versions, build an osmChange document that preserves untouched tags, upload atomically, and resolve conflicts by re-reading instead of overwriting."
pageTitle: "Upload an OSM Changeset from Python, Safely"
pageDescription: "A complete Python changeset upload: describe the changeset, read each object fresh, emit a full-state osmChange document, and handle a version conflict by re-reading rather than bumping."
slug: uploading-an-osm-changeset-from-python
type: article
breadcrumb: "Uploading a Changeset"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Uploading an OSM Changeset from Python

Write a small, documented edit back to OpenStreetMap from Python without destroying tags you never touched and without overwriting an edit somebody made while your script was thinking.

## Prerequisites

- [ ] An OpenStreetMap account with an OAuth 2 token, and — for a first run — the development API rather than the live one, as set up in [Dry-Running a Bulk Edit Against the Dev API](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/dry-running-a-bulk-edit-against-the-dev-api/).
- [ ] A documented rationale for the edit, and ideally a community discussion, per [The OSM Editing API & Changeset Upload](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/).
- [ ] Python 3.10+ with `requests`; `xml.etree.ElementTree` from the standard library builds the document.
- [ ] A short, explicit list of objects to change — this guide deliberately does not scale to thousands.
- [ ] A rollback plan: the changeset id you will need if the edit turns out to be wrong.

## Conceptual minimum

Three properties of the API drive every design choice below.

**Modification is replacement.** A `modify` element in an `osmChange` document carries the object's *entire* state. The server does not merge; it replaces. Sending a way with one tag and no `nd` children does not "just update the tag" — it strips the way's tags and its geometry.

**Uploads are atomic.** The whole document applies or none of it does. One stale version rejects everything, which is exactly what you want: a partial application of a coherent edit is worse than no application.

**The version field is a lock.** You state the version you believe you are editing. A mismatch is a conflict, and a conflict means somebody else edited the object after you read it.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 226" role="img" aria-labelledby="uoc1-t uoc1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="uoc1-t">The parts of an osmChange document and the order the server applies them</title>
  <desc id="uoc1-d">A single document split into three sections applied in order. The create section carries new objects with negative placeholder identifiers, which the server replaces with real ones and reports back. The modify section carries objects in their complete new state, including every tag and, for ways, every node reference. The delete section is applied last so that a way and the nodes it references can be removed in the same document. A note adds that the whole document applies atomically or not at all.</desc>
  <rect x="0" y="0" width="880" height="226" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three sections, applied in this order, all or nothing</text>
  <rect x="26" y="56" width="244" height="54" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="148" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">create</text>
  <text x="148" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">negative ids</text>
  <text x="148" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">placeholders, not real ids</text>
  <text x="148" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">server returns the mapping</text>
  <text x="148" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">ways may reference them</text>
  <rect x="274" y="56" width="327" height="54" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="438" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">modify</text>
  <text x="438" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">complete state</text>
  <text x="438" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">every tag, every node ref</text>
  <text x="438" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">replacement, never a patch</text>
  <text x="438" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">carries the version you read</text>
  <rect x="606" y="56" width="244" height="54" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="728" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">delete</text>
  <text x="728" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">applied last</text>
  <text x="728" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">so a way can go with its nodes</text>
  <text x="728" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">needs the current version too</text>
  <text x="728" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">if-unused avoids some failures</text>
  <text x="868" y="210" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The middle section is where data gets destroyed: an incomplete modify silently removes everything it did not mention.</text>
</svg>
<figcaption>Ordering is why a way and its nodes can be deleted together, and atomicity is why a single stale version rejects the lot.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
import os
import xml.etree.ElementTree as ET
from dataclasses import dataclass

import requests

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.api.upload")

# Point at the DEVELOPMENT API until an edit has been reviewed end to end.
API = os.environ.get("OSM_API", "https://master.apis.dev.openstreetmap.org/api/0.6")
TOKEN = os.environ["OSM_OAUTH_TOKEN"]
HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "User-Agent": "osm-pipeline-example/1.0 (contact@example.org)",
}


class VersionConflict(RuntimeError):
    """Somebody edited an object after we read it. Re-read; never bump."""


@dataclass(frozen=True)
class TagEdit:
    osm_type: str            # "node" | "way" | "relation"
    osm_id: int
    set_tags: dict[str, str]     # keys to add or overwrite
    remove_tags: tuple[str, ...] = ()


def read_object(osm_type: str, osm_id: int) -> ET.Element:
    """Fetch an object's CURRENT full state. This is the conflict defence."""
    response = requests.get(f"{API}/{osm_type}/{osm_id}", headers=HEADERS, timeout=30)
    response.raise_for_status()
    root = ET.fromstring(response.content)
    element = root.find(osm_type)
    if element is None:
        raise RuntimeError(f"{osm_type}/{osm_id} not found")
    return element


def apply_tag_edit(element: ET.Element, edit: TagEdit) -> bool:
    """Mutate a copy of the CURRENT element. Returns False if nothing changed."""
    current = {t.get("k"): t.get("v") for t in element.findall("tag")}
    updated = dict(current)
    updated.update(edit.set_tags)
    for key in edit.remove_tags:
        updated.pop(key, None)
    if updated == current:
        return False

    # Rebuild the tag children from the FULL updated set — a modify replaces,
    # so every surviving tag must be present in the document we upload.
    for tag in element.findall("tag"):
        element.remove(tag)
    for key, value in sorted(updated.items()):
        ET.SubElement(element, "tag", {"k": key, "v": value})
    return True


def open_changeset(comment: str, source: str) -> int:
    root = ET.Element("osm")
    changeset = ET.SubElement(root, "changeset")
    for key, value in {
        "comment": comment,
        "source": source,
        "created_by": "osm-pipeline-example 1.0",
    }.items():
        ET.SubElement(changeset, "tag", {"k": key, "v": value})
    response = requests.put(f"{API}/changeset/create", headers=HEADERS,
                            data=ET.tostring(root), timeout=30)
    response.raise_for_status()
    changeset_id = int(response.text.strip())
    logger.info("opened changeset %d", changeset_id)
    return changeset_id


def build_osm_change(elements: list[ET.Element], changeset_id: int) -> bytes:
    root = ET.Element("osmChange", {"version": "0.6",
                                    "generator": "osm-pipeline-example"})
    modify = ET.SubElement(root, "modify")
    for element in elements:
        element.set("changeset", str(changeset_id))
        modify.append(element)
    return ET.tostring(root)


def upload(changeset_id: int, document: bytes) -> str:
    response = requests.post(f"{API}/changeset/{changeset_id}/upload",
                             headers=HEADERS, data=document, timeout=120)
    if response.status_code == 409:
        raise VersionConflict(response.text.strip())
    response.raise_for_status()
    return response.text


def close_changeset(changeset_id: int) -> None:
    requests.put(f"{API}/changeset/{changeset_id}/close",
                 headers=HEADERS, timeout=30)
    logger.info("closed changeset %d", changeset_id)


def run(edits: list[TagEdit], comment: str, source: str) -> None:
    # Read as late as possible: the read-to-upload window is the conflict window.
    staged: list[ET.Element] = []
    for edit in edits:
        element = read_object(edit.osm_type, edit.osm_id)
        if apply_tag_edit(element, edit):
            staged.append(element)
        else:
            logger.info("%s/%d already correct, skipping", edit.osm_type, edit.osm_id)

    if not staged:
        logger.info("nothing to do")
        return

    changeset_id = open_changeset(comment, source)
    try:
        upload(changeset_id, build_osm_change(staged, changeset_id))
        logger.info("uploaded %d object(s) in changeset %d", len(staged), changeset_id)
    except VersionConflict as exc:
        # Do NOT increment the version and retry: that overwrites the other edit.
        logger.error("conflict — re-read the named object and decide again: %s", exc)
        raise
    finally:
        close_changeset(changeset_id)


if __name__ == "__main__":
    run(
        edits=[TagEdit("node", 1234567, {"amenity": "pharmacy"}, ("shop",))],
        comment="Retag shop=chemist to amenity=pharmacy in <area>; see wiki page",
        source="Local survey, 2026-09",
    )
```

## Step-by-step walkthrough

1. **Default to the development API.** The endpoint comes from an environment variable whose default is the development instance. Reaching the live map should require a deliberate act.
2. **Read the whole object.** `read_object` returns the server's complete current element, versions and all. Everything downstream mutates that, not a hand-built stub.
3. **Merge into the full tag set.** `apply_tag_edit` starts from the current tags, applies additions and removals, and rebuilds the element's children from the complete result. This is what stops a modify from deleting untouched tags.
4. **Detect no-ops.** If the merged tag set equals the current one, the object is skipped. Uploading unchanged objects inflates the changeset, muddies review, and bumps versions for nothing.
5. **Open the changeset after staging.** The changeset is created only once there is something to upload, which keeps stray empty changesets out of the map.
6. **Describe the changeset properly.** A comment naming the change and pointing at documentation, a checkable source, and the tool version. A reviewer with these three can evaluate the edit without contacting you; without them, reverting is their only safe option.
7. **Never bump on conflict.** The conflict handler logs the object the server named and re-raises. Recovery means re-reading that object and deciding again whether the edit still applies — a decision, not a retry.
8. **Close in `finally`.** An open changeset left behind by an exception is confusing to everybody who sees it.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 306" role="img" aria-labelledby="uoc2-t uoc2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="uoc2-t">What to do when the upload returns a version conflict</title>
  <desc id="uoc2-d">A decision node about a conflicting object, with three outcomes. If the other edit already made the change you intended, drop your edit for that object because it is now a no-op. If the other edit is unrelated and your change still applies to the new state, recompute it against that state and re-upload. If the two edits genuinely disagree about the same tag or geometry, skip the object and route it to a human, because an automated resolution of a real disagreement is exactly what gets bulk edits reverted.</desc>
  <defs><marker id="uoc2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="306" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">A conflict is a decision, never a retry</text>
  <rect x="26" y="117" width="250" height="88" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.6"/>
  <text x="151" y="145" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">What did the other edit do?</text>
  <text x="151" y="167" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Re-read the object first</text>
  <text x="151" y="185" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Then pick one of three</text>
  <line x1="276" y1="161" x2="314" y2="161" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="314" y2="239" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="353" y2="83" stroke="currentColor" stroke-width="1.4" marker-end="url(#uoc2-a)"/>
  <rect x="356" y="52" width="498" height="62" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="370" y="77" font-size="12" font-weight="700" fill="currentColor">Drop your edit</text>
  <text x="370" y="97" font-size="10.5" fill="currentColor" opacity="0.88">Their change already achieves what you intended</text>
  <line x1="314" y1="161" x2="353" y2="161" stroke="currentColor" stroke-width="1.4" marker-end="url(#uoc2-a)"/>
  <rect x="356" y="130" width="498" height="62" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="370" y="155" font-size="12" font-weight="700" fill="currentColor">Recompute and retry</text>
  <text x="370" y="175" font-size="10.5" fill="currentColor" opacity="0.88">Unrelated change; yours still applies to the new state</text>
  <line x1="314" y1="239" x2="353" y2="239" stroke="currentColor" stroke-width="1.4" marker-end="url(#uoc2-a)"/>
  <rect x="356" y="208" width="498" height="62" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="370" y="233" font-size="12" font-weight="700" fill="currentColor">Skip, send to a human</text>
  <text x="370" y="253" font-size="10.5" fill="currentColor" opacity="0.88">Genuine disagreement about the same tag or geometry</text>
  <text x="868" y="290" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Bumping the version number is a fourth option that looks like the second one and silently destroys the other mapper's work.</text>
</svg>
<figcaption>All three branches start by re-reading, which is the step that distinguishes a decision from a retry loop.</figcaption>
</figure>

## Verification

- **Untouched tags survive.** Read the object back after upload and diff its tag set against the pre-edit state; only the intended keys should differ.
- **The changeset is described.** Fetch the changeset metadata and confirm the comment, source and created_by tags are present and meaningful.
- **No-ops were skipped.** Run the script twice; the second run should report every object as already correct and open no changeset.
- **The conflict path works.** On the development API, edit an object in the web interface between the read and the upload, and confirm the script raises rather than overwriting.
- **The changeset is closed.** After both a success and a forced failure, the changeset must show as closed.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="uoc3-t uoc3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="uoc3-t">Three checks that prove an upload did what was intended</title>
  <desc id="uoc3-d">Three panels covering post-upload verification. The tag diff check reads the object back and compares its tag set against the pre-edit state, proving only the intended keys changed. The idempotence check runs the script a second time and expects every object to be reported as already correct with no changeset opened. The metadata check fetches the changeset itself and confirms the comment, source and creating tool are present and meaningful to a stranger.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three checks, all of them after the upload</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Tag diff</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Read the object back</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Diff against the pre-edit state</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Only intended keys differ</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Catches a partial modify</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Idempotence</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Run the script a second time</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Every object already correct</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">No changeset opened at all</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Catches a no-op detection bug</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Changeset metadata</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Fetch the changeset itself</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Comment, source, created_by</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Evaluable by a stranger</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Catches a silent template gap</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The second check is the cheapest and finds the most: a script that is not idempotent will bump versions on every scheduled run.</text>
</svg>
<figcaption>None of these needs the live map — all three work on the development API, which is where they should run first.</figcaption>
</figure>

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Tags vanished after upload | Partial tag set in the modify element | Rebuild the element from the complete merged tag set |
| Way geometry destroyed | Node references omitted from the modify | Upload the element the server returned, mutated in place |
| HTTP 409 on upload | Object version moved since the read | Re-read and decide; never increment the version |
| HTTP 401 | Token missing, expired or wrong scope | Re-issue an OAuth 2 token with write scope |
| Empty changesets in the map | Changeset opened before staging | Open only once there is something to upload |
| Changeset left open after a crash | Close call not in a `finally` block | Close in `finally`, unconditionally |
| Edit landed on the live map by accident | Endpoint defaulted to production | Default the endpoint to the development API |

## Specification reference

> An `osmChange` document submitted to the changeset upload endpoint contains `create`, `modify` and `delete` blocks applied in that order, and the upload is atomic: if any element fails a precondition the entire document is rejected. Each modified or deleted element must carry the `version` the client believes is current; a mismatch produces an HTTP 409 conflict. See the [OSM API v0.6 changeset documentation](https://wiki.openstreetmap.org/wiki/API_v0.6) for the element-level requirements and the diff result format returned on success.

## Frequently Asked Questions

<details>
<summary>Why does my modify delete tags I did not include?</summary>

Because modify is a replacement operation, not a patch. The server takes the element you send as the object's complete new state, so any tag absent from your document is absent from the object afterwards. The safe pattern is never to construct an element yourself: fetch the server's current element, mutate that object in memory, and upload the mutated original so every field you did not touch travels along unchanged.
</details>

<details>
<summary>Can I just increment the version number when I get a conflict?</summary>

You can, and it is the single most damaging thing you can do through this API. The conflict exists because another mapper edited the object after you read it; incrementing the version tells the server you have seen their change when you have not, and their edit is overwritten without trace. Re-read the object instead and decide whether your edit still applies, is now redundant, or genuinely disagrees and needs a human.
</details>

<details>
<summary>Should I upload one changeset per object?</summary>

No — that inflates the changeset history and makes the edit harder, not easier, to review. Group objects that belong to the same fix in the same bounded area into one changeset of a few hundred at most. The grouping rule is what a revert should undo: everything in a changeset stands or falls together, so everything in it should have been the same decision.
</details>

<details>
<summary>How do I test this without touching the real map?</summary>

Use the development API instance, which is a separate deployment with its own accounts, its own data and its own object identifiers. Point the endpoint at it through configuration rather than by editing code, so the live endpoint is never one uncommitted change away. Exercise the whole pipeline there, including the conflict path, before any run against the production API.
</details>

## Related

- [The OSM Editing API & Changeset Upload](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/) — the parent topic with the changeset lifecycle and review expectations.
- [Dry-Running a Bulk Edit Against the Dev API](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/dry-running-a-bulk-edit-against-the-dev-api/) — how to exercise this script safely first.
- [OSM Feature Identity & ID Stability](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/) — the version semantics the conflict handling depends on.
- [Rolling Back a Bad OSM Import](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/rolling-back-a-bad-osm-import/) — undoing a changeset you should not have uploaded.
- [Flagging Deprecated OSM Tags in a Pipeline](https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/flagging-deprecated-osm-tags-in-a-pipeline/) — a common source of the retagging edits this script performs.

Up one level: [The OSM Editing API & Changeset Upload](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Uploading an OSM Changeset from Python",
  "description": "Open a changeset, read current object versions, build an osmChange document that preserves untouched tags, upload atomically, and resolve conflicts by re-reading instead of overwriting.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Querying OSM: Overpass, Nominatim & APIs",
  "about": ["osmChange upload", "OSM API conflict", "changeset metadata"]
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
    { "@type": "ListItem", "position": 4, "name": "Uploading an OSM Changeset from Python", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/uploading-an-osm-changeset-from-python/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Upload a tag edit to OpenStreetMap from Python",
  "description": "Read each object's current state, merge the change into its complete tag set, open a described changeset, upload an atomic osmChange document, and handle conflicts by re-reading.",
  "step": [
    { "@type": "HowToStep", "name": "Default to the development endpoint", "text": "Read the API base URL from configuration with the development instance as the default so reaching the live map is deliberate." },
    { "@type": "HowToStep", "name": "Read the current element", "text": "Fetch each object's complete current state from the API immediately before uploading, and mutate that element rather than constructing one." },
    { "@type": "HowToStep", "name": "Merge into the full tag set", "text": "Apply additions and removals to the object's existing tags and rebuild its children from the complete merged result." },
    { "@type": "HowToStep", "name": "Skip no-ops", "text": "Compare the merged tag set against the current one and drop objects that would not change." },
    { "@type": "HowToStep", "name": "Open a described changeset", "text": "Create the changeset only once there is something to upload, with a comment, a checkable source and the tool version." },
    { "@type": "HowToStep", "name": "Upload atomically", "text": "Submit a single osmChange document whose modify block carries every staged element in full." },
    { "@type": "HowToStep", "name": "Re-read on conflict, close in finally", "text": "Treat a version conflict as a decision requiring a fresh read, and close the changeset unconditionally." }
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
      "name": "Why does my modify delete tags I did not include?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because modify is a replacement operation, not a patch. The server takes the element you send as the object's complete new state, so any tag absent from your document is absent from the object afterwards. Fetch the server's current element, mutate that object in memory, and upload the mutated original so every field you did not touch travels along unchanged." }
    },
    {
      "@type": "Question",
      "name": "Can I just increment the version number when I get a conflict?",
      "acceptedAnswer": { "@type": "Answer", "text": "You can, and it is the single most damaging thing you can do through this API. The conflict exists because another mapper edited the object after you read it; incrementing the version tells the server you have seen their change when you have not, and their edit is overwritten without trace. Re-read the object instead and decide whether your edit still applies." }
    },
    {
      "@type": "Question",
      "name": "Should I upload one changeset per object?",
      "acceptedAnswer": { "@type": "Answer", "text": "No — that inflates the changeset history and makes the edit harder, not easier, to review. Group objects that belong to the same fix in the same bounded area into one changeset of a few hundred at most. The grouping rule is what a revert should undo: everything in a changeset stands or falls together." }
    },
    {
      "@type": "Question",
      "name": "How do I test an OSM upload without touching the real map?",
      "acceptedAnswer": { "@type": "Answer", "text": "Use the development API instance, which is a separate deployment with its own accounts, its own data and its own object identifiers. Point the endpoint at it through configuration rather than by editing code, so the live endpoint is never one uncommitted change away. Exercise the whole pipeline there, including the conflict path, before any production run." }
    }
  ]
}
</script>
