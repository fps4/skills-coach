---
title: Pharma R&D data, real-world data and GxP
summary: The vocabulary and constraints software meets on clinical and real-world health data — the development pipeline, CDISC and OMOP, GxP validation, data integrity, and what an AI product in this domain needs.
---

## Frame

Software for scientists, statisticians and medical teams runs on data with stricter rules than retail.
The goal of this guide: **recognise the words, know which ones change the delivery plan, and ask the
right first questions.**

## 1. The drug development pipeline

| Stage | What happens | Data it produces |
|---|---|---|
| Discovery / research | Targets, compounds, assays, omics | Lab and assay data, ELN, LIMS, sequencing |
| Pre-clinical | Animal and lab safety studies | Study reports (GLP regulated) |
| Phase I | First in humans, safety, dose | Small trial datasets |
| Phase II | Efficacy signal, dose finding | Trial datasets |
| Phase III | Confirmatory, large, multi-site | The datasets submitted to regulators |
| Submission | FDA / EMA review | Submission package (CDISC formats) |
| Phase IV / post-market | Real-world safety and effectiveness | Pharmacovigilance cases, RWD studies |

"Biomedical" usually means the research / omics end; "clinical" the trial end; "RWD" the post-market
end. Ask which one a product serves — they have different rules.

## 2. Clinical trial data

- **Systems:** EDC (electronic data capture — Medidata Rave, Veeva Vault EDC), CTMS (trial management
  — sites, enrolment, milestones), eTMF (trial master file — documents), IRT/RTSM (randomisation and
  drug supply), safety databases (Argus, Veeva Safety).
- **Standards (CDISC):** **CDASH** for collection, **SDTM** for tabulated submission data (domains
  like DM demographics, AE adverse events, LB labs), **ADaM** for analysis datasets. If a product
  touches submission data, these formats are the contract.
- **Blinding.** In a blinded trial, who knows which arm a subject is on is restricted. A system that
  can see unblinded data must not be usable by a blinded user — anything derived from restricted data
  inherits the restriction.
- **Subjects are pseudonymised**, not anonymous: subject IDs, site IDs. Re-identification risk is real
  with small sites or rare diseases.

## 3. Real-world data (RWD) and evidence (RWE)

- **Sources:** EHR, claims, disease registries, wearables, patient-reported outcomes. RWE is what is
  concluded from RWD.
- **Common data model: OMOP CDM** (OHDSI) — person, visit, condition, drug exposure, measurement. Many
  pharma RWD platforms harmonise into OMOP. Its core tables are the RWD equivalent of knowing a star
  schema.
- **Licences and data-use agreements** limit what each dataset may be used for, by whom, and whether
  it may be combined with others. A system that joins two RWD sources may break a licence — the "what
  may this user see / combine" check is a delivery item, not a legal footnote.
- **Cohorts and phenotypes** — a cohort definition (who counts as "patient with condition X") is the
  RWD version of "active customer": several defensible definitions with different owners. A product
  must say which definition it used.

## 4. Regulation that touches software

| Term | What it means for delivery |
|---|---|
| **GxP** (GCP, GLP, GMP, GVP) | "Good x Practice" — quality rules per area. If a system supports a GxP process, it must be validated |
| **CSV / CSA** | Computer System Validation; FDA's newer *Computer Software Assurance* is risk-based and lighter. Validation means documented requirements, risk assessment, testing against them, and change control |
| **GAMP 5** (2nd ed., 2022) | ISPE guidance for validating computerised systems; has explicit material on AI/ML and agile delivery |
| **21 CFR Part 11 / EU GMP Annex 11** | Electronic records and signatures: audit trails, access control, signature meaning |
| **ALCOA+** | Data integrity: Attributable, Legible, Contemporaneous, Original, Accurate + Complete, Consistent, Enduring, Available. An AI system's answer and its sources should be ALCOA-shaped |
| **GDPR (health data = special category)** | Legal basis, purpose limitation, minimisation; secondary use of trial data needs its own basis. Swiss nFADP where Swiss law applies |
| **EU AI Act** | Most R&D decision-support agents are not high-risk; anything that is part of a medical device or used for patient-level clinical decisions may be. Ask, do not assume |

**Delivery consequence.** Ask in week one: *is this product in GxP scope?* If yes, the release process
includes a validation package and Quality sign-off, and the evaluation battery becomes validation
evidence — plan for weeks, not days. If no (many exploratory R&D tools), say so in writing so nobody
assumes later that it was.

## 5. What an AI or agentic product needs in this domain

1. **An evaluation set signed by a scientific owner**, scored at least as correct / refused /
   confidently wrong / leaked. "Confidently wrong" is the one that matters in science.
2. **Citations to source records**, not summaries without sources — ALCOA's "attributable".
3. **Access decided before retrieval** — blinding, consent, data-use limits applied in the query, not
   redacted from the answer afterwards.
4. **An audit record per answer** that Quality or Compliance can read without engineering help.
5. **Model and prompt changes under change control** — a model upgrade is a change to a validated
   system if the product is in GxP scope.

## 6. First questions for the scientific owners

1. Which stage and which data — research, trial, post-market RWD?
2. Is any of it unblinded, patient-level, or under a data-use agreement with limits?
3. What would a wrong answer cost — a wasted experiment, a wrong decision on a trial, a missed safety
   signal?
4. Who signs that the system is good enough, and on what evidence?
5. Is the product in GxP scope, and who in Quality is the counterpart?

## Sources

- CDISC: SDTM and ADaM overviews (cdisc.org).
- OHDSI *Book of OHDSI*, chapters on the CDM and on cohorts (free online).
- FDA guidance *Computer Software Assurance for Production and Quality System Software* (final 2025).
- ISPE GAMP 5 Second Edition — the AI/ML appendix.
- EMA reflection paper on AI in the medicinal product lifecycle (2024).
