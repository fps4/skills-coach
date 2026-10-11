---
title: Tax, regulatory and compliance data flows
summary: The EU and global regimes that shape a finance data estate — DAC7, ViDA, SAF-T, e-invoicing, PSD2, SOX and GDPR — and what data, lineage, immutability and retention each one demands.
---

## Frame

For a large marketplace or multi-entity group, tax and regulatory reporting is not a quiet corner of
the finance estate — it is the most schedule-pressured workstream in it, because regulators publish
dates and enterprises miss them at their peril. The aim of this guide: name the regimes that drive
architecture decisions, and say what *data* each needs, who owns it, and what the lineage,
immutability and retention story looks like.

Three meta-points:

1. **Tax and regulatory flows are the cleanest data products in the wild.** Each regime has a fixed
   schema, a fixed cadence, a regulator as the consumer and audit-grade evidence requirements. They
   map directly onto data-contract / data-product / data-mesh thinking.
2. **Immutability and lineage are non-negotiable.** Once a figure has gone to a tax authority it cannot
   be quietly fixed. The architecture must preserve *what was reported, when, on what data*.
3. **The regulator's calendar is the roadmap.** ViDA's 2027–2030 phasing, DAC7's annual deadlines,
   e-invoicing mandates — these are immovable, and they tend to dominate a multi-year finance-systems
   roadmap.

---

## 1. DAC7 — EU Council Directive 2021/514

### What it is

An EU directive requiring digital platforms to **report the income of their sellers to tax
authorities** in the member states where the sellers reside or where the property is located. In force
since 2023; annual reports due 31 January for the prior calendar year.

### Who is in scope

Platforms facilitating: rental of immovable property (hotels, holiday rentals), personal services,
sale of goods, and rental of any mode of transport.

### What the platform must collect and report

For each *reportable seller*:

- Identification: name, primary address, TIN, VAT ID, date of birth (individuals), business
  registration (entities).
- Activity: total consideration received per quarter, per reportable activity, per jurisdiction, per
  property (for immovable property).
- Property: address and land-registration number.
- Fees, commissions and taxes withheld by the platform.

### Architecture implications

- **Master data:** seller records must be reliable, deduplicated and resolvable to a single golden
  record — across brands, if there are several. Harder than it sounds at scale.
- **Transactions:** every payable transaction must be attributable to a reportable seller with the
  right tax attributes — joins across order, partner, payment, refund and chargeback.
- **Format:** an XML schema specified by each member state's tax authority (usually based on a common
  EU schema, with local variations).
- **Submission:** API or portal upload, per member state — potentially 20+ destinations.
- **Audit trail:** the exact dataset submitted must be retrievable years later.

### Design discipline

A DAC7 pipeline is a textbook data product: an owned dataset, a fixed schema (the regulator's), a
fixed consumer (the regulator), an SLA (the annual deadline), retention (typically ten years), and an
immutable snapshot per submission.

---

## 2. ViDA — VAT in the Digital Age

### What it is

An EU package adopted in 2024, phased in **2027–2030**. Three pillars:

1. **Single VAT registration** — extending the One-Stop-Shop so a business can handle EU-wide VAT
   through one registration.
2. **Platform-economy rules** — for short-term accommodation rental and passenger transport,
   **platforms become deemed suppliers** for VAT when the underlying supplier does not charge VAT
   (e.g. an individual host).
3. **Digital reporting and e-invoicing** — mandatory structured e-invoicing for intra-EU B2B and
   near-real-time digital reporting to tax authorities, replacing periodic recapitulative statements.

### Timeline (broad strokes)

- **2027:** platform-economy rules begin; member states may require structured e-invoicing.
- **2030:** mandatory digital reporting for intra-EU B2B; mandatory structured e-invoicing.

### Architecture implications

- **The deemed-supplier rule is the big one** for an in-scope platform: it becomes VAT-liable where
  the host is not VAT-registered. VAT calculation moves into the checkout and payment flow, is posted to the
  GL, and is reported to multiple jurisdictions.
- **Near-real-time digital reporting** ends the era of monthly periodic reports for some flows; the
  architecture has to support per-transaction, per-day cadences.
- **E-invoicing** (Peppol-based or country formats such as Italy's FatturaPA, France's Factur-X,
  Germany's XRechnung/ZUGFeRD) needs an outbound integration capability with the right schema per
  destination country.

### DAC7 vs ViDA

DAC7 is *information reporting* about other people's income. ViDA changes *who owes VAT* and moves VAT
reporting towards per-transaction, near-real-time digital reporting.

### Investments to make now

Per-transaction VAT calculation in the checkout and payment flow; an immutable VAT ledger separate from the
financial GL; an outbound e-invoicing capability; multi-jurisdiction reporting orchestration.

---

## 3. SAF-T — Standard Audit File for Tax

### What it is

An OECD-defined XML format that tax authorities can request, containing detailed accounting and
transactional data for an audit period. Originated in 2005; adopted with local variations by roughly
15 countries (the Netherlands, Portugal, France, Norway, Poland, Lithuania, Romania and others).

### Typical sections

- General ledger (chart of accounts, postings)
- Customers, suppliers, products
- Sales invoices, purchase invoices
- Payments
- Inventory movements (where applicable)
- Master files (taxonomies, tax codes)

### Architecture implications

- **It is a "give us your books" file.** The challenge is being able to *produce* it on demand, per
  jurisdiction, consistently across source systems.
- **Per-country variations are real.** Portugal requires monthly submission; the Netherlands requests
  it during audits; Poland requires *JPK* (its SAF-T variant) on a strict monthly cadence.
- **Common answer:** materialise a canonical **audit dataset** in the lakehouse — chart of accounts,
  postings, master data — versioned and immutable, with a generator that renders per-country SAF-T XML
  on request.

For a multi-jurisdiction, multi-entity group, audit requests arrive unpredictably; producing SAF-T
fast means lower audit cost and lower regulatory risk.

---

## 4. E-invoicing mandates — the country-by-country map

The EU is fragmenting fast on e-invoicing. What matters is knowing *that* it matters, not memorising
every format:

| Country | Format | B2B mandate status (mid-2026) |
|---|---|---|
| Italy | FatturaPA via SdI | Mandatory since 2019 |
| France | Factur-X / Chorus Pro | Mandate phasing 2026–2027 |
| Germany | XRechnung / ZUGFeRD | Mandatory receive 2025; mandatory send 2027–2028 |
| Belgium | Peppol BIS | Mandate 2026 |
| Spain | Facturae / VeriFactu | Mandate phasing |
| Poland | KSeF | Delayed, expected 2026–2027 |
| Netherlands | Peppol BIS (preferred) | Voluntary; required for the public sector |

**Takeaway:** outbound e-invoicing is a **capability, not a project** — best built as one service
that adapts to per-country profiles. Inbound is similar: suppliers and partners send invoices in many
formats.

---

## 5. PSD2 — Payment Services Directive 2

### What it is

An EU directive in force since 2018 regulating payment service providers and electronic payments. It
mandates **strong customer authentication (SCA)** and opens APIs to licensed third parties providing
**payment initiation (PIS)** and **account information (AIS)** services.

### Why it matters

- **Merchant-of-record exposure.** The merchant of record is the party that charges the card, refunds
  and handles chargebacks. A business that operates as merchant of record must implement SCA flows end
  to end, and FX, refunds, chargebacks and VAT all run through its own finance stack.
- **Tokenisation and 3DS2** flow through the payment data architecture.
- **PSD3 is coming** — proposed in 2023, adoption expected in the late 2020s: tighter fraud rules,
  refined SCA exemptions, data sharing widened towards *open finance* beyond payments.

### Architecture implications

- **Payment events are first-class data** — streamed into the finance estate and reconciled against
  business events, GL postings and acquirer settlement files.
- **PII handling** — card data tokenised and vaulted to reduce PCI DSS scope.

---

## 6. SOX — Sarbanes-Oxley

Any US-listed group is in SOX scope. The data architect is not the SOX owner, but makes the decisions
that determine SOX cost and risk.

### Three SOX-touching architecture controls

1. **Segregation of duties (SoD)** — no single role can both originate and approve a financial
   change. Dataset access controls (policy engines, warehouse RBAC) must separate ops, developers and
   finance users on finance data.
2. **Change-management evidence** — every code change touching finance data needs auditable approval:
   transformation-model changes, pipeline DAG changes and schema changes all carry a PR, a reviewer and
   a ticket link an auditor can pull years later.
3. **Lineage for audit** — the auditor asks "where did this figure in the annual report come from?"
   The answer must trace end to end from source to disclosure, so lineage tooling (OpenLineage, a data
   catalogue, dbt docs, custom) is not optional.

### What auditors actually ask for

- Access lists at a point in time.
- Change history for specific objects (tables, views, models) over the year.
- Reconciliation evidence between the system of record and analytical figures.
- Sample testing — pull ten transactions and show full lineage.

### Framing

SOX is not a control bolted on — it is an architecture property. Lineage, immutability and access
governance designed in from day one make audits cheap; designed out, they make audits brutal.

---

## 7. GDPR for finance data

Often treated as a customer-data topic, but **finance data has GDPR implications too**:

- **Partner and supplier individuals** (sole traders, freelancers, hosts) are natural persons, so
  their data is personal data.
- **Right to erasure vs retention for tax.** Retention usually wins, but the architecture must support
  tagged retention windows and a clear deletion path once retention expires.
- **Data residency** — postings touching EU data subjects often need to stay on EU infrastructure;
  finance estates with warehouses in US regions get scrutinised.
- **Cross-border transfers** — Standard Contractual Clauses and Transfer Impact Assessments; a
  recurring conversation for any group with a non-EU parent, EU operations and global hyperscalers.

---

## 8. Pressures that compound for large platforms

- **DMA gatekeeper obligations.** A platform designated as a gatekeeper under the Digital Markets Act
  owes partners real-time data access and data portability. That reaches into the finance estate
  (partner economics, commission reporting) and demands low-latency, API-grade access to data that has
  traditionally been batch-warehouse only.
- **Moving to merchant of record.** Every merchant transaction widens the surface for FX, refunds,
  chargebacks, SCA and VAT — at far higher volume than an agency model.
- **Multi-brand, multi-jurisdiction.** Each brand has its own tax footprint, jurisdiction map and
  partner population; SAF-T, DAC7, ViDA and e-invoicing are solved per brand and per country.

---

## 9. The data architect's regulatory checklist

For any tax or regulatory pipeline, walk this list:

1. **Source of truth** — which system is the system of record?
2. **Master-data resolution** — a golden record for the entities being reported (sellers, partners,
   customers).
3. **Schema** — regulator-defined; not negotiable.
4. **Cadence** — annual, monthly, near-real-time?
5. **Immutability** — submitted data must be reproducible: a snapshot per submission.
6. **Lineage** — source-to-submission traceability for auditors.
7. **Retention** — typically 7–10 years; tagged and governed.
8. **Per-jurisdiction profiles** — one logical pipeline, many output formats.
9. **Reconciliation** — back to the GL and the source systems, sample-testable.
10. **Submission integration** — API, portal or file drop; error handling, retries and idempotency, so
    a resubmission never doubles a report.
