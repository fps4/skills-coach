---
title: The C4 model
summary: Diagramming software-system structure as a hierarchy of zooms — context, container, component, code — with its notation, tools and anti-patterns.
---

## Frame

C4 (Simon Brown, around 2011) is the most widely adopted notation for *software-system* architecture
diagrams. It models **systems**, not data — data structures belong in an ERD.

The goal: sketch a Context and a Container diagram on a whiteboard in five minutes, say which level
you are at, know when to reach for C4 versus UML or ArchiMate, and keep it as text-as-code when it
lives in a repo.

Three mental models:

1. **C4 is a hierarchy of zooms, not a single diagram.** You draw a Context diagram, zoom into a
   Container diagram for one system, then into a Component diagram for one container — like a map
   zooming from country to city to street.
2. **Audience determines level.** Context for executives and non-technical stakeholders. Container
   for developers and architects. Component for developers inside one container. Code for nobody.
3. **C4 is deliberately under-specified.** A tiny notation keeps it memorable. Resist adding custom
   flourishes.

---

## 1. The four core levels

### Level 1 — System Context
- **Shows:** the system in scope as one box in the centre, surrounded by the people who use it and
  the *other* systems it interacts with.
- **Audience:** business stakeholders, sponsors, non-technical leadership.
- **Answers:** "What is this thing and what does it talk to?"
- **Granularity:** the system is a single opaque box.

```
       ┌──────────────┐
       │  Finance     │
       │  Analyst     │
       └──────┬───────┘
              │ views reports
              ▼
   ┌─────────────────────┐         ┌────────────────┐
   │                     │ reads   │                │
   │  Finance Data       │◀────────│  ERP           │
   │  Platform           │         │  (Source SoR)  │
   │                     │ writes  └────────────────┘
   │                     │────────▶┌────────────────┐
   └─────────────────────┘         │  Warehouse     │
                                    └────────────────┘
```

### Level 2 — Container
- **Shows:** the major deployable, executable or data-store units inside the system, and how they
  talk.
- **Audience:** developers, architects, technical product owners.
- **A container is** anything that needs to run to be useful — a web app, an API, a database, a
  queue, a file store, a serverless function, a topic. **Not** a Docker container specifically.

```
   Finance Data Platform
   ┌─────────────────────────────────────────────────────────┐
   │  ┌───────────────┐    ┌──────────────┐                   │
   │  │ Ingestion API │───▶│ Kafka topic  │                   │
   │  │ (Node.js)     │    │              │                   │
   │  └───────────────┘    └──────┬───────┘                   │
   │                              ▼                            │
   │                       ┌──────────────┐                    │
   │                       │ dbt jobs     │                    │
   │                       │ (Airflow)    │                    │
   │                       └──────┬───────┘                    │
   │                              ▼                            │
   │                       ┌──────────────┐                    │
   │                       │ Warehouse DB │                    │
   │                       └──────────────┘                    │
   └─────────────────────────────────────────────────────────┘
```

### Level 3 — Component
- **Shows:** the major components (modules, services, libraries) inside one container.
- **Audience:** developers working inside that container.
- **Granularity:** components are *logical* groupings, not classes — a "Payment Reconciliation
  Service", not a `PaymentReconciler` class.

### Level 4 — Code
- **Shows:** classes, interfaces, methods inside a component.
- **In practice:** almost never drawn by hand. IDEs generate class diagrams and UML covers the
  territory; Brown himself recommends skipping it.

---

## 2. Supplementary diagrams

- **System Landscape** — a zoom *out* from level 1: many systems and their users across an
  enterprise or domain. For portfolio conversations.
- **Dynamic** — one scenario through the static structure, as numbered arrows in call or event
  order. A sequence diagram in C4 shapes.
- **Deployment** — the containers mapped to *where* they run (cloud region, Kubernetes cluster,
  data centre). Critical for hybrid and multi-cloud conversations.

---

## 3. Notation

C4 uses **three shapes only**:

1. **Box** — a person, system, container or component.
2. **Arrow** — a relationship, labelled with what flows ("reads", "publishes", "authenticates
   against") and optionally how (HTTPS/JSON, Kafka/Avro).
3. **Boundary (dotted rectangle)** — groups containers within a system, or systems within a domain.

Colour conventions: person yellow/orange; system in scope dark blue; external system grey ("not
ours"); container lighter blue; database as a cylinder.

Each box carries a **name**, its **type and technology** ("Container: Node.js + Express") and a
**one-line description**. Each arrow carries a **verb-phrase label** ("Publishes events to") and
optionally the **protocol or format**.

---

## 4. C4 versus other notations

| Notation | Strength | Where it fits |
|---|---|---|
| **C4** | Software-system structure, zoomable, simple | "How does this system work" |
| **UML** | Class, sequence, activity, state diagrams | Code-level design, call-order modelling |
| **ArchiMate** | Enterprise layers: business, application, technology | Heavy EA tooling; complements TOGAF |
| **BPMN** | Business process flows | Business analysts modelling process |
| **ERD (crow's foot)** | Data structures | Data modelling |
| **Cloud architecture icons** | Cloud topology with vendor icons | Vendor-specific deployment diagrams |

C4 for the system conversation, an ERD for data, sequence diagrams when call order matters,
cloud-icon diagrams when deployment is the point. Do not make C4 do all of them.

ArchiMate is the closest competitor: C4 is faster to draw and read for software architecture;
ArchiMate wins at enterprise scope with explicit layers and constructs for capabilities and value
streams. C4 and UML are complementary — structure across abstraction levels versus code-level and
behavioural modelling.

---

## 5. Tools

### Text-as-code (versionable, diffable)
- **[Structurizr DSL](https://docs.structurizr.com/dsl)** — Brown's own DSL, the canonical C4
  expression: one model, many views.
- **[C4-PlantUML](https://github.com/plantuml-stdlib/C4-PlantUML)** — C4 macros on PlantUML; probably
  the most common choice in repos.
- **[Mermaid C4](https://mermaid.js.org/syntax/c4.html)** — renders natively in GitHub Markdown; the
  most accessible.
- **[LikeC4](https://likec4.dev)** — newer, web-native renderer with hot reload.

### GUI tools
draw.io / diagrams.net (built-in C4 shapes), Lucidchart, Excalidraw (hand-drawn style for
whiteboard sketches), Miro (collaborative sessions, C4 templates).

### By setting
- **Whiteboard:** plain labelled boxes and arrows; do not worry about colour.
- **Repo documentation:** C4-PlantUML or Mermaid in `docs/architecture/`, reviewed in pull requests
  next to the code it describes, alongside written ADRs for decisions.
- **Stakeholder presentations:** Structurizr or LikeC4 for polished output.

---

## 6. Using C4 in a live design session

### The five-minute opening sketch
1. **State which level you start at.** "I'll start with a Context diagram so we agree on scope."
2. **Draw the in-scope system as one labelled box in the centre.**
3. **Add the actors and users around it.**
4. **Add the external systems, with labelled arrows** ("reads from the ERP via CDC").
5. **Pause and confirm the boundary.** "Anything in or out I've got wrong?"
6. **Then zoom in** — draw the Container diagram fresh, not on top of the Context one.

### Zoom discipline
- **Don't mix levels.** A "User" on one side and a database table on the other is incoherent.
- **Don't add detail nobody asked for.** Draw components only when the conversation goes there.

---

## 7. Anti-patterns

- **UML class diagrams called "C4".** Classes and methods are level 4; that is not a working C4
  artefact.
- **Containers conflated with Docker.** Lambdas, warehouses and Kafka topics are containers too.
- **Boundaries that group anything and everything.** A boundary should reflect real ownership or
  deployment grouping, not visual convenience.
- **Arrows without labels.** An unlabelled line says nothing.
- **Showing every relationship.** C4 favours clarity over completeness.
- **The mega-diagram.** The most common failure: if it needs a magnifying glass, zoom.
- **Inconsistent abstraction.** A "Finance Domain" box next to a single `customers` table.

---

## 8. Things to skip

- Level 4 (Code) — IDEs generate it when needed.
- Memorising every Structurizr DSL keyword — the mental model matters more than the syntax.
- BPMN, unless you are modelling business processes.
