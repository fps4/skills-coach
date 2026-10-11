---
title: Power BI for Data Architects
summary: The semantic-model half of Power BI for someone who builds warehouses and lakehouses — storage modes, the Databricks connection, security, release process, enough DAX to review, and the standards to set.
---

## Frame

The goal is not to become a Power BI developer. It is to discuss **the model, the storage mode, the
security and the release process** with a BI lead as a peer, and to review what report developers
build.

Direct Lake and the Fabric capacity model are covered in
[Microsoft Fabric](./microsoft-fabric-platform.md) (Section 4) and not repeated here. Product details
move fast; items marked *(check)* should be verified against current Microsoft and Databricks docs.

Three mental models:

1. **The semantic model is the product, the report is a view.** A *semantic model* (formerly
   "dataset") holds tables, relationships, measures and security. Reports are thin clients. Most
   quality problems — wrong totals, slow visuals, two versions of a KPI — are model problems.
2. **VertiPaq wants a star.** The in-memory columnar engine compresses and filters well on narrow
   dimension tables with single-direction one-to-many relationships to a fact table. Flat wide tables,
   snowflaked dimensions and bi-directional relationships are the usual causes of slow and wrong
   reports. Kimball is how the engine works, not a modelling taste.
3. **Measures, not columns, carry business logic.** A measure is DAX evaluated in the filter context of
   the visual; a calculated column is computed at refresh and stored. KPI definitions belong in
   measures (or upstream in the gold layer), with one owner.

---

## 1. Storage modes — the first design decision

| Mode | What happens | When | Cost |
|---|---|---|---|
| **Import** | Data copied into VertiPaq at refresh | Default; fastest queries | Refresh windows, size limits, data as old as the last refresh |
| **DirectQuery** | Every visual sends SQL to the source | Very large or near-real-time data | Latency, load on the warehouse, DAX limitations |
| **Dual** | A table acts as Import or DirectQuery depending on the query | Dimensions in composite models | Complexity |
| **Composite** | Mix of Import and DirectQuery tables, or a model chained on another | Aggregations over large facts | Harder to reason about; relationship limits across sources |
| **Direct Lake** | Model reads Delta/Parquet in OneLake directly | Fabric only | Needs Fabric capacity; can fall back to DirectQuery |

**Default over a lakehouse gold layer:** Import for dimensions and moderate facts, with incremental
refresh; DirectQuery or aggregation tables only for facts that do not fit. Direct Lake becomes an
option when the gold layer is in OneLake and Fabric capacity is already paid for.

**Incremental refresh** partitions the fact table by date using the `RangeStart` / `RangeEnd`
parameters and refreshes only recent partitions. It needs a filter that *folds* to the source (query
folding) or it silently loads everything.

---

## 2. Databricks ↔ Power BI

- **Connector** — Power BI talks to a **Databricks SQL warehouse** (usually serverless) over the SQL
  endpoint; Entra ID OAuth for users, a service principal for scheduled refresh *(check)*.
- **Publish from Unity Catalog** — Catalog Explorer can publish tables to the Power BI service as a
  semantic model, keeping relationships from primary/foreign key constraints *(check)*.
- **Refresh after load** — a Power BI task in a Databricks job refreshes the model after the gold
  tables update, so refresh follows data, not a clock *(check)*.
- **Unity Catalog metric views** — measures defined once in UC; the Databricks-native answer to where
  a KPI definition lives *(check)*.
- **Where governance sits** — Unity Catalog governs tables; the semantic model governs measures and
  report security. Decide which owns the KPI definition: definitions in gold tables or metric views,
  Power BI measures only aggregate them.
- **Cost trap** — DirectQuery on a busy report can keep a SQL warehouse awake all day; Import plus
  refresh-after-load is usually cheaper.

---

## 3. Security

- **Workspace roles** — Admin, Member, Contributor, Viewer; Apps distribute content to consumers.
- **Row-level security (RLS)** — roles with DAX filter expressions; dynamic RLS filters a security
  table by `USERPRINCIPALNAME()`. Applies to Viewers, not to workspace Members and above.

```dax
[Region] IN
  CALCULATETABLE(
    VALUES(Security[Region]),
    Security[Email] = USERPRINCIPALNAME()
  )
```

- **Object-level security (OLS)** — hides tables or columns; configured with Tabular Editor / TMDL,
  not the Desktop UI *(check)*.
- **Source security** — with DirectQuery and SSO, the user's identity reaches Databricks so Unity
  Catalog row filters and column masks apply. With Import, source security does not travel and must
  be rebuilt as RLS in the model. This is the security question for any design.
- **Sensitivity labels** (Purview) carry onto exports.

---

## 4. Release process and source control

- **PBIP** (Power BI Project) saves the model as folders of text files, the model itself in **TMDL**
  (Tabular Model Definition Language) — reviewable in Git.
- **Deployment pipelines** — Dev → Test → Prod workspaces with deployment rules (e.g. a different
  connection per stage). Fabric Git integration ties a workspace to a branch.
- **XMLA endpoint** (Premium/Fabric capacity) — external tools (Tabular Editor, ALM Toolkit, DAX
  Studio) read and write the model; enables CI/CD and Best Practice Analyzer checks.
- **Certified / promoted semantic models** — endorsement so report builders reuse one governed model:
  *one certified model per domain; reports connect live to it; no private imports of the same facts.*

---

## 5. DAX — enough to review

- **Filter context vs row context** — a measure is evaluated per cell under that cell's filters; row
  context iterates one row at a time (calculated columns, iterators).
- **`CALCULATE`** changes the filter context — almost every non-trivial measure uses it.

```dax
Sales LY :=
CALCULATE(
  [Sales],
  SAMEPERIODLASTYEAR('Date'[Date])
)
```

- **Time intelligence** (`SAMEPERIODLASTYEAR`, `DATESYTD`) needs a proper marked date table.
- **Review smells:** calculated columns doing a measure's job; `FILTER` over a whole fact table
  inside `CALCULATE`; bi-directional relationships to "fix" a total; many-to-many without a bridge
  table; the same KPI defined in three reports.

---

## 6. Standards an architect writes for a BI team

1. Star schema in the gold layer; the semantic model mirrors it. No flat extracts.
2. One certified semantic model per domain; reports live-connect to it.
3. KPI definitions owned and documented, in gold tables or metric views; measures aggregate, they do
   not redefine.
4. Storage mode decided per table and written down, with refresh tied to the pipeline.
5. Security decided once: Unity Catalog at source, RLS in the model for Import, and a written mapping
   between the two.
6. PBIP/TMDL in Git, deployment pipelines, Best Practice Analyzer rules in CI.
7. Naming conventions, display folders, descriptions on every measure.

---

## Hands-on in an hour

1. Install Power BI Desktop (Windows only — use a VM on macOS).
2. Load any star schema from CSV or a DuckDB export.
3. Build the relationships, a date table, a few measures, and one RLS role by region; test with
   *View as role*.
4. Save as PBIP and look at the TMDL files in Git.
