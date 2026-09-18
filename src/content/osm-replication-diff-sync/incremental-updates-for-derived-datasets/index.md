---
title: "Incremental Updates for Derived Datasets"
description: "Push OSM changes through to the things built on top of the data — tile caches, search indexes, analytics tables — without rebuilding them, and know when incremental has stopped being cheaper than starting over."
pageTitle: "Keeping Derived OSM Datasets Current Without Rebuilding"
pageDescription: "Turn an .osc change file into the minimum set of updates each derived dataset needs, handle deletions and identity churn honestly, and decide when a full rebuild is the cheaper answer."
slug: incremental-updates-for-derived-datasets
type: guide
breadcrumb: "Incremental Derived Updates"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Incremental Updates for Derived Datasets

Applying an `.osc` file to a local OSM database is the easy part, and for most pipelines it is not the part that costs anything. The expense sits downstream: the vector tiles cut from that database, the search index built over its place names, the analytics table aggregating its features by administrative area. Each of those took hours to build, each of them is now wrong in a handful of places, and rebuilding all of them every minute is not an option anybody can afford.

This topic is about the translation step between those two facts — turning a change file into the smallest set of downstream work that restores correctness. The general shape is always the same: read the diff, determine which derived artifacts the changed features participate in, invalidate or recompute exactly those, and record what you did well enough to prove the derived dataset corresponds to a specific upstream state. What varies, and varies enormously, is how hard that second step is for a given derived dataset.

It assumes the sequence model from [Replication Sequence Numbers & State Tracking](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/) and the apply mechanics from [Applying .osc Change Files with Osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/). Everything below starts from a successfully applied diff and asks what happens next.

## The Problem This Topic Solves

A minutely diff touching four hundred features is a trivial database update and a potentially enormous downstream one. Four hundred features scattered across a continent can invalidate tiles at every zoom level they appear in, which at zoom fourteen alone might be a few thousand tiles and across the whole pyramid considerably more. One of those features might be an administrative boundary whose edit changes which country a hundred thousand other features are counted in. Another might be a deleted node that three ways referenced, whose removal changes the geometry of each of them.

The naive responses both fail. Rebuilding everything on each diff is correct and impossibly expensive. Updating only the features named in the diff is cheap and wrong, because derived datasets contain relationships the diff does not mention — the tile that contains a feature, the relation whose geometry depends on a member, the aggregate whose total includes a row. The work of this topic is finding the middle: a derivation of affected downstream units that is neither the whole dataset nor merely the changed features.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="iud1-t iud1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="iud1-t">Why the changed features are not the affected outputs</title>
  <desc id="iud1-d">Three panels showing how a small diff expands downstream. A single edited node may be a member of several ways, so the geometry of each of those ways changes even though the diff never names them. A single edited way appears in tiles at every zoom where it is rendered, so one edit invalidates a column through the tile pyramid rather than one tile. A single edited boundary relation changes which administrative area thousands of unchanged features fall inside, so an aggregate built on that boundary is wrong for features the diff never touched.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">One change, three kinds of downstream spread</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Node edit</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Ways referencing it move</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Diff never names them</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Geometry changes anyway</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Lookup by membership</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Way edit</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Appears at many zooms</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">A column of tiles, not one</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Plus neighbours at low zoom</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Lookup by tile coverage</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Boundary edit</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Contained features recount</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Thousands, all unchanged</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Aggregates now wrong</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Lookup by spatial join</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Each kind of spread needs a different lookup, and a pipeline that implements only the first is the common case that quietly drifts.</text>
</svg>
<figcaption>The diff names causes. The affected outputs have to be derived from them.</figcaption>
</figure>

## Prerequisites

- [ ] A working diff-sync loop, per [Building a Minutely Update Pipeline](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/).
- [ ] A recorded sequence number for the base state of each derived dataset, not just the primary database.
- [ ] Knowledge of which derived datasets exist and who reads them, which is more often missing than the technical pieces.
- [ ] A rebuild path that works, because incremental update is an optimisation over rebuilding and you will need the fallback.

## Deriving the Affected Set

Every derived dataset needs a function from changed features to affected units, and writing that function honestly is the substance of the work.

For **tiles**, the unit is a tile coordinate and the function is geometric: the bounding box of the changed feature's old and new geometry, expanded to cover every tile it intersects at every zoom the layer is rendered at. Both geometries matter — a feature that moved invalidates where it was as well as where it is — which means the pipeline needs the previous geometry, and a diff that only carries the new version does not supply it. That is the single most common source of stale tiles: the old location is never invalidated because nothing remembered it.

For a **search index**, the unit is a document and the function is usually identity-based, which makes it the easy case. A changed place gets reindexed; a deleted one gets removed. The complication is that search documents typically denormalise context — a street's document may carry its city and country names — so an edit to a city name invalidates every document that embedded it, and identity alone will not find those.

For **analytics aggregates**, the unit is a group and the function is whatever the grouping key is. If features are counted by administrative area, a changed feature invalidates its area's total, and a changed boundary invalidates the totals of every area whose extent moved plus the neighbours it borrowed from. Aggregates are where incremental update most often goes subtly wrong, because a wrong total looks exactly like a right one.

The general rule is that **the affected set must be derived from both the old and the new state of each changed feature**. Anything computed from the new state alone will leave the consequences of the old state in place, and those consequences are invisible: a tile showing a building that has been demolished, a count including a feature that moved away.

## Handling Deletions and Identity Churn

Deletions are the case incremental pipelines handle worst, for a structural reason: a deleted feature carries almost no information. An `.osc` `<delete>` block gives you a type, an identifier and a version, and frequently nothing else. If the derived dataset needs the feature's geometry to compute the affected set — as tiles do — that geometry has to come from somewhere, and the only somewhere is the local database as it stood before the diff was applied.

This forces an ordering constraint that is easy to get backwards. **Compute the affected set before applying the diff, not after.** Once the delete has landed, the geometry is gone and the tiles covering it can no longer be identified. Pipelines that apply first and derive afterwards work fine for creates and modifications and silently fail for deletions, which is a failure mode that takes months to notice because deletions are relatively rare and the resulting staleness is localised.

Identity churn is the related problem covered in [OSM Feature Identity & ID Stability](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/). A feature can be deleted and recreated with a new identifier while representing the same real-world thing, or a way can be split into two ways where one keeps the original identifier and one does not. A derived dataset keyed on the OSM identifier sees a delete and a create, which is the correct behaviour for an index and the wrong behaviour for anything tracking a thing over time.

## Recording What the Derived State Corresponds To

A derived dataset that has been incrementally updated needs to record which upstream sequence it reflects, for the same reason the primary database does: without it, nobody can tell whether it is current, and after any failure nobody can tell where to resume.

The subtlety is that the derived dataset's sequence is not the primary database's sequence. They diverge whenever an incremental update fails, is skipped, or is still running, and treating them as one number is how a tile cache ends up being reported as current while serving data from an hour ago. Each derived dataset owns its own marker, advanced only when its update for that sequence has fully succeeded.

Recording it also makes the rebuild decision expressible. If the tile cache is at sequence 6,231,004 and the database is at 6,231,890, the gap is 886 diffs — and at some gap size, catching up incrementally costs more than starting over.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 292" role="img" aria-labelledby="iud2-t iud2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="iud2-t">The ordering constraint deletions impose on the update loop</title>
  <desc id="iud2-d">A timeline of four marks showing the required order of operations. First the diff is fetched but not applied. Second the affected set is derived, while the pre-diff state is still present in the database, which is the only moment at which a deleted feature's geometry can be read. Third the diff is applied to the primary database. Fourth the derived datasets are updated against the affected set computed earlier, and each advances its own sequence marker only on success. Reversing the second and third steps works for creates and modifications and silently fails for deletions.</desc>
  <defs><marker id="iud2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="292" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Derive before applying, not after</text>
  <line x1="26" y1="150" x2="848" y2="150" stroke="currentColor" stroke-width="1.8" marker-end="url(#iud2-a)"/>
  <rect x="35" y="52" width="189" height="66" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="130" y="76" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">Fetch diff</text>
  <text x="130" y="94" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">do not apply yet</text>
  <text x="130" y="110" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">parse only</text>
  <line x1="130" y1="118" x2="130" y2="143" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="130" cy="150" r="5" fill="var(--osm-accent,#0369a1)"/>
  <rect x="242" y="176" width="189" height="66" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="336" y="200" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">Derive affected</text>
  <text x="336" y="218" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">pre-diff state present</text>
  <text x="336" y="234" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">deletions readable here</text>
  <line x1="336" y1="176" x2="336" y2="157" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="336" cy="150" r="5" fill="var(--osm-ok,#15803d)"/>
  <rect x="449" y="52" width="189" height="66" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="544" y="76" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">Apply diff</text>
  <text x="544" y="94" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">primary db advances</text>
  <text x="544" y="110" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">old geometry now gone</text>
  <line x1="544" y1="118" x2="544" y2="143" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="544" cy="150" r="5" fill="var(--osm-warn,#a16207)"/>
  <rect x="656" y="176" width="189" height="66" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="750" y="200" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">Update derived</text>
  <text x="750" y="218" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">use the earlier set</text>
  <text x="750" y="234" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">advance own marker</text>
  <line x1="750" y1="176" x2="750" y2="157" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="750" cy="150" r="5" fill="var(--osm-alt,#6d28d9)"/>
  <text x="868" y="276" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Swapping the middle two steps is the single most common design error, and it fails only for deletions, which is why it survives review.</text>
</svg>
<figcaption>The second mark is the only moment a deleted feature's geometry still exists locally.</figcaption>
</figure>

## Deciding When to Rebuild Instead

Incremental update is an optimisation, and like every optimisation it has a region where it stops paying. Three signals say you have left it.

**The gap is large.** Catching up on a thousand diffs sequentially takes a thousand round trips and a thousand affected-set computations, most of which touch overlapping units. A rebuild processes the current state once. The crossover point is dataset-specific and worth measuring rather than guessing, but it exists, and it is usually lower than people expect.

**The derivation logic changed.** If the tile schema, the index mapping or the aggregate definition has been edited, incremental update propagates new changes through new logic while leaving old data computed under the old logic. The result is a dataset that is internally inconsistent in a way no diff will ever repair.

**Correctness is in doubt.** After any incident where the affected set may have been computed wrongly — a crash mid-update, a bug fixed in the derivation — the cheap remedy is a rebuild, because the alternative is proving a negative about data you cannot enumerate.

A useful discipline is to rebuild on a schedule regardless: a weekly or monthly full rebuild bounds how long any undetected incremental error can persist, and it keeps the rebuild path exercised so it works when you need it urgently. A rebuild path that has not been run in six months is not a fallback.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 250" role="img" aria-labelledby="iud3-t iud3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="iud3-t">Three derived datasets, and how the affected set is computed for each</title>
  <desc id="iud3-d">A grid of three derived dataset kinds against the unit that gets invalidated, the function from changed features to that unit, and the case that most often goes wrong. Tiles invalidate a tile coordinate, derived geometrically from the union of the old and new geometry across every rendered zoom, and most often go wrong when the old geometry is unavailable. Search indexes invalidate a document, derived from the feature identity, and most often go wrong when a document denormalises context that itself changes. Analytics aggregates invalidate a group, derived from the grouping key, and most often go wrong when the key is a boundary that moved.</desc>
  <rect x="0" y="0" width="880" height="250" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Unit, function, and the usual failure</text>
  <rect x="176" y="48" width="226" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="289" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Unit</text>
  <rect x="402" y="48" width="226" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="515" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Derivation</text>
  <rect x="628" y="48" width="226" height="30" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="741" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Usual failure</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Tiles</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="289" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">tile coordinate</text>
  <text x="515" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">old union new geom</text>
  <text x="741" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">old geometry missing</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Search index</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="289" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a document</text>
  <text x="515" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">feature identity</text>
  <text x="741" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">denormalised context</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Aggregates</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="289" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a group</text>
  <text x="515" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">the grouping key</text>
  <text x="741" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">boundary moved</text>
  <text x="868" y="234" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Only the middle row is identity-keyed, which is why the other two need a lookup the change file does not provide.</text>
</svg>
<figcaption>Each row needs a different index to answer its question cheaply at diff time.</figcaption>
</figure>

## Validation and Error Handling

| Check | What it catches | Response |
| --- | --- | --- |
| Derived sequence versus primary sequence | A derived dataset silently falling behind | Alert on gap; rebuild beyond a threshold |
| Affected set size distribution | A derivation returning nothing, or everything | Investigate before applying the update |
| Old-geometry availability on delete | Deriving after applying rather than before | Reorder the loop; rebuild the affected area |
| Sample re-derivation against a rebuild | Incremental and full results diverging | Rebuild, then fix the derivation logic |
| Update duration trend | Incremental cost approaching rebuild cost | Reassess the crossover point |
| Per-dataset failure isolation | One derived dataset failing the whole loop | Advance the others; retry the failed one |

## Performance and Scale

The cost of an incremental update decomposes into deriving the affected set and doing the work on it, and which dominates varies by dataset. For tiles, the derivation is cheap — a bounding-box-to-tile computation — and the work is expensive, because each invalidated tile must be re-cut from the database. For aggregates, the derivation may involve a spatial join that costs more than recomputing the aggregate would.

Two practical levers matter more than micro-optimisation. The first is **batching across diffs**: processing ten minutely diffs together and deduplicating the affected set is dramatically cheaper than processing them one at a time, because the same tiles and the same aggregates are invalidated repeatedly by consecutive edits in the same area. The cost is freshness, and an hour of freshness is a reasonable trade for most derived datasets even when the primary database is minutely.

The second is **deferring the expensive half**. An invalidation can be recorded without being serviced: mark the tile dirty and let it be re-cut on the next request, or on a background worker draining the dirty list by priority. This turns a synchronous cost into an asynchronous one and lets popularity decide what is actually worth recomputing, which for tile pyramids is a very large saving because most tiles are never requested.

## Failure Modes and Gotchas

**Deriving after applying.** Covered above, and worth repeating because it survives code review: it works perfectly for the ninety-odd percent of changes that are creates and modifications.

**Assuming the diff is complete.** A change file contains the features that changed, not the features whose derived representation changed. Relations whose members moved, and features whose containing boundary shifted, are affected without appearing.

**One sequence marker for everything.** Derived datasets fail independently and therefore must be tracked independently, or the first failure makes every subsequent freshness claim untrue.

**Dirty lists that grow unboundedly.** Deferring work is only a saving if the deferred work is eventually done or explicitly expired. A dirty tile list that grows faster than it drains is a rebuild that has not admitted it yet.

**No rebuild path.** Every incremental pipeline eventually needs to start over, and the ones that cannot are the ones that stay subtly wrong for years.

## Integration Points

Incremental derived updates sit between replication and every consumer. Upstream they depend on the sequence discipline in [Replication Sequence Numbers & State Tracking](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/) and the apply step in [Applying .osc Change Files with Osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/). Downstream they feed [OSM Vector Tiles & Rendering Pipelines](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/), where the dirty-tile list is the interface, and the analytics shapes in [Modelling OSM for Analytics Warehouses](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/).

They also interact with quality gating: an incremental update that lands a bad batch is harder to identify than a bad rebuild, because only part of the dataset changed. The thresholds discussed in [Continuous QA for OSM Pipelines](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/) apply to the update, not just the whole dataset.

## Guides in This Topic

- [Propagating OSM Diffs Into a GeoParquet Lake](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/propagating-osm-diffs-into-a-geoparquet-lake/) — applying changes to immutable files, where update means rewriting partitions.
- [Updating a Search Index from OSM Diffs](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/updating-a-search-index-from-osm-diffs/) — the identity-keyed case, and what denormalised context does to it.
- [Computing a Dirty Tile List from an .osc File](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/computing-a-dirty-tile-list-from-an-osc-file/) — the geometric derivation, including the old-geometry problem.

## Frequently Asked Questions

<details>
<summary>Should derived datasets update synchronously with the diff apply?</summary>

Usually not. Coupling them means the slowest derived dataset sets the pace of the whole replication loop, and a failure in a tile cutter stops the primary database from advancing. The better shape is that the apply loop records what changed and advances its own state, and each derived dataset consumes that record at its own rate with its own marker. The cost is that freshness varies between datasets, which is true anyway and better made explicit.
</details>

<details>
<summary>How do you verify an incrementally updated dataset is actually correct?</summary>

By rebuilding a sample and comparing. Pick a bounded area — a city, a tile range, an aggregate group — rebuild it from the current database, and diff it against the incrementally maintained version. Doing this on a schedule catches derivation bugs that no amount of logging will, because the failure signature of a wrong affected set is data that looks entirely plausible.
</details>

<details>
<summary>What about changes that affect nothing downstream?</summary>

Most changes are like this, and filtering them early is the largest available saving. An edit to a tag your tile schema never reads, or to a feature type your index does not contain, produces an empty affected set and should cost nothing. The filter belongs at the start of the derivation, and it is worth measuring what proportion of diffs it eliminates, because on a narrow derived dataset that proportion is often above ninety percent.
</details>

<details>
<summary>Can an incremental update be rolled back?</summary>

Only if the derived dataset supports it, which most do not. A tile cache has no history; a search index has no previous version of a document once it is replaced. The practical answer is that rollback for derived data means rebuilding from a primary database that has itself been rolled back, which is why the primary database's recoverability matters more than the derived dataset's. Keeping the derived marker separate at least tells you which upstream state to rebuild from.
</details>

<details>
<summary>How often should a full rebuild run even when nothing is wrong?</summary>

Often enough that an undetected incremental error cannot persist beyond the interval, and often enough that the rebuild path stays working. For most pipelines that lands between weekly and monthly. The second reason is the one people forget: a rebuild procedure that has not run since the schema changed is not a fallback, and discovering that during an incident is expensive.
</details>

## Related

- [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/) — the parent section.
- [Replication Sequence Numbers & State Tracking](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/) — where the markers come from.
- [Applying .osc Change Files with Osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/) — the apply step this follows.
- [Replication Monitoring & Lag Alerting](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-monitoring-and-lag-alerting/) — the signals that show a derived dataset falling behind.
- [OSM Vector Tiles & Rendering Pipelines](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/) — the largest consumer of incremental invalidation.
- [OSM Feature Identity & ID Stability](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/) — why delete-and-recreate breaks identity-keyed derivations.

Up one level: [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Incremental Updates for Derived Datasets",
  "description": "Push OSM changes through to the things built on top of the data — tile caches, search indexes, analytics tables — without rebuilding them, and know when incremental has stopped being cheaper than starting over.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Replication & Diff Sync",
  "about": ["incremental update", "derived datasets", "cache invalidation"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Replication & Diff Sync", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/" },
    { "@type": "ListItem", "position": 3, "name": "Incremental Updates for Derived Datasets", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Keep a derived OSM dataset current from change files",
  "description": "Derive the affected downstream units from both the old and new state of each changed feature before applying the diff, update only those units, and track each derived dataset's upstream sequence separately.",
  "step": [
    { "@type": "HowToStep", "name": "Parse the diff without applying it", "text": "Read the change file first, while the pre-diff state is still present locally." },
    { "@type": "HowToStep", "name": "Derive the affected set", "text": "Compute affected downstream units from both the old and new geometry, which is the only way deletions are covered." },
    { "@type": "HowToStep", "name": "Apply the diff", "text": "Advance the primary database once the affected set has been captured." },
    { "@type": "HowToStep", "name": "Update each derived dataset", "text": "Service the affected set per dataset, isolating failures so one slow consumer does not stall the rest." },
    { "@type": "HowToStep", "name": "Advance per-dataset markers", "text": "Record the upstream sequence each derived dataset now reflects, separately from the primary one." },
    { "@type": "HowToStep", "name": "Batch and defer where possible", "text": "Deduplicate affected units across several diffs and let popularity decide which deferred work is done." },
    { "@type": "HowToStep", "name": "Rebuild on a schedule", "text": "Run a periodic full rebuild to bound undetected drift and keep the fallback path exercised." }
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
      "name": "Should derived datasets update synchronously with the diff apply?",
      "acceptedAnswer": { "@type": "Answer", "text": "Usually not. Coupling means the slowest derived dataset paces the whole replication loop and a tile-cutter failure stops the primary database advancing. Better that the apply loop records what changed and advances its own state, with each derived dataset consuming that record at its own rate and its own marker." }
    },
    {
      "@type": "Question",
      "name": "How do you verify an incrementally updated dataset is correct?",
      "acceptedAnswer": { "@type": "Answer", "text": "By rebuilding a bounded sample — a city, a tile range, an aggregate group — and diffing it against the incrementally maintained version. Doing this on a schedule catches derivation bugs logging never will, because a wrong affected set produces data that looks entirely plausible." }
    },
    {
      "@type": "Question",
      "name": "What about OSM changes that affect nothing downstream?",
      "acceptedAnswer": { "@type": "Answer", "text": "Most changes are like this, and filtering them early is the largest available saving. An edit to a tag the tile schema never reads produces an empty affected set and should cost nothing. On a narrow derived dataset that filter often eliminates well over ninety percent of diffs." }
    },
    {
      "@type": "Question",
      "name": "Can an incremental update to a derived dataset be rolled back?",
      "acceptedAnswer": { "@type": "Answer", "text": "Only if the derived dataset supports it, and most do not: a tile cache has no history and a search index has no previous document version once replaced. Practically, rollback means rebuilding from a primary database that has itself been rolled back." }
    },
    {
      "@type": "Question",
      "name": "How often should a full rebuild run when nothing is wrong?",
      "acceptedAnswer": { "@type": "Answer", "text": "Often enough to bound how long an undetected incremental error can persist, and often enough that the rebuild path stays working — usually between weekly and monthly. A rebuild procedure that has not run since the schema changed is not a fallback." }
    }
  ]
}
</script>
