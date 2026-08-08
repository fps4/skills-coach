---
title: TOGAF Refresher — Architect's Edition
summary: The ADM, building blocks, the Enterprise Continuum and ARB governance — plus where TOGAF fits against DMBOK, Data Mesh and cloud-native practice.
topic: architecture
format: refresher
tags: [togaf, enterprise-architecture, adm, governance, arb, principles]
updated: 2026-08-07
---

## Frame

This is a refresh for an architect who already knows the framework but hasn't used the vocabulary actively for a while. The goal: be able to (a) speak TOGAF fluently in an architecture-team setting, (b) distinguish where TOGAF fits against DMBOK / Data Mesh / cloud-native patterns, and (c) answer the question that always comes — *"how do you bring TOGAF discipline to a fast-moving cloud estate?"* — without either reciting the spec or sounding like you reject it.

Three mental models to hold:

1. **TOGAF is a method, not an inventory.** Junior architects treat it as a catalogue of artefacts to produce. Senior architects use the *Architecture Development Method (ADM)* as a thinking cadence and skip the artefacts that don't earn their keep.
2. **The four domains (BDAT) are the universal grouping.** Business → Data → Application → Technology. Almost every enterprise architecture conversation maps to one of these layers, even when nobody says "TOGAF."
3. **TOGAF + DMBOK + Data Mesh are complementary, not competing.** TOGAF gives you the method and governance; DMBOK gives you the data-management vocabulary; Data Mesh gives you the modern organisational shape. An architecture team that uses all three is unremarkable; one that uses none is unstaffed.

---

## 1. The current version

- **TOGAF 9.2** was the long-stable version (2018) — what your certification is on.
- **TOGAF 10** was released April 2022. Restructure rather than rewrite: same ADM, same BDAT, same Enterprise Continuum, but split into the **TOGAF Fundamental Content** + **TOGAF Series Guides** (separately versioned, easier to update).
- For interview purposes: **9 and 10 are interchangeable in conversation**. If anyone presses, mention "we're on the TOGAF 10 structure now but the substance is unchanged for a finance-systems context."

---

## 2. The ADM — the heart of the framework

The Architecture Development Method, a cyclical 8-phase process plus two cross-cutting elements:

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

### Phase summaries (memorise these one-liners)

| Phase | One-liner |
|---|---|
| **Preliminary** | Establish the architecture capability — frameworks, principles, governance, tools. |
| **A. Vision** | What is this initiative trying to achieve at a strategic level? Get sponsor sign-off. |
| **B. Business** | Model the business processes, organisation, capabilities the architecture must support. |
| **C. Information Systems — Data** | Logical data model, data architecture decisions. *(DMBOK lives here.)* |
| **C. Information Systems — Application** | Application landscape, integration patterns, app rationalisation. |
| **D. Technology** | Infrastructure, platforms, cross-cutting tech standards. |
| **E. Opportunities & Solutions** | Identify gap-closing work; group into projects/programmes. |
| **F. Migration Planning** | Sequence and dependencies; transition architectures. |
| **G. Implementation Governance** | Architecture compliance during build/run. |
| **H. Architecture Change Management** | Ongoing change governance after delivery. |
| **Requirements Management** | The centre — feeds and is fed by every phase. |

### What an architect actually does day-to-day

You won't walk all eight phases for every change. Senior architects use ADM as a *menu*. For a contained workstream you might do A → C → D and skip the rest. For a five-brand SAP migration you do the whole thing, slowly.

The honest framing: *"ADM is the discipline; how much of it I invoke depends on the size of the bet."*

---

## 3. The BDAT domains

The four architecture domains, in order:

1. **Business Architecture** — capabilities, value streams, organisation, processes. *Who does what and why.*
2. **Data Architecture** — entities, models, flows, master/reference, lineage. *What information exists and how it moves.* (DMBOK is the deep dive here.)
3. **Application Architecture** — apps, services, interfaces. *What software runs and how it talks.*
4. **Technology Architecture** — infrastructure, platforms, cloud, networks. *What it runs on.*

The order matters: TOGAF's stance is that **Business drives Data drives Application drives Technology**. Architects who start with technology (or worse, with vendor choices) violate the discipline. In practice, real engagements are messier — but the framework gives you the language to push back when someone wants to start at Technology.

---

## 4. Building blocks — ABBs and SBBs

- **ABB (Architecture Building Block)** — a generic, capability-defined building block. E.g. "a customer master data service." Vendor-neutral, scope-bounded.
- **SBB (Solution Building Block)** — the implementation choice. E.g. "Reltio MDM running on AWS." Vendor-specific.

You design at the ABB level, then choose the SBB. The two layers separate *intent* from *implementation*, which keeps you honest when vendors push solutions before requirements.

The phrasing that carries it: *"model it as a capability-level building block first — the ABB — and only choose the SBB once it has been checked against the principles and the build-vs-buy criteria."*

---

## 5. Enterprise Continuum + Architecture Repository

- **Enterprise Continuum** — TOGAF's way of describing a spectrum from generic / industry-standard architecture down to organisation-specific. Its practical use is forcing the question: "is this pattern industry-generic, or specific to us?"
- **Architecture Repository** — where architecture artefacts live. Includes the Continuum, reference models, standards, the Architecture Landscape (current state), and the Solutions Landscape.

In modern practice, the Repository is some combination of: Confluence/Notion pages, Lucid/Miro diagrams, an EA tool (Sparx EA, BiZZdesign, LeanIX, Ardoq), and source code. The TOGAF point is *that you have one*, not which tool you use.

---

## 6. Architecture governance — ARB

- **Architecture Review Board (ARB)** — the standing body that reviews proposed architectures for compliance with principles and standards.
- **Architecture Compliance Review** — the *act* of reviewing a specific design against the standards. Outputs: compliant / non-compliant / conditional approval with dispensations.
- **Architecture Contracts** — formal agreements between architecture and implementation teams about what will be delivered to what standard.
- **Dispensations** — formal exceptions to standards, time-bounded, with a remediation plan.

The four governance artefacts — Principles, Standards, Reference Architectures, and the ARB process itself — are what make architecture *enforceable* rather than aspirational.

---

## 7. TOGAF + DMBOK + Data Mesh — how they fit

This combination came up in the DAMA guide; it's worth being explicit:

| Framework | What it gives you |
|---|---|
| TOGAF | The *method* — ADM, BDAT domains, governance discipline, building blocks |
| DMBOK | The *vocabulary* — data-management knowledge areas, DQ dimensions, master vs reference |
| Data Mesh | The *organisational shape* — domain ownership, data as a product, federated governance |

A clean architect-of-architects answer when asked "how do you choose a framework?" — *"I don't choose between them. TOGAF gives me the method and the governance backbone, DMBOK gives me the data-management vocabulary I use inside Phase C, and Data Mesh gives me the organisational shape that makes federated governance actually work at multi-brand scale. They overlap deliberately; the overlap is where the real work is."*

---

## 8. Where TOGAF is overkill — the honest critique

A senior architect who can't critique TOGAF sounds like a true believer. Three valid critiques to acknowledge:

1. **Artefact-heavy in its full form.** A small workstream doesn't need a Phase A Vision document, a Phase B capability map, *and* a Phase F migration plan. Use the cadence; skip the paperwork.
2. **Slow at cloud-native speed.** TOGAF was shaped by ~2000s-era enterprise IT. Modern cloud architecture moves faster than the ADM cycle assumes. Mitigation: use ADM for the *strategic* layer (multi-year roadmaps, cross-domain decisions) and use lighter patterns (RFCs, ADRs, OKRs) at the *tactical* layer.
3. **Doesn't natively address data-product thinking.** TOGAF Phase C: Data was conceived in a warehouse-and-MDM era, not a data-mesh-and-streaming era. Fill the gap with DMBOK + Data Mesh, as above.

The framing worth keeping: *"TOGAF works best invoked at the strategic layer and kept out of the tactical layer. The mistake is treating every change like a full ADM cycle."*

---

## 9. Where the concepts actually surface

TOGAF reads as abstract until you map it onto a real estate. Take a multi-brand group running an ERP-anchored finance platform into a cloud warehouse — each phase acquires a concrete job:

| Concept | What it is in practice |
|---|---|
| ADM Phase B (Business) | The multi-brand capability map — what Finance does, what's shared, what's brand-specific |
| ADM Phase C (Data) | The ERP↔warehouse architecture; the master partner record across brands |
| ADM Phase D (Technology) | Warehouse / table-format / streaming / orchestration stack decisions |
| ADM Phase F (Migration) | Sequencing the ERP migration across brands |
| Architecture Principles | "Cloud-first," "data as a product," "compliance built in by design" |
| ARB | The standing review forum — and the shape most formal design reviews take |
| Building Blocks | The shared platform services a central team curates — extraction, integration, governance, reporting |
| Architecture Compliance Review | The day job: reviewing proposed designs from product teams |

---

## 10. Vocabulary

- *"ADM phase C"* — when discussing data/application architecture work.
- *"Business → Data → Application → Technology"* — when sequencing a design conversation.
- *"ABB before SBB"* — when resisting vendor-led design.
- *"Architecture compliance review"* — for the boarding-session-style conversation.
- *"Transition architecture"* — for migration-era intermediate states.
- *"Architecture principles"* — for the shared rules of the road.
- *"Dispensation"* — when discussing exceptions; signals you know the formal pattern, not just "let's just let them do it."
- *"Architecture Contract"* — when discussing the producer-consumer agreement between architecture and delivery teams.

---

## 11. Check yourself

1. **"How do you reconcile TOGAF with cloud-native speed?"** → Use the "strategic layer / tactical layer" framing from §8.
2. **"What's the relationship between TOGAF and Data Mesh?"** → Use the table in §7.
3. **"Walk me through how you'd approach an architecture review for a new design."** → ABB-level review against principles, standards, reference architectures; named outputs (compliant / conditional / non-compliant); dispensation pattern when conditional.
4. **"What's an architecture principle you've actually applied?"** → Pick one from your own work and tell the story concretely — the principle, the design it shaped, and the moment it was tested. A principle that never cost anyone anything was never a principle. For example: *"config-driven over code-driven for integration logic" is easy to state and only means something the first time a team wants to skip the contract layer to hit a date.*
5. **"How do you handle architectural debt?"** → Frame as backlog item, track via ARB, dispensations with time-bounds.

---

## 12. Practice / output

A small output for week-5 polish:

> **Architecture Principles I'd Propose on Day 1**
>
> Five-to-seven principles for a multi-brand, regulated data estate. Each one line, each with a *because* clause — the clause is the whole exercise. Examples:
>
> - *Cloud-first, multi-cloud-aware* — because brand-level autonomy and a warehouse-led platform both have to survive.
> - *Data as a product across brands* — because regulatory reporting (DAC7, ViDA) is the natural data-product surface.
> - *Compliance built in by design* — because SOX, GDPR, DAC7 and DMA all penalise after-the-fact governance.
> - *ABB before SBB* — because a mixed vendor estate offers too many product-led shortcuts.
> - *Federated governance with central policy* — because brand autonomy and cross-brand audit obligations both have to coexist.
>
> A principle without a *because* is a slogan, and slogans lose the first argument they meet.

---

## 13. Things to skip

- Memorising all 47 deliverables in the ADM. Use them when relevant; don't recite.
- Deep TOGAF 9 → 10 migration mechanics. Be conversational, not pedantic.
- Religious wars with Zachman, FEAF, or DoDAF — name them, don't enter them.
- Re-certifying just for the role. Your TOGAF 9 still signals; TOGAF 10 isn't an exam separate from the substance.

---

