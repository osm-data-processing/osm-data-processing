---
title: "Building Stable Surrogate Keys for OSM Features"
description: "Mint your own identifiers for OSM-derived features and maintain a mapping that survives splits, merges and replacements, so downstream systems are insulated from the map's churn."
pageTitle: "Surrogate Keys That Survive OSM Feature Churn"
pageDescription: "Give OSM-derived features your own stable keys, resolve them against the map through a versioned mapping table, and handle splits and merges as lineage rather than as broken references."
slug: building-stable-surrogate-keys-for-osm-features
type: article
breadcrumb: "Surrogate Keys"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Building Stable Surrogate Keys for OSM Features

Downstream systems want a key that means the same thing next year. OSM offers a key that means the same database row next year, which is not the same promise. A surrogate key is how you bridge the gap.

## Prerequisites

- [ ] The identity semantics from [OSM Feature Identity & ID Stability](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/).
- [ ] A change classifier, per [Tracking an OSM Feature Across Versions](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/tracking-an-osm-feature-across-versions/).
- [ ] Python 3.10+ and a database that can hold a mapping table with a history.
- [ ] A decision about what a surrogate key *represents* — a road, a stretch of road, a junction — made before any code.
- [ ] Downstream consumers who will actually use the surrogate rather than reaching past it.

## Conceptual minimum

A surrogate key is an identifier your pipeline mints, owns and never changes. It maps to one or more OSM objects through a table you maintain, and that indirection is what absorbs the map's churn.

Three properties make it work.

**The key is opaque and permanent.** It carries no meaning, is never reused, and is never recomputed from content. A key derived from a hash of tags changes when the tags change, which defeats the entire purpose.

**The mapping is versioned, not overwritten.** When a feature splits, the old mapping row is closed and new ones opened, with the surrogate key unchanged. The history is then readable: this key meant one way until March and three ways since.

**Lineage is recorded, not inferred.** When two surrogate keys merge or one splits, the relationship between old and new keys is stored explicitly. Downstream systems that need to reconcile last quarter's numbers with this quarter's can then do so.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 262" role="img" aria-labelledby="bsk1-t bsk1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="bsk1-t">The three tables a surrogate key scheme needs</title>
  <desc id="bsk1-d">Three stacked tables. The feature table holds one row per surrogate key with the attributes downstream systems consume, and never changes its key. The mapping table holds one row per surrogate key and OSM object pairing, with validity dates, so a split adds rows rather than changing the key. The lineage table records relationships between surrogate keys themselves, such as one key superseding two others, which is what lets historical figures be reconciled against current ones.</desc>
  <rect x="0" y="0" width="880" height="262" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three tables, and only the first is what consumers see</text>
  <rect x="26" y="50" width="828" height="52" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="42" y="72" font-size="12.5" font-weight="700" fill="currentColor">Features</text>
  <text x="42" y="90" font-size="10.5" fill="currentColor" opacity="0.88">One row per surrogate key</text>
  <text x="838" y="82" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">the key never changes</text>
  <rect x="26" y="112" width="828" height="52" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="42" y="134" font-size="12.5" font-weight="700" fill="currentColor">Mapping</text>
  <text x="42" y="152" font-size="10.5" fill="currentColor" opacity="0.88">Key to OSM objects, with dates</text>
  <text x="838" y="144" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">a split adds rows</text>
  <rect x="26" y="174" width="828" height="52" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="42" y="196" font-size="12.5" font-weight="700" fill="currentColor">Lineage</text>
  <text x="42" y="214" font-size="10.5" fill="currentColor" opacity="0.88">Key to key relationships</text>
  <text x="838" y="206" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">reconciles across time</text>
  <text x="868" y="246" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Consumers join to the first table only; the other two exist so that table can keep its promise when the map moves underneath it.</text>
</svg>
<figcaption>Skipping the lineage table works until somebody asks why a total changed between two reports.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import date

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.identity.surrogate")

SCHEMA = """
CREATE TABLE IF NOT EXISTS feature (
    surrogate_key TEXT PRIMARY KEY,
    kind          TEXT NOT NULL,
    created_on    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mapping (
    surrogate_key TEXT NOT NULL,
    osm_type      TEXT NOT NULL,
    osm_id        INTEGER NOT NULL,
    osm_version   INTEGER NOT NULL,
    valid_from    TEXT NOT NULL,
    valid_to      TEXT,                    -- NULL means currently valid
    PRIMARY KEY (surrogate_key, osm_type, osm_id, valid_from)
);
CREATE TABLE IF NOT EXISTS lineage (
    parent_key TEXT NOT NULL,
    child_key  TEXT NOT NULL,
    relation   TEXT NOT NULL,              -- 'split' | 'merge'
    occurred_on TEXT NOT NULL,
    PRIMARY KEY (parent_key, child_key, occurred_on)
);
"""


@dataclass(frozen=True)
class Mapping:
    surrogate_key: str
    osm_type: str
    osm_id: int
    osm_version: int


def connect(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA)
    return conn


def mint(conn: sqlite3.Connection, kind: str) -> str:
    """A new opaque key. Never derived from content, never reused."""
    key = f"{kind}-{uuid.uuid4()}"
    conn.execute("INSERT INTO feature (surrogate_key, kind, created_on) "
                 "VALUES (?, ?, ?)", (key, kind, date.today().isoformat()))
    return key


def bind(conn: sqlite3.Connection, m: Mapping, on: date | None = None) -> None:
    conn.execute(
        "INSERT OR IGNORE INTO mapping (surrogate_key, osm_type, osm_id,"
        " osm_version, valid_from) VALUES (?, ?, ?, ?, ?)",
        (m.surrogate_key, m.osm_type, m.osm_id, m.osm_version,
         (on or date.today()).isoformat()))


def close_mapping(conn: sqlite3.Connection, key: str, osm_type: str,
                  osm_id: int, on: date | None = None) -> None:
    conn.execute(
        "UPDATE mapping SET valid_to = ? WHERE surrogate_key = ? "
        "AND osm_type = ? AND osm_id = ? AND valid_to IS NULL",
        ((on or date.today()).isoformat(), key, osm_type, osm_id))


def current_objects(conn: sqlite3.Connection, key: str) -> list[tuple[str, int]]:
    return [(r[0], r[1]) for r in conn.execute(
        "SELECT osm_type, osm_id FROM mapping WHERE surrogate_key = ? "
        "AND valid_to IS NULL ORDER BY osm_type, osm_id", (key,))]


def apply_split(conn: sqlite3.Connection, key: str,
                new_objects: list[Mapping], on: date | None = None) -> None:
    """A way split: the SURROGATE key is unchanged, the mapping gains rows.

    This is the whole point of the indirection. Downstream consumers keyed on
    the surrogate see nothing; the feature simply now spans several OSM ways.
    """
    when = on or date.today()
    existing = set(current_objects(conn, key))
    for m in new_objects:
        if (m.osm_type, m.osm_id) not in existing:
            bind(conn, m, when)
    # Any previously mapped object no longer present has been superseded.
    incoming = {(m.osm_type, m.osm_id) for m in new_objects}
    for osm_type, osm_id in existing - incoming:
        close_mapping(conn, key, osm_type, osm_id, when)
    conn.commit()
    logger.info("split applied to %s: now maps to %d object(s)",
                key, len(current_objects(conn, key)))


def apply_merge(conn: sqlite3.Connection, keys: list[str],
                kind: str, objects: list[Mapping], on: date | None = None) -> str:
    """Two features became one. A NEW key is minted and lineage recorded."""
    when = on or date.today()
    new_key = mint(conn, kind)
    for m in objects:
        bind(conn, Mapping(new_key, m.osm_type, m.osm_id, m.osm_version), when)
    for old in keys:
        for osm_type, osm_id in current_objects(conn, old):
            close_mapping(conn, old, osm_type, osm_id, when)
        conn.execute("INSERT OR IGNORE INTO lineage (parent_key, child_key,"
                     " relation, occurred_on) VALUES (?, ?, 'merge', ?)",
                     (old, new_key, when.isoformat()))
    conn.commit()
    logger.info("merged %d key(s) into %s", len(keys), new_key)
    return new_key


if __name__ == "__main__":
    conn = connect(":memory:")
    key = mint(conn, "route")
    bind(conn, Mapping(key, "way", 4305800, 7))
    apply_split(conn, key, [Mapping(key, "way", 4305800, 8),
                            Mapping(key, "way", 999001, 1)])
```

## Step-by-step walkthrough

1. **Mint opaquely.** A random key carries no meaning and cannot be invalidated by a content change. Deriving a key from a hash of tags or geometry recreates the exact problem the surrogate exists to solve.
2. **Never reuse a key.** A retired key stays retired, exactly as OSM retires deleted identifiers, so a stale reference in a downstream system fails rather than silently pointing somewhere new.
3. **Version the mapping with validity dates.** Closing a row rather than deleting it preserves the ability to answer what a key meant at a past date, which is what makes historical reports reproducible.
4. **Treat a split as a mapping change, not a key change.** This is the central move: the surrogate key still names the same real-world feature, which now happens to span several OSM objects.
5. **Treat a merge as a new key with lineage.** Two features becoming one is a genuinely new thing, so a new key is honest — and the lineage rows are what let somebody reconcile the old totals.
6. **Record lineage explicitly.** Inferring it later from overlapping mappings is possible and unreliable; storing it costs one row per event.
7. **Give consumers only the feature table.** A downstream system that joins directly to the mapping table has re-coupled itself to OSM identifiers and gains nothing from the scheme.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="bsk2-t bsk2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="bsk2-t">What each map edit does to the surrogate key and to the tables beneath it</title>
  <desc id="bsk2-d">A grid of four map edits against whether the surrogate key changes, what happens in the mapping table, and whether lineage is recorded. A retag leaves the key unchanged, updates the recorded OSM version in the mapping, and needs no lineage. A split leaves the key unchanged, adds mapping rows for the new objects, and needs no lineage because the feature is still one thing. A merge mints a new key, closes the old mappings and records lineage. A deletion leaves the key in place but closes every mapping, marking the feature as no longer present on the map.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four edits, and only one of them changes the key</text>
  <rect x="176" y="48" width="226" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="289" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Surrogate key</text>
  <rect x="402" y="48" width="226" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="515" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Mapping</text>
  <rect x="628" y="48" width="226" height="30" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="741" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Lineage</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Retag</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="289" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">unchanged</text>
  <text x="515" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">version updated</text>
  <text x="741" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">none</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Split</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="289" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">unchanged</text>
  <text x="515" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">rows added</text>
  <text x="741" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">none</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Merge</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="289" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">new key</text>
  <text x="515" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">old rows closed</text>
  <text x="741" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">recorded</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Deletion</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="289" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">retained</text>
  <text x="515" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">all rows closed</text>
  <text x="741" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">none</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The second row is why the scheme exists: the edit that silently breaks a raw reference is invisible to a consumer of the surrogate.</text>
</svg>
<figcaption>A key that survives a split and changes on a merge matches how people actually think about the features.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="bsk3-t bsk3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="bsk3-t">How one surrogate key behaves as the map changes beneath it</title>
  <desc id="bsk3-d">Four moments for a single route feature. At creation the key is minted and mapped to one OSM way. After a retag the key and the mapping are unchanged except for the recorded version. After a split the key is still unchanged but the mapping now names two ways, so a consumer sees one feature spanning more objects. After a merge with a neighbouring route a new key is minted, the old mappings are closed, and lineage records that the old key was superseded.</desc>
  <defs><marker id="bsk3-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">One key, four moments, one change of key</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">created</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">minted, one way</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">the key is born</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#bsk3-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">retagged</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">key unchanged</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">version updated</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#bsk3-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">split</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">key unchanged</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">now two ways</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#bsk3-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">merged</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">new key</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">lineage recorded</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Three of the four moments are invisible to a downstream consumer, which is the measure of whether the scheme is working.</text>
</svg>
<figcaption>A consumer that notices any of the first three moments has been given access to the wrong table.</figcaption>
</figure>

## Verification

- **A split leaves the key intact.** Apply one and confirm the surrogate key is unchanged while the mapping gained a row.
- **Historical mappings resolve.** Query what a key mapped to at a past date and confirm it returns the pre-split object.
- **Merged keys are reachable.** From an old key, follow the lineage to the current one.
- **Keys are never reused.** Attempt to mint a key that already exists and confirm the primary key prevents it.
- **Consumers use only the feature table.** Grep downstream code for direct references to OSM identifiers; each one is a leak.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Keys change when tags change | Key derived from content | Mint opaque keys with no relationship to content |
| Historical reports irreproducible | Mapping rows overwritten | Close rows with a validity date rather than updating them |
| Totals unexplainable after a merge | No lineage recorded | Store parent and child key relationships explicitly |
| Splits break downstream joins | Split treated as a new key | Keep the key; add mapping rows for the new objects |
| Consumers still coupled to OSM | Mapping table exposed downstream | Expose only the feature table |
| A retired key resolves again | Keys recycled | Never reuse a key, exactly as OSM never reuses its own |
| Mapping table grows unboundedly | Every version recorded as a row | Update the version in place; add rows only on object change |

## Specification reference

> A surrogate key is an identifier with no business meaning, assigned by the system that owns the record and never changed. Combined with validity-dated mapping rows, it implements a slowly changing dimension over an external identifier space, which is the standard treatment for a source system whose keys are not stable. See [OSM Feature Identity & ID Stability](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/) for the specific instabilities this pattern absorbs.

## Frequently Asked Questions

<details>
<summary>Why not derive the key from the feature's content?</summary>

Because a content-derived key changes when the content does, which is exactly the instability a surrogate is supposed to remove. Hashing the tags gives a key that changes on a retag; hashing the geometry gives one that changes when a node moves. An opaque key minted once and never recomputed is the only form that keeps its promise, and its lack of meaning is a feature rather than a limitation.
</details>

<details>
<summary>Should a split produce a new key?</summary>

No. A road split at a junction is still the same road; only its representation in the database changed. Keeping the surrogate key and adding mapping rows means downstream consumers see nothing, which is the entire value of the indirection. A merge is different — two features genuinely becoming one is a new thing — and that is why it mints a new key with lineage recorded.
</details>

<details>
<summary>How do downstream systems handle a merge?</summary>

Through the lineage table. A consumer holding an old key finds it no longer current, follows the lineage to the key that superseded it, and can then reconcile its historical figures against the new one. Without the lineage that reconciliation is guesswork, which is how a total that changed between two reports becomes an unanswerable question.
</details>

<details>
<summary>Is this worth the complexity for a small dataset?</summary>

If the dataset is small and short-lived, probably not — storing the type, identifier and version, and re-resolving, is adequate. The scheme earns its cost when downstream systems hold references for a long time, when historical reports must be reproducible, or when the same features are joined from several places. Those conditions arrive gradually, which is why the scheme is worth considering before they do.
</details>

## Related

- [OSM Feature Identity & ID Stability](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/) — the parent topic and the instabilities this absorbs.
- [Tracking an OSM Feature Across Versions](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/tracking-an-osm-feature-across-versions/) — detecting the splits and merges that drive mapping updates.
- [Handling Deleted and Redacted OSM Objects](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/handling-deleted-and-redacted-osm-objects/) — what to do when a mapping's objects disappear.
- [Modelling OSM for Analytics Warehouses](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/) — where surrogate keys become dimension keys.
- [Matching OSM Features to External Datasets](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/) — matches that should reference surrogates rather than raw identifiers.

Up one level: [OSM Feature Identity & ID Stability](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Building Stable Surrogate Keys for OSM Features",
  "description": "Mint your own identifiers for OSM-derived features and maintain a mapping that survives splits, merges and replacements, so downstream systems are insulated from the map's churn.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Data Fundamentals & Architecture",
  "about": ["surrogate keys", "slowly changing dimensions", "identifier mapping"]
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
    { "@type": "ListItem", "position": 4, "name": "Building Stable Surrogate Keys for OSM Features", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/building-stable-surrogate-keys-for-osm-features/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Give OSM-derived features stable surrogate keys",
  "description": "Mint opaque permanent keys, map them to OSM objects with validity dates, keep the key through a split, mint a new key with lineage on a merge, and expose only the feature table downstream.",
  "step": [
    { "@type": "HowToStep", "name": "Mint opaque keys", "text": "Generate keys with no relationship to content, so a retag or a geometry change cannot invalidate them." },
    { "@type": "HowToStep", "name": "Never reuse a key", "text": "Retire keys permanently, so a stale downstream reference fails rather than resolving to something unrelated." },
    { "@type": "HowToStep", "name": "Date the mapping rows", "text": "Close a mapping with a validity date rather than deleting it, preserving what a key meant at any past date." },
    { "@type": "HowToStep", "name": "Keep the key through a split", "text": "Add mapping rows for the new OSM objects while leaving the surrogate key untouched." },
    { "@type": "HowToStep", "name": "Mint a new key on a merge", "text": "Create a new key for the merged feature, close the old mappings, and record parent-to-child lineage." },
    { "@type": "HowToStep", "name": "Expose only the feature table", "text": "Keep consumers joining to surrogate keys so they never re-couple to OSM identifiers." }
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
      "name": "Why not derive a surrogate key from the feature's content?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because a content-derived key changes when the content does, which is exactly the instability a surrogate is supposed to remove. Hashing the tags gives a key that changes on a retag; hashing the geometry gives one that changes when a node moves. An opaque key minted once and never recomputed is the only form that keeps its promise." }
    },
    {
      "@type": "Question",
      "name": "Should an OSM way split produce a new surrogate key?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. A road split at a junction is still the same road; only its representation changed. Keeping the surrogate key and adding mapping rows means downstream consumers see nothing, which is the value of the indirection. A merge is different, because two features genuinely becoming one is a new thing." }
    },
    {
      "@type": "Question",
      "name": "How do downstream systems handle a surrogate key merge?",
      "acceptedAnswer": { "@type": "Answer", "text": "Through the lineage table. A consumer holding an old key finds it no longer current, follows the lineage to the key that superseded it, and can reconcile its historical figures. Without the lineage that reconciliation is guesswork, which is how a total that changed between reports becomes unanswerable." }
    },
    {
      "@type": "Question",
      "name": "Is a surrogate key scheme worth the complexity for a small dataset?",
      "acceptedAnswer": { "@type": "Answer", "text": "If the dataset is small and short-lived, probably not — storing the type, identifier and version and re-resolving is adequate. The scheme earns its cost when downstream systems hold references for a long time, when historical reports must be reproducible, or when the same features are joined from several places." }
    }
  ]
}
</script>
