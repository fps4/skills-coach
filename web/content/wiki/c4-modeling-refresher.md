---
title: C4 Model Refresher — System Architecture Diagramming
summary: The four zoom levels, how to sketch Context and Container under pressure, and how to keep C4 diagrams in version control.
topic: architecture
format: refresher
tags: [c4, diagramming, plantuml, structurizr, documentation, adr]
updated: 2026-08-07
---

## Frame

C4 (Simon Brown, ~2011) is the most widely-adopted *system architecture* diagramming notation in modern software-architecture practice. It models **software systems**, not data. Distinct from the data-modeling refresher: that guide is about modelling *data*, this one is about modelling *systems*.

The goal: be able to (a) sketch a C4 Context and Container diagram on a whiteboard in 5 minutes during a design round, (b) explain what level you're operating at, (c) know when to reach for C4 vs UML vs ArchiMate, and (d) execute it in text-as-code when it needs to live in a repo.

Three mental models to hold:

1. **C4 is a hierarchy of zooms, not a single diagram.** You don't draw "the C4 diagram." You draw a Context diagram, then zoom into a Container diagram for one of those systems, then zoom into a Component diagram for one of those containers. Same way Google Maps lets you zoom from country → city → street.
2. **Audience determines level.** Context for executives and non-technical stakeholders. Container for developers and architects. Component for developers inside one container. Code for nobody — it's automatically generated if needed.
3. **C4 is deliberately under-specified.** Brown chose three boxes-and-arrows abstractions to keep the notation memorable. The notational simplicity is the point. Resist the urge to add custom flourishes.

---

## 1. The four core levels

### Level 1 — System Context
- **What it shows:** the system being designed (one box, in the centre), surrounded by the people who use it and the *other* systems it interacts with.
- **Audience:** business stakeholders, sponsors, non-technical leadership.
- **What it answers:** "What is this thing and what does it talk to?"
- **Granularity:** the system is a single opaque box. No internals.

```
       ┌──────────────┐
       │  Finance     │
       │  Analyst     │
       └──────┬───────┘
              │ views reports
              ▼
   ┌─────────────────────┐         ┌────────────────┐
   │                     │ reads   │                │
   │  Finance Data       │◀────────│  SAP S/4HANA   │
   │  Platform           │         │  (Source SoR)  │
   │                     │ writes  └────────────────┘
   │                     │────────▶┌────────────────┐
   └─────────────────────┘         │  Snowflake     │
                                    │  (Warehouse)   │
                                    └────────────────┘
```

### Level 2 — Container
- **What it shows:** zooming into the system from level 1 — the major deployable / executable / data-store units inside it (containers).
- **Audience:** developers, architects, technical product owners.
- **What it answers:** "What are the major moving parts inside this system, and how do they talk?"
- **A container is:** anything that needs to run to be useful — a web app, an API, a database, a queue, a file store, a serverless function, a topic. **Not** a Docker container specifically (though it can be).

```
   Finance Data Platform
   ┌─────────────────────────────────────────────────────────┐
   │                                                          │
   │  ┌───────────────┐    ┌──────────────┐                   │
   │  │ Ingestion API │───▶│ Kafka topic  │                   │
   │  │ (Node.js)     │    │ (Confluent)  │                   │
   │  └───────────────┘    └──────┬───────┘                   │
   │                              │                            │
   │                              ▼                            │
   │                       ┌──────────────┐                    │
   │                       │ dbt jobs     │                    │
   │                       │ (Airflow)    │                    │
   │                       └──────┬───────┘                    │
   │                              │                            │
   │                              ▼                            │
   │                       ┌──────────────┐                    │
   │                       │ Snowflake    │                    │
   │                       │ (DB)         │                    │
   │                       └──────────────┘                    │
   └─────────────────────────────────────────────────────────┘
```

### Level 3 — Component
- **What it shows:** zooming into one container — the major components (modules, services, libraries) within it.
- **Audience:** developers working inside that container.
- **What it answers:** "What are the building blocks inside this container?"
- **Granularity:** components are *logical* groupings, not classes. A "Payment Reconciliation Service" component, not a `PaymentReconciler` class.

### Level 4 — Code
- **What it shows:** classes, interfaces, methods inside a component.
- **Audience:** nobody, in practice.
- **Reality check:** **You almost never draw level 4 manually.** Modern IDEs autogenerate class diagrams; UML covers this territory. C4 names it for completeness but Brown himself recommends skipping it.

---

## 2. The supplementary diagrams

Three additional diagrams that aren't part of the strict four-level hierarchy but appear in real engagements:

### System Landscape
- A *zoomed-out* view of level 1 — multiple systems and the people who use them, across an enterprise or domain. Useful for portfolio-level conversations.

### Dynamic
- A specific scenario through the static diagram — numbered arrows showing the order of calls/events. Like a UML sequence diagram, rendered in C4 shapes.

### Deployment
- The static Container diagram, but mapped to *where* each container actually runs (AWS region, Kubernetes cluster, on-prem datacentre). Critical for hybrid / multi-cloud conversations.

---

## 3. Notation conventions

C4 deliberately uses **three shapes only:**

1. **Box (rectangle)** — a person, system, container, or component.
2. **Line / arrow** — a relationship, labelled with what flows ("reads", "publishes", "authenticates against") and optionally how (HTTP/JSON, Kafka/Avro).
3. **Boundary (dotted rectangle)** — to group containers within a system, or systems within a domain.

Standard colour conventions:
- **Person** — yellow / orange.
- **System in scope** — dark blue.
- **External system** — grey (signals: "not ours").
- **Container** — blue (lighter than the system).
- **Database** — cylinder shape, distinct fill.

Each box should carry:
- **Name** (mandatory).
- **Type / technology** (e.g. "Container: Node.js + Express").
- **One-line description** of what it does.

Each relationship arrow should carry:
- **Verb-phrase label** ("Publishes events to").
- **Optional protocol/format** ("HTTPS/JSON", "Kafka/Avro").

---

## 4. C4 vs other notations

Know where C4 fits in the broader landscape:

| Notation | Strength | Where it fits |
|---|---|---|
| **C4** | Software-system structure, zoomable, simple | Software architecture: "how does this system work" |
| **UML** | Class / sequence / activity / state diagrams | Code-level design, sequence-of-calls modelling |
| **ArchiMate** | Enterprise architecture (business, application, technology layers) | Heavy EA tooling; complements TOGAF |
| **BPMN** | Business process flows | Business analysts modelling process |
| **ERD (Crow's Foot)** | Data structures | Data modelling — see data-modeling guide |
| **AWS / Azure architecture icons** | Cloud topology with vendor icons | Vendor-specific deployment diagrams |

**The architect's pragmatic stance:** C4 for the system architecture conversation, ERD for the data architecture conversation, sequence diagrams when call order matters, cloud-icon diagrams when the deployment story is the point. **Don't try to make C4 do all of these.**

ArchiMate is the closest competitor at the enterprise-architecture level. C4 wins for software-architecture work because it's faster to draw and easier to read; ArchiMate wins at the enterprise level because it has explicit layers and constructs for capabilities and value streams.

---

## 5. Tools

### Text-as-code (modern preference — versionable, diffable)
- **[Structurizr DSL](https://docs.structurizr.com/dsl)** — Simon Brown's own DSL, the canonical C4 expression. Renders to web viewer, PNG, SVG.
- **[C4-PlantUML](https://github.com/plantuml-stdlib/C4-PlantUML)** — C4 macros on top of PlantUML. Works anywhere PlantUML runs (GitHub, GitLab, VS Code extensions). Probably the most common choice in repos.
- **[Mermaid C4](https://mermaid.js.org/syntax/c4.html)** — Mermaid added C4 support. Renders natively in GitHub Markdown. Most accessible.
- **[Likec4](https://likec4.dev)** — newer, polished, web-native renderer with hot-reload.

### GUI tools
- **draw.io / diagrams.net** — has a "C4" shape library built in. Free, browser-based.
- **Lucidchart** — C4 shape library available.
- **Excalidraw** — no native C4, but the hand-drawn aesthetic works well for whiteboard-style sketches.
- **Miro** — fine for collaborative whiteboard sessions; C4 templates available.

### IDE integration
- **VS Code** — extensions for PlantUML and Structurizr; render on save.
- **IntelliJ** — same, via plugins.

### What an architect actually uses
- **Live whiteboard:** plain boxes-and-lines, label the boxes, label the arrows. Don't worry about colour or precise notation under pressure.
- **Repo documentation:** C4-PlantUML in `docs/architecture/`. Renders inline on GitHub, lives in version control, diffs reviewably.
- **Stakeholder presentations:** Structurizr or Likec4 for polished output.

---

## 6. Live design sessions — how to use C4 under pressure

On a whiteboard or a shared canvas, with the clock running, use C4 mentally even if you never name it.

### The 5-minute opening sketch
1. **State which level you're starting at.** "I'll start with a Context diagram so we agree on what's in and out of scope."
2. **Draw the in-scope system as one box in the centre.** Label it.
3. **Add the actors / users around it.** Label them.
4. **Add the external systems it talks to.** Label them and the arrows ("reads from SAP S/4HANA via CDC", "publishes to ThoughtSpot").
5. **Pause. Confirm the boundary is right.** "Anything in or out I've got wrong?"
6. **Then zoom in.** "Now let me draw the Container diagram for [system X]." Erase or move the Context diagram aside; draw the Container diagram fresh.

### The zoom discipline
- **Don't mix levels.** A diagram with "User" on one side and a "PostgreSQL table" on the other is incoherent. If you find yourself doing this under pressure, stop and label which level you're at.
- **Don't add detail nobody asked for.** Resist drawing the Component diagram unless the conversation moves there.

### The phrase that buys you room
*"Let me start at the Context level and zoom in if useful. Here's the system in scope, here are the actors, here are the external systems. Once we agree on the boundary, I'll zoom into the Container level."*

That sentence does three things: signals discipline, sets expectations, and earns you 30 seconds of clarity before the design conversation accelerates.

---

## 7. Anti-patterns to call out

- **Drawing UML class diagrams and calling them "C4."** Class diagrams are level 4 (Code) and almost nobody draws them. If your diagram has classes and methods, it's not a working C4 artefact.
- **Conflating Containers with Docker.** A "container" in C4 = anything that runs (web app, queue, database). Docker containers are one kind. Lambda functions are containers. Snowflake is a container. Kafka topics are containers.
- **Boundary boxes that group anything-and-everything.** Boundaries should reflect real ownership / deployment grouping, not visual convenience.
- **Arrows without labels.** A line that says nothing about the relationship is useless. Always label.
- **Showing every relationship.** Pick the relationships that matter for the conversation. C4 favours clarity over completeness.
- **A single mega-diagram showing everything.** This is the most common failure mode. If your diagram needs a magnifying glass, zoom.
- **Inconsistent abstraction across the same diagram.** A "Finance Domain" box next to a "PostgreSQL `customers` table" is a level mismatch.

---

## 8. Worked example — a regulated finance data platform

A concrete shape to practise against, and a fair representation of the levels you actually draw most often:

- **Context** — the finance data platform, plus actors (finance users, auditors, data scientists) and external systems (an ERP such as S/4HANA, a streaming platform, the warehouse, a policy-enforcement layer, BI tools, and the regulators receiving DAC7/SAF-T submissions).
- **Container** — inside the platform: ingestion adapter, replication flows, Kafka topics, dbt jobs on Airflow, warehouse schemas, the regulatory reporting service.
- **Deployment** — the multi-cloud topology if it matters: warehouse region, cloud regions for compute, hybrid integration with on-prem where it exists.

Components (level 3) come up rarely at architecture altitude — they're more for sprint-team conversations once delivery is under way.

---

## 9. Vocabulary

- *"At Context level..."* — when zooming out.
- *"At Container level..."* — when zooming in once.
- *"In and out of scope"* — when defining the boundary.
- *"Deployment view"* — when the conversation moves to where things run.
- *"Dynamic view"* — when the conversation moves to scenario flow / call order.
- *"External system"* — for things you don't own.
- *"System landscape"* — for the multi-system zoom-out.

---

## 10. Check yourself

1. **"Sketch the architecture for X."** Start with Context. Confirm boundary. Zoom to Container. Don't go deeper unless asked.
2. **"How do you document architecture?"** C4 in repo via PlantUML / Structurizr / Mermaid, rendered in PRs, lives next to the code it describes. Plus written ADRs for decisions.
3. **"What's the difference between C4 and UML?"** C4 covers software-architecture structure across abstraction levels; UML covers code-level and behavioural modelling. Complementary, not competing.
4. **"Why C4 over ArchiMate?"** Faster to draw, lower learning curve, focused on software-architecture conversation; ArchiMate is stronger at full-enterprise EA scope (and pairs with TOGAF).
5. **"What's in a Container?"** Anything that needs to run / be deployed to be useful. Apps, services, queues, topics, databases, functions, file stores.

---

## 11. Practice / output

A small repo-resident artefact is the fastest way to make this stick:

1. Pick one system you know well — ideally one you have worked on, so the boundary questions are real.
2. Write it up as C4-PlantUML in 3 diagrams: System Context, Container, Deployment.
3. Commit it to a `docs/architecture/` folder so it lives in version control and diffs reviewably.
4. Practise sketching the Context level on paper from memory in under 3 minutes.

One C4 artefact you have actually drawn for a real system is worth more than any amount of notation theory — it turns "how do you document architecture" into something you answer by reference rather than in the abstract.

---

## 12. Things to skip

- Level 4 (Code). Brown himself recommends skipping it. Modern IDEs autogenerate when needed.
- ArchiMate certification — relevant only if you join an EA function that requires it. TOGAF is enough credential weight; see TOGAF guide.
- Memorising every Structurizr DSL keyword — look up when needed. The mental model matters more than the syntax.
- BPMN — separate notation for business processes; relevant for business analysts, not architects of data systems.

---

