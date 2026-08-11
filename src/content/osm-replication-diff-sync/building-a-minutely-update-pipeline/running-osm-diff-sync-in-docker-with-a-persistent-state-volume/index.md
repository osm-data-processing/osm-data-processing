---
title: "Running OSM Diff Sync in Docker with a Persistent State Volume"
description: "Containerise a minutely OSM update loop so restarts cost a minute: state on a volume, the lock where the state is, graceful SIGTERM handling, and a healthcheck that tests progress."
pageTitle: "Run OSM Diff Sync in Docker with a State Volume"
pageDescription: "A containerised OSM diff-sync — Dockerfile, compose service, volume-resident checkpoint and lock, atomic checkpoint writes with directory fsync, and a progress-based healthcheck."
slug: "running-osm-diff-sync-in-docker-with-a-persistent-state-volume"
type: "article"
breadcrumb: "Diff Sync in Docker"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Running OSM Diff Sync in Docker with a Persistent State Volume

Containerise a minutely update loop so a container restart costs a minute, not a full reimport — and so two containers can never apply diffs to the same file at once.

## Prerequisites

- [ ] Docker 24+ or Podman, with a named volume or bind mount available
- [ ] A working diff-sync loop, per [Building a Minutely Update Pipeline](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/)
- [ ] Disk for the working extract plus room to write a new copy during apply
- [ ] A decision about who owns the cadence: the container, or a scheduler

## Conceptual minimum

Containers are ephemeral by design and a diff-sync loop is defined by its state. Reconciling those is a matter of being explicit about which is which.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 318" role="img" aria-labelledby="docker-state-t docker-state-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="docker-state-t">Which parts of a diff-sync deployment belong in the image and which in a volume</title>
  <desc id="docker-state-d">A grid of five items. The sync script belongs in the image because code is immutable and rebuilt on deploy. The working PBF belongs in a volume because re-downloading it takes hours. The sequence checkpoint belongs in a volume above all, because losing it means a rebuild. The osmium node cache may optionally live in a volume; it is rebuildable but slow. Logs belong in neither and should go to stdout for the runtime to collect.</desc>
  <rect x="0" y="0" width="880" height="318" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">What must survive a container restart, and where it lives</text>
  <text x="317" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">in the image</text>
  <text x="531" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">in a volume</text>
  <text x="745" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">why</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">the sync script</text>
  <rect x="213" y="84" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="317" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">yes</text>
  <rect x="427" y="84" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="531" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">no</text>
  <rect x="641" y="84" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="745" y="104" text-anchor="middle" font-size="9.5" fill="currentColor">code is immutable, rebuilt on deploy</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">the working .osm.pbf</text>
  <rect x="213" y="124" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="317" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">no</text>
  <rect x="427" y="124" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="531" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">yes</text>
  <rect x="641" y="124" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="745" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">re-downloading it is hours</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">the sequence checkpoint</text>
  <rect x="213" y="164" width="208" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="317" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">no</text>
  <rect x="427" y="164" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="531" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">yes — this one above all</text>
  <rect x="641" y="164" width="208" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="745" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">losing it means a rebuild</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">the osmium node cache</text>
  <rect x="213" y="204" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="317" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">no</text>
  <rect x="427" y="204" width="208" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="531" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">optional</text>
  <rect x="641" y="204" width="208" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="745" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">rebuildable, but slow</text>
  <text x="198" y="264" text-anchor="end" font-size="11.5" fill="currentColor">logs</text>
  <rect x="213" y="244" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="317" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">no</text>
  <rect x="427" y="244" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="531" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">no — stdout</text>
  <rect x="641" y="244" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="745" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">let the runtime collect them</text>
  <text x="440" y="300" text-anchor="middle" font-size="10.0" fill="currentColor" opacity="0.85">One row is the whole reason this needs care: a checkpoint written inside the container filesystem is gone the moment the container is replaced.</text>
</svg>
<figcaption>The checkpoint is the one piece of state that cannot be reconstructed from anything else, which makes the volume mount a correctness requirement rather than a convenience.</figcaption>
</figure>

The checkpoint is the piece that matters. The working extract is expensive to lose and can be re-downloaded; the checkpoint cannot be reconstructed from anything, and losing it means either a rebuild from a fresh extract or, worse, a guess that silently skips or replays diffs — the failure the sequence discipline in [Replication Sequence Numbers & State Tracking](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/) exists to prevent.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="docker-lock-t docker-lock-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="docker-lock-t">The startup and locking sequence for a containerised diff-sync</title>
  <desc id="docker-lock-d">A four-stage chain. The container starts and reads the checkpoint from the mounted volume. It takes an flock on the volume rather than on a container-local path, because the lock must live where the state lives. It applies the diff and writes the checkpoint in that order, with an fsync before releasing. It exits zero, and either a restart policy re-runs it or an internal sleep loop continues.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="dk" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">One container, one lock, one owner of the state</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">container starts</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">reads the checkpoint</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">from the mounted volume</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#dk)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">flock on the volume</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">not on /tmp</text>
  <text x="331" y="122" text-anchor="middle" font-size="10.0" fill="currentColor" opacity="0.8">the lock must share the state</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#dk)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">apply + checkpoint</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">in that order</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">fsync before releasing</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#dk)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">exit 0</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">restart policy re-runs it</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">or a sleep loop inside</text>
  <text x="440" y="158" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">Putting the lock inside the container filesystem makes it invisible to a second container, which is exactly the case it exists to prevent.</text>
</svg>
<figcaption>A lock on a container-local path is invisible to every other container, which makes it a lock that cannot do its job.</figcaption>
</figure>

The lock deserves the same care as the checkpoint, and for the same reason. `flock` on a path inside the container's own filesystem is invisible to any other container, so two replicas each take "the lock" successfully and both apply diffs to the same file.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 251" role="img" aria-labelledby="docker-schedule-t docker-schedule-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="docker-schedule-t">Three scheduling models for a containerised diff-sync loop</title>
  <desc id="docker-schedule-d">Three panels. A long-running loop sleeps between iterations in-process, keeping one container always up with the restart policy handling crashes; it is simplest to reason about but accumulates memory leaks. Restart-on-exit runs one iteration per process with restart always re-running it, giving a fresh process each minute and no leak accumulation, at the risk of restart storms if it fails fast. An external scheduler such as a Kubernetes CronJob or systemd timer owns the cadence and gives overlap prevention free through a forbid concurrency policy, at the cost of another moving part.</desc>
  <rect x="0" y="0" width="880" height="251" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three ways to schedule the loop in a container</text>
  <rect x="26" y="52" width="258" height="157" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Long-running loop</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Sleep between iterations, in-process</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">One container, always up</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Restart policy handles crashes</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Simplest to reason about</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Memory leaks accumulate</text>
  <rect x="310" y="52" width="258" height="157" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="439" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Restart-on-exit</text>
  <text x="324" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Script does one iteration, exits</text>
  <text x="324" y="125" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">restart: always` re-runs it</text>
  <text x="324" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Fresh process every minute</text>
  <text x="324" y="167" font-size="10.5" fill="currentColor" opacity="0.92">No leak accumulation</text>
  <text x="324" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Restart storms if it fails fast</text>
  <rect x="594" y="52" width="258" height="157" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="723" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">External scheduler</text>
  <text x="608" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Kubernetes CronJob, systemd timer</text>
  <text x="608" y="125" font-size="10.5" fill="currentColor" opacity="0.92">The runtime owns the cadence</text>
  <text x="608" y="146" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">concurrencyPolicy: Forbid</text>
  <text x="608" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Overlap prevention comes free</text>
  <text x="608" y="188" font-size="10.5" fill="currentColor" opacity="0.92">One more moving part</text>
  <text x="440" y="235" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.85">The middle option needs a backoff or a failing script becomes a restart loop; the third gets overlap prevention from the scheduler instead of from flock.</text>
</svg>
<figcaption>All three work. What must not vary is that exactly one of them applies a diff to the state volume at a time.</figcaption>
</figure>

## Runnable solution

```dockerfile
# Dockerfile
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        osmium-tool python3 python3-pyosmium ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Run as a fixed non-root uid so the volume's ownership is predictable across hosts.
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin osm
WORKDIR /app
COPY --chown=osm:osm sync.py /app/sync.py

USER osm
ENV STATE_DIR=/state \
    REPL_BASE=https://planet.osm.org/replication/minute/ \
    PYTHONUNBUFFERED=1

# stdout only: let the container runtime collect and rotate the logs.
ENTRYPOINT ["python3", "/app/sync.py"]
```

```yaml
# compose.yaml
services:
  osm-sync:
    build: .
    restart: unless-stopped
    volumes:
      - osm-state:/state          # the extract, the checkpoint and the lock
    environment:
      EXTRACT: /state/ireland.osm.pbf
      SLEEP_SECONDS: "60"
    healthcheck:
      # Unhealthy once the checkpoint stops advancing, not merely when the
      # process dies — a wedged loop keeps its process alive.
      test: ["CMD", "python3", "/app/sync.py", "--healthcheck"]
      interval: 120s
      timeout: 10s
      retries: 3
      start_period: 300s
    stop_grace_period: 120s       # let an in-flight apply finish rather than be killed
    deploy:
      resources:
        limits: { memory: 4G }

volumes:
  osm-state:
```

```python
#!/usr/bin/env python3
"""Containerised OSM diff-sync. All durable state lives under $STATE_DIR."""
from __future__ import annotations

import fcntl
import json
import logging
import os
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

logging.basicConfig(level=logging.INFO, stream=sys.stdout,
                    format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("osm-sync")

STATE_DIR = Path(os.environ.get("STATE_DIR", "/state"))
EXTRACT = Path(os.environ.get("EXTRACT", str(STATE_DIR / "data.osm.pbf")))
CHECKPOINT = STATE_DIR / "checkpoint.json"
LOCK_PATH = STATE_DIR / "sync.lock"      # on the volume, not in the container
SLEEP_SECONDS = int(os.environ.get("SLEEP_SECONDS", "60"))
STALE_AFTER = int(os.environ.get("STALE_AFTER", "900"))

_shutdown = False


def _request_shutdown(signum, _frame) -> None:
    """SIGTERM sets a flag; the loop finishes the current iteration and exits."""
    global _shutdown
    logger.info("signal %d received — finishing the current iteration", signum)
    _shutdown = True


@dataclass(frozen=True)
class Checkpoint:
    sequence: int
    updated_at: float

    @classmethod
    def read(cls) -> "Checkpoint | None":
        if not CHECKPOINT.exists():
            return None
        data = json.loads(CHECKPOINT.read_text())
        return cls(sequence=int(data["sequence"]), updated_at=float(data["updated_at"]))

    def write(self) -> None:
        """Temp file plus atomic rename, both on the volume, then fsync the dir."""
        tmp = CHECKPOINT.with_suffix(".tmp")
        tmp.write_text(json.dumps({"sequence": self.sequence,
                                   "updated_at": self.updated_at}))
        with tmp.open("rb") as handle:
            os.fsync(handle.fileno())
        tmp.replace(CHECKPOINT)
        dir_fd = os.open(STATE_DIR, os.O_RDONLY)
        try:
            os.fsync(dir_fd)          # the rename itself must reach the disk
        finally:
            os.close(dir_fd)


def healthcheck() -> int:
    """Healthy only while the checkpoint is advancing."""
    checkpoint = Checkpoint.read()
    if checkpoint is None:
        logger.warning("no checkpoint yet")
        return 1
    age = time.time() - checkpoint.updated_at
    if age > STALE_AFTER:
        logger.error("checkpoint is %.0f s old (limit %d s)", age, STALE_AFTER)
        return 1
    logger.info("healthy: sequence %d, %.0f s old", checkpoint.sequence, age)
    return 0


def apply_next(sequence: int) -> bool:
    """Apply one diff. Returns False when already current."""
    result = subprocess.run(
        ["pyosmium-up-to-date", "--verbose", "--size", "100",
         "--server", os.environ["REPL_BASE"], str(EXTRACT)],
        capture_output=True, text=True)
    if result.returncode not in (0, 3):        # 3 = already up to date
        logger.error("apply failed (%d): %s", result.returncode, result.stderr.strip())
        raise RuntimeError("apply-changes failed")
    return result.returncode == 0


def iteration() -> None:
    checkpoint = Checkpoint.read()
    sequence = checkpoint.sequence if checkpoint else 0
    if apply_next(sequence):
        # Work first, checkpoint second — a crash between them replays, never skips.
        Checkpoint(sequence=sequence + 1, updated_at=time.time()).write()
        logger.info("applied; checkpoint now %d", sequence + 1)
    else:
        Checkpoint(sequence=sequence, updated_at=time.time()).write()
        logger.info("already current at %d", sequence)


def main() -> int:
    if "--healthcheck" in sys.argv:
        return healthcheck()

    STATE_DIR.mkdir(parents=True, exist_ok=True)
    signal.signal(signal.SIGTERM, _request_shutdown)
    signal.signal(signal.SIGINT, _request_shutdown)

    with LOCK_PATH.open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            logger.error("another container holds the state lock — exiting")
            return 1

        logger.info("lock acquired; syncing %s", EXTRACT)
        while not _shutdown:
            started = time.monotonic()
            try:
                iteration()
            except Exception:
                logger.exception("iteration failed; retrying after the interval")
            elapsed = time.monotonic() - started
            for _ in range(int(max(0.0, SLEEP_SECONDS - elapsed))):
                if _shutdown:
                    break
                time.sleep(1)          # 1 s granularity so SIGTERM is responsive
    logger.info("shut down cleanly")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

## Step-by-step walkthrough

The lock file lives at `/state/sync.lock`, on the volume. That is the single most important line in the file: a lock on the volume is shared by every container that mounts it, which is precisely the set of processes that could collide. `flock` also releases automatically when the process dies, so a hard kill does not leave a stale lock behind.

`Checkpoint.write` does temp file, fsync, rename, then fsync of the *directory*. The directory fsync is the step usually missed — without it the rename can be lost in a power failure even though the data survived, leaving the checkpoint at its previous value and replaying one diff. That is the safe direction, which is why the ordering also puts the apply first.

The `USER` with a fixed uid matters more in containers than elsewhere. A volume created by one image and mounted by another with a different uid gives permission errors that look like corruption; pinning 10001 makes the ownership predictable across rebuilds and hosts.

The healthcheck asserts that the checkpoint is *advancing*, not that the process is alive. A loop wedged on a socket read keeps its process, its port and its liveness, and only the checkpoint's age reveals it — the same distinction drawn in [Replication Monitoring & Lag Alerting](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-monitoring-and-lag-alerting/).

`stop_grace_period: 120s` with a `SIGTERM` flag lets an in-flight apply finish. The default ten seconds is far too short for a diff apply on a country extract, and a `SIGKILL` partway through leaves a partially rewritten file.

The sleep is a one-second loop rather than one long `time.sleep`, so a shutdown signal is acted on within a second instead of up to a minute.

## Verification

Prove the state survives the container, which is the whole point:

```bash
docker compose up -d && sleep 180
docker compose exec osm-sync cat /state/checkpoint.json
docker compose down && docker compose up -d          # container replaced
docker compose logs --tail 5 osm-sync                # expect it to resume, not restart
```

The second checkpoint read must show a sequence at or above the first. A sequence of zero means the volume is not mounted where the code expects.

Prove the lock actually excludes a second container:

```bash
docker compose up -d
docker compose run --rm osm-sync                     # a second one, same volume
# expect: "another container holds the state lock — exiting", exit 1
```

If the second container starts syncing, the lock is on a container-local path.

Prove graceful shutdown does not truncate an apply:

```bash
docker compose stop -t 120 osm-sync
docker compose logs --tail 3 osm-sync                # expect "shut down cleanly"
osmium fileinfo /var/lib/docker/volumes/.../ireland.osm.pbf   # must still parse
```

## Common errors and fixes

| Symptom | Root cause | Fix |
|---|---|---|
| Full reimport after every restart | Checkpoint written inside the container | Put it on the mounted volume |
| Two containers applying diffs together | Lock on a container-local path | `flock` a file on the volume |
| Permission denied on the volume | uid differs between image builds | Pin a fixed uid in the Dockerfile |
| Healthy container, stale data | Healthcheck only tests liveness | Assert the checkpoint's age |
| Corrupt PBF after a deploy | `SIGKILL` mid-apply | Raise `stop_grace_period`; handle `SIGTERM` |
| Container OOM-killed | No memory limit, or too low for the node cache | Set a limit above the cache size |
| Restart storm | Fail-fast script with `restart: always` | Add a backoff, or run a long-lived loop |

## Frequently Asked Questions

<details>
<summary>Named volume or bind mount?</summary>

A named volume for anything managed by the container runtime, because it handles ownership and lifecycle. A bind mount when the extract must be readable by processes outside the container — a tile server, a PostGIS import — which is common enough that bind mounts are the pragmatic default in a mixed deployment. The locking and checkpoint discipline is identical either way.
</details>

<details>
<summary>Should the loop be inside the container or a CronJob?</summary>

If you already run Kubernetes, a `CronJob` with `concurrencyPolicy: Forbid` gives overlap prevention from the scheduler and one fewer thing to get right. On a single host, an in-container loop with a `flock` is simpler and has fewer moving parts than adding a scheduler. Both are correct; what must not happen is two mechanisms both thinking they own the cadence.
</details>

<details>
<summary>Can several containers sync different regions on one volume?</summary>

Yes, with a lock file per region rather than one global lock. Each container locks `/state/<region>.lock` and touches only its own extract and checkpoint. What must not be shared is the extract: two containers applying diffs to one file corrupt it regardless of how careful each one is on its own.
</details>

<details>
<summary>How do I back this up?</summary>

Snapshot the volume with the container stopped, or at minimum while the lock is held by your backup process rather than by the sync. Copying the extract and the checkpoint at different moments produces a backup whose checkpoint does not describe its data, which restores as a silently wrong state — the checkpoint-ahead-of-data case that [Recovering from a Replication Sequence Gap](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/recovering-from-a-replication-sequence-gap/) shows cannot be repaired by replay.
</details>

## Specification reference

> `flock(2)` advisory locks are associated with the open file description and are released automatically when the last descriptor is closed, including on process death. Locks are visible to any process that opens the same file through the same filesystem, which for containers means the lock file must live on a shared mount rather than inside a container's own writable layer.

## Related

- [Building a Minutely Update Pipeline](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/) — the topic this deployment packages.
- [Scheduling OSM Diff Sync with systemd Timers](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/scheduling-osm-diff-sync-with-systemd-timers/) — the non-container equivalent, with the same lock problem.
- [Replication Sequence Numbers & State Tracking](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/) — the checkpoint the volume exists to preserve.
- [Replication Monitoring & Lag Alerting](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-monitoring-and-lag-alerting/) — why the healthcheck tests progress rather than liveness.
- [Resuming an Interrupted OSM Import](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/resuming-an-interrupted-osm-import/) — the same commit ordering, for batch jobs.

Up one level: [Building a Minutely Update Pipeline](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/).
