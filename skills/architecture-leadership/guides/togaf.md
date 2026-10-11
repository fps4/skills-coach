---
title: TOGAF for architects
summary: The ADM, the BDAT domains, building blocks and architecture governance — TOGAF as a working method rather than a catalogue of artefacts.
---

## Frame

A refresher for an architect who knows TOGAF but has not used its vocabulary actively for a while.
The aim is to speak TOGAF fluently in an architecture team, to place it next to DMBOK, Data Mesh and
cloud-native practice, and to bring its discipline to a fast-moving estate without either reciting the
specification or rejecting it.

Three mental models:

1. **TOGAF is a method, not an inventory.** Treating it as a catalogue of artefacts to produce is the
   junior reading. The *Architecture Development Method (ADM)* is a thinking cadence; skip the
   artefacts that do not earn their keep.
2. **The four domains (BDAT) are the universal grouping.** Business → Data → Application →
   Technology. Almost every enterprise-architecture conversation maps onto one of these layers, even
   when nobody says "TOGAF".
3. **TOGAF, DMBOK and Data Mesh are complementary.** TOGAF gives the method and governance, DMBOK the
   data-management vocabulary, Data Mesh the organisational shape.

---

## 1. Versions

- **TOGAF 9.2** (2018) was the long-stable version.
- **TOGAF 10** (April 2022) is a restructure rather than a rewrite: same ADM, same BDAT, same
  Enterprise Continuum, split into the **TOGAF Fundamental Content** and separately versioned
  **TOGAF Series Guides**.
- In conversation, 9 and 10 are interchangeable; the substance is unchanged.

---

## 2. The ADM

A cyclical process of a Preliminary phase and eight phases, with Requirements Management at the
centre:

```
       Preliminary  ─────────────┐
            │                     │
            ▼                     │
    A. Architecture Vision        │
            │                     │
            ▼                     │
    B. Business Architecture      │
            │                     │
            ▼                     │
    C. Information Systems        │     Requirements
       (Data + Application)       │     Management
            │                     │     (the centre)
            ▼                     │
    D. Technology Architecture    │
            │                     │
            ▼                     │
    E. Opportunities & Solutions  │
            │                     │
            ▼                     │
    F. Migration Planning         │
            │                     │
            ▼                     │
    G. Implementation Governance  │
            │                     │
            ▼                     │
    H. Architecture Change Mgmt   │
            │                     │
            └─── loop back ────────┘
```

| Phase | One-liner |
|---|---|
| **Preliminary** | Establish the architecture capability — frameworks, principles, governance, tools. |
| **A. Vision** | What is this initiative trying to achieve at a strategic level? Get sponsor sign-off. |
| **B. Business** | Model the business processes, organisation and capabilities the architecture must support. |
| **C. Information Systems — Data** | Logical data model, data architecture decisions. *(DMBOK lives here.)* |
| **C. Information Systems — Application** | Application landscape, integration patterns, app rationalisation. |
| **D. Technology** | Infrastructure, platforms, cross-cutting technology standards. |
| **E. Opportunities & Solutions** | Identify gap-closing work; group it into projects and programmes. |
| **F. Migration Planning** | Sequence and dependencies; transition architectures. |
| **G. Implementation Governance** | Architecture compliance during build and run. |
| **H. Architecture Change Management** | Ongoing change governance after delivery. |
| **Requirements Management** | The centre — feeds and is fed by every phase. |

### The ADM as a menu

Nobody walks all eight phases for every change. For a contained workstream you might do A → C → D
and skip the rest; for a multi-year platform migration you do the whole cycle, slowly. How much of
the ADM to invoke depends on the size of the bet.

---

## 3. The BDAT domains

1. **Business Architecture** — capabilities, value streams, organisation, processes. *Who does what
   and why.*
2. **Data Architecture** — entities, models, flows, master and reference data, lineage. *What
   information exists and how it moves.*
3. **Application Architecture** — applications, services, interfaces. *What software runs and how it
   talks.*
4. **Technology Architecture** — infrastructure, platforms, cloud, networks. *What it runs on.*

The order matters: **Business drives Data drives Application drives Technology**. Starting with
technology, or with a vendor choice, inverts the discipline. Real engagements are messier, but the
framework gives you the language to push back.

---

## 4. Building blocks — ABBs and SBBs

- **ABB (Architecture Building Block)** — generic, capability-defined, vendor-neutral. E.g. "a
  customer master data service".
- **SBB (Solution Building Block)** — the implementation choice. E.g. a named MDM product on a named
  cloud.

Design at the ABB level, then choose the SBB once it has been checked against the principles and the
build-versus-buy criteria. Separating intent from implementation is the guard against vendors pushing
solutions before requirements.

---

## 5. Enterprise Continuum and Architecture Repository

- **Enterprise Continuum** — a spectrum from generic, industry-standard architectures down to
  organisation-specific ones. It helps you ask whether a pattern is universal or local.
- **Architecture Repository** — where architecture artefacts live: the Continuum, reference models,
  standards, the Architecture Landscape (current state) and the Solutions Landscape.

In practice the Repository is a mix of wiki pages, diagrams, an EA tool (Sparx EA, BiZZdesign,
LeanIX, Ardoq) and source code. TOGAF's point is *that you have one*, not which tool you use.

---

## 6. Architecture governance

- **Architecture Review Board (ARB)** — the standing body that reviews proposed architectures for
  compliance with principles and standards.
- **Architecture Compliance Review** — the act of reviewing one design against the standards.
  Outcomes: compliant, non-compliant, or conditional approval with dispensations.
- **Architecture Contract** — a formal agreement between architecture and an implementation team
  about what will be delivered, to what standard.
- **Dispensation** — a formal, time-bounded exception to a standard with a remediation plan. This is
  how architectural debt is tracked instead of silently allowed.

Principles, standards, reference architectures and the ARB process together are what make
architecture *enforceable* rather than aspirational.

---

## 7. TOGAF, DMBOK and Data Mesh

| Framework | What it gives you |
|---|---|
| TOGAF | The *method* — ADM, BDAT domains, governance discipline, building blocks |
| DMBOK | The *vocabulary* — data-management knowledge areas, data-quality dimensions, master vs reference |
| Data Mesh | The *organisational shape* — domain ownership, data as a product, federated governance |

You do not choose between them. TOGAF supplies the method and governance backbone, DMBOK the
vocabulary used inside Phase C, and Data Mesh the organisational shape that makes federated
governance work at scale. They overlap deliberately.

---

## 8. Where TOGAF is overkill

Three valid critiques:

1. **Artefact-heavy in its full form.** A small workstream does not need a Vision document, a
   capability map *and* a migration plan. Use the cadence; skip the paperwork.
2. **Slow at cloud-native speed.** TOGAF was shaped by 2000s-era enterprise IT. Use the ADM at the
   *strategic* layer (multi-year roadmaps, cross-domain decisions) and lighter tools — RFCs, ADRs,
   OKRs — at the *tactical* layer.
3. **No native data-product thinking.** Phase C was conceived in a warehouse-and-MDM era, not a
   data-mesh-and-streaming one. Fill the gap with DMBOK and Data Mesh.

The mistake is treating every change as a full ADM cycle.

---

## 9. Architecture principles

A principle is a one-line rule of the road with a *because* clause. Examples of the kind a data
estate might hold:

- *Cloud-first, multi-cloud-aware* — because platform choices should not lock out business units.
- *Data as a product* — because regulatory and analytical reporting are natural data-product surfaces.
- *Compliance built in by design* — because after-the-fact governance is penalised.
- *ABB before SBB* — because vendor-led design is a constant temptation in an integration estate.
- *Federated governance with central policy* — because domain autonomy and cross-domain audit
  obligations have to coexist.

Architectural debt is handled the same way as any other: a backlog item, tracked through the ARB,
with time-bounded dispensations.

---

## 10. Vocabulary

- *ADM Phase C* — data and application architecture work.
- *Business → Data → Application → Technology* — sequencing a design conversation.
- *ABB before SBB* — resisting vendor-led design.
- *Architecture compliance review* — reviewing a design against standards.
- *Transition architecture* — an intermediate, deliverable state between baseline and target.
- *Architecture principles* — the shared rules of the road.
- *Dispensation* — a formal, time-bounded exception.
- *Architecture Contract* — the agreement between architecture and delivery teams.

---

## 11. Things to skip

- Memorising all the ADM deliverables. Use them when relevant.
- Deep TOGAF 9 → 10 migration mechanics.
- Religious wars with Zachman, FEAF or DoDAF — name them, do not enter them.
