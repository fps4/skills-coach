---
title: Palantir Foundry and AIP — Primer
summary: The shape of Foundry and its AI layer for a lakehouse practitioner — datasets, the ontology, governed Actions, markings, AIP agents and evals, and how releases cross Foundry and Databricks.
---

## Frame

Palantir sells **Foundry** (the data and application platform) and **AIP** (the AI layer on top of
it). In life sciences and industry it often sits next to Databricks: Databricks for engineering and ML
at scale, Foundry for the operational layer that scientists and operations people click on. To work
alongside a Foundry team you need to know **what they build, what a release is, and where access and
audit live**.

Palantir renames and bundles products often; check current names on palantir.com/docs. This guide is
the stable shape, not a feature list.

## 1. The layers, mapped to the lakehouse

| Foundry | What it is | Nearest lakehouse equivalent |
|---|---|---|
| **Datasets + transforms** (Pipeline Builder, Code Repositories with PySpark/SQL) | Versioned datasets built by transforms; every build records its inputs | Delta tables + dbt/Spark jobs, with lineage built in |
| **Ontology** | Business objects (*Study*, *Site*, *Batch*), their properties and **link types**, backed by datasets | A semantic layer or knowledge-graph spine over the warehouse — but also the write target |
| **Actions** | Governed writes: a user or agent changes an object through a defined action with rules and an audit entry | An API with validation and an audit log — the only sanctioned write path |
| **Functions** | TypeScript/Python code over ontology objects, used by apps, actions and AIP | Service-layer logic |
| **Workshop / Slate / Quiver / Contour** | App builder and analysis tools for end users | Low-code front-ends and BI over a semantic layer |
| **Markings, restricted views, project permissions** | Access control that travels with data through lineage (a marking on an input propagates to outputs) | Lineage-based restriction — unlike table grants, which a derived table does not inherit |
| **Apollo** | Palantir's deployment / continuous-delivery system for its own software | Not something a client team manages |

## 2. AIP — the agentic layer

- **AIP Logic** — build LLM-powered functions with little code: a prompt, tools that read the
  ontology, actions it may call, and evaluation in the same tool.
- **AIP Agent Studio** — configure agents with retrieval over ontology objects and documents, plus
  tools; deployable inside Workshop apps.
- **AIP Evals** — test suites for Logic functions and agents. This is where a release criterion lives
  on Foundry; what matters is whether it is used as a gate and who wrote the cases.
- **Model choice** — Foundry brokers several LLM providers; the contract decides which.
- **Agents act through Actions.** An agent that changes something goes through the same governed
  Action a human would, so permissions and audit already exist. The question is which write Actions
  an agent holds and who approved them.

## 3. What a release is on Foundry

Branching exists on code repositories and, through Foundry's branching features, on the ontology and
pipelines, with proposals reviewed and merged. The dependency to plan is **ontology change ↔ app ↔
agent**: a new property or changed link type breaks the apps and agents built on it unless changes are
branched, reviewed and coordinated — the same problem as a schema change in a data platform.

## 4. Foundry + Databricks in the same estate

Typical split: raw ingestion and heavy ML in Databricks; curated outputs synced into Foundry (via
connectors and the published Databricks partnership), where the ontology and apps live. Consequence:
**a release often crosses both platforms and two teams**, and a Databricks table change can break a
Foundry object type. Track the cross-platform dependency from day one. See
[Databricks](./databricks-platform.md).

## 5. Questions to ask a Foundry team

1. Which products are AIP agents, which are Databricks-hosted agents, which are both?
2. Who owns the ontology — a central team or each product team?
3. Is AIP Evals (or anything) used as a release gate? Who signs off the eval set?
4. Do agents have write Actions? Which, and under whose approval?
5. Which datasets carry markings (e.g. patient-level, unblinded), and how is that checked on a new
   agent before release?

## Sources

- Palantir docs: Foundry overview, Ontology, Actions, AIP Logic, AIP Evals, Markings.
- Palantir–Databricks partnership announcement (2025), for the integration pattern.
