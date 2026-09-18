---
title: "Running OSM Validation in GitHub Actions"
description: "Wire OSM quality checks into CI so every change is validated against a fixture on a pull request and against real data on a schedule, without either job taking an hour."
pageTitle: "OSM Data Validation as a GitHub Actions Workflow"
pageDescription: "Two jobs, one workflow: a fast fixture-based check on every pull request and a scheduled run against a real extract, with caching, artifacts and a summary somebody reads."
slug: running-osm-validation-in-github-actions
type: article
breadcrumb: "Validation in CI"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Running OSM Validation in GitHub Actions

A validation suite that only runs on somebody's laptop protects nothing, and one that downloads a continental extract on every pull request protects nothing either because it will be turned off within a fortnight.

## Prerequisites

- [ ] A repository with the validation rules, per [Writing Custom OSM Validation Rules in Python](https://www.osm-data-processing.org/osm-data-quality-validation/writing-custom-osm-validation-rules-in-python/).
- [ ] A small committed fixture extract — a city, not a country — under a few megabytes.
- [ ] The check ordering from [Continuous QA for OSM Pipelines](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/).
- [ ] A runner with enough disk for the scheduled job's extract, which the default runner often lacks.
- [ ] Somewhere to keep metric history between runs, since relative checks need it.

## Conceptual minimum

The workflow splits along a single axis: **what runs on every change, and what runs against real data**.

The pull-request job answers "did this change break the checks?". It runs against a committed fixture, takes under two minutes, and blocks the merge. Its correctness depends on the fixture being representative enough to exercise the rules — which means a fixture chosen for its awkwardness, containing the multipolygon with a missing role and the relation that nests, rather than a tidy city centre.

The scheduled job answers "is the real data still healthy?". It runs against an actual extract, takes as long as it takes, and does not block anything because there is nothing to block. Its output is a report and, on failure, an issue or an alert.

Two mechanics make both affordable. **Caching** the downloaded extract keyed on the upstream file's date avoids re-downloading unchanged inputs, which on a several-gigabyte file is most of the job's runtime. **Artifacts** carry the metrics document out of the run so the next scheduled execution can compare against it, which is the cheapest available history store for a pipeline that does not have a database to hand.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="gha1-t gha1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="gha1-t">Two jobs, two questions, two very different budgets</title>
  <desc id="gha1-d">Two panels. The pull-request job runs on every change against a small committed fixture, completes in under two minutes, blocks the merge when it fails, and answers whether the change broke the rules. Its weakness is that a fixture cannot show real data volumes or genuine upstream surprises. The scheduled job runs daily against a real extract, takes tens of minutes, blocks nothing because there is nothing to block, and answers whether the real data is still healthy. Its output is a report and, on failure, an issue with the metrics attached.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Pull request versus schedule</text>
  <rect x="26" y="52" width="401" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="226" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">On pull request</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Committed fixture, small</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Under two minutes</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Blocks the merge</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Cannot see real volumes</text>
  <rect x="453" y="52" width="401" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="654" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">On a schedule</text>
  <text x="467" y="104" font-size="10.5" fill="currentColor" opacity="0.92">A real extract</text>
  <text x="467" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Tens of minutes</text>
  <text x="467" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Blocks nothing</text>
  <text x="467" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Opens an issue on failure</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Running the second on every pull request is the usual mistake, and the usual outcome is that somebody removes the workflow.</text>
</svg>
<figcaption>Each job is cheap for its own question and unaffordable for the other one's.</figcaption>
</figure>

## Runnable solution

{% raw %}
```yaml
name: osm-validation

on:
  pull_request:
  schedule:
    - cron: "17 4 * * *"     # off the hour: shared runners are busiest at :00
  workflow_dispatch:

permissions:
  contents: read
  issues: write              # only the scheduled job needs this

jobs:
  fixture:
    name: Rules against the committed fixture
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
          cache: pip
      - run: pip install -r requirements-dev.txt
      - name: Structural and rule checks
        run: |
          python -m osmqa.validate \
            --input tests/fixtures/awkward-city.osm.pbf \
            --rules rules/ \
            --metrics-out fixture-metrics.json \
            --fail-on structural,rules
      - name: Summarise
        if: always()
        run: python -m osmqa.summarise fixture-metrics.json >> "$GITHUB_STEP_SUMMARY"

  real-data:
    name: Statistical checks against a real extract
    if: github.event_name != 'pull_request'
    runs-on: ubuntu-latest
    timeout-minutes: 90
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12", cache: pip }
      - run: pip install -r requirements-dev.txt

      - name: Resolve the upstream extract date
        id: upstream
        run: |
          date=$(curl -sI "$EXTRACT_URL" | awk 'tolower($1)=="last-modified:"{print $4$3$5}')
          echo "date=${date:-unknown}" >> "$GITHUB_OUTPUT"
        env:
          EXTRACT_URL: ${{ vars.EXTRACT_URL }}

      # Key on the upstream date, not on a run number: an unchanged extract
      # is the common case and re-downloading it is most of this job.
      - name: Cache the extract
        id: cache
        uses: actions/cache@v4
        with:
          path: data/extract.osm.pbf
          key: extract-${{ steps.upstream.outputs.date }}

      - name: Download if the cache missed
        if: steps.cache.outputs.cache-hit != 'true'
        run: |
          mkdir -p data
          curl -fsSL --retry 3 -o data/extract.osm.pbf "$EXTRACT_URL"
        env:
          EXTRACT_URL: ${{ vars.EXTRACT_URL }}

      # Metric history lives in artifacts: the cheapest store available to a
      # pipeline with no database of its own.
      - name: Restore previous metrics
        uses: actions/download-artifact@v4
        continue-on-error: true
        with: { name: osm-metrics, path: history }

      - name: Validate
        id: validate
        run: |
          python -m osmqa.validate \
            --input data/extract.osm.pbf \
            --rules rules/ \
            --history history/metrics.json \
            --metrics-out metrics.json \
            --report-out report.md \
            --fail-on structural,critical

      - name: Publish the report
        if: always()
        run: cat report.md >> "$GITHUB_STEP_SUMMARY"

      # Only record history from a PASSING run. Metrics from a degraded run
      # teach the rolling band that the degradation is normal.
      - name: Record metrics as history
        if: success()
        uses: actions/upload-artifact@v4
        with:
          name: osm-metrics
          path: metrics.json
          retention-days: 90
          overwrite: true

      - name: Open an issue on failure
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            const body = require('fs').readFileSync('report.md', 'utf8');
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: `OSM validation failed (run ${context.runNumber})`,
              body,
              labels: ['osm-quality'],
            });
```
{% endraw %}

## Step-by-step walkthrough

1. **Separate the two jobs by trigger.** The `if: github.event_name != 'pull_request'` guard is what keeps a pull request from waiting on a continental download.
2. **Commit an awkward fixture.** A tidy extract passes everything; the useful fixture contains the cases the rules exist for, and it belongs in version control beside them.
3. **Key the cache on the upstream file's date.** Keying on a run identifier never hits; keying on the date hits on every run where the extract has not changed, which is most of them.
4. **Fail the fixture job on rule failures.** This is the part that blocks a merge, and it should be strict because it runs against data you control.
5. **Fail the real-data job only on structural and critical checks.** A statistical wobble in real data on a Tuesday is not a reason to open an incident.
6. **Restore history with `continue-on-error`.** The first run has no previous artifact, and a workflow that fails on its own first execution gets deleted.
7. **Record history only from passing runs.** Otherwise a degraded run establishes the degradation as the new normal, which defeats the entire relative-check layer.
8. **Write to the step summary.** A report nobody has to click through to is read considerably more often than one they do.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="gha2-t gha2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="gha2-t">Why the cache key must come from upstream rather than from the run</title>
  <desc id="gha2-d">Four steps. The workflow issues a HEAD request against the extract URL and reads the Last-Modified header, which identifies the upstream file rather than this execution. That value becomes the cache key, so every run against an unchanged extract resolves to the same key. On a hit, the download step is skipped entirely and the job proceeds straight to validation, saving what is usually the great majority of its runtime. On a miss, meaning the provider has published a new extract, the file is downloaded once and cached under the new key for every subsequent run that day.</desc>
  <defs><marker id="gha2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Cache keyed on the upstream file</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">HEAD upstream</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">read Last-Modified</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">identifies the file</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#gha2-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">form the key</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">unchanged means same key</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">not the run number</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#gha2-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">hit: skip download</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">most runs</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">most of the runtime</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#gha2-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">miss: fetch once</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">a new extract</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">cached for the rest</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Keying on a run number or a commit hash produces a cache that never hits and a job that downloads several gigabytes every night.</text>
</svg>
<figcaption>The whole saving comes from the key naming the input rather than the execution.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 434" role="img" aria-labelledby="gha3-t gha3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="gha3-t">Seven workflow decisions and what each one is protecting against</title>
  <desc id="gha3-d">A grid of seven workflow choices against what each protects and the consequence of the obvious alternative. Splitting jobs by trigger protects pull-request latency, where running everything everywhere leads to the workflow being removed. An awkward fixture protects rule coverage, where a tidy extract passes every rule regardless. An upstream-derived cache key protects runtime, where a run-scoped key never hits. Strict failure on the fixture protects the merge gate. Lenient failure on real data protects against nightly false alarms. Tolerant history restore protects the first execution. Uploading history only on success protects the baseline from degradation.</desc>
  <rect x="0" y="0" width="880" height="434" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Decision, protection, alternative</text>
  <rect x="204" y="48" width="325" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="366" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Protects</text>
  <rect x="529" y="48" width="325" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="692" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">The alternative costs</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Split by trigger</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="366" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">pull request latency</text>
  <text x="692" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">the workflow gets removed</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Awkward fixture</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="366" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">rule coverage</text>
  <text x="692" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">everything passes anyway</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Upstream cache key</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="366" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">job runtime</text>
  <text x="692" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a cache that never hits</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Strict on fixture</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="366" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">the merge gate</text>
  <text x="692" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">regressions merge</text>
  <text x="30" y="289" font-size="11.5" font-weight="600" fill="currentColor">Lenient on real data</text>
  <line x1="26" y1="308" x2="854" y2="308" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="366" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">trust in alerts</text>
  <text x="692" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">nightly false alarms</text>
  <text x="30" y="335" font-size="11.5" font-weight="600" fill="currentColor">Tolerant restore</text>
  <line x1="26" y1="354" x2="854" y2="354" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="366" y="335" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">the first run</text>
  <text x="692" y="335" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a workflow born failing</text>
  <text x="30" y="381" font-size="11.5" font-weight="600" fill="currentColor">History on success</text>
  <line x1="26" y1="400" x2="854" y2="400" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="366" y="381" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">the baseline</text>
  <text x="692" y="381" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">degradation normalised</text>
  <text x="868" y="418" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The last row is the quietest: nothing fails, the band simply widens around whatever the pipeline is producing now.</text>
</svg>
<figcaption>Each row is one line of YAML and one specific way the workflow stops being useful.</figcaption>
</figure>

## Verification

- **A broken rule fails the pull request.** Introduce a deliberate rule failure and confirm the merge is blocked.
- **The cache hits.** Run the scheduled job twice without an upstream change and confirm the second skips the download.
- **History is compared.** Confirm the second scheduled run reports deltas against the first.
- **A failing run does not poison history.** Force a failure and confirm no artifact is uploaded.
- **The summary is readable.** Open the run's summary page and confirm the report renders without needing an artifact download.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Pull requests take forty minutes | Real-data job running on every PR | Guard it with an event-name condition |
| Cache never hits | Key derived from the run or the commit | Key on the upstream file's date or ETag |
| First run of the workflow fails | Download of a history artifact that does not exist | Add `continue-on-error` to the restore |
| Thresholds drift toward degradation | History recorded from failing runs | Upload the artifact only on success |
| Runner runs out of disk | Default runner too small for the extract | Use a larger runner or clip the extract first |
| Nobody sees failures | Report only in an artifact | Write it to the step summary and open an issue |
| Scheduled job queues for an hour | Cron set on the hour | Offset the schedule off the hour |

## Specification reference

> `actions/cache` restores an entry whose key matches exactly, falling back to `restore-keys` prefixes when no exact match exists; a cache entry is immutable once written under a key. Workflow runs triggered by `schedule` use the default branch's workflow file. Writing to the file named by `GITHUB_STEP_SUMMARY` renders Markdown on the run's summary page. See the GitHub Actions documentation for caching, events that trigger workflows, and job summaries.

## Frequently Asked Questions

<details>
<summary>Should the extract be committed rather than downloaded?</summary>

Only the fixture, and only if it is small. A few megabytes of PBF in the repository is a reasonable price for a deterministic, offline, always-available test input, and it makes the pull-request job independent of any network. A real extract is far too large to commit and is the wrong input for the pull-request job anyway, since its content changes underneath you and a failure could mean either a code regression or an upstream change.
</details>

<details>
<summary>Are artifacts really a sensible place to keep metric history?</summary>

For a pipeline with nowhere better, yes, with two caveats: retention is finite, so a ninety-day window is the most history you get, and overwriting a named artifact loses the series rather than keeping it. If you need longer history or trend analysis, write metrics to a small table or an object store instead. The artifact approach is the version that works today without provisioning anything, which is often the difference between having history and not.
</details>

<details>
<summary>How do you stop the scheduled job from being disabled for inactivity?</summary>

GitHub disables scheduled workflows in repositories with no activity for sixty days, which for a stable pipeline is entirely plausible. The reliable answers are either a repository that sees regular commits anyway, or triggering the run from an external scheduler through `workflow_dispatch` rather than relying on `schedule`. Discovering the silent disablement during an incident is a memorable way to learn this.
</details>

<details>
<summary>Should validation run before or after the pipeline's own build?</summary>

After, against the output, because that is what consumers read. Validating the input as well is worth doing and belongs in the same workflow as an earlier step, so a truncated extract fails in ten seconds rather than after the processing. What does not work is validating only the input and assuming the pipeline preserved its quality, which is precisely the assumption a parser regression violates.
</details>

## Related

- [Continuous QA for OSM Pipelines](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/) — the parent topic.
- [Setting Quality Thresholds That Fail a Build](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/setting-quality-thresholds-that-fail-a-build/) — what `--fail-on critical` actually evaluates.
- [Generating an OSM Data Quality Report](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/generating-an-osm-data-quality-report/) — what goes into the step summary.
- [Writing Custom OSM Validation Rules in Python](https://www.osm-data-processing.org/osm-data-quality-validation/writing-custom-osm-validation-rules-in-python/) — the rules the fixture job runs.
- [Mirroring OSM Downloads Behind a Local Cache](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-download-strategy/mirroring-osm-downloads-behind-a-local-cache/) — a better source than the public provider for repeated CI downloads.

Up one level: [Continuous QA for OSM Pipelines](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Running OSM Validation in GitHub Actions",
  "description": "Wire OSM quality checks into CI so every change is validated against a fixture on a pull request and against real data on a schedule, without either job taking an hour.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Data Quality & Validation",
  "about": ["GitHub Actions", "continuous integration", "OSM validation"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Quality & Validation", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/" },
    { "@type": "ListItem", "position": 3, "name": "Continuous QA for OSM Pipelines", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/" },
    { "@type": "ListItem", "position": 4, "name": "Running OSM Validation in GitHub Actions", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/running-osm-validation-in-github-actions/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Run OSM validation in GitHub Actions",
  "description": "Split the workflow into a fast fixture check that blocks pull requests and a scheduled run against a real extract, cached on the upstream file's date and comparing against metrics kept as artifacts.",
  "step": [
    { "@type": "HowToStep", "name": "Split the jobs by trigger", "text": "Guard the real-data job so pull requests never wait on a large download." },
    { "@type": "HowToStep", "name": "Commit an awkward fixture", "text": "Keep a small extract containing the cases the rules exist for, beside the rules themselves." },
    { "@type": "HowToStep", "name": "Cache on the upstream date", "text": "Derive the cache key from the extract's Last-Modified header so unchanged inputs are not re-downloaded." },
    { "@type": "HowToStep", "name": "Fail the fixture job strictly", "text": "Block the merge on any rule or structural failure, since the input is under your control." },
    { "@type": "HowToStep", "name": "Restore history tolerantly", "text": "Allow the metrics artifact download to fail so the first execution of the workflow succeeds." },
    { "@type": "HowToStep", "name": "Record history only on success", "text": "Upload metrics only from a passing run so a degraded run cannot become the new baseline." },
    { "@type": "HowToStep", "name": "Write to the step summary", "text": "Render the report on the run page and open an issue on failure, rather than leaving it in an artifact." }
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
      "name": "Should the OSM extract be committed rather than downloaded in CI?",
      "acceptedAnswer": { "@type": "Answer", "text": "Only the fixture, and only if it is small. A few megabytes of PBF in the repository buys a deterministic, offline test input. A real extract is far too large and is the wrong input for a pull request anyway, since its content changes underneath you and a failure becomes ambiguous." }
    },
    {
      "@type": "Question",
      "name": "Are CI artifacts a sensible place to keep OSM metric history?",
      "acceptedAnswer": { "@type": "Answer", "text": "For a pipeline with nowhere better, yes, with caveats: retention is finite and overwriting a named artifact loses the series. For longer history or trend analysis, write metrics to a small table or object store. The artifact approach works today without provisioning anything." }
    },
    {
      "@type": "Question",
      "name": "How do you stop a scheduled validation workflow being disabled for inactivity?",
      "acceptedAnswer": { "@type": "Answer", "text": "GitHub disables scheduled workflows in repositories inactive for sixty days, which a stable pipeline easily reaches. The reliable answers are a repository that sees regular commits anyway, or triggering via workflow_dispatch from an external scheduler rather than relying on schedule." }
    },
    {
      "@type": "Question",
      "name": "Should validation run before or after the pipeline's build?",
      "acceptedAnswer": { "@type": "Answer", "text": "After, against the output, because that is what consumers read. Validating the input too is worth doing as an earlier step so a truncated extract fails in seconds. What fails is validating only the input and assuming the pipeline preserved its quality." }
    }
  ]
}
</script>
