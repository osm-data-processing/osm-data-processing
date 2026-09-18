---
title: "Applying Backpressure in an Asyncio OSM Pipeline"
description: "Stop a fast PBF reader from filling memory ahead of a slow writer by giving every queue a bound, so the producer waits instead of buffering a continent."
pageTitle: "Backpressure for an Asyncio OSM Pipeline"
pageDescription: "Bound every queue, let await do the throttling, and propagate failures both ways so a slow database stalls the reader instead of exhausting memory."
slug: applying-backpressure-in-an-asyncio-osm-pipeline
type: article
breadcrumb: "Asyncio Backpressure"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Applying Backpressure in an Asyncio OSM Pipeline

A PBF reader can produce features far faster than a database can accept them, and an unbounded queue between the two converts that difference into memory consumption until the process dies.

## Prerequisites

- [ ] Python 3.11+ for `asyncio.TaskGroup`, and familiarity with `async`/`await`.
- [ ] The async parsing baseline in [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/).
- [ ] A sink whose throughput you can actually measure, since backpressure is only meaningful against a known rate.
- [ ] Memory limits you care about, whether a container ceiling or a shared host.

## Conceptual minimum

Backpressure is not a mechanism you add; it is what you get when you remove unbounded buffering. `asyncio.Queue(maxsize=N)` makes `await queue.put()` suspend once the queue is full, and that suspension propagates backwards through every stage until the reader itself stops reading. The queue bound is the entire implementation.

Three details decide whether it works.

**Every queue needs a bound.** One unbounded queue anywhere in the chain absorbs the whole difference in rate, and the bounds on the others become decoration.

**The bound is in items, but memory is in bytes.** A queue of 1000 batches of 50,000 features is not a bound anybody intended. Size the queue against the batch size, and prefer small queues of large batches to large queues of small ones, because the per-item overhead dominates otherwise.

**Failure has to travel both directions.** A consumer that dies leaves the producer blocked on a full queue forever, and a producer that dies leaves the consumer waiting on an empty one. `TaskGroup` cancels siblings on an exception, which handles the first; a sentinel per consumer handles the second.

CPU-bound work is the case where this reasoning breaks down. Parsing a PBF block is not I/O, so an `async def` that does it blocks the event loop and no amount of queue bounding helps. That work belongs in a `ProcessPoolExecutor` reached through `run_in_executor`, with the bound applied to the number of outstanding submissions.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 239" role="img" aria-labelledby="abp1-t abp1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="abp1-t">What an unbounded queue does to a rate mismatch</title>
  <desc id="abp1-d">Two panels. With an unbounded queue, a reader producing eighty thousand features a second feeds a writer accepting twelve thousand, and the difference of sixty-eight thousand a second accumulates in memory until the process is killed, with throughput unchanged by the buffering. With a bounded queue, the reader blocks on put once the bound is reached, memory stays flat at the bound times the batch size, and the pipeline runs at the writer's rate, which is the rate it was always going to run at.</desc>
  <rect x="0" y="0" width="880" height="239" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Same rates, two outcomes</text>
  <rect x="26" y="52" width="401" height="153" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="226" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Unbounded queue</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Reader: 80k features/s</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Writer: 12k features/s</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">68k/s accumulates in RAM</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Killed, not slowed</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Throughput unchanged</text>
  <rect x="453" y="52" width="401" height="153" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="654" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Bounded queue</text>
  <text x="467" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Reader blocks on put</text>
  <text x="467" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Memory flat at bound</text>
  <text x="467" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Runs at the writer's rate</text>
  <text x="467" y="167" font-size="10.5" fill="currentColor" opacity="0.92">The rate it always was</text>
  <text x="467" y="188" font-size="10.5" fill="currentColor" opacity="0.92">No surprise at 3am</text>
  <text x="868" y="223" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Buffering never made the pipeline faster; it only postponed the moment the slow stage set the pace, and paid memory for the delay.</text>
</svg>
<figcaption>The bounded version is not slower. It is the same speed, without the failure.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import AsyncIterator, Iterable
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.async.backpressure")

BATCH = 5_000          # features per batch: big, so per-item overhead is small
QUEUE_DEPTH = 4        # batches in flight: small, so memory is bounded tightly
WRITERS = 4

SENTINEL: object = object()


@dataclass(frozen=True)
class Batch:
    features: tuple[dict, ...]
    source_block: int


def parse_block(raw: bytes, index: int) -> Batch:
    """CPU-bound. Runs in a worker process, never on the event loop."""
    # Stand-in for the real decode; the point is that it does not await.
    features = tuple({"id": index * 1000 + i, "raw_len": len(raw)}
                     for i in range(BATCH))
    return Batch(features, index)


async def reader(blocks: Iterable[tuple[int, bytes]],
                 queue: asyncio.Queue,
                 pool: ProcessPoolExecutor) -> None:
    """Decode blocks off-loop, and block on put once the queue is full.

    The await on put IS the backpressure. Nothing else throttles this.
    """
    loop = asyncio.get_running_loop()
    for index, raw in blocks:
        batch = await loop.run_in_executor(pool, parse_block, raw, index)
        await queue.put(batch)          # suspends when the queue is full
    for _ in range(WRITERS):
        await queue.put(SENTINEL)       # one per consumer, never one shared
    logger.info("reader finished")


async def writer(name: str, queue: asyncio.Queue, sink) -> int:
    written = 0
    while True:
        item = await queue.get()
        try:
            if item is SENTINEL:
                return written
            await sink.write(item.features)
            written += len(item.features)
        finally:
            queue.task_done()


class SlowSink:
    """Stand-in for a database: the stage that sets the pipeline's real rate."""

    def __init__(self, rows_per_second: int) -> None:
        self.rate = rows_per_second

    async def write(self, features: tuple[dict, ...]) -> None:
        await asyncio.sleep(len(features) / self.rate)


async def run(blocks: Iterable[tuple[int, bytes]]) -> int:
    queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_DEPTH)
    sink = SlowSink(rows_per_second=12_000)
    total = 0

    with ProcessPoolExecutor(max_workers=os.cpu_count()) as pool:
        # TaskGroup cancels every sibling when one raises: a writer that dies
        # cannot leave the reader blocked on a queue nobody will drain.
        async with asyncio.TaskGroup() as tg:
            tg.create_task(reader(blocks, queue, pool))
            writers = [tg.create_task(writer(f"w{i}", queue, sink))
                       for i in range(WRITERS)]
        total = sum(w.result() for w in writers)

    logger.info("wrote %d features", total)
    return total


async def monitor(queue: asyncio.Queue, period_s: float = 5.0) -> None:
    """A persistently full queue means the sink is the bottleneck.

    A persistently empty one means the reader is. Either is useful to know;
    not knowing which is the usual state of an async pipeline.
    """
    while True:
        await asyncio.sleep(period_s)
        depth = queue.qsize()
        logger.info("queue depth %d/%d (%s-bound)", depth, QUEUE_DEPTH,
                    "sink" if depth >= QUEUE_DEPTH - 1 else "reader")


if __name__ == "__main__":
    fake = [(i, b"\x00" * 1024) for i in range(20)]
    asyncio.run(run(fake))
```

## Step-by-step walkthrough

1. **Bound the queue, in batches.** `maxsize=4` with 5,000-feature batches caps in-flight work at 20,000 features, which is a number you can multiply by a feature's size and reason about.
2. **Let `await put` do the throttling.** No rate limiter, no sleep, no token bucket. The suspension is the mechanism, and adding anything on top of it fights the thing that already works.
3. **Keep CPU work off the loop.** `run_in_executor` with a process pool means block decoding does not stall every other coroutine, which is the failure that looks like backpressure not working.
4. **Send one sentinel per consumer.** A single sentinel stops one writer and leaves the others waiting forever, and it is the most common way this shape deadlocks.
5. **Use `TaskGroup`.** An exception in any task cancels the rest, which is what stops a dead writer from leaving the reader blocked on a full queue.
6. **Measure the queue depth.** Persistently full means the sink is the bottleneck; persistently empty means the reader is. Without that signal you are guessing at which half to optimise.
7. **Size batches upward before queues.** Per-item overhead dominates at small batch sizes, so a queue of four large batches outperforms a queue of four hundred small ones at the same memory.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="abp2-t abp2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="abp2-t">How a stall propagates backwards through bounded stages</title>
  <desc id="abp2-d">Four stages. The sink slows, perhaps because the database is checkpointing. Its writers stop taking from the queue, so the queue reaches its bound. The reader's await on put suspends, so it stops submitting blocks to the process pool. Memory stays flat at the bound rather than growing, and when the sink recovers every stage resumes in order with nothing lost. The chain only works if every queue in it is bounded, since one unbounded queue absorbs the entire mismatch.</desc>
  <defs><marker id="abp2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">A stall travelling upstream</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">sink slows</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">database checkpoints</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">writes take longer</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#abp2-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">queue fills</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">consumers stop taking</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">reaches its bound</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#abp2-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">reader suspends</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">await put blocks</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">stops submitting work</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#abp2-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">memory flat</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">nothing accumulates</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">resumes in order</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">One unbounded queue anywhere in this chain absorbs the whole mismatch and makes every other bound decorative.</text>
</svg>
<figcaption>Nothing here is a rate limiter. The suspension on a bounded put is the entire implementation.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 342" role="img" aria-labelledby="abp3-t abp3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="abp3-t">Five ways this shape deadlocks or leaks, and the signal each gives</title>
  <desc id="abp3-d">A grid of five failure modes against their observable signal and the fix. An unbounded queue shows memory climbing while throughput stays constant, fixed by setting an explicit maxsize. A single sentinel for several consumers shows the run hanging at the end with writers idle, fixed by emitting one per consumer. CPU work on the event loop shows an empty queue with the reader slow, fixed by run_in_executor. A dead consumer shows the reader blocked on put with no progress, fixed by a task group. An ungated process pool shows memory climbing despite a bounded queue, fixed by a semaphore around submission.</desc>
  <rect x="0" y="0" width="880" height="342" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Failure modes and their signals</text>
  <rect x="194" y="48" width="330" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="359" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Observable signal</text>
  <rect x="524" y="48" width="330" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="689" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Fix</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Unbounded queue</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="359" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">memory climbs, rate flat</text>
  <text x="689" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">set an explicit maxsize</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">One shared sentinel</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="359" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">hangs at the end, idle</text>
  <text x="689" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">one sentinel per consumer</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">CPU on the loop</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="359" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">queue empty, reader slow</text>
  <text x="689" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">run_in_executor</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Dead consumer</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="359" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">reader blocked on put</text>
  <text x="689" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">use a TaskGroup</text>
  <text x="30" y="289" font-size="11.5" font-weight="600" fill="currentColor">Ungated pool</text>
  <line x1="26" y1="308" x2="854" y2="308" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="359" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">memory climbs anyway</text>
  <text x="689" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">semaphore on submit</text>
  <text x="868" y="326" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The last row catches people who bounded every queue carefully and then handed unlimited work to an executor that buffers it just as happily.</text>
</svg>
<figcaption>Each signal is cheap to observe and none of them is visible without logging the queue depth.</figcaption>
</figure>

## Verification

- **Memory stays flat.** Run against a deliberately slow sink and watch resident memory; it should plateau rather than climb.
- **Throughput matches the sink.** Total features divided by wall-clock should land near the sink's rate, not the reader's.
- **The queue depth reports usefully.** Confirm the monitor distinguishes a full queue from an empty one under both fast and slow sinks.
- **A dying writer stops the run.** Raise inside one writer and confirm the whole group cancels rather than hanging.
- **No deadlock on completion.** Confirm every writer exits, which proves the sentinel count matches the consumer count.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Memory climbs until the process dies | Unbounded queue somewhere in the chain | Give every queue an explicit `maxsize` |
| Bound set but memory still grows | Bound counts items, batches are huge | Size the bound against the batch, in bytes |
| Pipeline hangs at the end | One sentinel for several consumers | Send one sentinel per consumer |
| Everything stalls, queue stays empty | CPU work running on the event loop | Move decoding to `run_in_executor` |
| Reader blocked forever | A consumer died silently | Use `TaskGroup` so siblings are cancelled |
| Throughput far below the sink's rate | Too few consumers for a latency-bound sink | Add writers; concurrency hides per-write latency |
| Cannot tell which stage is slow | Queue depth never observed | Log `qsize()` against `maxsize` periodically |

## Specification reference

> `asyncio.Queue(maxsize=0)` creates a queue of infinite size. If `maxsize` is greater than zero, `put()` blocks when the queue reaches `maxsize` until an item is removed by `get()`. `asyncio.TaskGroup` provides a context manager holding a group of tasks; if any task fails with an exception other than `CancelledError`, the remaining tasks in the group are cancelled. See the Python `asyncio` queue and task-group documentation.

## Frequently Asked Questions

<details>
<summary>Why not use a rate limiter instead of a bounded queue?</summary>

Because a rate limiter needs a rate, and the correct rate is whatever the sink happens to manage right now — which changes with load, with checkpoints, with the time of day. A bounded queue discovers that rate continuously without being told it. Configuring a limiter means either setting it below the sink's capacity, wasting throughput, or above it, which is the unbounded case with extra code.
</details>

<details>
<summary>How large should the queue bound be?</summary>

Small. The queue exists to absorb short-term jitter, not to buffer work, and two to eight batches covers nearly all jitter. Going larger trades memory for a benefit that stops accruing almost immediately, because once the queue is deep enough to bridge a momentary stall, further depth only delays the point at which the reader learns the sink is slow.
</details>

<details>
<summary>Does this apply when the sink is a file rather than a database?</summary>

Yes, and more subtly, because the operating system's page cache provides its own unbounded buffer. Writes appear instant until dirty-page limits are reached, at which point the throughput collapses to the disk's actual rate. The queue bound still works, but the observed sink rate during the first minute is not the real one, so measure over a long enough window to get past the cache.
</details>

<details>
<summary>What if one stage is CPU-bound and the rest are I/O-bound?</summary>

Put the CPU-bound stage in a process pool and bound the number of outstanding submissions rather than a queue. A `ProcessPoolExecutor` will happily accept unlimited work, serialising every argument into memory as it queues, so the executor is itself an unbounded buffer unless you gate it — a semaphore acquired before submitting and released on completion is the usual shape.
</details>

## Related

- [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/) — the parent topic.
- [Streaming OSM XML with Expat in Constant Memory](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/streaming-osm-xml-with-expat-in-constant-memory/) — the same discipline applied to a parser.
- [Loading OSM into PostGIS with osm2pgsql Flex](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/loading-osm-into-postgis-with-osm2pgsql-flex/) — the sink that usually sets the rate.
- [Quarantining Bad OSM Features to a Dead-Letter Store](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/quarantining-bad-osm-features-to-a-dead-letter-store/) — what a worker does with a feature it cannot write.
- [Applying Backpressure to an Overpass Client](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-rate-limits-and-etiquette/) — the same idea against a remote server's limits.

Up one level: [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Applying Backpressure in an Asyncio OSM Pipeline",
  "description": "Stop a fast PBF reader from filling memory ahead of a slow writer by giving every queue a bound, so the producer waits instead of buffering a continent.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Parsing & Tag Normalization Workflows",
  "about": ["asyncio backpressure", "bounded queues", "OSM pipeline throughput"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Parsing & Tag Normalization Workflows", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/" },
    { "@type": "ListItem", "position": 3, "name": "Async PBF Parsing with Pyrosm", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/" },
    { "@type": "ListItem", "position": 4, "name": "Applying Backpressure in an Asyncio OSM Pipeline", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/applying-backpressure-in-an-asyncio-osm-pipeline/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Apply backpressure in an asyncio OSM pipeline",
  "description": "Bound every queue so a full queue suspends the producer, keep CPU work off the event loop, and use a task group so a failure in any stage cancels the rest rather than deadlocking.",
  "step": [
    { "@type": "HowToStep", "name": "Bound every queue", "text": "Give each asyncio.Queue an explicit maxsize measured in batches, so in-flight memory is a number you can compute." },
    { "@type": "HowToStep", "name": "Let await put throttle", "text": "Rely on the suspension of a full put rather than adding a rate limiter on top of it." },
    { "@type": "HowToStep", "name": "Move CPU work to a process pool", "text": "Decode PBF blocks via run_in_executor so parsing never stalls the event loop." },
    { "@type": "HowToStep", "name": "Send one sentinel per consumer", "text": "Emit as many terminating sentinels as there are writers, so none waits forever on an empty queue." },
    { "@type": "HowToStep", "name": "Use a TaskGroup", "text": "Let an exception in any task cancel its siblings so a dead writer cannot block the reader." },
    { "@type": "HowToStep", "name": "Monitor queue depth", "text": "Log qsize against maxsize periodically to identify whether the sink or the reader is the bottleneck." },
    { "@type": "HowToStep", "name": "Grow batches before queues", "text": "Prefer a short queue of large batches, since per-item overhead dominates at small batch sizes." }
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
      "name": "Why not use a rate limiter instead of a bounded queue?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because a rate limiter needs a rate, and the correct rate is whatever the sink manages right now, which changes with load and checkpoints. A bounded queue discovers that rate continuously. Configuring a limiter means setting it below capacity and wasting throughput, or above it, which is the unbounded case with extra code." }
    },
    {
      "@type": "Question",
      "name": "How large should the queue bound be?",
      "acceptedAnswer": { "@type": "Answer", "text": "Small. The queue absorbs short-term jitter rather than buffering work, and two to eight batches covers nearly all jitter. Further depth only delays the point at which the reader learns the sink is slow, while costing memory the whole time." }
    },
    {
      "@type": "Question",
      "name": "Does backpressure apply when the sink is a file rather than a database?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes, and more subtly, because the page cache is its own unbounded buffer. Writes look instant until dirty-page limits are hit and throughput collapses to the disk's real rate. The queue bound still works, but measure over a long enough window to get past the cache." }
    },
    {
      "@type": "Question",
      "name": "What if one stage is CPU-bound and the rest are I/O-bound?",
      "acceptedAnswer": { "@type": "Answer", "text": "Put it in a process pool and bound outstanding submissions rather than a queue. A ProcessPoolExecutor accepts unlimited work, serialising every argument into memory as it queues, so it is itself an unbounded buffer unless gated by a semaphore acquired before submitting." }
    }
  ]
}
</script>
