---
title: Data Vault 2.0 + dbt + AutomateDV — Architect Refresher
summary: Hubs, links and satellites, hash keys, and the dbt + AutomateDV execution pattern — plus when a vault is the wrong answer.
topic: data-engineering
format: refresher
tags: [data-vault, dbt, automatedv, modeling, warehouse, sap]
updated: 2026-08-07
---

## Frame

Data Vault 2.0 (DV2.0) is one of three modelling methodologies most enterprise data architects need to be conversant in (alongside Kimball dimensional and 3NF/Inmon). It excels at the *raw* / *integration* layer of a warehouse — auditability, scalability, lineage, source-system agility — which is exactly the shape of an SAP-anchored finance estate at multi-brand scale.

The goal: be able to (a) explain DV2.0 in two minutes, (b) sketch hub-link-satellite over an SAP-origin source on a whiteboard, (c) discuss when to use it and when not to, and (d) actually execute the dbt + AutomateDV pattern rather than only describing it.

Three mental models:

1. **Hubs are nouns, Links are verbs, Satellites are descriptions.** Hub = the business key for a thing. Link = a relationship between things. Satellite = attributes that change over time. Memorise this — it's the whole methodology.
2. **DV2.0 is the raw layer, not the consumption layer.** Reports don't read the vault directly. There's always a "business vault" or "information mart" above it (often dimensional) for consumers.
3. **The reason it exists: source-system agility.** If a new source for "vendor" arrives next year, you don't change your hub — you add another satellite. The downstream model is unchanged. This is the wedge over star-schema-only architectures.

---

## 1. The three core entities

### Hub
A single-column-of-substance table representing the *business key* for an entity (customer, vendor, invoice, etc.). Plus metadata.

```sql
CREATE TABLE hub_vendor (
  vendor_hk        BINARY(20),    -- hash key (the surrogate)
  vendor_bk        VARCHAR(50),   -- business key (the natural key)
  load_date        TIMESTAMP,     -- when first seen
  record_source    VARCHAR(50)    -- which source system it came from
);
```

Three rules:
- One hub per business concept across all sources. The S/4 vendor LFA1 and the legacy ECC vendor both load into the same `hub_vendor` (deduplicated by business key after harmonisation rules).
- Hash key (`hk`) is deterministic: typically SHA1/MD5 of the upper-cased, trimmed business key. Same business key → same hash, every source, every time.
- Insert-only. Once a hub row exists, it never changes.

### Link
Represents a *relationship between two or more hubs*. Examples: invoice-line-to-account, customer-to-order, posting-to-account-and-cost-center.

```sql
CREATE TABLE link_posting_account (
  posting_account_hk  BINARY(20),    -- hash of the combined link
  posting_hk          BINARY(20),    -- FK to hub_posting
  account_hk          BINARY(20),    -- FK to hub_account
  load_date           TIMESTAMP,
  record_source       VARCHAR(50)
);
```

- The link's own hash key is the hash of the constituent business keys concatenated.
- Insert-only. Relationships, once observed, are recorded forever.
- "End-dating" relationships (when a customer-vendor link no longer exists) is done via an **effectivity satellite** on the link, not by deleting the link row.

### Satellite
Holds the *descriptive attributes* of a hub or link, with historisation.

```sql
CREATE TABLE sat_vendor_master (
  vendor_hk        BINARY(20),
  load_date        TIMESTAMP,           -- start of validity for this row
  hashdiff         BINARY(20),          -- hash of all descriptive cols
  name             VARCHAR(200),
  vat_id           VARCHAR(50),
  country_code     CHAR(2),
  record_source    VARCHAR(50),
  PRIMARY KEY (vendor_hk, load_date)
);
```

- Insert-only. New row whenever any descriptive attribute changes.
- `hashdiff` = hash of all descriptive columns. If incoming row's hashdiff matches the latest, no insert. If different, insert a new row.
- Multiple satellites per hub allowed and encouraged — one per source system, one per rate of change, one per security classification. E.g. `sat_vendor_master_s4`, `sat_vendor_master_legacy_ecc`, `sat_vendor_payment_terms`, `sat_vendor_tax_attributes`.

---

## 2. The supporting entities

### Hashdiff
The fingerprint of a satellite row's descriptive payload. Used to detect change without column-by-column comparison. Convention: concatenate all descriptive columns with a delimiter, upper-case, trim, hash.

### Effectivity satellite
A specialised satellite on a *link*, with explicit `load_date` and "end_date" (often computed via a window function rather than stored), used to model when a relationship was active.

### PIT (Point-in-Time) table
A pre-computed lookup that gives, for a hub key and a snapshot date, the satellite primary keys to join. Solves the "join three satellites at the same point in time" problem (the cartesian explosion if you don't have a PIT).

### Bridge table
Like a PIT but for traversing multiple hubs through links. Pre-computed many-to-many resolution. Performance optimisation only — not a logical requirement.

### Reference tables
For low-cardinality reference data (currency codes, country codes, doc types). These don't get the hub/sat treatment — they're modelled as plain reference tables.

---

## 3. Raw Vault vs Business Vault

### Raw Vault
- Loaded directly from sources via deterministic rules: hash keys, hashdiffs, source attribution.
- **No business logic.** No filtering, no enrichment, no derived columns beyond what's mechanically computable.
- Holds *what the source said*. Period.

### Business Vault
- Built on top of the Raw Vault.
- Adds derived entities: "computed hubs" (e.g. a merged vendor master from two sources after applying matching rules), "computed satellites" (e.g. a vendor-status satellite derived from multiple sources), "computed links."
- Holds *what the business means*.

The split is non-negotiable for SOX-grade traceability: an auditor can always trace a Business Vault row back to its Raw Vault source.

### Information Marts (the consumption layer)
- Built above the Business Vault for actual consumers.
- Usually dimensional (Kimball-style facts and dimensions).
- This is what BI tools (SAC, ThoughtSpot, Tableau) and dbt downstream models read.

The full picture:
```
Sources ─▶ Raw Vault ─▶ Business Vault ─▶ Information Marts ─▶ BI / consumers
                              │
                              └─▶ Direct consumers (data science) where appropriate
```

---

## 4. The dbt + AutomateDV pattern

[AutomateDV](https://automate-dv.readthedocs.io/) (formerly dbtvault) is the canonical dbt package for generating Data Vault structures. UK-built, open-source, mature.

### What it generates for you
Macros for the standard entity types: `hub`, `link`, `sat`, `eff_sat`, `t_link` (transactional link), `pit`, `bridge`, plus staging helpers (hash key generation, hashdiff generation).

### Minimal example — a hub model

```sql
-- models/raw_vault/hub_vendor.sql
{{ config(materialized='incremental') }}

{%- set yaml_metadata -%}
source_model:
  stg_s4_vendor: 'vendor_hk'
  stg_legacy_vendor: 'vendor_hk'
src_pk: 'vendor_hk'
src_nk: 'vendor_bk'
src_ldts: 'load_date'
src_source: 'record_source'
{%- endset -%}

{%- set metadata_dict = fromyaml(yaml_metadata) -%}

{{ automate_dv.hub(
    src_pk=metadata_dict['src_pk'],
    src_nk=metadata_dict['src_nk'],
    src_ldts=metadata_dict['src_ldts'],
    src_source=metadata_dict['src_source'],
    source_model=metadata_dict['source_model']
) }}
```

A hub macro generates the standard "select where business key doesn't already exist in target" pattern. Multiple source models can feed the same hub.

### Staging models
Before a hub/link/sat can be built, you need staging models that compute the hash key + hashdiff. AutomateDV provides macros for these too.

```sql
-- models/staging/stg_s4_vendor.sql
{{
  automate_dv.stage(
    include_source_columns=true,
    source_model='raw_s4_vendor',
    derived_columns={'record_source': '!S4_VENDOR_FEED'},
    hashed_columns={
      'vendor_hk': 'vendor_bk',
      'vendor_master_hashdiff': ['name', 'vat_id', 'country_code']
    }
  )
}}
```

### Materialisation strategy
- Hubs / links / satellites: **incremental**. Insert-only. No updates.
- PITs / bridges: typically incremental with a snapshot-date cadence.
- Information marts: depends — dimensional facts often incremental, dimensions sometimes table or merge.

### The repo shape you want for the portfolio piece
```
dbt_project/
├── models/
│   ├── staging/                 # per-source staging (hashes, hashdiffs)
│   │   ├── stg_s4_vendor.sql
│   │   ├── stg_s4_gl_postings.sql
│   │   └── stg_s4_accounts.sql
│   ├── raw_vault/
│   │   ├── hub_vendor.sql
│   │   ├── hub_posting.sql
│   │   ├── hub_account.sql
│   │   ├── link_posting_account.sql
│   │   ├── link_posting_vendor.sql
│   │   ├── sat_vendor_master.sql
│   │   ├── sat_posting_attributes.sql
│   │   └── sat_account_master.sql
│   ├── business_vault/
│   │   └── bv_vendor_consolidated.sql
│   └── marts/
│       └── fact_gl_postings.sql
├── seeds/
└── dbt_project.yml
```

Use Snowflake free trial; load TPC-H or fake-GL CSVs. Build, run, document. **This is your "I've actually done it" artefact for the design round.**

---

## 5. Modelling SAP-origin data — patterns

### Universal Journal (ACDOCA)
- `hub_posting` — business key is the document number + company code + fiscal year (composite).
- `link_posting_account` — relates a posting to its GL account.
- `link_posting_cost_center` — relates a posting to its cost centre.
- `link_posting_vendor` — relates to vendor when AP.
- `link_posting_customer` — relates to customer when AR.
- `sat_posting_attributes` — amount, currency, posting date, doc type, text.

### Business Partner (BUT000 + KNA1 + LFA1)
- `hub_business_partner` — business key is the BP number.
- `sat_bp_general` — common attributes (name, address, country).
- `sat_bp_customer_role` — customer-side attributes (credit limit, etc.).
- `sat_bp_vendor_role` — vendor-side attributes (payment terms, etc.).
- Multiple satellites on the same hub = clean separation of role-specific data.

### Master data harmonisation
- One hub per business concept across sources.
- Multiple staging models per source feeding the same hub.
- Source-attribution in `record_source` lets you trace which source created a hub row.
- Conflict resolution between sources lives in the Business Vault, not the Raw Vault.

---

## 6. When NOT to use Data Vault

The dirty secret: DV2.0 is wonderful for some things and overkill for others.

**Good fit:**
- Multi-source warehouses with sources that evolve frequently.
- Audit-heavy estates (finance, healthcare, regulated industries).
- Large estates where lineage and historisation matter long-term.
- Estates anticipating source-system migrations (e.g. ECC → S/4) — DV survives that gracefully.

**Bad fit:**
- Small single-source warehouses where dimensional alone suffices.
- High-velocity, low-latency use cases — DV's verbosity adds joins, adds query cost. Use streaming + denormalised serving layer.
- Teams without strong dbt / SQL maturity. DV done badly is worse than dimensional done well.
- Use cases where the consumption layer dominates effort and the integration is trivial.

**The honest architect's framing:** *"DV2.0 over the Raw layer for SAP-origin finance data makes sense; the analytical marts above it stay dimensional for the consumers. DV everywhere is a smell."*

---

## 7. Vocabulary

- *"Hub-link-satellite"* — never "DV tables."
- *"Hashdiff"* — for change detection.
- *"Effectivity satellite"* — for relationship lifecycle on links.
- *"PIT and Bridge"* — for join-performance optimisations.
- *"Raw Vault vs Business Vault"* — always frame the split explicitly.
- *"Insert-only"* — the methodology's defining property.
- *"Source-system agility"* — the architectural reason it exists.

---

## 8. Practice / output

By end of week 4, you should have:

1. A working dbt + AutomateDV portfolio repo modelling a fake GL/AR/AP source as Raw Vault + Business Vault + a fact mart on Snowflake free trial. Public or private — both work.
2. A README in that repo that explains the model in 200 words and includes one architectural decision record (why DV here, why not dimensional-only).
3. A one-page mental sketch you can draw on a whiteboard: source → staging → hubs/links/sats → business vault → mart.

In the design round, having the repo *exists* (you don't have to show it) gives you the calm of someone who's done the thing.

---

## 9. Things to skip

- Inmon vs Kimball vs DV religious wars — name them, don't enter them.
- Deep DV history (1.0 → 2.0 evolution) — irrelevant in interviews.
- Manual SQL for hub/link/sat building — AutomateDV handles it; understand the pattern, don't memorise the verbose form.

---

