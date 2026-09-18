---
title: "Migrating a PostGIS OSM Schema Without Downtime"
description: "Change the shape of an OSM table that queries are running against, using a shadow schema and an atomic search_path or view switch rather than an ALTER that holds a lock."
pageTitle: "Changing a PostGIS OSM Schema With No Downtime"
pageDescription: "Build the new OSM schema alongside the old one, backfill it, verify it against the live table, then cut over atomically and keep the previous version until rollback stops being plausible."
slug: migrating-a-postgis-osm-schema-without-downtime
type: article
breadcrumb: "Zero-Downtime Migration"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Migrating a PostGIS OSM Schema Without Downtime

An OSM table that a map service reads from cannot be rebuilt in place, because the rebuild takes hours and holds a lock for all of them. The way round it is to build the new shape beside the old one and switch which name points at it.

## Prerequisites

- [ ] PostgreSQL 14+ with PostGIS 3.2+, and a role permitted to create schemas.
- [ ] The export baseline in [Exporting OSM to GeoParquet and PostGIS](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/).
- [ ] Enough disk for two copies of the table during the migration.
- [ ] A way to reload the loader, since it writes to the schema under a different rule than readers.
- [ ] The row counts and a handful of known features you can check on both sides.

## Conceptual minimum

The migration turns on one idea: **readers resolve a name, and the name can be made to resolve somewhere else atomically.** Postgres gives two mechanisms for this, and the choice between them is the main design decision.

A **schema switch** uses `search_path`. Readers query unqualified `planet_osm_polygon`; the new version lives in `osm_v2` and the old in `osm_v1`; changing the role's `search_path` changes which one an unqualified name finds. It is a catalogue update, so it takes microseconds, and it applies to new sessions or at the next `SET`.

A **view switch** keeps the tables named distinctly and points a view at whichever is current. `CREATE OR REPLACE VIEW` takes a brief `ACCESS EXCLUSIVE` lock on the view, which is fine because nothing holds a long lock on a view definition, and the switch is transactional so it can be rolled back with the transaction.

The view is the better default: it is explicit, it is transactional, and it does not depend on per-role session state that is easy to get wrong. The schema switch wins when the new version has to differ in more than one object at a time, because a whole schema swaps as a unit.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 239" role="img" aria-labelledby="mpg1-t mpg1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="mpg1-t">In-place ALTER versus shadow-and-switch, in what each holds</title>
  <desc id="mpg1-d">Two panels. An in-place rewrite takes an ACCESS EXCLUSIVE lock on the live table for the whole rewrite, which on a continental polygon table is hours, blocks every reader, and cannot be undone once partly applied without another rewrite. The shadow approach creates the new table in a separate schema, backfills while readers continue against the old one untouched, verifies the two side by side, then switches a view in a transaction holding a lock for milliseconds, with the old table still present for rollback.</desc>
  <rect x="0" y="0" width="880" height="239" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">What each approach locks, and for how long</text>
  <rect x="26" y="52" width="401" height="153" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="226" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">In-place ALTER</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Exclusive lock on live table</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Held for the whole rewrite</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Hours on a planet table</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Every reader blocked</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Rollback is another rewrite</text>
  <rect x="453" y="52" width="401" height="153" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="654" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Shadow and switch</text>
  <text x="467" y="104" font-size="10.5" fill="currentColor" opacity="0.92">New table, separate schema</text>
  <text x="467" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Readers untouched meanwhile</text>
  <text x="467" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Verify both sides at once</text>
  <text x="467" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Lock held for milliseconds</text>
  <text x="467" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Old table kept for rollback</text>
  <text x="868" y="223" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The shadow approach costs disk for a second copy, which is almost always cheaper than the outage the first one causes.</text>
</svg>
<figcaption>Both end with the same schema; only one of them can be done during working hours.</figcaption>
</figure>

## Runnable solution

```sql
-- 1. Build the new shape in its own schema. Nothing here touches the live table.
CREATE SCHEMA IF NOT EXISTS osm_next;

CREATE TABLE osm_next.polygon (
    osm_id      bigint PRIMARY KEY,
    osm_type    char(1) NOT NULL,
    -- new in v2: tags as jsonb rather than a wide column set
    tags        jsonb   NOT NULL DEFAULT '{}'::jsonb,
    -- new in v2: an explicit area, so consumers stop calling ST_Area ad hoc
    area_m2     double precision,
    geom        geometry(MultiPolygon, 3857) NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 2. Backfill in bounded batches so no single statement holds a long snapshot.
--    Run this repeatedly until it reports zero rows moved.
INSERT INTO osm_next.polygon (osm_id, osm_type, tags, area_m2, geom)
SELECT p.osm_id,
       CASE WHEN p.osm_id < 0 THEN 'r' ELSE 'w' END,
       jsonb_strip_nulls(jsonb_build_object(
           'building', p.building, 'landuse', p.landuse,
           'natural',  p."natural", 'name',    p.name)),
       ST_Area(p.way::geography),
       ST_Multi(p.way)
FROM   osm_live.planet_osm_polygon AS p
WHERE  p.osm_id > COALESCE((SELECT max(osm_id) FROM osm_next.polygon), -1)
ORDER  BY p.osm_id
LIMIT  200000
ON CONFLICT (osm_id) DO NOTHING;

-- 3. Index AFTER the bulk load, and CONCURRENTLY so it never blocks.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_next_polygon_geom
    ON osm_next.polygon USING GIST (geom);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_next_polygon_tags
    ON osm_next.polygon USING GIN (tags jsonb_path_ops);
ANALYZE osm_next.polygon;

-- 4. Verify before switching. Counts, and a geometry equality sample.
SELECT (SELECT count(*) FROM osm_live.planet_osm_polygon) AS live_rows,
       (SELECT count(*) FROM osm_next.polygon)            AS next_rows;

SELECT count(*) AS mismatched
FROM   osm_live.planet_osm_polygon AS l
JOIN   osm_next.polygon            AS n USING (osm_id)
WHERE  NOT ST_Equals(ST_Multi(l.way), n.geom)
LIMIT  1000;

-- 5. Cut over. Transactional, milliseconds, reversible by rolling back.
BEGIN;
  CREATE OR REPLACE VIEW public.osm_polygon AS
      SELECT osm_id, osm_type, tags, area_m2, geom FROM osm_next.polygon;
  COMMENT ON VIEW public.osm_polygon IS 'v2 since 2026-09-17; v1 in osm_live';
COMMIT;

-- 6. Keep the old table until rollback stops being plausible. Then, separately:
--    DROP TABLE osm_live.planet_osm_polygon;
```

```python
"""Drive the batched backfill until it converges, with a lock-time guard."""
from __future__ import annotations

import logging
import time

import psycopg

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.postgis.migrate")

BACKFILL = open("backfill.sql", encoding="utf-8").read()


def backfill(dsn: str, batch_pause_s: float = 0.5) -> int:
    total = 0
    with psycopg.connect(dsn, autocommit=True) as conn:
        # A statement that cannot get its lock quickly should fail, not queue:
        # a queued ACCESS EXCLUSIVE request blocks every reader behind it.
        conn.execute("SET lock_timeout = '3s'")
        conn.execute("SET statement_timeout = '10min'")
        while True:
            with conn.cursor() as cur:
                cur.execute(BACKFILL)
                moved = cur.rowcount
            total += moved
            logger.info("backfilled %d rows (%d total)", moved, total)
            if moved == 0:
                return total
            time.sleep(batch_pause_s)  # let autovacuum and readers breathe


if __name__ == "__main__":
    logger.info("backfill, verify, then switch the view in a transaction")
```

## Step-by-step walkthrough

1. **Create the new schema, not a new column.** Adding columns to the live table is the in-place path in disguise, and a rewrite-triggering `ALTER` holds the same lock as any other.
2. **Backfill in bounded batches.** A single `INSERT ... SELECT` over a continental table holds one snapshot for hours, which bloats the source and blocks vacuum.
3. **Set `lock_timeout`.** A migration statement that cannot acquire its lock immediately should fail rather than queue, because a queued exclusive request blocks every reader arriving behind it.
4. **Index after loading, and concurrently.** Building indexes during the load slows it and a non-concurrent build blocks writes, neither of which the switch needs.
5. **Verify before switching, not after.** Compare counts and sample geometry equality between the two tables while both exist, which is the only window in which that comparison is possible.
6. **Switch inside a transaction.** `CREATE OR REPLACE VIEW` is transactional, so an unexpected result rolls the switch back with the transaction rather than leaving a half-migrated name.
7. **Repoint the loader separately.** Readers and the writer switch at different times, and a writer still filling the old table after the switch produces a silently stale view.
8. **Keep the old table.** Dropping it in the same change removes the only cheap rollback, and disk is a better thing to spend than an outage.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 292" role="img" aria-labelledby="mpg2-t mpg2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="mpg2-t">Where the risk sits across a shadow migration</title>
  <desc id="mpg2-d">A timeline of five marks. Creating the new schema carries no risk because nothing live is touched. The backfill is long but low risk, with the only hazards being disk consumption and vacuum pressure on the source. Index building is slow and safe when done concurrently. Verification is the decision point, and skipping it moves all the risk past the switch where it cannot be undone cheaply. The switch itself is milliseconds and reversible. Dropping the old table is the one irreversible step and should happen days later.</desc>
  <defs><marker id="mpg2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="292" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Risk across the five phases</text>
  <line x1="26" y1="150" x2="848" y2="150" stroke="currentColor" stroke-width="1.8" marker-end="url(#mpg2-a)"/>
  <rect x="35" y="52" width="148" height="66" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="109" y="76" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">Create</text>
  <text x="109" y="94" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">no risk at all</text>
  <text x="109" y="110" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">nothing live touched</text>
  <line x1="109" y1="118" x2="109" y2="143" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="109" cy="150" r="5" fill="var(--osm-accent,#0369a1)"/>
  <rect x="201" y="176" width="148" height="66" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="274" y="200" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">Backfill</text>
  <text x="274" y="218" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">long, low risk</text>
  <text x="274" y="234" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">disk and vacuum only</text>
  <line x1="274" y1="176" x2="274" y2="157" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="274" cy="150" r="5" fill="var(--osm-ok,#15803d)"/>
  <rect x="366" y="52" width="148" height="66" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="440" y="76" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">Verify</text>
  <text x="440" y="94" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">the decision point</text>
  <text x="440" y="110" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">only comparison window</text>
  <line x1="440" y1="118" x2="440" y2="143" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="440" cy="150" r="5" fill="var(--osm-warn,#a16207)"/>
  <rect x="532" y="176" width="148" height="66" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="606" y="200" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">Switch</text>
  <text x="606" y="218" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">milliseconds</text>
  <text x="606" y="234" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">transactional, reversible</text>
  <line x1="606" y1="176" x2="606" y2="157" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="606" cy="150" r="5" fill="var(--osm-alt,#6d28d9)"/>
  <rect x="697" y="52" width="148" height="66" rx="8" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.5"/>
  <text x="771" y="76" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">Drop old</text>
  <text x="771" y="94" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">irreversible</text>
  <text x="771" y="110" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">days later, separately</text>
  <line x1="771" y1="118" x2="771" y2="143" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="771" cy="150" r="5" fill="var(--osm-bad,#b91c1c)"/>
  <text x="868" y="276" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Skipping verification does not remove risk; it relocates it past the switch, where the cheap remedy no longer exists.</text>
</svg>
<figcaption>Only the last mark cannot be undone, and it is the one with no deadline attached.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 228" role="img" aria-labelledby="mpg3-t mpg3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="mpg3-t">Choosing between a view switch and a schema search_path switch</title>
  <desc id="mpg3-d">A decision with two branches. A view switch keeps tables distinctly named and repoints a view, which is transactional, explicit in the catalogue and rolls back with its transaction, but it swaps one object at a time. A search_path switch moves a whole schema at once, which suits a migration changing several related objects together, but it depends on per-role session state and applies at the next session or SET rather than instantly for connections already open.</desc>
  <defs><marker id="mpg3-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="228" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Which switch mechanism</text>
  <rect x="26" y="78" width="250" height="88" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.6"/>
  <text x="151" y="106" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">How many objects change together?</text>
  <text x="151" y="128" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">One view, or a whole schema</text>
  <text x="151" y="146" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Both atomic; one is transactional</text>
  <line x1="276" y1="122" x2="314" y2="122" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="314" y2="161" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="353" y2="83" stroke="currentColor" stroke-width="1.4" marker-end="url(#mpg3-a)"/>
  <rect x="356" y="52" width="498" height="62" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="370" y="77" font-size="12" font-weight="700" fill="currentColor">One object: replace the view</text>
  <text x="370" y="97" font-size="10.5" fill="currentColor" opacity="0.88">Transactional, explicit, rolls back with the transaction</text>
  <line x1="314" y1="161" x2="353" y2="161" stroke="currentColor" stroke-width="1.4" marker-end="url(#mpg3-a)"/>
  <rect x="356" y="130" width="498" height="62" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="370" y="155" font-size="12" font-weight="700" fill="currentColor">Several at once: move the search_path</text>
  <text x="370" y="175" font-size="10.5" fill="currentColor" opacity="0.88">A schema swaps as a unit, but open sessions keep the old one</text>
  <text x="868" y="212" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Existing connections keep their old search_path until they reconnect or issue SET, which is the usual surprise with the second option.</text>
</svg>
<figcaption>Prefer the view unless the migration genuinely changes several related objects together.</figcaption>
</figure>

## Verification

- **Counts match.** Live and shadow row counts should agree, or differ only by rows added since the backfill started.
- **Geometry survives.** A sample `ST_Equals` comparison across joined identifiers should find no mismatches.
- **Query plans are sane.** `EXPLAIN` a representative query against the view and confirm it uses the new indexes.
- **The switch is fast.** Time the cutover transaction; anything beyond a few milliseconds means something held a lock.
- **Rollback works.** Before dropping anything, point the view back at the old table and confirm readers recover.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Readers block for hours | In-place `ALTER` rewriting the table | Build a shadow table and switch a view |
| Backfill bloats the source | One statement holding a long snapshot | Batch with `LIMIT` and commit between batches |
| Cutover hangs | No `lock_timeout`, request queued behind a reader | `SET lock_timeout = '3s'` and retry |
| View shows stale data | Loader still writing to the old table | Repoint the writer as a separate, explicit step |
| Index build blocks writes | `CREATE INDEX` without `CONCURRENTLY` | Build concurrently, after the bulk load |
| Queries slow after cutover | Statistics never gathered | `ANALYZE` the new table before switching |
| No way back | Old table dropped in the same change | Keep it for days; drop it as its own change |

## Specification reference

> `CREATE OR REPLACE VIEW` replaces the definition of an existing view. The new query must generate the same columns in the same order with the same types, though columns may be added at the end. The operation is transactional. `CREATE INDEX CONCURRENTLY` builds an index without taking any locks that prevent concurrent inserts, updates or deletes on the table, at the cost of two table scans. See the PostgreSQL documentation for `CREATE VIEW`, `CREATE INDEX` and `lock_timeout`.

## Frequently Asked Questions

<details>
<summary>Why not just add a column to the existing table?</summary>

Adding a nullable column with no default is instant and perfectly safe. The trouble is that OSM schema changes are rarely that: they change a type, add a `NOT NULL` with a computed default, or restructure wide columns into `jsonb`, and each of those rewrites the whole table under an exclusive lock. On a continental polygon table that is hours of blocked readers. The shadow approach costs disk and buys the ability to do it during the day.
</details>

<details>
<summary>Should the loader write to both schemas during the migration?</summary>

Only if the backfill will run long enough that the gap matters. Dual-writing doubles the write path's failure surface and introduces the question of what to do when one side succeeds and the other does not. For a backfill measured in hours against data that updates daily, a simpler answer is to run the backfill, switch, and then let the next normal load populate the new table's recent changes.
</details>

<details>
<summary>How long should the old table be kept?</summary>

Until a full cycle of every consumer has run against the new one — which usually means at least one of whatever your slowest periodic job is, plus a working week. The cost is disk, and the thing it buys is that a problem discovered on day three has a one-statement remedy rather than a re-migration. Drop it as its own deliberate change, never as the tail of the migration.
</details>

<details>
<summary>Does the same approach work for a GeoParquet export?</summary>

It works better, because object storage has no locks at all. Write the new-shape files to a new prefix, verify, and repoint whatever resolves the dataset path — a catalogue entry, a manifest, or a symlink-like alias. The structure of the migration is identical; only the atomic switch mechanism differs.
</details>

## Related

- [Exporting OSM to GeoParquet and PostGIS](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/) — the parent topic.
- [Loading OSM into PostGIS with osm2pgsql Flex](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/loading-osm-into-postgis-with-osm2pgsql-flex/) — the loader that has to be repointed.
- [Keeping GeoParquet and PostGIS Exports Consistent](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/keeping-geoparquet-and-postgis-exports-consistent/) — the other sink that moves with the schema.
- [Modelling OSM for Analytics Warehouses](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/) — where the target shape is decided.
- [Propagating OSM Diffs Into a GeoParquet Lake](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/propagating-osm-diffs-into-a-geoparquet-lake/) — the same switch idea applied to files.

Up one level: [Exporting OSM to GeoParquet and PostGIS](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Migrating a PostGIS OSM Schema Without Downtime",
  "description": "Change the shape of an OSM table that queries are running against, using a shadow schema and an atomic search_path or view switch rather than an ALTER that holds a lock.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Parsing & Tag Normalization Workflows",
  "about": ["PostGIS migration", "zero downtime", "shadow schema"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Parsing & Tag Normalization Workflows", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/" },
    { "@type": "ListItem", "position": 3, "name": "Exporting OSM to GeoParquet and PostGIS", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/" },
    { "@type": "ListItem", "position": 4, "name": "Migrating a PostGIS OSM Schema Without Downtime", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/migrating-a-postgis-osm-schema-without-downtime/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Migrate a PostGIS OSM schema with no reader downtime",
  "description": "Create the new table shape in a separate schema, backfill it in batches, index concurrently, verify against the live table, then switch a view transactionally and keep the old table for rollback.",
  "step": [
    { "@type": "HowToStep", "name": "Create a shadow schema", "text": "Build the new table shape in its own schema so nothing on the live table is altered." },
    { "@type": "HowToStep", "name": "Backfill in batches", "text": "Move rows in bounded batches so no statement holds a long snapshot against the source." },
    { "@type": "HowToStep", "name": "Set a lock timeout", "text": "Make migration statements fail rather than queue, since a queued exclusive request blocks readers behind it." },
    { "@type": "HowToStep", "name": "Index concurrently after loading", "text": "Build GIST and GIN indexes with CONCURRENTLY once the bulk load is done, then ANALYZE." },
    { "@type": "HowToStep", "name": "Verify both sides", "text": "Compare row counts and sample geometry equality while both tables still exist." },
    { "@type": "HowToStep", "name": "Switch the view in a transaction", "text": "Use CREATE OR REPLACE VIEW inside a transaction so the cutover is milliseconds and reversible." },
    { "@type": "HowToStep", "name": "Repoint the loader, keep the old table", "text": "Move the writer as a separate step and drop the previous table days later as its own change." }
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
      "name": "Why not just add a column to the existing OSM table?",
      "acceptedAnswer": { "@type": "Answer", "text": "Adding a nullable column with no default is instant and safe, but OSM schema changes are rarely that: they change a type, add a NOT NULL with a computed default, or restructure wide columns into jsonb, each of which rewrites the whole table under an exclusive lock. On a continental polygon table that is hours of blocked readers." }
    },
    {
      "@type": "Question",
      "name": "Should the loader write to both schemas during the migration?",
      "acceptedAnswer": { "@type": "Answer", "text": "Only if the backfill runs long enough that the gap matters. Dual-writing doubles the write path's failure surface and raises the question of what to do when one side succeeds and the other does not. For a backfill of hours against daily data, run it, switch, and let the next normal load populate recent changes." }
    },
    {
      "@type": "Question",
      "name": "How long should the old table be kept after cutover?",
      "acceptedAnswer": { "@type": "Answer", "text": "Until every consumer has completed a full cycle against the new table, usually at least the slowest periodic job plus a working week. The cost is disk and it buys a one-statement remedy for a problem found on day three. Drop it as its own deliberate change." }
    },
    {
      "@type": "Question",
      "name": "Does the same approach work for a GeoParquet export?",
      "acceptedAnswer": { "@type": "Answer", "text": "It works better, because object storage has no locks. Write the new-shape files to a new prefix, verify, and repoint whatever resolves the dataset path — a catalogue entry, manifest or alias. The structure is identical; only the atomic switch mechanism differs." }
    }
  ]
}
</script>
