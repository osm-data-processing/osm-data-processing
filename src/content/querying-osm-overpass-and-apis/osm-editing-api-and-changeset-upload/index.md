---
title: "The OSM Editing API & Changeset Upload"
description: "Reading current object versions and writing edits back through the OSM API: the changeset lifecycle, osmChange documents, optimistic locking, and the review discipline automated edits require."
pageTitle: "The OSM Editing API: Changesets, osmChange & Conflicts"
pageDescription: "Use the OpenStreetMap editing API correctly — open and close changesets, build osmChange documents, resolve version conflicts, and keep automated edits small, documented and revertible."
slug: osm-editing-api-and-changeset-upload
type: guide
breadcrumb: "Editing API"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# The OSM Editing API & Changeset Upload

Reading OpenStreetMap is a technical decision. Writing to it is a social one, executed with technical tools, and the tools are deliberately shaped by the social expectations. The editing API will accept an authenticated changeset from any account within seconds of you writing your first script; whether that changeset stays in the map depends entirely on choices that have nothing to do with HTTP.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="eac1-t eac1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="eac1-t">The changeset lifecycle from open to close</title>
  <desc id="eac1-d">Four stages. Opening a changeset submits metadata including a comment, a source and the creating software, and receives a changeset identifier. Reading fetches the current version of every object the edit will touch, which is the only defence against overwriting somebody else's work. Uploading submits an osmChange document containing creates, modifications and deletions, which the server applies atomically or rejects entirely. Closing finalises the changeset so it becomes visible for review and revert.</desc>
  <defs><marker id="eac1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four calls, and the second one is not optional</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">open</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">comment, source, tool</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">returns an id</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#eac1-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">read current</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">version per object</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">the conflict defence</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#eac1-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">upload</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">osmChange document</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">atomic: all or none</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#eac1-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">close</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">finalise the changeset</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">reviewable, revertible</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Skipping the second call is how an automated edit silently reverts a mapper's correction made twenty minutes earlier.</text>
</svg>
<figcaption>The upload is atomic, which means a single stale version rejects the entire document — that is a feature, not an obstacle.</figcaption>
</figure>

## The Problem This Topic Solves

Sometimes the right outcome of a data pipeline is an improvement to OpenStreetMap itself: a systematic tagging error you have detected across a region, an authoritative dataset that genuinely adds information the map lacks, a set of objects whose geometry you can demonstrably improve. The editing API is how that gets back.

The failure scenario is well documented in the community's collective memory. A team runs a bulk edit without discussion, using a script that reads objects once, holds them for an hour, and uploads with versions that have since moved on. Some uploads conflict and are rejected; the script bumps the version numbers to force them through; the edits silently overwrite corrections made by local mappers in the meantime. The changeset comment says "data import". Nobody can tell what the source was or whom to ask. The result is a revert, a mailing list thread, and a team that is now unwelcome. Every step of that is preventable by the practices below, and none of them is technically difficult.

## Prerequisites

Understand the element model in [Node, Way & Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/), because an edit that touches a way's node list is a very different proposition from one that only touches tags. Read the parent [Querying OSM: Overpass, Nominatim & APIs](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/) overview for the service's role. And be clear on identity and versioning, covered in [OSM Feature Identity & ID Stability](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/) — the version number is the whole basis of the API's concurrency control.

## The Changeset as the Unit of Everything

A changeset is not a transaction wrapper; it is the unit of *review* and the unit of *revert*. That single fact determines how you should size and scope one.

A changeset containing five thousand objects spanning four unrelated fixes cannot be reverted selectively: undoing the one mistake undoes the four good changes with it. A changeset containing one coherent fix across a bounded area can be reviewed in a minute and reverted cleanly if it turns out to be wrong. The engineering rule that follows is: **group by what a revert should undo**, not by what is convenient to batch.

The metadata carries equal weight. Three tags should be present on every automated changeset:

- **`comment`** — what changed and why, in a sentence a stranger can evaluate.
- **`source`** — where the data came from, specifically enough to check.
- **`created_by`** — the tool and version, so a systematic error can be traced to its cause.

A contact point, whether in the comment or as a link to a documented wiki page describing the edit, is what turns "suspicious automated edit" into "let me ask them about this".

<figure class="diagram-wrap">
<svg viewBox="0 0 880 239" role="img" aria-labelledby="eac2-t eac2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="eac2-t">How changeset size affects review, revert and trust</title>
  <desc id="eac2-d">Three panels covering changeset sizing. A small single-purpose changeset covering one fix in a bounded area can be reviewed in minutes and reverted cleanly, and it builds trust because each one is evaluable. A large single-purpose changeset is still revertible as a unit but is hard to review and its blast radius is wide. A large mixed changeset combining unrelated fixes cannot be reverted selectively, so undoing one mistake destroys the good changes with it, and it is the shape most likely to be reverted wholesale.</desc>
  <rect x="0" y="0" width="880" height="239" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Size the changeset by what a revert should undo</text>
  <rect x="26" y="52" width="259" height="153" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Small, single purpose</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">One fix, bounded area</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Reviewable in minutes</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Reverts cleanly on its own</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Each one builds trust</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">The shape to aim for</text>
  <rect x="311" y="52" width="259" height="153" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Large, single purpose</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">One fix, wide area</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Hard to review in full</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Still reverts as a unit</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Wide blast radius</text>
  <text x="325" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Split by area if you can</text>
  <rect x="595" y="52" width="259" height="153" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Large, mixed purpose</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Several unrelated fixes</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Effectively unreviewable</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Cannot revert selectively</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">One error loses all of it</text>
  <text x="609" y="188" font-size="10.5" fill="currentColor" opacity="0.92">The shape to never ship</text>
  <text x="868" y="223" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">A reviewer who cannot tell what a changeset was for has only one safe option available to them, and it is the revert button.</text>
</svg>
<figcaption>Batching unrelated fixes together is convenient for the uploader and hostile to everybody who has to evaluate the result.</figcaption>
</figure>

## Optimistic Locking and the Version Field

Every OSM object carries a version number that increments on each edit. When you upload a change, you state the version you believe you are modifying. If the server's current version differs, it rejects the *entire* changeset with a conflict response naming the offending object.

This is optimistic locking, and it is the mechanism that stops concurrent editors from silently destroying each other's work. Two consequences matter for a pipeline.

First, **the read-to-write window must be short**. Reading objects, computing changes for an hour, and then uploading maximises the chance that something moved. Read immediately before uploading, in the same run, ideally in the same few seconds.

Second, **never resolve a conflict by bumping the version**. The conflict means somebody edited the object after you read it. Incrementing the version number you send does not merge their change; it overwrites it. The correct response is to re-read the object, re-evaluate whether your edit still applies to the new state, and either re-apply it or skip the object — a distinction developed in [Uploading an OSM Changeset from Python](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/uploading-an-osm-changeset-from-python/).

## The osmChange Document

Uploads are submitted as an `osmChange` XML document with three sections — `create`, `modify` and `delete` — applied in that order. Several details routinely surprise people.

**New objects use negative ids.** An object being created is given a negative placeholder id, and the server returns a mapping from your placeholder to the real assigned id. Ways referencing newly created nodes reference the negative ids, and the server resolves them.

**Modification is a full replacement.** There is no partial update: a `modify` element carries the object's complete tag set and, for a way, its complete node list. Sending a `modify` with only the tag you changed deletes every other tag on the object. This is the single most destructive mistake available through this API.

**Deletion has ordering constraints.** A node that is a member of a way cannot be deleted while the way references it. The `delete` section is applied last precisely so that a way can be deleted in the same changeset as its nodes.

## Validation and Error Handling

| Condition | Root cause | Detection | Remediation |
| --- | --- | --- | --- |
| HTTP 409 conflict | Object version moved since you read it | Response names the object and both versions | Re-read, re-evaluate, re-apply or skip — never bump |
| HTTP 400 with a precondition failure | Referenced object missing or already deleted | Response names the missing reference | Re-read the referencing object; it may already be fixed |
| Tags disappeared after an edit | `modify` sent a partial tag set | Object has only the tags you sent | Always send the complete current tag set plus changes |
| Way geometry destroyed | `modify` sent a partial node list | Way has only the nodes you listed | Send the complete node list on every way modification |
| Changeset rejected as too large | Element count above the server limit | Explicit size error on upload | Split into several smaller, single-purpose changesets |
| Upload succeeds, edit is reverted | No discussion, no source, no contact | A revert changeset referencing yours | Document the edit and discuss before repeating it |
| HTTP 429 on upload | Write rate limit exceeded | Rate-limit response | Slow down; write volume is deliberately constrained |

## Performance, Scale and Restraint

Everything about this API's performance profile is a deliberate signal. Writes are rate limited. Changesets have element ceilings. Bulk reads are discouraged in favour of extracts and Overpass. These are not obstacles to engineer around; they are the system telling you that its write path is designed for human-scale editing and for automation that behaves like a careful human.

The practical scaling pattern for a large systematic edit is therefore not "upload faster" but "upload in reviewable pieces over time": split by area, cap each changeset at a few hundred objects, pause between them, and watch for feedback. That cadence gives local mappers a chance to notice and object before the whole edit has landed, which is precisely the point.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 292" role="img" aria-labelledby="eac3-t eac3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="eac3-t">The sequence a large automated edit should follow before any upload happens</title>
  <desc id="eac3-d">Four stages spread over time. The proposal stage documents the edit on a wiki page and raises it on the relevant community channels, before any code is written. The dry run stage executes the entire edit against the development API to prove the mechanics work without touching live data. The pilot stage uploads one small bounded area to the live map and waits for feedback. The rollout stage proceeds area by area with pauses, so objections can still change the outcome partway through.</desc>
  <defs><marker id="eac3-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="292" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four stages, and three of them happen before the live map</text>
  <line x1="26" y1="150" x2="848" y2="150" stroke="currentColor" stroke-width="1.8" marker-end="url(#eac3-a)"/>
  <rect x="35" y="52" width="189" height="66" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="130" y="76" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">propose</text>
  <text x="130" y="94" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">document and discuss</text>
  <text x="130" y="110" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">before writing code</text>
  <line x1="130" y1="118" x2="130" y2="143" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="130" cy="150" r="5" fill="var(--osm-accent,#0369a1)"/>
  <rect x="242" y="176" width="189" height="66" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="336" y="200" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">dry run</text>
  <text x="336" y="218" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">against the dev API</text>
  <text x="336" y="234" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">proves the mechanics</text>
  <line x1="336" y1="176" x2="336" y2="157" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="336" cy="150" r="5" fill="var(--osm-ok,#15803d)"/>
  <rect x="449" y="52" width="189" height="66" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="544" y="76" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">pilot</text>
  <text x="544" y="94" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">one small area, live</text>
  <text x="544" y="110" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">then wait for feedback</text>
  <line x1="544" y1="118" x2="544" y2="143" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="544" cy="150" r="5" fill="var(--osm-warn,#a16207)"/>
  <rect x="656" y="176" width="189" height="66" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="750" y="200" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">roll out</text>
  <text x="750" y="218" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">area by area, paused</text>
  <text x="750" y="234" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">objections still count</text>
  <line x1="750" y1="176" x2="750" y2="157" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="750" cy="150" r="5" fill="var(--osm-alt,#6d28d9)"/>
  <text x="868" y="276" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The pilot means a mistake costs one small area rather than a country, and objections arrive while they can still change the plan.</text>
</svg>
<figcaption>Each stage exists to make the next one cheaper to reverse, which is the only reliable protection against a systematic error.</figcaption>
</figure>

## Failure Modes and Gotchas

- **Partial modification deletes data.** A `modify` replaces the object wholesale. Read the current object, apply your change to that complete state, and send the result.
- **Version bumping overwrites people.** A conflict is information about a concurrent edit, not an obstacle. Re-read and re-evaluate.
- **Negative ids are per-changeset.** Placeholder ids have no meaning outside the document that declares them; do not persist them.
- **An unclosed changeset stays open.** It will eventually time out, but until then it is visible and confusing. Close in a `finally` block.
- **Deleting a referenced node fails.** Delete the referencing way in the same changeset, or leave the node alone.
- **The development API is a separate world.** Different accounts, different data, different object ids. Code that hard-codes ids will not move between them, which is exactly why a dry run should exercise the full pipeline rather than a fixture.
- **Rate limits apply to writes specifically.** A read-heavy client that also writes can be throttled on the write path while reads continue fine, which makes the symptom confusing.

## Integration Points

Upstream, the decision about *what* to edit should come from a validation process, not from an ad hoc query — the rule catalogue in [Authoring OSM Validation Rules](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/) is the right source of candidate fixes, because a rule that has been reviewed and measured for false positives is a far better basis for a bulk edit than a hunch. Where the edit originates in an external dataset, the matching and scoring belongs in [OSM Conflation & Data Enrichment](https://www.osm-data-processing.org/osm-conflation-and-enrichment/) and the audit in [Auditing a Conflation Run Before Upload](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/auditing-a-conflation-run-before-upload/).

Downstream, your own copy of the data is now behind the map you just changed. If you run a replication pipeline, your edits will come back to you through the diff stream like anybody else's, which is a useful end-to-end check that they landed as intended.

## Guides in This Topic

- [Uploading an OSM Changeset from Python](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/uploading-an-osm-changeset-from-python/) — the full lifecycle in code, with conflict handling that re-reads rather than overwrites.
- [Dry-Running a Bulk Edit Against the Dev API](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/dry-running-a-bulk-edit-against-the-dev-api/) — exercising the whole pipeline against the development instance before touching live data.

## Frequently Asked Questions

<details>
<summary>Why did my changeset delete tags I never touched?</summary>

Because a modify operation replaces the object completely rather than patching it. If the document you uploaded listed only the tag you changed, the server took that as the object's full tag set and removed everything else. The fix is structural: always read the object's current state immediately before uploading, apply your change to that complete state, and send the whole result. The same applies to a way's node list.
</details>

<details>
<summary>What should I do when the API returns a version conflict?</summary>

Re-read the object and decide again. A conflict means somebody edited it after you read it, so your change was computed against a state that no longer exists. Sometimes their edit already fixed what you were fixing; sometimes yours still applies cleanly; sometimes the two genuinely conflict and the object should be skipped and reviewed by a human. Incrementing the version number to force the upload through discards their work silently and is the behaviour most likely to get an account blocked.
</details>

<details>
<summary>How large should an automated changeset be?</summary>

Small enough that a reviewer can understand it and that a revert undoes exactly one thing. A few hundred objects covering one coherent fix in a bounded area is a good target. The technical ceiling is much higher, but changesets are the unit of review and revert, so a large mixed changeset forces a reviewer who spots one problem to choose between accepting it and destroying everything else in the same upload.
</details>

<details>
<summary>Do I have to discuss an automated edit before making it?</summary>

For anything systematic or bulk, yes — that is the community's documented expectation, and it is also straightforwardly in your interest. A discussion surfaces regional tagging conventions you did not know about, finds the local mappers who will review your work, and produces the wiki page you can link from every changeset comment. Edits that arrive without any of that get reverted on suspicion, regardless of whether they were technically correct.
</details>

<details>
<summary>Can I use the editing API to read data in bulk?</summary>

No — and not because it will refuse, but because it is the same machinery every editor depends on and it is not built for that load. Reading single objects to check their current version before an edit is exactly what it is for. Reading a region, a category of features, or anything you would describe as a dataset belongs to Overpass or, better, to a downloaded extract.
</details>

## Related

- [Querying OSM: Overpass, Nominatim & APIs](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/) — the parent section and the read side of the service layer.
- [OSM Feature Identity & ID Stability](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/) — the version and identity model this API's locking depends on.
- [Authoring OSM Validation Rules](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/) — the right source of candidate fixes for a systematic edit.
- [Rolling Back a Bad OSM Import](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/rolling-back-a-bad-osm-import/) — what happens when this goes wrong, and how to undo it cleanly.
- [Changeset Analysis & Vandalism Detection](https://www.osm-data-processing.org/osm-data-quality-validation/changeset-analysis-and-vandalism-detection/) — how your changesets look from the reviewing side.
- [Fetching OSM Changeset Metadata from the API](https://www.osm-data-processing.org/osm-data-quality-validation/changeset-analysis-and-vandalism-detection/fetching-osm-changeset-metadata-from-the-api/) — reading changeset metadata rather than writing it.

Up one level: [Querying OSM: Overpass, Nominatim & APIs](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "The OSM Editing API & Changeset Upload",
  "description": "Reading current object versions and writing edits back through the OSM API: the changeset lifecycle, osmChange documents, optimistic locking, and the review discipline automated edits require.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Querying OSM: Overpass, Nominatim & APIs",
  "about": ["OSM editing API", "changeset upload", "osmChange document"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Querying OSM: Overpass, Nominatim & APIs", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/" },
    { "@type": "ListItem", "position": 3, "name": "The OSM Editing API & Changeset Upload", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Upload an automated edit to OpenStreetMap responsibly",
  "description": "Document and discuss the edit, dry-run it against the development API, read current versions immediately before upload, and ship small single-purpose changesets that a reviewer can revert cleanly.",
  "step": [
    { "@type": "HowToStep", "name": "Document and discuss", "text": "Write up what the edit does and why, and raise it on the relevant community channels before writing the upload code." },
    { "@type": "HowToStep", "name": "Dry-run against the development API", "text": "Execute the entire pipeline against the development instance to prove the mechanics without touching live data." },
    { "@type": "HowToStep", "name": "Open a described changeset", "text": "Open a changeset carrying a comment explaining the change, a checkable source, and the creating tool and version." },
    { "@type": "HowToStep", "name": "Read current versions immediately", "text": "Fetch each object's current state in the same run as the upload, and apply the change to that complete state." },
    { "@type": "HowToStep", "name": "Upload complete objects", "text": "Send full tag sets and full node lists in every modify element, because a modify replaces the object rather than patching it." },
    { "@type": "HowToStep", "name": "Handle conflicts by re-reading", "text": "On a version conflict, re-read the object and decide again whether the edit still applies, never by incrementing the version." },
    { "@type": "HowToStep", "name": "Close and pause", "text": "Close the changeset, then pause before the next area so objections can still change the plan." }
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
      "name": "Why did my changeset delete tags I never touched?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because a modify operation replaces the object completely rather than patching it. If the document you uploaded listed only the tag you changed, the server took that as the object's full tag set and removed everything else. Always read the object's current state immediately before uploading, apply your change to that complete state, and send the whole result. The same applies to a way's node list." }
    },
    {
      "@type": "Question",
      "name": "What should I do when the OSM API returns a version conflict?",
      "acceptedAnswer": { "@type": "Answer", "text": "Re-read the object and decide again. A conflict means somebody edited it after you read it, so your change was computed against a state that no longer exists. Sometimes their edit already fixed what you were fixing; sometimes the two genuinely conflict and the object should be skipped. Incrementing the version number to force the upload through discards their work silently." }
    },
    {
      "@type": "Question",
      "name": "How large should an automated changeset be?",
      "acceptedAnswer": { "@type": "Answer", "text": "Small enough that a reviewer can understand it and that a revert undoes exactly one thing. A few hundred objects covering one coherent fix in a bounded area is a good target. Changesets are the unit of review and revert, so a large mixed changeset forces a reviewer who spots one problem to choose between accepting it and destroying everything else in the same upload." }
    },
    {
      "@type": "Question",
      "name": "Do I have to discuss an automated OSM edit before making it?",
      "acceptedAnswer": { "@type": "Answer", "text": "For anything systematic or bulk, yes — that is the community's documented expectation, and it is also straightforwardly in your interest. A discussion surfaces regional tagging conventions you did not know about, finds the local mappers who will review your work, and produces the wiki page you can link from every changeset comment." }
    },
    {
      "@type": "Question",
      "name": "Can I use the OSM editing API to read data in bulk?",
      "acceptedAnswer": { "@type": "Answer", "text": "No — and not because it will refuse, but because it is the same machinery every editor depends on and it is not built for that load. Reading single objects to check their current version before an edit is exactly what it is for. Reading a region or a category of features belongs to Overpass or, better, to a downloaded extract." }
    }
  ]
}
</script>
