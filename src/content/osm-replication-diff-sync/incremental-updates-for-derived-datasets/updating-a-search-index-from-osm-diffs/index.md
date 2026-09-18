---
title: "Updating a Search Index from OSM Diffs"
description: "Keep a geocoding or place-search index current from minutely change files, including the denormalised context that goes stale when a city is renamed and no document mentioning it changed."
pageTitle: "Incrementally Updating a Place Search Index from OSM"
pageDescription: "Turn an .osc change file into index operations, handle deletes and re-parenting, and find the documents whose embedded context changed even though the features themselves did not."
slug: updating-a-search-index-from-osm-diffs
type: article
breadcrumb: "Search Index Updates"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Updating a Search Index from OSM Diffs

A search index is the easiest derived dataset to update incrementally and the easiest to get quietly wrong, because documents embed context from features other than the one they describe.

## Prerequisites

- [ ] An index that supports bulk upsert and delete by identifier — Elasticsearch, OpenSearch, Typesense or similar.
- [ ] Python 3.10+; the code below uses only the standard library plus your client.
- [ ] The affected-set framing from [Incremental Updates for Derived Datasets](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/).
- [ ] A stable document identifier derived from the OSM type and identifier.
- [ ] A defined set of searchable feature types, so most diffs can be filtered out cheaply.

## Conceptual minimum

Identity makes the base case trivial. A document identifier of `n123456` or `w987654` means a create is an upsert, a modify is an upsert, and a delete is a delete by identifier. Ninety-something percent of an OSM diff maps onto that directly, and a pipeline that does only this is right most of the time.

The remaining percentage is where the work is, and it has three sources.

**Denormalised context.** A street document typically carries the name of its city, its region and its country, because searching for "Main Street, Springfield" has to match something. Those names come from features the diff may never mention. When the city is renamed, every document that embedded the old name is stale, and nothing in the change file points at them.

**Filter transitions.** A feature that stops being searchable — a `place=town` retagged to something else, a name removed — does not appear in the diff as a delete. It appears as a modify, and a pipeline that upserts modifications and deletes deletions leaves it in the index forever. Every modify must be evaluated against the searchability filter, and a feature that fails it must be deleted rather than skipped.

**Re-parenting.** A feature whose containing boundary changed — because the boundary moved, not because the feature did — needs its context recomputed without having changed at all.

The practical resolution is that **context changes are a separate, slower path**. Identity-keyed updates run per diff in seconds. Context updates run when a context-bearing feature changes, are potentially enormous, and belong in a background reindex of the affected area rather than in the minutely loop.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="usi1-t usi1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="usi1-t">Three ways an index goes stale without any wrong document being written</title>
  <desc id="usi1-d">Three panels. Denormalised context goes stale when a city is renamed, because every street document embedded the old city name and the change file names only the city. A filter transition leaves a document behind when a feature stops qualifying for the index, since that appears as a modification rather than a deletion and a pipeline that upserts modifications keeps it searchable forever. Re-parenting changes a document's administrative context when a boundary moves, even though the feature itself was never edited and appears in no diff.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three stale-index paths</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Stale context</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">City renamed once</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Streets embedded old name</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Diff names only the city</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Documents never touched</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Filter transition</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Feature stops qualifying</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Appears as a modify</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Upsert keeps it indexed</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Searchable forever</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Re-parenting</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Boundary moved</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Feature never edited</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Context now wrong</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Appears in no diff</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">All three produce documents that are individually well formed, which is why no schema validation or write-path check will ever notice them.</text>
</svg>
<figcaption>The identity-keyed path handles none of these, and it is the only path most pipelines implement.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.search.incremental")

# Features worth indexing at all. Everything else is filtered before any work.
SEARCHABLE_KEYS = ("place", "amenity", "shop", "tourism", "highway", "boundary")
# Features whose own attributes are embedded in OTHER documents.
CONTEXT_KEYS = ("boundary", "place")


@dataclass(frozen=True)
class Change:
    action: str                 # create | modify | delete
    osm_type: str
    osm_id: int
    tags: dict[str, str] = field(default_factory=dict)
    old_tags: dict[str, str] = field(default_factory=dict)


def doc_id(osm_type: str, osm_id: int) -> str:
    return f"{osm_type[0]}{osm_id}"


def is_searchable(tags: dict[str, str]) -> bool:
    """A feature with no name is not findable by name, whatever else it has."""
    if not tags.get("name"):
        return False
    return any(key in tags for key in SEARCHABLE_KEYS)


def is_context_bearing(tags: dict[str, str]) -> bool:
    return any(key in tags for key in CONTEXT_KEYS)


@dataclass
class Plan:
    upserts: list[str] = field(default_factory=list)
    deletes: list[str] = field(default_factory=list)
    reindex_areas: list[tuple[str, int]] = field(default_factory=list)


def plan_from_diff(changes: Iterable[Change]) -> Plan:
    plan = Plan()
    for change in changes:
        identifier = doc_id(change.osm_type, change.osm_id)

        if change.action == "delete":
            plan.deletes.append(identifier)
        elif is_searchable(change.tags):
            plan.upserts.append(identifier)
        elif is_searchable(change.old_tags):
            # It WAS indexed and no longer qualifies. A modify, not a delete —
            # skipping it here is how features stay searchable after they stop
            # being findable in reality.
            plan.deletes.append(identifier)

        # A renamed city or a moved boundary invalidates documents that
        # embedded its name. Those documents are not in this diff at all.
        context_changed = (
            is_context_bearing(change.tags) or is_context_bearing(change.old_tags)
        ) and change.tags.get("name") != change.old_tags.get("name")
        if context_changed or (change.action != "modify"
                               and is_context_bearing(change.tags)):
            plan.reindex_areas.append((change.osm_type, change.osm_id))

    return plan


def bulk_operations(plan: Plan, index: str) -> Iterator[dict]:
    """Emit operations in delete-then-upsert order.

    A feature that moved out of one document shape and into another must lose
    the old document before gaining the new one, or both exist briefly.
    """
    for identifier in plan.deletes:
        yield {"delete": {"_index": index, "_id": identifier}}
    for identifier in plan.upserts:
        yield {"index": {"_index": index, "_id": identifier}}


def apply(plan: Plan, client, index: str, sequence: int) -> None:
    if plan.deletes or plan.upserts:
        client.bulk(list(bulk_operations(plan, index)), refresh=False)
        logger.info("seq %d: %d upsert(s), %d delete(s)", sequence,
                    len(plan.upserts), len(plan.deletes))

    # The slow path. Queued, not run inline: one boundary rename can touch
    # hundreds of thousands of documents and must not stall the minutely loop.
    for osm_type, osm_id in plan.reindex_areas:
        client.enqueue_area_reindex(osm_type, osm_id)
        logger.info("seq %d: queued context reindex for %s%d",
                    sequence, osm_type, osm_id)

    client.set_marker(index, sequence)


if __name__ == "__main__":
    logger.info("identity path inline, context path queued")
```

## Step-by-step walkthrough

1. **Filter before doing anything.** Most changes touch features the index does not contain, and discarding them first is the difference between a diff costing milliseconds and costing seconds.
2. **Evaluate every modify against the filter twice.** Once against the new tags and once against the old, because the transition out of searchability is a modify that must become a delete.
3. **Treat a missing name as unsearchable.** A feature nobody can search for by name is a document that only adds noise, and removing the name is a common edit.
4. **Detect context-bearing changes separately.** A boundary or place whose name changed invalidates documents that embedded it, none of which appear in the diff.
5. **Queue the context reindex; never run it inline.** One country rename can touch millions of documents, and a minutely loop that attempts it stops being minutely.
6. **Order deletes before upserts in the bulk body.** A document whose identifier changed shape must lose its old form before gaining the new one.
7. **Do not refresh per diff.** Forcing a refresh on every minutely update multiplies segment churn for a freshness guarantee search users cannot perceive.
8. **Advance the index's own marker.** The index's sequence is not the database's, and conflating them is how a stalled index reports itself current.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 306" role="img" aria-labelledby="usi2-t usi2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="usi2-t">Routing a change to the fast path or the slow path</title>
  <desc id="usi2-d">A decision with three branches based on what a change touches. A change to a feature that is not searchable, before or after, is discarded immediately and costs nothing, which covers most of a typical diff. A change to a searchable non-context feature goes to the inline identity path, becoming an upsert or a delete in the current bulk request. A change to a context-bearing feature such as a boundary or a place name queues an area reindex on the background path, because it can invalidate an unbounded number of documents that the diff never names.</desc>
  <defs><marker id="usi2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="306" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Which path a change takes</text>
  <rect x="26" y="117" width="250" height="88" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.6"/>
  <text x="151" y="145" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">What does this change touch?</text>
  <text x="151" y="167" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Evaluated against old and new tags</text>
  <text x="151" y="185" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Most diffs stop at the first branch</text>
  <line x1="276" y1="161" x2="314" y2="161" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="314" y2="239" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="353" y2="83" stroke="currentColor" stroke-width="1.4" marker-end="url(#usi2-a)"/>
  <rect x="356" y="52" width="498" height="62" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="370" y="77" font-size="12" font-weight="700" fill="currentColor">Nothing searchable: discard</text>
  <text x="370" y="97" font-size="10.5" fill="currentColor" opacity="0.88">Costs nothing, and covers most of a typical change file</text>
  <line x1="314" y1="161" x2="353" y2="161" stroke="currentColor" stroke-width="1.4" marker-end="url(#usi2-a)"/>
  <rect x="356" y="130" width="498" height="62" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="370" y="155" font-size="12" font-weight="700" fill="currentColor">A searchable feature: inline</text>
  <text x="370" y="175" font-size="10.5" fill="currentColor" opacity="0.88">Upsert or delete by identifier in this diff's bulk request</text>
  <line x1="314" y1="239" x2="353" y2="239" stroke="currentColor" stroke-width="1.4" marker-end="url(#usi2-a)"/>
  <rect x="356" y="208" width="498" height="62" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="370" y="233" font-size="12" font-weight="700" fill="currentColor">Context bearing: queue a reindex</text>
  <text x="370" y="253" font-size="10.5" fill="currentColor" opacity="0.88">Unbounded fan-out; never run inside the minutely loop</text>
  <text x="868" y="290" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Running the third branch inline is how a minutely index update occasionally takes forty minutes and nobody can say why.</text>
</svg>
<figcaption>The branches differ by orders of magnitude in cost, which is the reason to separate them.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="usi3-t usi3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="usi3-t">How a single city rename reaches documents the diff never names</title>
  <desc id="usi3-d">Four steps. A change file contains one modification: a place node whose name tag changed. The identity path upserts exactly one document, which is correct and insufficient. The context detector notices the changed feature is context bearing and its name differs from the previous name, so it queues an area reindex keyed on that feature. The background worker resolves the feature geometry, queries the primary database for every searchable feature inside it, and bulk upserts those documents with the corrected context, which may be hundreds of thousands of documents from one edit.</desc>
  <defs><marker id="usi3-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">One edit, hundreds of thousands of documents</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">one modify</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">a place name changed</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">a single diff entry</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#usi3-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">identity path</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">upserts one document</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">correct, insufficient</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#usi3-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">queue reindex</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">context bearing, renamed</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">keyed on that feature</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#usi3-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">background pass</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">everything inside it</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">context corrected</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The fan-out between the second and fourth step is unbounded, which is the whole reason the two paths are separated.</text>
</svg>
<figcaption>Nothing in the change file points at the documents the fourth step rewrites.</figcaption>
</figure>

## Verification

- **A renamed feature becomes findable by the new name.** Search for it after the next diff.
- **An unsearchable transition removes the document.** Strip a feature's name and confirm it disappears from results.
- **A deleted feature is gone.** Delete and search; the absence should be immediate after refresh.
- **Context reindex is queued, not run.** Rename a boundary and confirm the diff completes quickly with a queued job.
- **The index marker advances.** Compare it against the database's sequence and confirm the gap is bounded.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Removed features still searchable | Modify out of searchability treated as a skip | Evaluate old tags too and emit a delete |
| Stale city names in street documents | Denormalised context never invalidated | Queue an area reindex on context changes |
| Minutely loop occasionally takes an hour | Context reindex run inline | Move it to a background queue |
| Documents duplicated after an edit | Upserts ordered before deletes | Emit deletes first in the bulk body |
| Index reported current while stale | Sharing the database's sequence marker | Give the index its own marker |
| Search latency degrades over time | Forced refresh on every diff | Refresh on an interval, not per update |
| Diffs cost seconds for no changes | No searchability filter before work | Filter first; most changes are irrelevant |

## Specification reference

> A bulk request applies its actions in the order given. Index actions create or replace a document with the given identifier; delete actions remove it. A refresh makes recent operations visible to search and is expensive relative to indexing, so it should not be requested per operation in a streaming workload. See the Elasticsearch bulk API and refresh documentation, and [Incremental Updates for Derived Datasets](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/) for the affected-set framing.

## Frequently Asked Questions

<details>
<summary>How do you bound the cost of a context reindex?</summary>

By scoping it to the geometry of the changed context feature. A renamed city invalidates documents inside that city, not everywhere, so the reindex is a spatial query against the primary database plus a bulk upsert of what it returns. The cost is proportional to the feature count inside the boundary, which for a country is genuinely large — and that case is the reason it runs in the background with a rate limit rather than inline.
</details>

<details>
<summary>Should the index store OSM tags or a flattened document?</summary>

Flattened, almost always. A search index is queried by people typing names, not by pipelines asking about tags, and storing raw tags pushes the interpretation work into query time where it is repeated on every request. Flatten once during indexing into the handful of fields search actually uses, and keep the raw tags in the primary database where the next reindex can read them.
</details>

<details>
<summary>What happens when the index falls a long way behind?</summary>

The same calculation as any derived dataset: at some gap, replaying diffs costs more than reindexing from current state. For a search index the crossover is usually favourable to reindexing, because a full reindex is a single scan with bulk writes and no per-diff overhead. Keeping the index's own marker is what makes the gap visible enough to make that call.
</details>

<details>
<summary>Do deletes need to be immediate?</summary>

More than upserts do. A missing result is a mild disappointment; a result that leads somewhere that no longer exists is a user following directions to a closed business. If anything is worth running promptly in an otherwise batched update, it is the delete path, and it is also the cheapest part since a delete carries no document body.
</details>

## Related

- [Incremental Updates for Derived Datasets](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/) — the parent topic.
- [Propagating OSM Diffs Into a GeoParquet Lake](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/propagating-osm-diffs-into-a-geoparquet-lake/) — the same problem where files are immutable.
- [Nominatim Geocoding at Scale](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-and-address-lookup/) — the search behaviour these documents support.
- [OSM Feature Identity & ID Stability](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/) — why delete-and-recreate churns document identifiers.
- [Normalizing OSM Name Tags for Search](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/regex-driven-tag-value-cleaning/) — the cleaning the documents depend on.

Up one level: [Incremental Updates for Derived Datasets](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Updating a Search Index from OSM Diffs",
  "description": "Keep a geocoding or place-search index current from minutely change files, including the denormalised context that goes stale when a city is renamed and no document mentioning it changed.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Replication & Diff Sync",
  "about": ["search index", "incremental reindex", "denormalised context"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Replication & Diff Sync", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/" },
    { "@type": "ListItem", "position": 3, "name": "Incremental Updates for Derived Datasets", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/" },
    { "@type": "ListItem", "position": 4, "name": "Updating a Search Index from OSM Diffs", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/updating-a-search-index-from-osm-diffs/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Update a place search index from OSM change files",
  "description": "Filter irrelevant changes, map searchable features onto identity-keyed upserts and deletes, detect transitions out of searchability, and queue context reindexes rather than running them inline.",
  "step": [
    { "@type": "HowToStep", "name": "Filter irrelevant changes", "text": "Discard changes to features the index does not contain, which is most of a typical diff." },
    { "@type": "HowToStep", "name": "Evaluate old and new tags", "text": "Check searchability against both states so a feature leaving the index becomes a delete rather than a skip." },
    { "@type": "HowToStep", "name": "Require a name", "text": "Treat a feature with no name as unsearchable, since it cannot be found by name anyway." },
    { "@type": "HowToStep", "name": "Detect context changes", "text": "Flag renamed boundaries and places, whose names are embedded in documents the diff never mentions." },
    { "@type": "HowToStep", "name": "Queue the context reindex", "text": "Run area reindexes on a background worker so one country rename cannot stall the minutely loop." },
    { "@type": "HowToStep", "name": "Order deletes before upserts", "text": "Emit delete actions first in the bulk body so a reshaped document never exists twice." },
    { "@type": "HowToStep", "name": "Advance the index marker", "text": "Record the index's own upstream sequence, separate from the primary database's." }
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
      "name": "How do you bound the cost of a context reindex?",
      "acceptedAnswer": { "@type": "Answer", "text": "By scoping it to the geometry of the changed context feature. A renamed city invalidates documents inside that city, so the reindex is a spatial query plus a bulk upsert of what it returns. For a country that is genuinely large, which is why it runs in the background with a rate limit." }
    },
    {
      "@type": "Question",
      "name": "Should a search index store raw OSM tags or a flattened document?",
      "acceptedAnswer": { "@type": "Answer", "text": "Flattened, almost always. A search index is queried by people typing names, and storing raw tags pushes interpretation into query time where it repeats on every request. Flatten once during indexing and keep raw tags in the primary database for the next reindex." }
    },
    {
      "@type": "Question",
      "name": "What happens when a search index falls a long way behind?",
      "acceptedAnswer": { "@type": "Answer", "text": "The same calculation as any derived dataset: at some gap, replaying diffs costs more than reindexing from current state, and for a search index the crossover usually favours reindexing because a full pass is one scan with bulk writes. The index's own marker is what makes the gap visible." }
    },
    {
      "@type": "Question",
      "name": "Do search index deletes need to be applied immediately?",
      "acceptedAnswer": { "@type": "Answer", "text": "More than upserts do. A missing result is a mild disappointment; a result leading somewhere that no longer exists sends a user to a closed business. Deletes are also the cheapest operation since they carry no document body, so prompt deletes cost little." }
    }
  ]
}
</script>
