---
title: "Running OSM Diff Sync on Kubernetes with a StatefulSet"
description: "Deploy a minutely replication loop as a single-replica StatefulSet so the sequence state, the working disk and the mutual exclusion all survive a restart and never run twice at once."
pageTitle: "Deploying an OSM Diff-Sync Loop on Kubernetes"
pageDescription: "Run OSM replication under Kubernetes without two pods applying the same diff: a single-replica StatefulSet, a persistent volume for the state, and probes that report data freshness rather than process liveness."
slug: running-osm-diff-sync-on-kubernetes-with-a-statefulset
type: article
breadcrumb: "Diff Sync on Kubernetes"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Running OSM Diff Sync on Kubernetes with a StatefulSet

A replication loop is stateful, single-writer and long-running, which is nearly the opposite of what a Deployment assumes — and two pods applying the same diff to the same database is a corruption, not a race you can retry.

## Prerequisites

- [ ] A Kubernetes cluster you can create StatefulSets and PersistentVolumeClaims in.
- [ ] The loop itself, per [Building a Minutely Update Pipeline](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/).
- [ ] A storage class supporting `ReadWriteOnce` with enough IOPS for `osmium` to work.
- [ ] The state model from [Replication Sequence Numbers & State Tracking](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/).
- [ ] Monitoring that can scrape a freshness metric, per [Replication Monitoring & Lag Alerting](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-monitoring-and-lag-alerting/).

## Conceptual minimum

Three properties of the workload decide the shape of the manifest.

**It must not run twice.** A Deployment during a rolling update deliberately runs old and new pods together, and a Deployment whose node becomes unreachable may start a replacement while the original is still running and still writing. A StatefulSet with `replicas: 1` gives at-most-one semantics: Kubernetes will not create the replacement until the original is confirmed gone, which is exactly the trade — availability sacrificed for the guarantee you need.

**Its state is on disk.** The sequence marker, the partially downloaded diffs and the working files all live on a volume. A StatefulSet's `volumeClaimTemplates` binds the same claim to the pod each time it is scheduled, so a restart resumes rather than restarts.

**It is not a request handler.** The default readiness and liveness semantics assume a server. For a loop, "alive" means it is making progress, and "ready" is meaningless — there is no traffic to gate. Wiring a liveness probe to data freshness rather than process existence is what turns a silently stalled loop into a restart.

The single most consequential setting is `terminationGracePeriodSeconds`. A loop killed mid-apply leaves the database and the sequence marker disagreeing, and recovering from that costs far more than waiting for the current diff to finish.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="dsk1-t dsk1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="dsk1-t">Why a Deployment is the wrong controller for a replication loop</title>
  <desc id="dsk1-d">Three panels. A Deployment performs rolling updates by design, starting the new pod before terminating the old one, so two replication loops write to the same database during every deploy. A Deployment also replaces a pod on an unreachable node without confirming the original has stopped, since from the control plane an unreachable node is indistinguishable from a slow one. A StatefulSet with one replica gives at-most-one semantics, never starting a replacement until the original is confirmed terminated, and binds the same persistent volume to the pod on every reschedule so the sequence marker survives.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Deployment, node failure, StatefulSet</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Rolling update</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">New pod before old stops</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Two loops, one database</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Happens every deploy</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">By design, not a bug</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Unreachable node</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Replacement started</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Original may still write</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Cannot be distinguished</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Corruption, not a race</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">StatefulSet, one replica</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">At most one, guaranteed</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Waits for confirmed exit</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Same volume every time</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Availability traded away</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The third panel is less available than the other two, and that is the point: a stalled loop is recoverable, a double-applied diff is not.</text>
</svg>
<figcaption>Choose the controller for the guarantee it gives, not the uptime it promises.</figcaption>
</figure>

## Runnable solution

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: osm-diff-sync
spec:
  replicas: 1                      # more than one corrupts the database
  serviceName: osm-diff-sync
  podManagementPolicy: OrderedReady
  updateStrategy:
    type: RollingUpdate            # with 1 replica this is stop-then-start
  selector:
    matchLabels: { app: osm-diff-sync }
  template:
    metadata:
      labels: { app: osm-diff-sync }
    spec:
      # Long enough for the current diff to finish. A loop killed mid-apply
      # leaves the database and the sequence marker disagreeing.
      terminationGracePeriodSeconds: 900
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        fsGroup: 10001
      containers:
        - name: sync
          image: registry.example.net/osm-diff-sync:2026.09.17
          args: ["--state-dir", "/var/lib/osm", "--interval", "60"]
          env:
            - name: REPLICATION_URL
              value: https://planet.openstreetmap.org/replication/minute
            - name: PGHOST
              valueFrom:
                secretKeyRef: { name: osm-db, key: host }
          ports:
            - { name: metrics, containerPort: 9187 }
          volumeMounts:
            - { name: state, mountPath: /var/lib/osm }
          resources:
            requests: { cpu: "1", memory: 4Gi }
            limits:   { memory: 8Gi }        # no CPU limit: throttling stalls apply
          # "Alive" means making progress, not "the process exists". A loop
          # whose lock is stuck answers a TCP check perfectly while doing
          # nothing at all.
          livenessProbe:
            httpGet: { path: /healthz/freshness, port: metrics }
            initialDelaySeconds: 300
            periodSeconds: 60
            failureThreshold: 10             # 10 minutes of staleness
          startupProbe:
            httpGet: { path: /healthz/started, port: metrics }
            failureThreshold: 60
            periodSeconds: 10
  volumeClaimTemplates:
    - metadata:
        name: state
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: fast-ssd
        resources:
          requests: { storage: 200Gi }
```

```python
"""The freshness endpoint the liveness probe reads.

Reporting process existence is worthless here: the failure mode is a loop
that runs, logs and exits zero every minute while applying nothing.
"""
from __future__ import annotations

import json
import logging
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.k8s.health")

STATE_DIR = Path("/var/lib/osm")
MAX_STALE_S = 600


def freshness() -> tuple[bool, dict]:
    marker = STATE_DIR / "applied.json"
    if not marker.exists():
        return False, {"reason": "no marker yet"}
    data = json.loads(marker.read_text(encoding="utf-8"))
    age = time.time() - data["applied_at"]
    return age < MAX_STALE_S, {"sequence": data["sequence"],
                               "age_seconds": round(age, 1)}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:                      # noqa: N802
        if self.path == "/healthz/started":
            ok, body = STATE_DIR.exists(), {"state_dir": str(STATE_DIR)}
        elif self.path == "/healthz/freshness":
            ok, body = freshness()
        else:
            ok, body = False, {"reason": "unknown path"}
        payload = json.dumps(body).encode("utf-8")
        self.send_response(200 if ok else 503)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args) -> None:          # probes are noisy
        return


if __name__ == "__main__":
    logger.info("serving freshness on :9187")
    HTTPServer(("", 9187), Handler).serve_forever()
```

## Step-by-step walkthrough

1. **Set `replicas: 1` and mean it.** Scaling this workload is not a capacity lever, and an autoscaler pointed at it is a corruption waiting for load.
2. **Use `volumeClaimTemplates`, not a shared claim.** The template binds storage to the pod's identity, which is what makes a reschedule a resume.
3. **Give a long grace period.** Fifteen minutes lets the current diff complete; the alternative is a partially applied change and a marker that disagrees with the database.
4. **Handle `SIGTERM` in the loop.** The grace period only helps if the process finishes the current diff and exits rather than dying at the first signal.
5. **Probe freshness, not liveness.** The characteristic failure is a loop that appears healthy by every process-level measure while applying nothing.
6. **Set a startup probe.** Initial catch-up can take hours, and a liveness probe without a startup probe restarts the pod repeatedly during it.
7. **Omit the CPU limit.** CPU throttling during an apply extends it past the probe threshold, which restarts a pod that was merely slow.
8. **Pin the image by digest or dated tag.** A loop restarting onto an unexpected version mid-incident is a second problem during the first.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="dsk2-t dsk2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="dsk2-t">What a graceful termination has to accomplish, in order</title>
  <desc id="dsk2-d">Four steps. Kubernetes sends SIGTERM and starts the grace-period countdown. The loop stops accepting new work, meaning it will not begin the next diff, but continues the one in progress. The in-flight diff completes its apply and the sequence marker is written, which is the atomic point that makes the state consistent. The process exits zero well inside the grace period, and Kubernetes proceeds. If the grace period expires first, SIGKILL arrives mid-apply and leaves the database and the marker disagreeing, which requires manual reconciliation.</desc>
  <defs><marker id="dsk2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">SIGTERM to a consistent stop</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">SIGTERM</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">countdown begins</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">grace period running</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#dsk2-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">stop taking work</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">no new diff started</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">current one continues</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#dsk2-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">finish and mark</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">apply completes</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">marker written, atomic</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#dsk2-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">exit zero</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">inside the grace period</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">state consistent</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">If the countdown expires at the third step, SIGKILL leaves the database ahead of the marker and reconciliation becomes manual.</text>
</svg>
<figcaption>The grace period must exceed the slowest realistic diff, not the average one.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 388" role="img" aria-labelledby="dsk3-t dsk3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="dsk3-t">Six manifest settings and the specific failure each one prevents</title>
  <desc id="dsk3-d">A grid of six settings against the failure they prevent and what happens at the default. One replica prevents two loops writing the same database, where the default of scaling freely corrupts the sequence. Volume claim templates prevent state loss on reschedule, where an emptyDir restarts the catch-up from nothing. A long termination grace period prevents a mid-apply kill, where the thirty-second default leaves the marker and database disagreeing. A freshness liveness probe prevents a silently stalled loop, where a process check reports health forever. A startup probe prevents restart loops during the initial catch-up. Omitting the CPU limit prevents throttling from extending an apply past the probe threshold.</desc>
  <rect x="0" y="0" width="880" height="388" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Setting, failure prevented, and the default</text>
  <rect x="202" y="48" width="326" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="365" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Prevents</text>
  <rect x="528" y="48" width="326" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="691" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">At the default</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">replicas: 1</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="365" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">two writers</text>
  <text x="691" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">sequence corrupted</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">volumeClaimTemplates</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="365" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">state loss</text>
  <text x="691" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">catch-up from nothing</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">grace period 900s</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="365" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">mid-apply kill</text>
  <text x="691" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">30s, marker disagrees</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">freshness liveness</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="365" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">silent stall</text>
  <text x="691" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">healthy forever</text>
  <text x="30" y="289" font-size="11.5" font-weight="600" fill="currentColor">startupProbe</text>
  <line x1="26" y1="308" x2="854" y2="308" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="365" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">restart loop</text>
  <text x="691" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">killed during catch-up</text>
  <text x="30" y="335" font-size="11.5" font-weight="600" fill="currentColor">no CPU limit</text>
  <line x1="26" y1="354" x2="854" y2="354" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="365" y="335" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">throttled apply</text>
  <text x="691" y="335" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">false restarts</text>
  <text x="868" y="372" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Every default in the right column is the correct choice for a request handler, which is what the defaults were written for.</text>
</svg>
<figcaption>None of these are tuning. Each removes one specific way this workload breaks.</figcaption>
</figure>

## Verification

- **Only one pod ever runs.** Trigger a rolling update and watch; the old pod should terminate before the new one starts.
- **State survives a delete.** Delete the pod and confirm the replacement resumes from the recorded sequence.
- **Freshness gates liveness.** Pause the loop artificially and confirm the probe fails and the pod restarts.
- **Termination is graceful.** Delete the pod mid-apply and confirm the diff completes before exit.
- **Startup does not thrash.** On an empty volume, confirm the initial catch-up completes without restart loops.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Duplicate or skipped diffs | Deployment rolling two pods together | Use a StatefulSet with one replica |
| State lost on reschedule | `emptyDir` or a shared claim | Use `volumeClaimTemplates` |
| Marker disagrees with the database | Pod killed mid-apply | Raise `terminationGracePeriodSeconds`, handle `SIGTERM` |
| Pod healthy while data is stale | Liveness probing the process | Probe a freshness endpoint instead |
| Restart loop on first deploy | No startup probe during catch-up | Add a `startupProbe` with a long threshold |
| Random restarts under load | CPU limit throttling the apply | Remove the CPU limit; keep the memory limit |
| Unexpected version after a restart | Mutable image tag | Pin by digest or a dated tag |

## Specification reference

> A StatefulSet maintains at most one pod with a given identity at any time. Unlike a Deployment, the controller will not create a replacement pod until the previous one is confirmed terminated; when a node becomes unreachable, the pod is not deleted until the node object is removed or the pod is force-deleted. Volumes provisioned from `volumeClaimTemplates` are bound to the pod identity and reattached on reschedule. See the Kubernetes StatefulSet documentation, and the pod-lifecycle documentation for termination and probe semantics.

## Frequently Asked Questions

<details>
<summary>Would a CronJob be simpler than a long-running loop?</summary>

It looks simpler and it is not. A CronJob gives no mutual exclusion — a run that overshoots its schedule overlaps the next one unless `concurrencyPolicy: Forbid` is set, and even then the semantics around missed schedules and a stuck job need care. A long-running loop with an internal interval makes the exclusion structural rather than configured, and the StatefulSet supplies the at-most-one guarantee the CronJob would need to be told about.
</details>

<details>
<summary>What about force-deleting a pod on an unreachable node?</summary>

Only when you have independently confirmed the original is not writing — by checking the database's connection list, or by confirming the node is genuinely powered off. Force deletion tells Kubernetes to stop waiting for confirmation, which is exactly the guarantee protecting the database. Doing it reflexively to clear a stuck pod is how two loops end up running, and the symptom is a corrupted sequence rather than an error message.
</details>

<details>
<summary>How large should the persistent volume be?</summary>

Large enough for the working extract plus several times the largest diff, plus headroom for `osmium` temporary files during an apply, which can approach the size of the file being rewritten. Undersizing produces a failure mid-apply that looks like corruption, and disk is cheap relative to the diagnosis. Alerting on volume utilisation is worth more here than in most workloads because the failure is destructive rather than merely inconvenient.
</details>

<details>
<summary>Should the database run in the same cluster?</summary>

It can, but the replication loop should not assume it. The loop's correctness depends on its own state volume and the database's transactional guarantees, not on their co-location, and keeping them independent means a cluster upgrade affects availability rather than consistency. What does matter is that the loop's sequence marker and the database write land in the same transaction where possible, which is a database-side design question rather than a Kubernetes one.
</details>

## Related

- [Building a Minutely Update Pipeline](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/) — the parent topic and the loop itself.
- [Replication Monitoring & Lag Alerting](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-monitoring-and-lag-alerting/) — what the freshness endpoint should expose.
- [Replication Sequence Numbers & State Tracking](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/) — the marker on the persistent volume.
- [Pinning a Reproducible OSM Snapshot by Sequence Number](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/pinning-a-reproducible-osm-snapshot-by-sequence-number/) — naming the state the loop has reached.
- [Incremental Updates for Derived Datasets](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/) — the consumers that run alongside this one.

Up one level: [Building a Minutely Update Pipeline](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Running OSM Diff Sync on Kubernetes with a StatefulSet",
  "description": "Deploy a minutely replication loop as a single-replica StatefulSet so the sequence state, the working disk and the mutual exclusion all survive a restart and never run twice at once.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Replication & Diff Sync",
  "about": ["Kubernetes StatefulSet", "diff sync deployment", "single writer"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Replication & Diff Sync", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/" },
    { "@type": "ListItem", "position": 3, "name": "Building a Minutely Update Pipeline", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/" },
    { "@type": "ListItem", "position": 4, "name": "Running OSM Diff Sync on Kubernetes with a StatefulSet", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/running-osm-diff-sync-on-kubernetes-with-a-statefulset/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Deploy an OSM diff-sync loop on Kubernetes",
  "description": "Run the replication loop as a single-replica StatefulSet with a bound persistent volume, a long termination grace period, and probes that measure data freshness rather than process existence.",
  "step": [
    { "@type": "HowToStep", "name": "Use a single-replica StatefulSet", "text": "Choose the controller that guarantees at most one pod, since two loops writing one database is corruption." },
    { "@type": "HowToStep", "name": "Bind storage with volumeClaimTemplates", "text": "Attach the same volume to the pod identity so a reschedule resumes from the recorded sequence." },
    { "@type": "HowToStep", "name": "Set a long grace period", "text": "Allow the in-flight diff to complete before exit, so the marker and database never disagree." },
    { "@type": "HowToStep", "name": "Handle SIGTERM in the loop", "text": "Stop accepting new diffs on signal, finish the current one, write the marker and exit zero." },
    { "@type": "HowToStep", "name": "Probe data freshness", "text": "Expose an endpoint reporting the age of the last applied diff and wire liveness to it." },
    { "@type": "HowToStep", "name": "Add a startup probe", "text": "Allow a long initial catch-up without the liveness probe restarting the pod repeatedly." },
    { "@type": "HowToStep", "name": "Avoid a CPU limit", "text": "Keep the memory limit but omit the CPU limit, since throttling during an apply triggers false restarts." }
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
      "name": "Would a Kubernetes CronJob be simpler than a long-running diff-sync loop?",
      "acceptedAnswer": { "@type": "Answer", "text": "It looks simpler and is not. A CronJob gives no mutual exclusion unless concurrencyPolicy is Forbid, and even then missed-schedule and stuck-job semantics need care. A long-running loop makes exclusion structural, and the StatefulSet supplies the at-most-one guarantee." }
    },
    {
      "@type": "Question",
      "name": "Is it safe to force-delete a diff-sync pod on an unreachable node?",
      "acceptedAnswer": { "@type": "Answer", "text": "Only after independently confirming the original is not writing, by checking the database's connections or confirming the node is powered off. Force deletion removes exactly the guarantee protecting the database, and doing it reflexively is how two loops end up running." }
    },
    {
      "@type": "Question",
      "name": "How large should the replication state volume be?",
      "acceptedAnswer": { "@type": "Answer", "text": "Enough for the working extract plus several times the largest diff, plus headroom for osmium temporary files, which can approach the size of the file being rewritten. Undersizing produces a mid-apply failure that resembles corruption." }
    },
    {
      "@type": "Question",
      "name": "Should the OSM database run in the same Kubernetes cluster?",
      "acceptedAnswer": { "@type": "Answer", "text": "It can, but the loop should not assume it. Correctness depends on the state volume and the database's transactional guarantees, not co-location, so keeping them independent means a cluster upgrade affects availability rather than consistency." }
    }
  ]
}
</script>
