---
title: Data governance, catalog and quality
summary: The operational layer beneath the DAMA vocabulary — governance operating models and policy as code, what a modern catalog does, and data quality as a layered defence.
---

## Frame

[DAMA-DMBOK](./dama-dmbok-governance.md) names *Data Governance*, *Metadata* and *Data Quality* as
three of its eleven knowledge areas. This guide goes one level deeper: **the operational practices and
tooling that turn those concepts into something someone can be held accountable to.**

Why one guide for all three: in modern stacks the boundaries between *catalog*, *governance*,
*quality* and *lineage* tooling have blurred. Atlan and Collibra ship governance + catalog + quality +
lineage. Monte Carlo ships observability + lineage. Snowflake Horizon ships catalog + governance +
classification. dbt ships testing + lineage. **None of them can be architected in isolation any
more.**

Three mental models:

1. **Governance is a *function*, catalog is an *artefact*, quality is an *outcome*.** Governance
   decides what's true; the catalog makes the truth discoverable; quality measures whether the truth
   is fit for use.
2. **Modern catalogs are not static directories — they're metadata platforms.** Their value comes
   from active lineage, policy enforcement, and integration with the tooling that *creates* data, not
   from human-maintained glossaries.
3. **Data quality is a layered defence, not a single check.** Source freshness → in-pipeline
   assertions → post-pipeline anomaly detection → consumer-side trust signals. Each layer catches
   different failure modes.

---

# Section A — Data governance (operational)

## A1. Operating models

DAMA names three; in practice there are four, with **federated computational** as the modern,
data-mesh-influenced default.

### Centralised
A central data office owns policies, standards, ownership decisions. Uniform but slow, and resented by
domains. Seen in older enterprise estates and conservative regulated industries.

### Federated (classic DAMA)
The central office sets policies; domains own implementation. Coordination via guilds, councils, RACI.
Seen in large enterprises adopting domain-led ownership without going full mesh.

### Hybrid
A central office for cross-cutting concerns (security, classification, regulatory); domains own
everything else; an explicit coordination layer. The most common model in large enterprises today.

### Federated computational (data mesh principle 4)
Policies expressed as code, enforced by the platform automatically. A central policy team curates the
policies; the platform enforces them. Domains can't violate them, but don't have to be policed by
humans. The destination most modern roadmaps aim for.

For a multi-unit, multi-jurisdiction estate with financial-reporting exposure, federated with
computational enforcement is the natural anchor: a central council for principles and policies,
per-domain implementation, automated enforcement at the platform layer so domain teams move fast
without violating.

## A2. Policy lifecycle

A working governance function operates policies as a lifecycle:

1. **Draft** — proposed by the central office or surfaced from a domain pattern.
2. **Review** — circulated among architects, security, legal, domain leads.
3. **Adopt** — approved (typically by an architecture board or governance council); communicated.
4. **Encode** — translated into enforceable form: dbt tests, access-policy rules, catalog rules,
   identity attributes.
5. **Enforce** — runs automatically; violations alert; exceptions require dispensations.
6. **Audit** — periodic review of effectiveness; metrics surfaced.
7. **Revise** — updated as the estate evolves.

**A policy that exists only as a PDF on a wiki is not a policy.** It must be encoded somewhere that
enforces it — *policy as code*.

## A3. Owner, steward, custodian

- **Data owner** — the accountable executive with authority over the data domain. Usually a senior
  business leader (the CFO for finance data, the CHRO for HR data).
- **Data steward** — the operational caretaker. Maintains quality, resolves disputes, approves
  changes, owns the glossary entries. Usually domain-embedded.
- **Data custodian** — the technical operator: DBAs, platform engineers. Doesn't make policy;
  implements it.

An architect discusses principles with owners, negotiates access models with stewards, and builds
platforms that custodians operate. Mixing up these conversations is a common stakeholder mistake.

## A4. Governance KPIs that mean something

Most governance dashboards measure compliance theatre. Useful KPIs:

- **% of critical datasets with a named owner** — table stakes; if this isn't ~100%, nothing else
  works.
- **% of critical datasets with active lineage** — column-level for audit-exposed data.
- **% of datasets with documented DQ SLAs** — a measurable expectation, not an aspiration.
- **Mean time to resolve a DQ incident** — operational discipline.
- **Dispensation backlog age** — how long exceptions sit unaddressed; the smell test of governance
  hygiene.
- **% of policies encoded vs PDF-only** — policy-as-code progress.

## A5. Regulatory drivers

Typical external drivers that shape governance:

- **Financial-reporting controls (SOX)** — segregation of duties, change-management evidence and
  lineage are not optional.
- **Privacy (GDPR)** — purpose limitation, minimisation, access and erasure.
- **Platform regulation (EU DMA)** — data portability and access obligations for gatekeepers.
- **Tax reporting (DAC7, ViDA)** — force discipline on seller and partner master data.

A common resulting shape: federated with central policy, computational enforcement through an
attribute-based access layer on the warehouse, a catalog with lineage on top, and in-pipeline tests
plus orchestration alerts for data quality.

---

# Section B — Data catalog

## B1. What a modern catalog does

Five interlocking jobs. Anything that doesn't do all five is a *glossary*, not a catalog:

1. **Discovery** — answer "what datasets exist relevant to X?" Searchable, classification-aware.
2. **Documentation** — definitions, ownership, lineage, SLA, sensitivity classification.
3. **Lineage** — table-grain and (increasingly) column-grain dependency graphs.
4. **Profiling** — automated stats: row counts, NULL rates, distribution shifts, top values.
5. **Policy surface** — classifications drive enforcement (tag → mask, tag → access rule).

The "active metadata" trend (from around 2021): catalogs ingest metadata continuously from the tools
that *create* data (warehouses, dbt, orchestrators, BI tools) and push back to those tools (e.g.
tag-based access rules in the policy-enforcement layer).

## B2. Tool landscape

### Enterprise commercial
| Tool | Strengths | Common context |
|---|---|---|
| **Collibra** | Long-time leader; strong governance/workflow features | Regulated industries; financial services |
| **Alation** | Strong glossary and search; analyst-friendly UX | Analytics-led organisations |
| **Atlan** | Modern UX; strong dbt + Snowflake integration; active metadata first-class | Modern cloud-data stacks |
| **Microsoft Purview** | Native Azure integration; governance + classification + lineage | Azure-heavy estates |
| **Informatica EDC / CDGC** | Enterprise data fabric; broad scope | Large Informatica estates |

### Platform-bundled
| Tool | Origin | What it covers |
|---|---|---|
| **Snowflake Horizon** | Snowflake | Catalog + classification + lineage + access policies; in-Snowflake only |
| **Databricks Unity Catalog** | Databricks | Same idea; in-Databricks only; expanding to multi-cloud |
| **AWS Glue Data Catalog** | AWS | Lighter; pairs with Lake Formation for governance |

### Open source
| Tool | Origin | Strengths |
|---|---|---|
| **DataHub** | LinkedIn (open-sourced) | Active community; strong metadata model |
| **OpenMetadata** | OpenMetadata.org | Newer, polished UX; opinionated metadata schema |
| **Apache Atlas** | Apache | Hadoop-era origins; less active development now |

### Choosing
- Single-warehouse shop with light needs → the **platform catalog + dbt docs** is often enough.
- Multi-source modern estate → an **active-metadata commercial catalog** (e.g. Atlan).
- Regulated industry with heavy governance workflow → a **workflow-strong** one (e.g. Collibra).
- Tight budget + engineering capacity → **open source** (e.g. DataHub), but you own operations.

Frame the criteria first — active metadata, integration depth with the warehouse and transformation
tools, lineage maturity, policy surface — then name the candidates that fit.

## B3. Metadata ingestion patterns

### Pull (catalog scrapes systems)
- The catalog connects to the warehouse, BI tool, dbt and orchestrator on a schedule.
- **Pros:** no work in the source systems; centralised control.
- **Cons:** latency between change and catalog; brittle to source-side changes.

### Push (systems emit metadata events)
- Source tools emit metadata events, typically via [OpenLineage](https://openlineage.io).
- **Pros:** near-real-time; loose coupling; one event stream feeds many consumers.
- **Cons:** every source must instrument; standards still maturing.

### OpenLineage
Open standard for emitting lineage events, with integrations for Airflow, dbt, Spark, Flink,
Snowflake, Databricks. As the lineage backbone it makes the catalog choice reversible.

## B4. Active vs passive metadata

- **Passive metadata** — documents what *is*: glossary entries, schemas, ownership.
- **Active metadata** — documents what *happens* AND drives action: profiling stats trigger anomaly
  alerts; tags drive access policies; lineage shapes impact analysis.

## B5. Build vs buy

| Position | When defensible |
|---|---|
| **Buy commercial** | Most enterprise contexts; faster time to value; vendor handles connectors |
| **Adopt open source** | Strong platform team; specific extension needs; budget pressure |
| **Build from scratch** | Almost never — the ecosystem has matured |

---

# Section C — Data quality

## C1. The layered defence

```
Layer 1 — Source freshness
   ▼
Layer 2 — Schema / contract validation at landing
   ▼
Layer 3 — In-pipeline assertions (dbt tests)
   ▼
Layer 4 — Post-pipeline observability (anomaly detection)
   ▼
Layer 5 — Consumer-side trust signals (data SLAs)
```

### Layer 1 — Source freshness
*Has data arrived when it was supposed to?*
**Tools:** dbt source freshness, orchestrator sensors, observability freshness monitors.
**Catches:** upstream silence — the most common failure mode in practice.

```yaml
sources:
  - name: erp
    freshness:
      warn_after:  {count: 6,  period: hour}
      error_after: {count: 24, period: hour}
    loaded_at_field: _loaded_at
```

### Layer 2 — Schema / contract validation
*Does the incoming data match the expected shape?*
**Tools:** a schema registry (for events), Great Expectations / Soda at landing, JSON Schema.
**Catches:** upstream schema drift before it propagates.

### Layer 3 — In-pipeline assertions
*Does the data satisfy expected business rules at each transformation step?*
**Tools:** dbt tests (built-in, custom, dbt_expectations), Great Expectations, Soda.
**Catches:** row-level violations, referential integrity, business-rule violations.

### Layer 4 — Post-pipeline observability
*Has anything statistically anomalous happened that wasn't explicitly checked?*
**Tools:** Monte Carlo, Anomalo, Bigeye, Sifflet, Elementary, Lightup.
**Catches:** distribution shifts, volume anomalies, freshness regressions — the *unknown unknowns*.

### Layer 5 — Consumer-side trust signals
*Has this dataset been recently validated, and what's its SLA?*
**Tools:** catalog certification badges, data-contract platforms.
**Catches:** consumer confusion about freshness and reliability.

## C2. Tool landscape

| Category | Tools | When chosen |
|---|---|---|
| **dbt-native testing** | dbt tests, dbt_expectations, dbt_utils | Cheapest, lives in the pipeline; first line of defence |
| **In-pipeline rule frameworks** | Great Expectations, Soda | When dbt-native isn't expressive enough or non-dbt pipelines exist |
| **Observability / anomaly detection** | Monte Carlo, Anomalo, Bigeye, Sifflet, Lightup | The unknown-unknowns layer; pricey but valuable for critical estates |
| **dbt-observability hybrids** | Elementary | Open source; sits on dbt artefacts; lighter than a commercial platform |
| **Warehouse-native** | Snowflake data metric functions (DMFs) | Single-warehouse estates; young capability |

## C3. Anomaly detection vs rule-based testing

**Both, with rules first.**

- **Rule-based** is cheaper, deterministic, reviewable. Every test states what's expected. Few false
  positives.
- **Anomaly detection** is costlier and less deterministic, but catches what rules don't anticipate.
  More false positives.

Rules for known constraints (uniqueness, referential integrity, value ranges, business rules); anomaly
detection layered on top for distribution shifts and volume changes.

## C4. DQ SLAs and incident management

1. **Documented SLAs per critical dataset** — freshness, completeness, accuracy thresholds.
2. **Alerts when SLAs are breached** — to a defined responder, not an inbox.
3. **Incident process** — the same shape as software incidents: detect, triage, communicate, fix,
   post-mortem.
4. **Post-mortems that produce policy changes** — not just remediation. The most under-invested step.

## C5. DQ as code

Quality tests live in version control next to the transformations they validate. No rules that live
only in a GUI or a PDF.

- **dbt tests** — a tests YAML next to each model.
- **Great Expectations** — Python expectation suites in the repo; CI-runnable.
- **Soda** — declarative YAML checks; CI-runnable.
- **Singular tests** — SQL files that return zero rows when passing:

```sql
-- tests/assert_no_negative_amounts.sql
select *
from {{ ref('fct_payments') }}
where amount < 0
```

PR-time enforcement: a model change without tests is rejected by CI; a model whose tests stop running
on schedule is alerted on.

---

# Section D — How the three fit together

```
              ┌─────────────────────────────────────────┐
              │       Catalog / Active Metadata         │
              │  glossary · lineage · classification ·  │
              │       policy surface · profiling        │
              └──────────┬──────────────────────┬───────┘
                         │                      │
            policy push  │                      │  metadata pull
                         ▼                      │
            ┌──────────────────────┐            │
            │  Policy Enforcement  │            │
            │  ABAC · masking ·    │            │
            │  row-level security  │            │
            └──────────┬───────────┘            │
                       ▼                        │
            ┌──────────────────────────────────┴─────┐
            │               Warehouse                │
            │   tables · views · dynamic tables      │
            └──────────┬──────────────────────┬──────┘
                       │                      │
       in-pipeline DQ  │                      │  observability DQ
                       ▼                      ▼
            ┌──────────────────┐    ┌──────────────────────┐
            │  dbt tests /     │    │  anomaly detection   │
            │  rule frameworks │    │                      │
            └──────────────────┘    └──────────────────────┘
                       │                      │
                       └──────────┬───────────┘
                                  ▼
                    OpenLineage events → catalog
```

The catalog is the metadata hub: it consumes lineage and DQ signals from the operational tools and
pushes classifications and policies back to the enforcement point in front of the warehouse.

**ABAC** (attribute-based access control) decides access, masking and row filters from attributes of
the user and tags on the data, instead of a grant per table — one policy rather than hundreds of
grants. **Lineage for an audit-exposed dataset** means column-level lineage emitted as OpenLineage
events from the transformation and warehouse layers, surfaced in the catalog, with an audit trail
retained as long as the regulator requires.

---

# Section E — Vocabulary

- **Policy as code** — the governance maturity signal.
- **Active metadata** — catalogs that drive behaviour, not just describe.
- **Federated computational governance** — data mesh principle 4.
- **Defence in depth** — for DQ layering.
- **ABAC / tag-based access policies** — access decided by attributes and classifications.
- **OpenLineage** — the lineage standard.
- **Data SLA** — never just "quality target".
- **Dispensation** — a formally approved exception to a policy.
