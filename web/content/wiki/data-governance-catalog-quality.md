---
title: Data Governance, Catalog & Quality — Operational Architect's Guide
summary: The implementation layer beneath DAMA vocabulary — operating models, policy lifecycle, catalog selection, lineage, and layered data-quality defence.
topic: governance
format: guide
tags: [governance, catalog, data-quality, lineage, openlineage, collibra, atlan, dbt]
updated: 2026-08-07
---

## Frame

The DAMA-DMBOK guide names *Data Governance*, *Metadata*, and *Data Quality* as three of the eleven knowledge areas. The TOGAF guide names the governance structures (ARB, principles, dispensations). This guide goes one level deeper: **the operational practices and tooling that turn those concepts into something an architect can hold someone accountable to.**

Why combined into one guide: in modern stacks the boundaries between *catalog*, *governance*, *quality*, and *lineage* tooling have blurred. Atlan and Collibra ship governance + catalog + quality + lineage. Monte Carlo ships observability + lineage. Snowflake's Horizon ships catalog + governance + classification. dbt ships testing + lineage. **You can't architect any one of them in isolation any more.**

Three mental models to hold:

1. **Governance is a *function*, catalog is an *artefact*, quality is an *outcome*.** Governance decides what's true; catalog makes the truth discoverable; quality measures whether the truth is fit for use. Mixing the three is the most common architecture-talk failure.
2. **Modern catalogs are not static directories — they're metadata platforms.** Their value comes from active lineage, policy enforcement, and integration with the tooling that *creates* data, not from human-maintained glossaries.
3. **Data Quality is a layered defence, not a single check.** Source freshness → in-pipeline assertions → post-pipeline anomaly detection → consumer-side trust signals. Each layer catches different failure modes.

---

# Section A — Data Governance (operational)

## A1. The operating model decisions

Governance models in practice. The DAMA guide names three; in 2026 there are really four, with **federated computational** as the modern data-mesh-influenced default:

### Centralised
A central data office owns policies, standards, ownership decisions. Implementations are uniform but slow and resented by domains.
**Where seen:** older enterprise estates, regulated industries with conservative posture.

### Federated (classic DAMA)
Central office sets policies; domains own implementation. Coordination via guilds, councils, RACI.
**Where seen:** large enterprises adopting domain-led data ownership without going full mesh.

### Hybrid
Central office for cross-cutting concerns (security, classification, regulatory); domains own everything else; explicit coordination layer.
**Where seen:** most large enterprises today — the pragmatic majority position.

### Federated computational (Data Mesh's principle 4)
Policies expressed as code, enforced by the platform automatically. A central policy team curates the policies; the platform enforces. Domains can't violate, but they don't have to be policed by humans.
**Where seen:** advanced cloud-native data teams; the destination state most modern roadmaps aim for.

**The architect's framing:** *"For a multi-brand, multi-jurisdiction, SOX-exposed estate, federated with computational enforcement is where I'd anchor the operating model. Central council for principles and policies; per-domain implementation; automated enforcement at the platform layer so domain teams move fast without violating."*

## A2. Policy lifecycle in practice

Policies don't write themselves and then live forever. A working governance function operates them as a lifecycle:

1. **Draft** — proposed by central office or surfaced from a domain pattern.
2. **Review** — circulated for comment among architects, security, legal, domain leads.
3. **Adopt** — approved (typically by ARB or data governance council); communicated.
4. **Encode** — translated into enforceable form: dbt tests, Immuta policies, catalog rules, SAML attributes.
5. **Enforce** — runs automatically; violations alert; exceptions require dispensations.
6. **Audit** — periodic review of effectiveness; metrics surfaced.
7. **Revise** — updated as the estate evolves.

The architect-level point: **a policy that exists only as a PDF on Confluence is not a policy.** It must be encoded somewhere that enforces it. *"Policy as code"* is the canonical phrase.

## A3. Stewardship — distinct from ownership

The DAMA guide names the distinction; here's how it actually works:

- **Data Owner** — the accountable executive. Has authority over the data domain. Usually a senior business leader (CFO for finance data, CHRO for HR data).
- **Data Steward** — operational caretaker. Maintains quality, resolves disputes, blesses changes, owns the glossary entries. Usually a domain-embedded role.
- **Data Custodian** — the technical operator. DBAs, platform engineers. Doesn't make policy; implements.

**Architect interface points:** you discuss principles with Owners; you negotiate access models with Stewards; you build platforms that Custodians operate. Mixing these conversations up is the most common stakeholder-management mistake.

## A4. Governance KPIs that actually mean something

Most governance dashboards measure compliance theatre. Genuinely useful KPIs:

- **% of critical datasets with a named owner** — table-stakes; if this isn't ~100%, nothing else works.
- **% of critical datasets with active lineage** — column-level for SOX-exposed data.
- **% of datasets with documented DQ SLAs** — measurable expectation, not aspiration.
- **Mean time to resolve a DQ incident** — operational discipline measure.
- **Dispensation backlog age** — how long exceptions sit unaddressed. The smell test of governance hygiene.
- **% of policies encoded vs PDF-only** — the policy-as-code progress measure.

## A5. Reading an estate's governance shape from its constraints

You can usually infer the governance model an organisation *must* adopt from a
handful of external facts, before anyone tells you what it is. The signals that
carry the most weight:

- **A policy-enforcement layer in production** (ABAC / dynamic masking on the warehouse) means computational enforcement is already the direction of travel.
- **A single identity provider** with SAML/OIDC into the policy layer means attributes — not table grants — are the unit of access control.
- **Digital Markets Act gatekeeper status** brings partner data-portability and access obligations that force specific governance shapes.
- **SOX exposure** (US-listed) makes segregation of duties, change-management evidence, and lineage non-optional rather than best practice.
- **DAC7 (annual reporting) and ViDA (2027–2030 phasing)** drive seller / partner master-data discipline whether or not anyone has budgeted for it.

**The shape those imply:** federated-with-central-policy, computational enforcement at the warehouse, lineage tooling layered on top, and in-pipeline DQ via transformation tests plus orchestrator alerts. Reading the constraints first is faster than asking, and it tells you which answers are actually available.

---

# Section B — Data Catalog

## B1. What a modern catalog actually does

Five interlocking jobs. Anything that doesn't do all five is a *glossary*, not a catalog:

1. **Discovery** — answer "what datasets exist relevant to X?" Searchable, classification-aware.
2. **Documentation** — definitions, ownership, lineage, SLA, sensitivity classification.
3. **Lineage** — table-grain and (increasingly) column-grain dependency graphs.
4. **Profiling** — automated stats: row counts, NULL rates, distribution shifts, top values.
5. **Policy surface** — classifications drive enforcement (tag → mask, tag → access rule).

The "active metadata" trend (Forrester / Gartner ~2021 onwards): catalogs aren't static directories any more. They ingest metadata continuously from the tools that *create* data (warehouses, dbt, Airflow, BI tools), and push back to those tools (e.g. tag-based access rules in Immuta).

## B2. The tool landscape

Three tiers; know them by name and rough positioning.

### Enterprise commercial (heavy, expensive, comprehensive)
| Tool | Strengths | Common context |
|---|---|---|
| **Collibra** | Long-time leader; strong governance/workflow features | Regulated industries; financial services |
| **Alation** | Strong glossary / search; analyst-friendly UX | Analytics-led organisations |
| **Atlan** | Modern UX; strong dbt + Snowflake integration; active metadata first-class | Modern cloud-data shops |
| **Microsoft Purview** | Native Azure integration; covers governance + classification + lineage | Azure-heavy estates |
| **Informatica EDC / CDGC** | Enterprise data fabric; broad scope | Large Informatica estates |

### Cloud-native bundled
| Tool | Origin | What it covers |
|---|---|---|
| **Snowflake Horizon** | Snowflake | Catalog + classification + lineage + access policies; in-Snowflake only |
| **Databricks Unity Catalog** | Databricks | Same idea; in-Databricks only; expanding to multi-cloud |
| **AWS Glue Data Catalog** | AWS | Lighter; pairs with Lake Formation for governance |

### Open source
| Tool | Origin | Strengths |
|---|---|---|
| **DataHub** | LinkedIn (open-sourced) | Active community; strong metadata model; CNCF-trajectory |
| **OpenMetadata** | OpenMetadata.org | Newer, polished UX; opinionated metadata schema |
| **Apache Atlas** | Apache | Older; Hadoop-era origins; less active development now |

### The architect's call
- Snowflake-only shop with light needs → **Horizon + dbt docs** is often enough.
- Snowflake + multi-source estate → **Atlan** is the modern default.
- Regulated industry with heavy governance demands → **Collibra**.
- Tight budget + engineering capacity → **DataHub** (open source, but you own operations).

A multi-source, multi-brand, SOX-exposed estate on a modern stack lands on **Atlan, Collibra, or Purview** most of the time — but the catalog of record is worth establishing as a fact rather than inferring it, since a second shadow catalog is a common and expensive discovery.

## B3. Metadata ingestion patterns

How metadata gets into the catalog. Two patterns, often hybridised:

### Pull (catalog scrapes systems)
- Catalog connects to warehouse, BI tool, dbt, Airflow on a schedule.
- Pulls schema, lineage artefacts, run metadata, profiling.
- **Pros:** no work in the source systems; centralised control.
- **Cons:** latency between change and catalog reflection; brittle to source-side changes.

### Push (systems emit metadata events)
- Source tools emit metadata events (typically via [OpenLineage](https://openlineage.io)).
- Catalog consumes events as they happen.
- **Pros:** near-real-time; loose coupling; same event stream feeds multiple consumers.
- **Cons:** every source system must instrument; standards still maturing.

### OpenLineage — worth name-dropping
Open standard for emitting lineage events. Integrations exist for Airflow, dbt, Spark, Flink, Snowflake, Databricks. The architect-level take: *"OpenLineage is the right bet for the lineage backbone — it lets catalog choice be reversible."*

## B4. Active vs passive metadata

- **Passive metadata** — documents what *is*. Glossary entries, schemas, ownership.
- **Active metadata** — documents what *happens* AND drives action. Profiling stats trigger anomaly alerts; tags drive access policies; lineage shapes impact analysis.

**Architect-level signal:** *"I'd anchor the catalog choice around active-metadata capability. Passive directories are an artefact; active platforms drive enforcement."*

## B5. Build vs buy

| Position | When defensible |
|---|---|
| **Buy commercial** (Atlan / Collibra / Alation) | Most enterprise contexts; faster time-to-value; vendor handles connectors |
| **Adopt open source** (DataHub / OpenMetadata) | Strong platform team; specific extension needs; budget pressure |
| **Build from scratch** | Almost never defensible in 2026 — the ecosystem has matured |

The reasonable architect's framing: *"In 2018 I might have argued for building. In 2026 the buy-or-adopt-OSS conversation is the right one; build is dead."*

---

# Section C — Data Quality

## C1. The DQ layered defence

Data quality is not a single test. It's a defence in depth, with each layer catching different failure modes:

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
*"Has data arrived when it was supposed to?"*
**Tools:** dbt source freshness, Airflow sensors, Monte Carlo freshness monitors.
**Catches:** upstream silence — the most common failure mode in practice.

### Layer 2 — Schema / contract validation
*"Does the incoming data match the expected shape?"*
**Tools:** Confluent Schema Registry (for events), Great Expectations / Soda at landing, JSON Schema validation.
**Catches:** upstream-side schema drift before it propagates.

### Layer 3 — In-pipeline assertions
*"Does the data satisfy expected business rules at each transformation step?"*
**Tools:** dbt tests (built-in + custom + dbt_expectations), Great Expectations, Soda, dbt_audit_helper.
**Catches:** row-level violations, referential integrity, business-rule violations.

### Layer 4 — Post-pipeline observability
*"Has anything statistically anomalous happened that wasn't explicitly checked?"*
**Tools:** Monte Carlo, Anomalo, Bigeye, Sifflet, Elementary, Lightup.
**Catches:** distribution shifts, volume anomalies, freshness regressions — the *unknown unknowns* that rule-based testing misses.

### Layer 5 — Consumer-side trust signals
*"Has this dataset been recently validated, and what's its SLA?"*
**Tools:** catalog badges (Atlan, Monte Carlo certifications), data contract platforms.
**Catches:** consumer confusion about freshness / reliability.

## C2. Tool landscape

| Category | Tools | When chosen |
|---|---|---|
| **dbt-native testing** | dbt tests (built-in), dbt_expectations, dbt_utils | Cheapest, lives in the pipeline; first line of defence |
| **In-pipeline rule frameworks** | Great Expectations, Soda Core, Soda Cloud | When dbt-native isn't expressive enough or non-dbt pipelines exist |
| **Observability / anomaly detection** | Monte Carlo, Anomalo, Bigeye, Sifflet, Lightup | The "unknown unknowns" layer; pricey but valuable for critical estates |
| **dbt-observability hybrids** | Elementary | Open-source; sits on dbt artefacts; lighter than Monte Carlo |
| **Snowflake-native** | Snowflake's data metric functions (DMFs) | If Snowflake-only and want native; nascent capability |

## C3. Anomaly detection vs rule-based testing

The architect's call: **both, with rules first.**

- **Rule-based** is cheaper, more deterministic, more reviewable. Every test states what's expected. False positives are low.
- **Anomaly detection** is more expensive, less deterministic, but catches what rules don't anticipate. False positives are higher.

**The right architecture:** rules for known constraints (uniqueness, referential integrity, value-range, business rules); anomaly detection layered on top for distribution shifts and volume changes.

## C4. DQ SLAs and incident management

A working DQ practice has:

1. **Documented SLAs per critical dataset** — freshness, completeness, accuracy thresholds.
2. **Alerts when SLAs are breached** — to a defined responder, not an inbox.
3. **Incident process** — same shape as software incidents: detect, triage, communicate, fix, post-mortem.
4. **Post-mortems that produce policy changes** — not just remediation. The most under-invested step.

## C5. DQ as code — patterns

Modern practice: DQ tests live in version control next to the data transformations they validate. **No tests-as-PDF, no rules-in-a-GUI-only.**

- **dbt tests** — `_tests.yml` next to each model (see dbt primer §6).
- **Great Expectations** — Python expectation suites in repo; CI-runnable.
- **Soda** — declarative `.yml` checks; CI-runnable.
- **Custom singular tests** — SQL files that return zero rows when passing.

The PR-time enforcement: a model change without tests is rejected by CI. A model whose tests don't run on the schedule is alerted on.

---

# Section D — How the three fit together

Modern stacks blur the boundaries. A realistic 2026 governance/catalog/quality topology:

```
              ┌─────────────────────────────────────────┐
              │       Catalog / Active Metadata         │
              │            (Atlan / Collibra)            │
              │  glossary · lineage · classification ·   │
              │       policy surface · profiling         │
              └──────────┬──────────────────────┬────────┘
                         │                      │
            policy push  │                      │  metadata pull
                         ▼                      │
            ┌──────────────────────┐            │
            │  Policy Enforcement  │            │
            │       (Immuta)       │            │
            │  ABAC · masking ·    │            │
            │  row-level security  │            │
            └──────────┬───────────┘            │
                       │                        │
                       ▼                        │
            ┌──────────────────────────────────┴─────┐
            │             Warehouse (Snowflake)      │
            │   tables · views · dynamic tables      │
            └──────────┬──────────────────────┬──────┘
                       │                      │
       in-pipeline DQ  │                      │  observability DQ
                       ▼                      ▼
            ┌──────────────────┐    ┌──────────────────────┐
            │  dbt tests +     │    │  Monte Carlo /       │
            │  Great Expect.   │    │  Anomalo (anomaly)   │
            └──────────────────┘    └──────────────────────┘
                       │                      │
                       └──────────┬───────────┘
                                  ▼
                    OpenLineage events → catalog
```

Each component does its job; the catalog is the metadata hub that consumes lineage + DQ signals from the operational tools and surfaces classifications + policies back to the enforcement points.

---

# Section E — Synthesis: a worked reference stack

Assembling the pieces for a multi-brand, SOX-exposed estate on a modern cloud
stack gives a shape that recurs often enough to be worth memorising:

- **Identity:** one IdP, SAML/OIDC, the source of the attributes everything else keys on.
- **Policy enforcement:** an ABAC layer on the warehouse — dynamic masking and row-level filtering, expressed as policy rather than grants.
- **Catalog:** one catalog of record. Which vendor matters less than the fact that there is exactly one.
- **DQ tooling:** transformation-layer tests as the floor, with an observability layer above them for the failures tests cannot anticipate.
- **Lineage:** OpenLineage events emitted from the transformation and orchestration layers, surfaced wherever the catalog lives.
- **Governance model:** federated-with-central-policy. A central council owns the regulatory policies (SOX, DAC7, ViDA, GDPR, DMA); domain teams implement.

**The questions that determine whether this shape is real or aspirational:**
1. *What is the catalog of record — and is there a second, unofficial one?*
2. *How is data quality actually observed — tests only, or an observability tool on top?*
3. *Where does the federated-vs-central line actually sit for policy?*
4. *"Is OpenLineage in use today?"*

---

# Section F — Vocabulary

- *"Policy as code"* — the modern governance maturity signal.
- *"Active metadata"* — for catalogs that drive behaviour, not just describe.
- *"Federated computational governance"* — Data Mesh principle 4.
- *"Defence in depth"* — for DQ layering.
- *"ABAC"* (attribute-based access control) — Immuta's discipline.
- *"Tag-based access policies"* — the Immuta + Snowflake pattern.
- *"OpenLineage"* — for the lineage standard.
- *"Data SLA"* — never just "quality target."
- *"Steward vs owner"* — when role-clarifying.
- *"Dispensation"* — when discussing exceptions (links back to TOGAF).

---

# Section G — Check yourself

1. **"How do you think about data governance at multi-brand scale?"**
   → Federated-with-central-policy + computational enforcement framing from §A1.
2. **"What catalog would you choose for a multi-brand estate?"**
   → Don't commit to a vendor sight-unseen. Frame the *criteria*: active metadata, dbt + Snowflake integration depth, lineage maturity, policy surface. Then name the candidates that fit.
3. **"How do you handle data quality at scale?"**
   → The layered defence from §C1. Mention OpenLineage and SLA-driven framing.
4. **"What's the difference between governance and catalog?"**
   → Governance is the function (who decides); catalog is the artefact (where it's discoverable). Easy gotcha if you blur them.
5. **"Anomaly detection vs rule-based testing?"**
   → Both, rules first; framing from §C3.
6. **"How would you instrument lineage for a SOX-exposed dataset?"**
   → Column-level lineage; OpenLineage events from dbt + warehouse; lineage surface in the catalog; audit-trail retention sufficient for the regulator.

---

# Section H — Practice / output

Produce a one-page sketch:

> **Governance + Catalog + DQ Reference Stack**
>
> The topology diagram from §D, with named candidate tools at each box, plus the open questions from §E that would change your choices.

Being able to draw that from memory is the test of whether this has landed. The methodology layer is easy to talk about in the abstract; the operational layer is where the argument gets settled.

---

# Section I — Things to skip

- Memorising vendor feature matrices. Know the names + positioning; the comparison detail is googleable.
- Deep CDMP / certification on governance — defer past offer.
- Religious wars over data mesh vs data fabric. Name both; don't enter.
- Building from scratch — not a defensible position in 2026.
- Detailed PII-classification taxonomy regulation-by-regulation — relevant only if you become the data privacy lead.

---

