---
title: dbt Primer — Architect's Edition
summary: dbt as a SQL compiler, dependency graph and test runner — project shape, materialisations, testing, and the architecture-level calls above the syntax.
topic: data-engineering
format: primer
tags: [dbt, elt, jinja, warehouse, testing, lineage, semantic-layer]
updated: 2026-08-07
---

## Frame

This is a primer for someone who already knows SQL deeply, has done ETL/ELT with Python/Spark/PySpark, and now needs to be conversant in dbt-specific mechanics and architecture-level patterns. It is **not** a "your first dbt model" tutorial.

Three mental models to hold from the start:

1. **dbt is a SQL compiler + dependency graph + test runner.** It is not a database, not an orchestrator, not a transformation engine. It generates SQL and asks your warehouse to run it. Everything else about dbt makes more sense once that's clear.
2. **The dependency graph is the asset.** Whether you have 50 models or 5,000, the value is that dbt knows what feeds what — and uses that knowledge for compilation order, incremental refresh, lineage, impact analysis, and selective execution.
3. **dbt is ELT, not ETL.** The "T" happens in the warehouse, after the "EL." This is the architectural premise: warehouses (Snowflake / BigQuery / Databricks / Redshift) are now powerful enough that pulling data out to transform is wasteful.

---

## 1. What dbt is and what it isn't

| Is | Isn't |
|---|---|
| SQL + Jinja compiler | A database |
| Dependency graph manager | An orchestrator (use Airflow / Dagster / Prefect) |
| Test runner | A data-quality platform (use Great Expectations / Soda for richer cases) |
| Documentation generator | A data catalog (though it produces catalog feed) |
| A modelling framework | A modelling methodology (Kimball / DV / 3NF — your choice) |
| Open-source (dbt Core) + commercial (dbt Cloud) | Single-vendor |

The single most architecturally important property: dbt enforces that **every transformation is a SQL `SELECT` statement** stored in version control with declared dependencies. That single constraint is what produces all the lineage / test / impact-analysis goodness downstream.

---

## 2. The project shape

```
my_dbt_project/
├── dbt_project.yml              # project config — name, paths, default materialisations
├── profiles.yml                 # connection config (lives in ~/.dbt/, not in repo)
├── models/
│   ├── staging/                 # 1-to-1 source mirroring, light cleaning
│   │   ├── stg_s4_postings.sql
│   │   ├── stg_s4_postings.yml  # tests + docs colocated
│   │   └── _sources.yml         # declare upstream sources
│   ├── intermediate/            # reusable joins / aggregations
│   └── marts/                   # consumer-facing models
│       └── finance/
│           ├── fct_gl_postings.sql
│           └── dim_vendor.sql
├── seeds/                       # CSV files dbt loads as small tables (reference data)
├── snapshots/                   # SCD2 capture
├── macros/                      # Jinja macros + custom test definitions
├── tests/                       # singular tests (one-off assertions)
├── analyses/                    # ad-hoc SQL, not part of the DAG
└── packages.yml                 # external package dependencies
```

The convention everyone follows (and that an architect should enforce): **staging → intermediate → marts**, with the rule that staging models are 1-to-1 with sources and marts are 1-to-1 with consumer needs.

---

## 3. Materializations

The single most important `dbt_project.yml` decision. Four built-ins:

| Materialization | What dbt builds | When to use |
|---|---|---|
| `view` | A SQL view | Default for staging; cheap, always fresh, slow to query at scale |
| `table` | A full table, rebuilt every run | Default for marts; expensive to rebuild but fast to query |
| `incremental` | Initial full build + delta inserts/merges on subsequent runs | Large fact tables where full rebuild is too expensive |
| `ephemeral` | Inlined as a CTE into downstream models — no table or view created | Reusable intermediate logic that doesn't need to be queryable |

### Incremental — the one to get right
The pattern:
```sql
{{ config(materialized='incremental', unique_key='posting_id') }}

SELECT *
FROM {{ ref('stg_s4_postings') }}

{% if is_incremental() %}
  WHERE ingestion_ts > (SELECT MAX(ingestion_ts) FROM {{ this }})
{% endif %}
```

Two flavours:
- **`append`** — just insert new rows. Cheap. No deduplication.
- **`merge`** — upsert on `unique_key`. More expensive (warehouse MERGE), handles late-arriving updates.

Architecture-level question: **what's the unit of incremental?** Is it source rows arriving (append-only fact tables) or source rows changing (merge with unique key)? Get this wrong and you either lose updates or pay for unnecessary merges.

### Snowflake-specific materialisations
- **`dynamic_table`** — Snowflake's managed incremental compute. dbt 1.6+ supports it. Worth knowing about — moves the incremental machinery from dbt into Snowflake.

---

## 4. `ref()` and `source()` — the dependency graph

The two functions that make dbt work as a graph.

```sql
-- Reference another dbt model (creates a dependency edge)
SELECT * FROM {{ ref('stg_s4_postings') }}

-- Reference a raw source (table dbt doesn't create — landed by some upstream EL tool)
SELECT * FROM {{ source('s4_raw', 'acdoca') }}
```

Why this matters architecturally:
- dbt determines model execution order from these refs. Topological sort, no manual orchestration of "build A before B."
- The graph is the lineage. `dbt docs generate` produces the lineage view.
- Sources let you declare raw tables you didn't create — and run freshness checks against them.

### Source freshness
```yaml
# in _sources.yml
sources:
  - name: s4_raw
    tables:
      - name: acdoca
        loaded_at_field: ingestion_ts
        freshness:
          warn_after: {count: 6, period: hour}
          error_after: {count: 24, period: hour}
```
Run `dbt source freshness` — fails loudly if upstream data is stale. Architect-level signal: **detect upstream silence before downstream consumers do.**

---

## 5. Snapshots — SCD2 handling

dbt's first-class support for slowly-changing-dimension Type 2 capture. Define once, dbt does the close-out-current + insert-new pattern (covered in the SQL refresher §5).

```sql
{% snapshot vendor_snapshot %}

{{
  config(
    target_schema='snapshots',
    unique_key='vendor_id',
    strategy='check',
    check_cols=['name', 'vat_id', 'country_code'],
  )
}}

SELECT * FROM {{ source('s4_raw', 'lfa1') }}

{% endsnapshot %}
```

Two strategies:
- **`timestamp`** — capture when an `updated_at` column changes.
- **`check`** — capture when listed columns change (no `updated_at` needed; dbt computes the diff).

Output columns added by dbt: `dbt_valid_from`, `dbt_valid_to`, `dbt_scd_id` (hash key per version). Becomes your point-in-time join surface (see SQL refresher §5).

**Architect-level note:** dbt snapshots are simpler than full Data Vault satellites but they're the right answer for many SCD2 needs. Use snapshots when you don't need the full hub-link-satellite discipline; use AutomateDV when you do.

---

## 6. Tests — the discipline that makes dbt earn its keep

Two test categories:

### Generic tests (declarative, in YAML)
```yaml
models:
  - name: stg_s4_postings
    columns:
      - name: posting_id
        tests:
          - unique
          - not_null
      - name: account
        tests:
          - relationships:
              to: ref('dim_account')
              field: account_id
      - name: currency
        tests:
          - accepted_values:
              values: ['EUR', 'USD', 'GBP']
```
Four built-ins (`unique`, `not_null`, `accepted_values`, `relationships`) plus anything you add via packages.

### Singular tests (a SQL file that returns failing rows)
```sql
-- tests/balance_check.sql
SELECT account, SUM(amount) AS balance
FROM {{ ref('fct_gl_postings') }}
GROUP BY account
HAVING ABS(SUM(amount)) > 0.01
```
Convention: **a test passes if it returns zero rows.**

### `dbt-utils` adds essential generic tests
- `dbt_utils.unique_combination_of_columns` (composite uniqueness)
- `dbt_utils.expression_is_true`
- `dbt_utils.equal_rowcount`
- `dbt_utils.relationships_where`

### Architect-level framing
Tests in dbt are not unit tests — they're **production data assertions**. They run on every refresh, against real data. The architectural value: every model carries its data contract with it, in the same repo, reviewed in the same PR.

This is the answer to *"how do you ensure data quality at the warehouse layer?"* in an interview — and it maps directly to DMBOK's DQ dimensions (see DAMA guide §4).

---

## 7. Jinja and macros — the templating layer

Jinja is the template engine dbt uses to make SQL composable. Two architecturally important uses:

### Macros for reusable logic
```sql
-- macros/fiscal_period.sql
{% macro fiscal_period(date_col) %}
  TO_CHAR({{ date_col }}, 'YYYY-MM')
{% endmacro %}
```
Use in models:
```sql
SELECT {{ fiscal_period('posting_date') }} AS fiscal_period, ...
```

### `var()` and environment-aware logic
```sql
WHERE posting_date >= '{{ var("backfill_start_date", "2024-01-01") }}'
```
Override at runtime with `--vars '{backfill_start_date: 2020-01-01}'`.

### The temptation to overdo it
Architect warning: every Jinja indirection costs a future reader cognitive load. **Macros only when the duplication is real and the logic is non-trivial.** A two-line repeated CASE statement isn't worth a macro. A fiscal-period calendar with multi-jurisdiction rules is.

---

## 8. Packages

dbt has a package ecosystem (`hub.getdbt.com`). Worth knowing by name:

| Package | What it adds |
|---|---|
| `dbt-utils` | Generic tests, cross-database macros, common utilities |
| `dbt_expectations` | Great Expectations-style assertions (more granular DQ tests) |
| `dbt_audit_helper` | Compare datasets (regression testing for refactors) |
| `dbt-codegen` | Generate boilerplate from existing tables/sources |
| `AutomateDV` (Datavault-UK) | Data Vault 2.0 macros — see DV guide |
| `dbt-snowflake-utils` | Snowflake-specific helpers |
| `elementary-data` | Anomaly detection + dbt observability dashboard |

Add via `packages.yml`:
```yaml
packages:
  - package: dbt-labs/dbt_utils
    version: 1.1.1
```

---

## 9. dbt Core vs dbt Cloud

| | dbt Core | dbt Cloud |
|---|---|---|
| License | Open source (Apache 2.0) | Commercial (subscription) |
| Runs where | CLI, your infra | dbt's hosted environment |
| Scheduler | None — bring your own (Airflow, etc.) | Built-in job scheduler |
| IDE | Your editor | Browser-based IDE with autocomplete |
| Lineage | `dbt docs` (self-hosted) | Hosted, prettier |
| Semantic layer | Self-managed | Hosted MetricFlow |
| CI/CD | Bring your own | Built-in slim CI, PR previews |
| Multi-tenant | Self-managed | First-class |

**Architect-level call:** an organisation that already runs its own orchestrator and has a real platform team usually runs dbt Core in its own infra — the marginal value of dbt Cloud is lowest exactly where that capability already exists. The dbt Cloud pitch lands hardest where there is no platform team to absorb the operational work.

---

## 10. Performance levers

You won't tune dbt itself in an interview; you'll tune the SQL it compiles and the materialisations it chooses.

| Lever | When to reach for it |
|---|---|
| `incremental` over `table` | Large facts where full rebuild > 5 min |
| `merge` over `append` | Late-arriving updates matter |
| `+materialized: view` for staging | Almost always — cheap, always fresh |
| `cluster_by` config (Snowflake) | High-cardinality filter columns on big tables |
| `partition_by` (BigQuery, Databricks) | Same idea, partition pruning |
| `dbt_utils.deduplicate` | When source rows arrive with dupes — pre-empt fan-out |
| `--select state:modified+` | CI: only rebuild what changed and its descendants |
| `dbt run --threads N` | Parallel execution; Snowflake handles it well |

---

## 11. Common anti-patterns to call out

In an architecture review, if you see any of these, push back:

- **Models that read directly from `source()` in marts** — skip staging, lose the testing surface, mix concerns.
- **`SELECT *` in staging models** — fragile to source schema changes; pin column lists explicitly.
- **One mega-model** — 500-line SQL files. Refactor into intermediate models with a clear grain.
- **Tests-as-afterthought** — models without `_tests.yml` next to them. The pattern should be: model created → tests added in same PR.
- **Materialised as `table` everywhere** — wastes warehouse credits. Default to `view` for staging, materialise only where query latency matters.
- **No source freshness** — silent upstream rot. Always declare freshness on critical sources.
- **Hard-coded environment names** — `prod_snowflake` baked into SQL. Use `target.name` or env vars instead.
- **No CI** — anyone can merge. At minimum, run `dbt build --select state:modified+` on PRs.

---

## 12. dbt + Data Vault + dimensional — how the layers fit

Tying this back to the modelling methodology choice from the Data Vault guide:

```
sources (declared in _sources.yml)
    │
    ▼
staging  (1-to-1 mirrors of sources, in dbt models)
    │
    ▼
raw vault  (hubs/links/sats via AutomateDV macros) ─── insert-only
    │
    ▼
business vault  (derived hubs/sats, dbt-coded)
    │
    ▼
marts  (dimensional facts and dimensions, dbt-coded) ─── consumer-facing
    │
    ▼
BI / consumers
```

Each layer has a recommended materialisation:
- staging → `view`
- raw vault → `incremental` (append)
- business vault → `incremental` (merge)
- marts → mix of `incremental` (large facts) and `table` (smaller dimensions)

---

## 13. Fitting dbt into an existing stack

A common estate shape — a managed Airflow for orchestration, a cloud warehouse,
an open table format on object storage, and a BI tool on top — is *dbt-shaped*
whether or not dbt is actually in it. Two cases, and the second matters more
than people expect:

- **If dbt is in scope**, the architectural conversation is about project structure across domains (mono-repo vs multi-repo), CI/CD discipline, lineage propagation into the catalog, and semantic-layer choices. None of those are syntax questions.
- **If dbt is not in scope**, the architecture is unchanged: **the layered model (staging → intermediate → marts) is universal** whether you use dbt or hand-roll the orchestration. dbt is the most convenient way to express that layering, not the reason for it.

---

## 14. Vocabulary

- *"Materialisation choice"* — never just "table vs view."
- *"Source freshness"* — when discussing upstream silence detection.
- *"dbt build"* — the modern command that runs models + tests + snapshots + seeds together.
- *"`state:modified+`"* — for CI-only-rebuild-changed conversations.
- *"Slim CI"* — the dbt-Cloud-blessed term for PR-scoped runs.
- *"Semantic layer / MetricFlow"* — when the conversation moves to consumer-facing metric definitions.
- *"Production data assertions"* — the right framing for dbt tests (not "unit tests").

---

## 15. Check yourself

1. **"How do you handle SCD2 in dbt?"** → Snapshots for simple cases; AutomateDV satellites in a vault context.
2. **"How do you keep dbt fast at scale?"** → Incremental materialisations, `state:modified+` CI, source freshness, smart materialisation defaults per layer.
3. **"How does dbt fit with Airflow?"** → Airflow orchestrates *when* dbt runs; dbt orchestrates *what order within a run*. The two layers don't overlap.
4. **"What's your view on dbt Cloud vs Core?"** → Core for orgs with strong platform teams; Cloud for orgs that want the IDE + scheduler + semantic layer bundled.
5. **"How do you handle multi-tenancy / multi-brand?"** → Schema-per-tenant via `generate_schema_name` override, or project-per-tenant for stronger isolation. Trade-off: shared models vs full isolation.

---

## 16. Practice / output

By end of your week-4 effort, the dbt + AutomateDV portfolio repo (covered in the DV guide §4) is *the* dbt artefact. It demonstrates:

- Project structure (`staging` → `raw_vault` → `business_vault` → `marts`).
- Materialisation discipline.
- Tests at every layer.
- `_sources.yml` with freshness.
- `dbt docs` generated lineage view.

If you want a separate one-page mental model: sketch the layered architecture (§12) with the materialisation choices labelled on each layer. Carry as a private interview reference.

---

## 17. Things to skip

- The full Jinja language specification — know `if`/`for`/`set`/`{% ... %}`, skip the rest until you need it.
- dbt's Python models (`models/*.py` with `dbt-python`) — niche, only relevant if a workflow genuinely can't be SQL.
- Deep MetricFlow / Semantic Layer — relevant if dbt Cloud is in scope; otherwise post-onboarding learning.
- Cross-engine quirks (BigQuery's partitioning syntax, Databricks' delta-specific config) — look up when needed.

---

