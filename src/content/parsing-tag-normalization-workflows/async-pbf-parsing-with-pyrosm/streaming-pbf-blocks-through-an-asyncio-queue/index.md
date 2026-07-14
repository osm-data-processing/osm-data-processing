---
title: "Streaming PBF Blocks Through an Asyncio Queue"
description: "Decouple PBF block decoding from downstream processing with a bounded asyncio.Queue producer-consumer so a slow consumer applies backpressure instead of exhausting memory."
pageTitle: "Stream OSM PBF Blocks Through a Bounded Asyncio Queue"
pageDescription: "Build a bounded asyncio.Queue producer-consumer for OSM PBF blocks: run blocking decode in an executor, apply backpressure, and shut down cleanly with a sentinel."
slug: streaming-pbf-blocks-through-an-asyncio-queue
type: article
breadcrumb: "Asyncio Queue Streaming"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# Streaming PBF Blocks Through an Asyncio Queue

Feed decoded PBF fileblocks into a slower downstream stage — geometry assembly, tag rewriting, a database COPY — without letting the fast decoder race ahead and pile every pending block into RAM, by handing blocks across a bounded `asyncio.Queue` that makes the producer wait whenever the consumer falls behind.

## Prerequisites

Verify each item before running the module below; the queue bound is the only thing standing between a fast decoder and an out-of-memory kill, so the sizing choices here are not optional.

- [ ] Python 3.10+ for the `asyncio.to_thread` helper, `X | None` unions, and the structural type hints used throughout.
- [ ] `osmium` ≥ 3.6 (`pip install osmium`) providing the `osmium.io.Reader` and `osmium.io.Header` surface used to pull raw fileblocks.
- [ ] A local `.osm.pbf` extract on disk — produced or tiled by the ingestion stage in [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/).
- [ ] A downstream sink you control the throughput of (a writer, a normalizer, a graph builder), so backpressure has somewhere to originate.
- [ ] A rough measurement of one decoded block's resident size, so you can pick `maxsize` against a real memory budget rather than a guess.
- [ ] Familiarity with the streaming memory discipline in [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/), which this pattern complements.

## Conceptual minimum

A PBF file is a sequence of independent, zlib-compressed fileblocks. Decoding one block is CPU work; whatever happens to the decoded features afterward — reprojection, tag canonicalization, an insert — is usually slower and often I/O-bound. If you decode in a tight loop and append every result to a list, the decoder finishes the file long before the consumer drains it, and peak memory grows to hold the *entire* backlog. The fix is not a faster consumer; it is a channel that refuses to accept more work than the consumer can take. A bounded [asyncio](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/) queue is exactly that channel: `await queue.put(block)` suspends the producer coroutine the moment the queue is full, and only resumes it once the consumer calls `queue.get()` and frees a slot. That suspension *is* backpressure — the producer's rate is clamped to the consumer's rate, and the in-flight set never exceeds `maxsize`.

Two details make this correct rather than merely plausible. First, decoding a block with osmium is a *blocking* call that would stall the entire event loop if run inline; it must execute in a thread or process pool via `loop.run_in_executor`, so the loop stays free to service `put`/`get` handoffs. Second, the consumer needs an unambiguous end-of-stream signal. A queue has no built-in "closed" state, so the producer enqueues a `None` sentinel after the last block, and the consumer treats that sentinel as its cue to stop — one sentinel per consumer, so every worker gets released.

<svg viewBox="0 0 760 320" role="img" aria-label="A producer coroutine decodes PBF fileblocks in a thread-pool executor and pushes each decoded block into a bounded asyncio queue of four slots; three slots are occupied so one remains free, and when all slots fill the producer's put call suspends, which is backpressure. Two consumer coroutines each call get to pull a block, process it against a slower downstream sink, and mark the task done. After the last block the producer enqueues one None sentinel per consumer to stop each worker cleanly." xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:760px;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>Bounded asyncio queue between a PBF block producer and two consumers</title>
  <desc>A producer coroutine runs blocking block decode in a thread-pool executor and pushes each decoded block onto a bounded asyncio queue with four slots, three occupied and one free. When the queue is full the producer's put call suspends, applying backpressure. Two consumer coroutines each call get, process the block against a slower downstream sink, and call task_done. A None sentinel per consumer signals end of stream.</desc>
  <defs>
    <marker id="sbq-arr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <!-- producer -->
  <rect x="20" y="118" width="150" height="72" rx="6" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-width="1.5"/>
  <text x="95" y="142" text-anchor="middle" font-size="12.5" fill="currentColor">Producer</text>
  <text x="95" y="160" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">run_in_executor</text>
  <text x="95" y="176" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">decode block</text>
  <!-- executor tag -->
  <rect x="20" y="24" width="150" height="44" rx="6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 3"/>
  <text x="95" y="42" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">Thread / process</text>
  <text x="95" y="58" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">pool executor</text>
  <line x1="95" y1="68" x2="95" y2="116" stroke="currentColor" stroke-width="1.2" stroke-dasharray="3 3" marker-end="url(#sbq-arr)"/>
  <!-- put arrow -->
  <line x1="170" y1="154" x2="256" y2="154" stroke="currentColor" stroke-width="1.5" marker-end="url(#sbq-arr)"/>
  <text x="213" y="146" text-anchor="middle" font-size="10.5" fill="currentColor">await put()</text>
  <!-- backpressure loop -->
  <path d="M400,116 L400,86 L95,86 L95,116" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 3" marker-end="url(#sbq-arr)"/>
  <text x="250" y="100" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">put() suspends while full — backpressure</text>
  <!-- queue -->
  <text x="400" y="130" text-anchor="middle" font-size="11" fill="currentColor">Bounded queue (maxsize = 4)</text>
  <g>
    <rect x="262" y="138" width="46" height="44" fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-width="1.3"/>
    <rect x="308" y="138" width="46" height="44" fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-width="1.3"/>
    <rect x="354" y="138" width="46" height="44" fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-width="1.3"/>
    <rect x="400" y="138" width="46" height="44" fill="none" stroke="currentColor" stroke-width="1.3"/>
  </g>
  <text x="331" y="200" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.8">3 filled</text>
  <text x="423" y="200" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.8">1 free</text>
  <!-- get arrows to consumers -->
  <line x1="446" y1="150" x2="536" y2="118" stroke="currentColor" stroke-width="1.5" marker-end="url(#sbq-arr)"/>
  <line x1="446" y1="168" x2="536" y2="210" stroke="currentColor" stroke-width="1.5" marker-end="url(#sbq-arr)"/>
  <text x="495" y="120" text-anchor="middle" font-size="10.5" fill="currentColor">await get()</text>
  <!-- consumers -->
  <rect x="538" y="86" width="150" height="60" rx="6" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-width="1.5"/>
  <text x="613" y="110" text-anchor="middle" font-size="12" fill="currentColor">Consumer A</text>
  <text x="613" y="128" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">process → sink</text>
  <rect x="538" y="182" width="150" height="60" rx="6" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-width="1.5"/>
  <text x="613" y="206" text-anchor="middle" font-size="12" fill="currentColor">Consumer B</text>
  <text x="613" y="224" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">process → sink</text>
  <!-- sentinel note -->
  <text x="380" y="300" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">End of stream: one None sentinel per consumer stops each worker cleanly</text>
</svg>

## Runnable solution

The module below reads fileblocks from a `.osm.pbf`, decodes each in a thread-pool executor, and streams the decoded results through a bounded queue to a configurable number of consumers. Decoding here counts nodes and ways per block as a stand-in for real per-block work; swap `_decode_block` for your geometry or normalization step. Consumers push to whatever sink you supply. It targets Python 3.10+ and `osmium>=3.6`.

```python
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Awaitable, Callable

import osmium

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.block_stream")

QUEUE_MAXSIZE = 4      # in-flight decoded blocks; the memory dial
N_CONSUMERS = 2        # parallel downstream workers


@dataclass(slots=True)
class DecodedBlock:
    """One decoded PBF fileblock's summary payload."""
    seq: int
    n_nodes: int
    n_ways: int


def _decode_block(seq: int, raw_bytes: bytes) -> DecodedBlock:
    """Blocking decode of a single fileblock — runs in an executor thread.

    Real pipelines would reconstruct geometry or rewrite tags here; this
    version tallies primitives so the example stays dependency-light.
    """
    n_nodes = n_ways = 0
    for line in raw_bytes.splitlines():
        if line.startswith(b"n"):
            n_nodes += 1
        elif line.startswith(b"w"):
            n_ways += 1
    return DecodedBlock(seq=seq, n_nodes=n_nodes, n_ways=n_ways)


def _iter_raw_blocks(pbf_path: Path) -> list[tuple[int, bytes]]:
    """Yield (sequence, raw bytes) per fileblock via osmium's block reader."""
    blocks: list[tuple[int, bytes]] = []
    reader = osmium.io.Reader(str(pbf_path))
    try:
        for seq, block in enumerate(reader):   # each item is one fileblock
            blocks.append((seq, bytes(block)))
    finally:
        reader.close()
    return blocks


async def stream_blocks(
    pbf_path: Path,
    consume: Callable[[DecodedBlock], Awaitable[None]],
) -> None:
    """Decode PBF blocks in an executor and fan them to bounded consumers."""
    queue: asyncio.Queue[DecodedBlock | None] = asyncio.Queue(maxsize=QUEUE_MAXSIZE)
    loop = asyncio.get_running_loop()

    async def producer() -> None:
        # Enumerating raw blocks is cheap; decoding is the blocking cost.
        for seq, raw in _iter_raw_blocks(pbf_path):
            block = await loop.run_in_executor(None, _decode_block, seq, raw)
            await queue.put(block)          # suspends when the queue is full
        for _ in range(N_CONSUMERS):
            await queue.put(None)           # one sentinel per consumer

    async def consumer(worker_id: int) -> None:
        while True:
            block = await queue.get()
            try:
                if block is None:
                    return                  # sentinel: this worker is done
                await consume(block)
                logger.info(
                    "worker %d handled block %d (%d nodes, %d ways)",
                    worker_id, block.seq, block.n_nodes, block.n_ways,
                )
            finally:
                queue.task_done()

    prod = asyncio.create_task(producer())
    workers = [asyncio.create_task(consumer(i)) for i in range(N_CONSUMERS)]
    # Surface a producer crash instead of hanging the consumers forever.
    await asyncio.gather(prod, *workers)


async def _demo_sink(block: DecodedBlock) -> None:
    """Stand-in slow consumer; replace with a DB write or normalizer."""
    await asyncio.sleep(0.05)               # simulate downstream latency


if __name__ == "__main__":
    asyncio.run(stream_blocks(Path("extract.osm.pbf"), _demo_sink))
```

## Step-by-step walkthrough

1. **`QUEUE_MAXSIZE` is the memory dial.** The queue admits at most four decoded blocks. Peak resident set for in-flight work is roughly `QUEUE_MAXSIZE × one decoded block`, independent of how large the file is — that bound is the entire point of the pattern.
2. **Blocking decode moves off the loop.** `await loop.run_in_executor(None, _decode_block, ...)` runs the CPU-heavy decode on the default thread pool. The `await` yields control, so the event loop keeps servicing `put` and `get` for other coroutines while a block decodes.
3. **`await queue.put(block)` is where backpressure lives.** When the four slots are full, this line suspends the producer until a consumer frees a slot. The producer literally cannot outrun the consumers, so the backlog never grows.
4. **One sentinel per consumer.** After the last real block, the producer enqueues `N_CONSUMERS` copies of `None`. Each consumer consumes exactly one and returns; a single sentinel would stop only the first worker to reach it and leave the others hanging on `get()`.
5. **`task_done()` in a `finally`.** Every `get()` is balanced by a `task_done()` even on the sentinel path, so a later `queue.join()` (or an external monitor) can tell when the queue has been fully drained.
6. **`asyncio.gather(prod, *workers)`.** Awaiting the producer alongside the workers means a producer exception propagates instead of silently leaving consumers blocked on an empty queue forever.

## Verification

Confirm the stream behaves before wiring it to a real sink:

- **Watch memory stay flat.** Sample RSS with `psutil` while processing a multi-gigabyte extract; it should plateau near `QUEUE_MAXSIZE × block size` rather than climbing with file size. A steadily rising curve means the bound is not taking effect.
- **Force a slow consumer.** Raise the `asyncio.sleep` in `_demo_sink` to 0.5 s and confirm the producer's decode rate drops to match — that observable throttling is backpressure working.
- **Count blocks end to end.** Sum the blocks each worker logs; the total must equal the fileblock count reported by `osmium fileinfo --extended extract.osm.pbf`. A short count means a sentinel stopped a worker early.
- **Prove clean shutdown.** The program should exit without a hang and without an `asyncio` "Task was destroyed but it is pending" warning; either symptom points to a missing sentinel or an unawaited task.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Program hangs at shutdown | Fewer sentinels than consumers | Enqueue exactly `N_CONSUMERS` `None` values after the last block. |
| Memory grows with file size | Unbounded queue (`maxsize=0`) | Construct `asyncio.Queue(maxsize=QUEUE_MAXSIZE)` with a finite bound. |
| Event loop stalls, no concurrency | Blocking decode called inline | Offload it with `await loop.run_in_executor(...)`. |
| One worker does all the work | Sentinel handled before siblings released | Send one sentinel per consumer, not a single shared one. |
| `Task was destroyed but pending` | Producer/consumer task not awaited | `await asyncio.gather(prod, *workers)` before returning. |
| Silent stall, no error surfaced | Producer raised; consumers block on `get()` | Gather the producer so its exception propagates. |

## Specification reference

> `asyncio.Queue(maxsize=0)` creates an unbounded queue; a positive `maxsize` bounds it, and "if the queue is full, wait until a free slot is available before adding the item" is the defined behaviour of the coroutine `put()`. See the [Python asyncio.Queue documentation](https://docs.python.org/3/library/asyncio-queue.html) for the `put`, `get`, `task_done`, and `join` contract, and [Running blocking code in an executor](https://docs.python.org/3/library/asyncio-eventloop.html#asyncio.loop.run_in_executor) for offloading the synchronous PBF decode off the event loop.

## Frequently Asked Questions

<details>
<summary>Why a bounded queue instead of just gathering all decode tasks?</summary>

Gathering every decode task schedules them all at once, so the number of in-flight decoded blocks equals the number of blocks in the file — exactly the unbounded backlog you are trying to avoid. A bounded queue caps concurrent work at `maxsize`, so a fast decoder is forced to wait for slow consumers and peak memory stays constant regardless of file size.
</details>

<details>
<summary>How many consumers should I run?</summary>

Start with the number of independent downstream resources, not CPU cores. If the sink is a single database connection, one consumer avoids lock contention; if it is a pool of connections or stateless CPU work, scale consumers toward that pool's parallelism. Because the queue bound caps memory, adding consumers changes throughput, not the resident-set ceiling.
</details>

<details>
<summary>Should decoding run in a thread pool or a process pool?</summary>

Use a thread pool when the decode releases the GIL in a C extension, which osmium largely does during raw reads — threads then give real parallelism with cheap handoff. Switch to a process pool only when the per-block work is pure-Python and GIL-bound; the trade is higher IPC cost to serialize each block across the process boundary.
</details>

<details>
<summary>What happens if a consumer raises mid-stream?</summary>

Wrap the per-block work in `try/except`, log or quarantine the offending block, and call `task_done()` in a `finally` so the queue accounting stays correct. Let an unrecoverable error propagate through `gather` so the whole stream fails loudly rather than silently dropping blocks — the same fail-fast contract the ingestion stage relies on.
</details>

## Related

- [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/) — the parent pattern that wraps a blocking reader in a producer-consumer with strict backpressure.
- [Tuning Pyrosm Worker Count for PBF Parsing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/tuning-pyrosm-worker-count-for-pbf-parsing/) — how many workers to run once the queue keeps memory bounded.
- [Speed Up OSM Parsing with Multiprocessing in Python](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/speed-up-osm-parsing-with-multiprocessing-in-python/) — fanning independent fileblocks across a process pool with a final reduce.
- [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) — the streaming and spill-to-disk discipline this queue enforces at the channel level.
- [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) — why fileblocks are the natural, independently decodable unit to stream.

Up one level: [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Streaming PBF Blocks Through an Asyncio Queue",
  "description": "Decouple PBF block decoding from downstream processing with a bounded asyncio.Queue producer-consumer so a slow consumer applies backpressure instead of exhausting memory.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "Parsing & Tag Normalization Workflows",
  "about": ["asyncio bounded queue backpressure", "OSM PBF fileblock streaming", "producer consumer memory control"]
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
    { "@type": "ListItem", "position": 4, "name": "Streaming PBF Blocks Through an Asyncio Queue", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/streaming-pbf-blocks-through-an-asyncio-queue/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Stream OSM PBF blocks through a bounded asyncio queue",
  "description": "Producer-consumer procedure that decodes PBF fileblocks in an executor and hands them across a bounded asyncio queue so a slow consumer applies backpressure and memory stays constant.",
  "step": [
    { "@type": "HowToStep", "name": "Create a bounded queue", "text": "Construct asyncio.Queue with a positive maxsize so the number of in-flight decoded blocks is capped and peak memory is independent of file size." },
    { "@type": "HowToStep", "name": "Decode off the event loop", "text": "Run each blocking fileblock decode with loop.run_in_executor so the event loop stays free to service queue put and get handoffs." },
    { "@type": "HowToStep", "name": "Apply backpressure on put", "text": "Await queue.put for each decoded block so the producer suspends when the queue is full and cannot outrun the consumers." },
    { "@type": "HowToStep", "name": "Fan out to consumers", "text": "Run one or more consumer coroutines that await queue.get, process each block against the downstream sink, and call task_done." },
    { "@type": "HowToStep", "name": "Shut down with sentinels", "text": "After the last block enqueue one None sentinel per consumer so every worker returns cleanly and the program exits without hanging." }
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
      "name": "Why a bounded queue instead of just gathering all decode tasks?",
      "acceptedAnswer": { "@type": "Answer", "text": "Gathering every decode task schedules them all at once, so the number of in-flight decoded blocks equals the number of blocks in the file, which is exactly the unbounded backlog you are trying to avoid. A bounded queue caps concurrent work at maxsize, so a fast decoder waits for slow consumers and peak memory stays constant regardless of file size." }
    },
    {
      "@type": "Question",
      "name": "How many consumers should I run?",
      "acceptedAnswer": { "@type": "Answer", "text": "Start with the number of independent downstream resources, not CPU cores. If the sink is a single database connection, one consumer avoids lock contention; if it is a pool of connections or stateless CPU work, scale consumers toward that pool's parallelism. Because the queue bound caps memory, adding consumers changes throughput, not the resident-set ceiling." }
    },
    {
      "@type": "Question",
      "name": "Should decoding run in a thread pool or a process pool?",
      "acceptedAnswer": { "@type": "Answer", "text": "Use a thread pool when the decode releases the GIL in a C extension, which osmium largely does during raw reads, so threads give real parallelism with cheap handoff. Switch to a process pool only when the per-block work is pure Python and GIL-bound, at the cost of higher IPC to serialize each block across the process boundary." }
    },
    {
      "@type": "Question",
      "name": "What happens if a consumer raises mid-stream?",
      "acceptedAnswer": { "@type": "Answer", "text": "Wrap the per-block work in try except, log or quarantine the offending block, and call task_done in a finally so the queue accounting stays correct. Let an unrecoverable error propagate through gather so the whole stream fails loudly rather than silently dropping blocks." }
    }
  ]
}
</script>
