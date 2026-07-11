# Fencepost SEO Command Center — Pipeline Overview

A CLI pipeline that takes a client intake PDF and produces a keyword research
workbook and content calendar as a multi-tab Excel workbook. Runs in Claude Code
via Ahrefs MCP. Ports to Next.js + Supabase + Ahrefs API later.

---

## Pipeline at a glance

```
Phase 1 — Intake & seed discovery     → data/clients/[slug]/
Phase 2 — Ahrefs keyword fetching     → data/clients/[slug]/keywords/
Phase 3 — Filter, cluster, dedupe     → data/clients/[slug]/clusters/
Phase 4 — Content plan generation     → data/clients/[slug]/content-plan/
Phase 5 — Excel workbook output       → reports/[slug]/
```

Never skip phases. Never run a phase if the previous phase QA failed.

---

## Folder map

```
data/
  raw/
    [client-slug]-intake.pdf          ← required upload
    [client-slug]-guidelines.pdf      ← optional upload
  processed/
    [client-slug]-intake.md
    [client-slug]-guidelines.md       ← only if guidelines PDF uploaded
  clients/[slug]/
    intake.json
    seeds.json
    competitors.json
    content-guidelines.json
    existing-pages.json            ← Phase 2 Job C (site audit)
    phase1-qa.json
    phase5-qa.json
    token-log.json
    keywords/
      keywords-seeds-raw.json
      keywords-competitors-raw.json
      keywords-raw-merged.json
    clusters/
      [cluster-slug].json
      [cluster-slug-2].json
      ...
    content-plan/
      content-plan.json
reports/[slug]/
  [client-slug]-keywords-content-calendar.xlsx   ← client deliverable (multi-tab)
  content-calendar.csv                    ← intermediate QA file only
```

---

## Phase 1 — Client Intake & Seed Discovery

### Inputs

| File | Status |
|---|---|
| `data/raw/[slug]-intake.pdf` | Required |
| `data/raw/[slug]-guidelines.pdf` | Optional |

### Steps

**Step 1.0 — PDF to markdown pre-processor**
Converts both PDFs to clean markdown. Strips noise (page numbers, footers,
formatting artifacts). Reduces token usage ~50%.

Reads: `data/raw/[slug]-intake.pdf` (+ guidelines if present)
Writes: `data/processed/[slug]-intake.md` (+ `[slug]-guidelines.md`)

**Step 1.1 — Intake parser (Claude)**
Prompt: `prompts/intake-parser.md`
Reads: `data/processed/[slug]-intake.md`
Writes: `data/clients/[slug]/intake.json`

Schema: `client_slug`, `business_name`, `website_url`, `primary_location`,
`service_areas`, `services`, `competitors`, `target_audience`, `goals`,
`client_keywords`, `missing_fields`

**Step 1.2 — Seed extractor (Claude)**
Prompt: `prompts/seed-extractor.md`
Reads: `data/clients/[slug]/intake.json`
Writes: `data/clients/[slug]/seeds.json`

Generates 6–8 seeds per service. Primary city only — city expansion happens
in Phase 2 via Ahrefs. Always includes: primary city variant, near-me variant,
cost/BOFU variant, company-type variant.

**Step 1.3 — Competitor resolver (Claude)**
Prompt: `prompts/competitor-resolver.md`
Reads: `data/clients/[slug]/intake.json` + `seeds.json`
Writes: `data/clients/[slug]/competitors.json`

If client named 3+ competitors: use as-is.
If client named 2: use both, log warning.
If client named 0–1: trigger web search fallback using primary seed keyword.
Excludes directories: yelp.com, angi.com, homeadvisor.com, thumbtack.com,
bbb.org, facebook.com, houzz.com, porch.com, and similar aggregators.

**Step 1.4 — Content guidelines parser (Claude, optional)**
Prompt: `prompts/guidelines-parser.md`
Runs only if `data/processed/[slug]-guidelines.md` exists.
Writes: `data/clients/[slug]/content-guidelines.json`

Extracts: tone, brand voice, topics to avoid, CTA preferences, audience notes,
formatting preferences.

If no guidelines PDF was uploaded, still writes `content-guidelines.json`
with `has_guidelines: false` and all fields null — so Phase 4 always has
a predictable file to read.

### Phase 1 QA

```bash
node qa/phase1-check.js --client [slug]
```

Writes: `data/clients/[slug]/phase1-qa.json`

**Error-level — pipeline stops:**
- `business_name` is null or empty
- `website_url` is null or empty
- `services[]` is empty
- `competitors.total` is 0 after fallback attempt

**Warning-level — pipeline continues, logged:**
- `seeds_by_service` has a service key with 0 seeds
- `services_covered` in seeds.json doesn't match services in intake.json
- Any field in `missing_fields[]`
- `competitors.total` is less than 3
- `has_auto_derived: true`
- `primary_location.zip` is null
- `client_keywords` is empty array
- Seed count per service is below 4
- `has_guidelines: false`

Do not proceed to Phase 2 if `ready_for_phase_2: false`.

---

## Phase 2 — Ahrefs Keyword Fetching

**Driver:** Claude via Ahrefs MCP — no scripts, agent calls MCP tools directly.

### Inputs

- `data/clients/[slug]/seeds.json`
- `data/clients/[slug]/competitors.json`

### Three jobs

**Job A — Seed expansion**
For each seed in `seeds.json`, call Ahrefs Keywords Explorer matching terms
and related terms. Tag all results: `source: "Matching Terms"`.

**Job B — Competitor gap**
For each domain in `competitors.json`, call Ahrefs Site Explorer organic
keywords. Tag all results: `source: "Content Gap"`.

**Job C — Client site audit**
Crawl the client's own website to build an inventory of existing pages. This
feeds the Phase 4 content audit (New vs Optimize) and the Phase 5 Keyword Map tab.

1. Try Ahrefs `site-explorer-top-pages` for the client domain.
2. If no data (small/new site): fetch `[website_url]/sitemap.xml` via WebFetch.
3. For each non-legal URL: fetch the page, extract `<title>`, meta description,
   `<h1>`, and which services are covered.

Writes: `data/clients/[slug]/existing-pages.json`

### Fields captured per keyword

`keyword`, `monthly_volume`, `kd`, `cpc`, `source`, `search_intent`,
`traffic_potential`

### Outputs

```
data/clients/[slug]/keywords/
  keywords-seeds-raw.json         ← Job A results
  keywords-competitors-raw.json   ← Job B results
  keywords-raw-merged.json        ← merged, Phase 3 reads this
data/clients/[slug]/
  existing-pages.json             ← Job C results (site audit)
```

Write raw first, then merge. Raw files are the audit trail — never overwrite.

### Phase 2 QA

- All three keyword files exist and are non-empty
- All seeds from seeds.json are represented in keywords-seeds-raw.json
- All competitor domains from competitors.json are represented in
  keywords-competitors-raw.json
- No merging errors (all records in merged file have required fields)
- `existing-pages.json` exists

---

## Phase 3 — Filter, Cluster, Dedupe

**Driver:** Claude — reads `keywords-raw-merged.json` only. Zero MCP calls.

### Input

`data/clients/[slug]/keywords/keywords-raw-merged.json`

### Jobs

1. Apply thresholds (min volume, KD ceiling, intent filter)
2. Cluster by topic — group semantically related keywords
3. Dedupe — remove exact and near-duplicate keywords across clusters
4. Name each cluster after the primary service or topic it represents

### Output

```
data/clients/[slug]/clusters/
  [cluster-slug].json
  [cluster-slug-2].json
  ...
```

Each cluster file contains the filtered keyword list for that topic, with
all fields from Phase 2 preserved.

### Phase 3 QA

- Every cluster has at least one keyword
- No keyword appears in more than one cluster
- Cluster slugs are lowercase and hyphenated
- All Phase 2 fields are present on every keyword record

---

## Phase 4 — Content Plan Generation

**Driver:** Claude — reads cluster files and intake. Zero MCP calls.

### Inputs

- `data/clients/[slug]/clusters/`
- `data/clients/[slug]/intake.json`
- `data/clients/[slug]/content-guidelines.json`

### Three jobs

**Job A — Blog posts (Claude-driven, one per cluster)**

| Field | Value |
|---|---|
| `status` | `Topic for Client Approval` |
| `due_date` | `null` — human fills in |
| `service_category` | Matched from intake.json services |
| `title` | Compelling, search-natural title |
| `type` | `Post – New` |
| `content_track` | `blog` |
| `primary_keyword` | Primary keyword from cluster |
| `volume` | From cluster data |
| `difficulty` | From cluster data |
| `angle` | 1–2 sentences: what the post is about + who it's for |
| `target_keywords` | 3–5 keywords, primary first |
| `gdoc_link` | `null` |
| `request_indexing_gsc` | `false` |

If `content-guidelines.json` has `has_guidelines: true`, apply brand voice
and avoid-list when writing the angle. If `has_guidelines: false`, write
angle generically.

**Job B — Location pages (logic-driven, no Claude)**

- Track 1: `[service]` + `[city]` → e.g. "AC Repair in Augusta, GA"
  (`type: "Page – New"`, `content_track: "location"`)
- Track 2: `[service variant]` + `[city]` → e.g. "Spray Foam Insulation
  Installers Augusta" (`type: "Page – New"`, `content_track: "service-location"`)

No angle or brief — title only. Notes field left null.

**Job C — Content audit (existing pages check)**

Before writing the final plan, load `existing-pages.json` and check each
proposed item against the client's existing URLs.

- Blog post: if primary keyword words (2+) match an existing URL slug → `page_status: "optimize"`
- Location page: if service slug + city both appear in an existing URL → `page_status: "optimize"`
- Otherwise → `page_status: "new"`

Every item gets both `page_status` and `existing_url` fields.

### Output

`data/clients/[slug]/content-plan/content-plan.json`

### Phase 4 QA

- Every cluster from Phase 3 has a corresponding blog row
- Every service × service_area combination has a location page row
- No row has a null title
- Every row has `page_status` ("new" or "optimize")
- Volume + KD present on all blog rows (warn if missing, don't block)

---

## Phase 5 — Excel Workbook Output

**Driver:** Claude + Python (openpyxl). Zero MCP calls.
**Requires:** `pip install openpyxl`

### Inputs

- `data/clients/[slug]/clusters/`
- `data/clients/[slug]/content-plan/content-plan.json`

### Deliverable

```
reports/[slug]/
  [client-slug]-keywords-content-calendar.xlsx   ← send this to the client
  content-calendar.csv                           ← intermediate file for QA script only
```

### Workbook tab structure

**Tab 1 — Content Calendar**
Columns: Type, Title, Service Category, Target Keyword, City, State, Priority,
Est. Words, Volume, KD, Cluster ID, Notes

Row order: blog posts first, then location pages.
Type column shows "Blog Post" or "Location Page — New" / "Location Page — Optimize"
based on the `page_status` field from Phase 4 Job C.
Color-coded by service (amber = generator, blue = panel, green = residential, purple = surge).

**Tab 2 — KW Summary**
Columns: Bucket, Topic Label, # Keywords, Total Search Volume, Avg Monthly Volume,
Avg KD, Avg CPC ($), % of Total

One row per cluster. Final row: TOTAL. CPC in dollars (divide Ahrefs cents by 100).

**Tab 3 — All Keywords**
Columns: Bucket, Keyword, Monthly Volume, KD, CPC ($), Source, Search Intent,
Traffic Potential

Every keyword from every cluster, flat list. Bucket column color-coded by service.

**Tab 4 — Keyword Map**
Columns: Existing URL, Proposed Keyword, Volume, KD, Suggested Meta Title,
Suggested Meta Description
One row per existing page with `include_in_keyword_map: true`.
Best keyword is scored by city match (+150pts), volume, and low KD.
Meta title target ≤60 chars. Meta description target ≤155 chars.

**Tabs 5+ — One tab per cluster**
Tab name = cluster slug (max 31 chars for Excel compatibility).
Columns: Keyword, Monthly Volume, KD, CPC ($), Search Intent, Traffic Potential, Source

### Phase 5 QA

```bash
node qa/phase5-check.js --client [slug]
```

Writes: `data/clients/[slug]/phase5-qa.json`

Cross-checks `content-calendar.csv` against both `intake.json` and
`content-plan.json` to confirm alignment before delivery.

**Error-level — fix before sending to client:**
- `content-calendar.csv` is missing from `reports/[slug]/`
- Row count in CSV doesn't match `content-plan.json` item count
- Any row has a blank Title
- A service from `intake.json` has zero rows in the calendar
- A title present in `content-plan.json` is absent from the CSV

**Warning-level — review, may be acceptable:**
- A service × service_area combination has no location page row
- A Service Category value doesn't match any service name in `intake.json`
- Blog post count doesn't match cluster count
- Blog rows are missing Volume or Difficulty

Manual checks (not scripted):
- KW Summary TOTAL row matches sum of individual cluster rows
- All cluster tabs present in the xlsx

Do not deliver to client if `passed: false`.

---

## General rules

### Naming
- Client slugs: lowercase, hyphenated (e.g. `waynes-air-experts`)
- No spaces or underscores in file names or slugs
- Date fields in JSON: ISO 8601 (`2025-07-01T09:00:00Z`)

### Claude API calls
- Always use `claude-sonnet-4-6`
- Always pass the relevant system prompt from `prompts/`
- Log token usage per call to `data/clients/[slug]/token-log.json`

### JSON output rules
- All JSON must be valid — validate before writing
- Use 2-space indentation
- Never write partial JSON — complete or nothing

### Error handling
- Error-level failures: stop and print the error clearly
- Warning-level issues: log and continue
- Always check if output file exists before running a step — ask to overwrite or skip

---

## Prompts reference

| Prompt | Used by | Purpose |
|---|---|---|
| `prompts/intake-parser.md` | Step 1.1 | Extract intake fields from markdown |
| `prompts/seed-extractor.md` | Step 1.2 | Generate service seed keywords |
| `prompts/competitor-resolver.md` | Step 1.3 | Evaluate and resolve competitor list |
| `prompts/guidelines-parser.md` | Step 1.4 | Extract brand voice and content rules |

---

## Dashboard migration (Next.js + Supabase)

This pipeline is now a native dashboard feature, not a standalone CLI. Ported:

| CLI | Dashboard |
|---|---|
| `data/clients/[slug]/` (one client's run) | one row in `keyword_pipeline_runs` (FK `master_client_id` → `master_clients.id` — NOT a new `clients` table; that name is already taken by a different existing table) |
| `intake.json`, `competitors.json`, `content-guidelines.json`, `existing-pages.json` | `jsonb` columns on `keyword_pipeline_runs` (`intake`, `competitors`, `content_guidelines`, `existing_pages`) |
| `seeds.json` | not persisted separately — generated on demand from `intake` jsonb, consumed immediately by the competitor/keyword steps |
| `clusters/*.json` | `keyword_pipeline_clusters` table (own table, not jsonb — keywords and content-plan items FK into it) |
| `keywords-raw-merged.json` | `keyword_pipeline_keywords` table, one row per keyword, `cluster_id` FK nullable until clustered |
| `content-plan.json` | `keyword_pipeline_content_plan_items` table, one row per blog post / location page |
| PDF pre-processor (Step 1.0) | **not needed** — intake/guidelines source from `master_clients.intake_form_link` / `content_guidelines_url` (Google Docs), fetched as plain text the same way `app/api/fetch-gdoc/route.ts` already does, no PDF anywhere |
| Intake parser | `app/api/keyword-pipeline/intake/route.ts` |
| Claude calls | OpenRouter (`OPENROUTER_API_KEY`), not a direct Anthropic key — matches `app/api/generate-page/route.ts` |
| Ahrefs MCP calls | Direct Ahrefs REST API v3 from `app/api/keyword-pipeline/keywords/route.ts` — needs `AHREFS_API_KEY` (not yet configured) |
| Competitor web-search fallback | no server-side equivalent yet — flagged gap, needs a real search API or a manual-entry UI escape hatch |
| Excel workbook (xlsx) | still a real downloadable `.xlsx` (not Google Sheets) — built server-side with `exceljs` in `app/api/keyword-pipeline/export/route.ts`, streamed back with `Content-Disposition: attachment` so it downloads straight to the user's machine |
| `prompts/*.md` | unchanged, live at `lib/keyword-pipeline/prompts/`, passed as system prompts from API routes |

Keep all business logic in prompts — not in route handlers.
