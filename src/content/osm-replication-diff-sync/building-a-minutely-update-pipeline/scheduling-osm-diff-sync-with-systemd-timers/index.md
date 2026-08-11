---
title: "Scheduling OSM Diff Sync with systemd Timers"
description: "Run the OSM minutely sync loop as a supervised systemd service and timer instead of cron: journald logging, Restart= failure isolation, and a lock that guarantees no overlapping runs."
pageTitle: "Schedule OSM Diff Sync with systemd Timers"
pageDescription: "A .service and .timer unit pair to run an OSM diff-sync loop on a Linux host — OnUnitActiveSec cadence, RuntimeMaxSec, journald logs, and flock so runs never overlap."
slug: scheduling-osm-diff-sync-with-systemd-timers
type: article
breadcrumb: "Scheduling with systemd"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# Scheduling OSM Diff Sync with systemd Timers

Run the minutely OSM sync loop reliably on a Linux host — restarted after reboots, logged to journald, isolated when it fails, and never running two overlapping copies at once — using a systemd service and timer pair instead of a cron line.

## Prerequisites

- [ ] A working sync loop entry point — the `serve()` function from [building a minutely update pipeline](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/) — installed at a known path.
- [ ] Python 3.10+ available in a virtualenv at `/opt/osm-sync/.venv`.
- [ ] `systemd` ≥ 240 (`systemctl --version`) for `RuntimeMaxSec=` and modern sandbox directives.
- [ ] Root or `sudo` to install unit files under `/etc/systemd/system/`.
- [ ] A dedicated unprivileged user (`osm`) that owns the extract, the checkpoint file, and the working directory.
- [ ] `util-linux` present for `flock` (it is on every mainstream distro).

## Conceptual minimum

A cron job answers only one question — *when* — and answers it badly for a long-running data task: it captures no structured logs, has no concept of a run that outlives its interval, restarts nothing when the host reboots, and cheerfully launches a second copy while the first is still working. systemd splits the job into two objects that each do one thing. A **service unit** (`.service`) describes *how* to run the process: which user, which working directory, what to do when it exits non-zero, how long it may run. A **timer unit** (`.timer`) describes *when* to activate that service, and — crucially — it is itself a supervised unit, so `systemctl` can tell you when it last fired and when it will fire next. Because the timer activates the service rather than forking a shell, every run inherits journald logging, cgroup accounting, and the restart policy for free. The relationship up to the loop it schedules is covered in the parent [minutely update pipeline](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/) guide; here the mechanism is the pairing itself.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 318" role="img" aria-labelledby="timer-vs-cron-t timer-vs-cron-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="timer-vs-cron-t">systemd timers against cron for a diff-sync job</title>
  <desc id="timer-vs-cron-d">A grid comparing cron and a systemd timer across five properties. Overlap prevention: cron has none and needs an external flock, while a systemd service is a unit that will not start twice. Missed runs after downtime: cron skips them silently, a timer with Persistent=true runs once on boot. Logging: cron mails output to a mailbox nobody reads, a timer writes to journald with the unit name. Failure visibility: cron exposes an exit code only, a timer exposes a failed state and can trigger OnFailure. Startup delay spread: cron has none, a timer has RandomizedDelaySec.</desc>
  <rect x="0" y="0" width="880" height="318" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">For a job that must never run twice, the unit model is the point</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">cron</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">systemd timer</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">overlapping runs</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">none — add flock yourself</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">unit will not start twice</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">missed runs after downtime</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">silently skipped</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">Persistent=true replays once</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">where output goes</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">mail to an unread mailbox</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">journald, tagged by unit</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">failure is visible as</text>
  <rect x="213" y="204" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">an exit code, if you look</text>
  <rect x="535" y="204" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">failed state + OnFailure=</text>
  <text x="198" y="264" text-anchor="end" font-size="11.5" fill="currentColor">thundering-herd control</text>
  <rect x="213" y="244" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">none</text>
  <rect x="535" y="244" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">RandomizedDelaySec=</text>
  <text x="440" y="300" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">None of this makes cron wrong for simple jobs — it makes it the wrong tool for one holding a checkpoint.</text>
</svg>
<figcaption>The decisive property for replication is the first one. A cron entry that fires every minute against a job that sometimes takes ninety seconds will eventually run two appliers against one state file.</figcaption>
</figure>

The one hazard a naive timer still leaves open is **overlap**. If a sync run occasionally takes longer than the interval — a large catch-up after an outage, say — the timer will start a second run while the first is mid-apply, and two processes writing the same base extract and checkpoint is exactly the corruption the pipeline's crash-safety was designed to prevent. The fix is a mutual-exclusion lock: wrap the loop in `flock` against a lockfile, and a second invocation exits immediately rather than racing the first. `Type=oneshot` with a timer, plus `flock`, gives a run-to-completion model with hard non-overlap.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 270" role="img" aria-label="How a systemd timer schedules the OSM diff-sync service. The timer unit fires on its OnUnitActiveSec cadence and activates the service unit. The service runs the sync script under an flock guard so that if a previous run still holds the lock the new invocation exits immediately with no overlap. The running script writes all output to journald, and on a non-zero exit the Restart policy relaunches it while a failed unit is isolated to its own status." style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit">
  <title>systemd timer activating a lock-guarded diff-sync service with journald logging</title>
  <desc>The timer fires on its cadence and activates the service. The service acquires an flock; if the lock is held by a prior run the new invocation exits with no overlap. The script logs to journald, and a non-zero exit triggers the Restart policy while the failure stays isolated to this unit.</desc>
  <defs>
    <marker id="sdt-arr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker>
  </defs>
  <rect x="0" y="0" width="900" height="270" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="450" y="26" text-anchor="middle" font-size="15" fill="currentColor" font-weight="700">Timer activates a lock-guarded service; the lock is what prevents overlap</text>
  <g transform="translate(0,-70)">
  <!-- timer -->
  <rect x="30" y="120" width="170" height="72" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="115" y="150" text-anchor="middle" font-size="13" fill="currentColor" font-weight="600">.timer unit</text>
  <text x="115" y="169" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">OnUnitActiveSec</text>
  <text x="115" y="184" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">= 60s</text>
  <!-- service -->
  <rect x="270" y="120" width="170" height="72" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="355" y="150" text-anchor="middle" font-size="13" fill="currentColor" font-weight="600">.service unit</text>
  <text x="355" y="169" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Type=oneshot</text>
  <text x="355" y="184" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">User=osm</text>
  <line x1="200" y1="156" x2="268" y2="156" stroke="currentColor" stroke-width="1.5" marker-end="url(#sdt-arr)"/>
  <text x="234" y="146" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">activates</text>
  <!-- flock -->
  <rect x="510" y="120" width="170" height="72" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="595" y="150" text-anchor="middle" font-size="13" fill="currentColor" font-weight="600">flock guard</text>
  <text x="595" y="169" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">sync.lock</text>
  <text x="595" y="184" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">--nonblock</text>
  <line x1="440" y1="156" x2="508" y2="156" stroke="currentColor" stroke-width="1.5" marker-end="url(#sdt-arr)"/>
  <!-- run -->
  <rect x="730" y="120" width="150" height="72" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="805" y="150" text-anchor="middle" font-size="13" fill="currentColor" font-weight="600">sync loop</text>
  <text x="805" y="169" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">run one cycle</text>
  <line x1="680" y1="156" x2="728" y2="156" stroke="currentColor" stroke-width="1.5" marker-end="url(#sdt-arr)"/>
  <text x="705" y="150" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.9">acquired</text>
  <!-- overlap-refused branch -->
  <path d="M595,192 V246" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 3" marker-end="url(#sdt-arr)"/>
  <rect x="510" y="248" width="170" height="52" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="595" y="272" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="600">Exit — no overlap</text>
  <text x="595" y="290" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">lock held by prior run</text>
  <text x="662" y="224" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">busy</text>
  <!-- journald -->
  <path d="M805,192 V246" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#sdt-arr)"/>
  <rect x="730" y="248" width="150" height="52" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="805" y="272" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="600">journald</text>
  <text x="805" y="290" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">journalctl -u</text>
  </g>
</svg>

## Runnable solution

Three files. The invoked script wraps the loop in a lock and logs to stdout (which journald captures); the service describes how to run it; the timer says when. Install the units under `/etc/systemd/system/`.

The wrapper script, `/opt/osm-sync/run-sync.sh`:

```bash
#!/usr/bin/env bash
# Run exactly one guarded sync process. flock ensures no overlap: if a prior
# run still holds the lock, --nonblock makes this invocation exit at once.
set -euo pipefail

LOCKFILE=/run/osm-sync/sync.lock
mkdir -p "$(dirname "$LOCKFILE")"

exec flock --nonblock "$LOCKFILE" \
    /opt/osm-sync/.venv/bin/python -m osm_sync.serve \
        --store /var/lib/osm-sync/checkpoint.json \
        --poll-seconds 60
```

The service unit, `/etc/systemd/system/osm-diff-sync.service`:

```ini
[Unit]
Description=OSM minutely diff sync (one guarded cycle batch)
Documentation=https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=osm
Group=osm
WorkingDirectory=/opt/osm-sync
ExecStart=/opt/osm-sync/run-sync.sh

# Failure isolation: retry a crashed run a few times, then stop and stay failed.
Restart=on-failure
RestartSec=30s
StartLimitIntervalSec=300
StartLimitBurst=4

# Do not let a wedged run block the next tick forever.
RuntimeMaxSec=50s

# journald captures stdout/stderr with this identifier.
StandardOutput=journal
StandardError=journal
SyslogIdentifier=osm-diff-sync

# Light sandboxing; the extract dir is the only writable path.
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/osm-sync /run/osm-sync
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

The timer unit, `/etc/systemd/system/osm-diff-sync.timer`:

```ini
[Unit]
Description=Fire the OSM diff-sync service every minute
Documentation=https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/

[Timer]
# First run 90s after boot, then 60s after each run *finishes* (not starts),
# so a slow run naturally spaces out the next rather than stacking up.
OnBootSec=90s
OnUnitActiveSec=60s
# Anchor to wall-clock minutes as an alternative cadence if you prefer:
# OnCalendar=*:*:00
AccuracySec=5s
Persistent=true
Unit=osm-diff-sync.service

[Install]
WantedBy=timers.target
```

Enable and start the timer (not the service — the timer owns the schedule):

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now osm-diff-sync.timer
```

## Step-by-step walkthrough

1. **`flock --nonblock` in the wrapper** is the non-overlap guarantee. The first run acquires `sync.lock`; while it holds the descriptor, any second invocation fails to acquire and — thanks to `--nonblock` — exits immediately instead of queuing. `exec` replaces the shell so the Python process inherits the lock for its whole lifetime.
2. **`Type=oneshot`** tells systemd the service runs to completion and exits, which is the right model for a timer-driven task: the unit is `active (exited)` between ticks, not a daemon systemd tries to keep alive.
3. **`Restart=on-failure` with `StartLimitBurst=4`** is failure isolation. A transient crash is retried up to four times in five minutes; a persistently failing run then lands in the `failed` state and stops retrying, so a genuine outage surfaces in `systemctl status` instead of spinning silently forever.
4. **`RuntimeMaxSec=50s`** caps a single activation just under the timer interval, so a wedged run is killed rather than blocking the host — the `flock` still prevents the next tick from overlapping the one being killed.
5. **`OnUnitActiveSec=60s`** measures the interval from when the previous activation *finished*, so runtimes and interval add up rather than colliding. `OnBootSec=90s` delays the first run until after the network is up. Swap in `OnCalendar=*:*:00` if you want runs anchored to wall-clock minute boundaries instead.
6. **`Persistent=true`** makes systemd run a missed activation immediately after boot if the host was down when a tick was due — the timer equivalent of `anacron`, so a rebooted host resumes syncing without waiting a full interval.
7. **`StandardOutput=journal` and `SyslogIdentifier`** route every log line the loop prints into journald under a searchable identifier, replacing cron's silent-or-emailed output with structured, queryable logs.
8. **`ProtectSystem=strict` plus `ReadWritePaths`** makes the whole filesystem read-only to the service except the checkpoint directory and the lock directory, so a bug or a compromised dependency cannot write outside the data dir.

## Verification

Confirm the schedule and a healthy run:

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="timer-verify-t timer-verify-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="timer-verify-t">Reading systemctl output to tell a healthy timer from three failure shapes</title>
  <desc id="timer-verify-d">A left-to-right chain of the four commands that answer whether the timer is working. list-timers shows NEXT and LAST; a LAST of n/a means the timer has never fired. status on the service shows the last exit; inactive dead with a zero exit is success, and failed shows the code. journalctl with the unit and since flags shows the run output. And a check on the state file modification time proves the run actually advanced the checkpoint rather than exiting early on the lock.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="tvf" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four commands, in this order, because each rules out a different failure</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">systemctl list-timers</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">NEXT and LAST columns</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">LAST = n/a → never fired</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#tvf)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">systemctl status</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">last exit code</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">failed → read the code</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#tvf)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">journalctl -u --since</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">the run output itself</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">lock contention shows here</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#tvf)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">stat the state file</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">mtime advancing?</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">if not, every run no-opped</text>
  <text x="440" y="158" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">A green timer and a stale state file is the combination to watch for — it is what a permanently held flock looks like from outside.</text>
</svg>
<figcaption>The last step is the one that catches the quiet failure: a timer that fires on schedule, a service that exits zero, and a lock that was held every single time, so nothing ever ran.</figcaption>
</figure>

- **The timer is armed.** `systemctl list-timers osm-diff-sync.timer` shows a `NEXT` firing time in the future and a recent `LAST`. If `NEXT` is blank, the timer is not enabled.
- **The service succeeds.** `systemctl status osm-diff-sync.service` reports `Active: inactive (dead)` between runs and `status=0/SUCCESS` for the last invocation. A oneshot that just finished shows `active (exited)` briefly.
- **Logs are flowing.** `journalctl -u osm-diff-sync.service -n 50 --no-pager` shows the loop's `applied seq …, lag …s` lines. `journalctl -u osm-diff-sync.service -f` follows them live.
- **Non-overlap holds.** Start two runs by hand — `sudo systemctl start osm-diff-sync.service` twice quickly — and the journal shows the second exiting without doing work because `flock` refused the lock.
- **Reboot recovery.** After `sudo reboot`, `list-timers` shows the timer re-armed and, with `Persistent=true`, a catch-up run fired shortly after boot.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Timer never fires | Enabled the `.service`, not the `.timer` | `systemctl enable --now osm-diff-sync.timer` |
| Two runs write the base at once | Missing or blocking lock | Use `flock --nonblock` in the wrapper as shown |
| `status=203/EXEC` | `ExecStart` script not executable | `chmod +x /opt/osm-sync/run-sync.sh` |
| Run killed at 50s every time | Catch-up backlog exceeds `RuntimeMaxSec` | Raise `RuntimeMaxSec`, or batch catch-up separately |
| `Read-only file system` writing checkpoint | Path not in `ReadWritePaths` | Add the checkpoint dir to `ReadWritePaths=` |
| Unit stuck in `failed`, no retries | Hit `StartLimitBurst` | `systemctl reset-failed osm-diff-sync.service` |
| No logs in journald | Output redirected elsewhere | Set `StandardOutput=journal`; reload the daemon |

## Specification reference

> A timer unit activates its paired service on the schedule declared in `[Timer]`. `OnUnitActiveSec=` fires relative to when the unit was last activated, `OnCalendar=` fires on wall-clock expressions, and `Persistent=true` runs a missed timer immediately after boot. Monotonic timers such as `OnBootSec=` and `OnUnitActiveSec=` are documented alongside calendar events in the official [systemd.timer manual](https://www.freedesktop.org/software/systemd/man/systemd.timer.html), and the service-side directives `Type=oneshot`, `Restart=`, and `RuntimeMaxSec=` in the [systemd.service manual](https://www.freedesktop.org/software/systemd/man/systemd.service.html).

## Frequently Asked Questions

<details>
<summary>Why use a systemd timer instead of a cron job for OSM diff sync?</summary>

A timer activates a service unit, so every run inherits journald logging, a restart policy, resource accounting, and a defined behaviour after reboot — none of which cron provides. You also get `systemctl list-timers` to see the last and next firing, and `Persistent=true` to catch up a missed run after downtime. cron only decides when to fork a shell and leaves logging, supervision, and overlap entirely to you.
</details>

<details>
<summary>How do I guarantee two sync runs never overlap?</summary>

Wrap the loop in `flock --nonblock` against a lockfile. The first run holds the lock for its whole lifetime because the shell `exec`s into the Python process; a second invocation that starts while the first is still running fails to acquire the lock and exits immediately. Combined with `OnUnitActiveSec=`, which measures the interval from when the previous run finished, this makes overlap impossible even when a run outlasts its interval.
</details>

<details>
<summary>What does Type=oneshot mean for a timer-driven sync?</summary>

It tells systemd the service runs to completion and exits, rather than being a long-lived daemon to keep alive. Between ticks the unit sits as inactive or active-exited, and the timer re-activates it each interval. This is the correct model for a task that does a bounded amount of work — apply the pending diffs — and then stops, as opposed to a resident process you would model with `Restart=always`.
</details>

<details>
<summary>How do I read and follow the sync logs?</summary>

Because the service sets `StandardOutput=journal` with a `SyslogIdentifier`, use `journalctl -u osm-diff-sync.service` to read the history, add `-f` to follow live, and `-n 50` to see the last fifty lines. Filter by time with `--since "10 min ago"`. Every line the sync loop prints — applied sequence, lag, back-off warnings — is captured there with no extra plumbing.
</details>

## Related

- [Building a Minutely Update Pipeline](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/) — the sync loop this service supervises, including its crash-safe checkpoint ordering.
- [Applying .osc Change Files with osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/) — the merge operation each scheduled run performs.
- [Replication Sequence Numbers and State](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/) — the sequence and state files the loop reads to decide what to fetch.
- [Catching Up a Stale OSM Extract with pyosmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/catching-up-a-stale-osm-extract-with-pyosmium/) — batching a large backlog before returning to per-minute cadence.
- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — isolating a bad diff so a scheduled run fails cleanly instead of corrupting state.

Up one level: [Building a Minutely Update Pipeline](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Scheduling OSM Diff Sync with systemd Timers",
  "description": "Run the OSM minutely sync loop as a supervised systemd service and timer instead of cron: journald logging, Restart= failure isolation, and a lock that guarantees no overlapping runs.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "OSM Replication & Diff Sync",
  "about": ["systemd timers", "OSM diff sync scheduling", "flock non-overlapping runs"]
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
    { "@type": "ListItem", "position": 4, "name": "Scheduling OSM Diff Sync with systemd Timers", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/scheduling-osm-diff-sync-with-systemd-timers/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Schedule an OSM diff-sync loop with a systemd service and timer",
  "description": "Install a lock-guarded wrapper script, a oneshot service unit, and a timer unit so an OSM minutely sync loop runs on a cadence with journald logging, failure isolation, and no overlapping runs.",
  "step": [
    { "@type": "HowToStep", "name": "Wrap the loop in a lock", "text": "Write a wrapper script that execs the sync loop under flock --nonblock so a second invocation exits immediately if a prior run still holds the lock." },
    { "@type": "HowToStep", "name": "Define the service unit", "text": "Create a Type=oneshot service with User=osm, Restart=on-failure, RuntimeMaxSec, and StandardOutput=journal so runs are isolated and logged." },
    { "@type": "HowToStep", "name": "Define the timer unit", "text": "Create a timer with OnBootSec, OnUnitActiveSec=60s, and Persistent=true so it fires on a cadence measured from when the last run finished and catches up after reboot." },
    { "@type": "HowToStep", "name": "Enable the timer", "text": "Run systemctl daemon-reload then systemctl enable --now on the timer, not the service, so the timer owns the schedule." },
    { "@type": "HowToStep", "name": "Verify the schedule", "text": "Check systemctl list-timers for the next firing, systemctl status for a clean last run, and journalctl -u to confirm logs are flowing." }
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
      "name": "Why use a systemd timer instead of a cron job for OSM diff sync?",
      "acceptedAnswer": { "@type": "Answer", "text": "A timer activates a service unit, so every run inherits journald logging, a restart policy, resource accounting, and a defined behaviour after reboot, none of which cron provides. You also get systemctl list-timers to see the last and next firing, and Persistent=true to catch up a missed run after downtime. cron only decides when to fork a shell and leaves logging, supervision, and overlap entirely to you." }
    },
    {
      "@type": "Question",
      "name": "How do I guarantee two sync runs never overlap?",
      "acceptedAnswer": { "@type": "Answer", "text": "Wrap the loop in flock --nonblock against a lockfile. The first run holds the lock for its whole lifetime because the shell execs into the Python process; a second invocation that starts while the first is still running fails to acquire the lock and exits immediately. Combined with OnUnitActiveSec, which measures the interval from when the previous run finished, this makes overlap impossible even when a run outlasts its interval." }
    },
    {
      "@type": "Question",
      "name": "What does Type=oneshot mean for a timer-driven sync?",
      "acceptedAnswer": { "@type": "Answer", "text": "It tells systemd the service runs to completion and exits, rather than being a long-lived daemon to keep alive. Between ticks the unit sits as inactive or active-exited, and the timer re-activates it each interval. This is the correct model for a task that does a bounded amount of work, apply the pending diffs, and then stops, as opposed to a resident process you would model with Restart=always." }
    },
    {
      "@type": "Question",
      "name": "How do I read and follow the sync logs?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because the service sets StandardOutput=journal with a SyslogIdentifier, use journalctl -u osm-diff-sync.service to read the history, add -f to follow live, and -n 50 to see the last fifty lines. Filter by time with --since. Every line the sync loop prints, applied sequence, lag, back-off warnings, is captured there with no extra plumbing." }
    }
  ]
}
</script>
