---
title: Data Vault 2.0 with dbt and AutomateDV
summary: Hubs, links and satellites, the raw/business vault split, and how dbt with AutomateDV builds them — plus when a vault is the wrong choice.
---

## Frame

Data Vault 2.0 (DV2.0) is one of the three modelling methodologies an enterprise data architect
needs (alongside Kimball dimensional and 3NF/Inmon). It excels at the *raw* / *integration* layer
of a warehouse — auditability, scalability, lineage, source-system agility — the shape of an
ERP-anchored, multi-source finance estate. For where it sits among the other methodologies, see
[Data modelling — levels, methodologies and tools](./data-modeling.md).

Three mental models:

1. **Hubs are nouns, links are verbs, satellites are descriptions.** Hub = the business key of a
   thing. Link = a relationship between things. Satellite = attributes that change over time.
2. **DV2.0 is the raw layer, not the consumption layer.** Reports don't read the vault directly.
   A business vault or information mart (often dimensional) always sits above it.
3. **It exists for source-system agility.** If a new source for "vendor" arrives next year, you don't
   change the hub — you add a satellite. Downstream is unchanged. This is the wedge over
   star-schema-only architectures.

---

## 1. The three core entities

### Hub
The *business key* of an entity (customer, vendor, invoice), plus metadata.

```sql
CREATE TABLE hub_vendor (
  vendor_hk        BINARY(20),    -- hash key (the surrogate)
  vendor_bk        VARCHAR(50),   -- business key (the natural key)
  load_date        TIMESTAMP,     -- when first seen
  record_source    VARCHAR(50)    -- which source system it came from
);
```

- One hub per business concept across all sources. The vendor from S/4HANA (LFA1) and the vendor
  from a legacy ECC system load into the same `hub_vendor`, deduplicated by business key after
  harmonisation rules.
- The hash key is deterministic: typically SHA1/MD5 of the upper-cased, trimmed business key. Same
  business key → same hash, every source, every load, no lookup.
- Insert-only. A hub row never changes.

### Link
A *relationship between two or more hubs*: invoice-line-to-account, customer-to-order,
posting-to-account-and-cost-centre.

```sql
CREATE TABLE link_posting_account (
  posting_account_hk  BINARY(20),    -- hash of the combined link
  posting_hk          BINARY(20),    -- FK to hub_posting
  account_hk          BINARY(20),    -- FK to hub_account
  load_date           TIMESTAMP,
  record_source       VARCHAR(50)
);
```

- The link's hash key is the hash of the constituent business keys concatenated.
- Insert-only. An observed relationship is recorded forever.
- Every link is many-to-many, even when the source says one-to-many.
- Ending a relationship is done with an **effectivity satellite** on the link, never by deleting the
  link row.

### Satellite
The *descriptive attributes* of a hub or link, historised.

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

- Insert-only. A new row whenever any descriptive attribute changes; validity ends where the next
  row starts.
- `hashdiff` = hash of all descriptive columns. If the incoming hashdiff matches the latest, no
  insert.
- Several satellites per hub are encouraged — one per source system, per rate of change, per
  security classification (`sat_vendor_master_s4`, `sat_vendor_payment_terms`,
  `sat_vendor_tax_attributes`).

---

## 2. The supporting entities

- **Hashdiff** — the fingerprint of a satellite row's descriptive payload: concatenate descriptive
  columns with a delimiter, upper-case, trim, hash. Detects change without column-by-column comparison.
- **Effectivity satellite** — a satellite on a *link* recording when the relationship was active
  (end date often computed with a window function rather than stored).
- **PIT (point-in-time) table** — for a hub key and a snapshot date, the satellite keys to join.
  Solves joining three satellites "as of" one moment without a cartesian explosion.
- **Bridge table** — like a PIT but across several hubs through links; precomputed many-to-many
  resolution. A performance aid, not a logical requirement.
- **Reference tables** — low-cardinality codes (currencies, countries, document types) are plain
  reference tables, not hubs and satellites.

---

## 3. Raw Vault vs Business Vault

### Raw Vault
- Loaded from sources by deterministic rules: hash keys, hashdiffs, source attribution.
- **No business logic** — no filtering, enrichment or derived columns beyond what is mechanically
  computable.
- Holds *what the source said*.

### Business Vault
- Built on top of the Raw Vault.
- Adds computed hubs (e.g. a merged vendor master after matching rules), computed satellites (a
  vendor status derived from several sources) and computed links.
- Holds *what the business means*.

The split is what makes the estate audit-grade: every Business Vault row traces back to the
unaltered Raw Vault row it came from.

### Information marts
- The consumption layer above the Business Vault, usually Kimball facts and dimensions.
- What BI tools and downstream dbt models read.

```
Sources ─▶ Raw Vault ─▶ Business Vault ─▶ Information Marts ─▶ BI / consumers
                              │
                              └─▶ Direct consumers (data science) where appropriate
```

---

## 4. dbt + AutomateDV

[AutomateDV](https://automate-dv.readthedocs.io/) (formerly dbtvault) is the open-source dbt package
for generating Data Vault structures. Its macros cover `hub`, `link`, `sat`, `eff_sat`, `t_link`
(transactional link), `pit` and `bridge`, plus staging helpers for hash keys and hashdiffs.

### A hub model

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

The hub macro generates the "insert where the business key is not yet in the target" pattern, and
several staging models can feed one hub.

### Staging models
Before a hub, link or satellite can be built, staging computes the hash key and hashdiff:

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

### Materialisation
- Hubs, links, satellites: **incremental**, insert-only, no updates.
- PITs and bridges: incremental on a snapshot-date cadence.
- Information marts: facts often incremental; dimensions table or merge.

### Project layout

```
dbt_project/
├── models/
│   ├── staging/                 # per-source staging (hashes, hashdiffs)
│   ├── raw_vault/               # hub_*, link_*, sat_*
│   ├── business_vault/          # computed hubs/links/sats
│   └── marts/                   # facts and dimensions
├── seeds/
└── dbt_project.yml
```

---

## 5. Modelling SAP-origin data

### Universal Journal (ACDOCA)
- `hub_posting` — business key: document number + company code + fiscal year (composite).
- `link_posting_account`, `link_posting_cost_center`, `link_posting_vendor` (AP),
  `link_posting_customer` (AR).
- `sat_posting_attributes` — amount, currency, posting date, document type, text.

### Business Partner (BUT000 + KNA1 + LFA1)
- `hub_business_partner` — business key: the BP number.
- `sat_bp_general` — name, address, country.
- `sat_bp_customer_role` — credit limit and other customer-side attributes.
- `sat_bp_vendor_role` — payment terms and other vendor-side attributes.

Several satellites on one hub keep role-specific data cleanly apart.

### Master-data harmonisation
- One hub per business concept across sources; several staging models feed it.
- `record_source` traces which source created a hub row.
- Conflict resolution between sources lives in the Business Vault, not the Raw Vault.

---

## 6. When not to use Data Vault

**Good fit:**
- Multi-source warehouses whose sources evolve often.
- Audit-heavy domains (finance, healthcare, regulated industries).
- Large estates where lineage and history matter long-term.
- Estates expecting a source-system migration (e.g. ECC → S/4HANA).

**Bad fit:**
- Small single-source warehouses where dimensional alone suffices.
- Low-latency use cases — the extra joins add query cost; use streaming plus a denormalised serving
  layer.
- Teams without strong dbt / SQL maturity. A vault done badly is worse than a star done well.
- Work dominated by the consumption layer, where integration is trivial.

A vault for the raw layer with dimensional marts above is a sound default for multi-source finance
data. A vault everywhere is a smell.

---

## 7. Out of scope here

- Inmon vs Kimball vs Data Vault debates — name them, don't enter them.
- DV 1.0 → 2.0 history.
- Hand-written SQL for hub/link/satellite loading — understand the pattern; the macros write it.
