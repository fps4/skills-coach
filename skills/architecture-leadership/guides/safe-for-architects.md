---
title: SAFe for architects
summary: The Scaled Agile Framework's structure, backlog and planning vocabulary, and what the System Architect does inside a release train.
---

## Frame

SAFe (Scaled Agile Framework) organises many Agile teams into a fixed planning rhythm. Much of its
substance — cross-team dependencies, a plan several teams commit to, architecture laid ahead of the
build — is familiar from any multi-team programme. This guide gives the SAFe names for it and the
architect's specific duties. The current major version is SAFe 6.0.

---

## 1. The structure

| Term | Meaning |
|---|---|
| **ART** (Agile Release Train) | 5–12 teams (~50–125 people) planning and delivering together |
| **PI** (Planning Interval, formerly Program Increment) | Usually 8–12 weeks: 4–5 iterations plus one IP iteration |
| **PI Planning** | Two-day event where all teams of the ART plan the PI together; output is team PI objectives and the program board |
| **Program board** | Features per team per iteration, with dependency strings between teams |
| **IP iteration** | Innovation & Planning — buffer, hackathon, Inspect & Adapt, next PI preparation |
| **System Demo** | End of each iteration: the integrated increment shown across teams |
| **Inspect & Adapt** | End-of-PI retrospective and problem-solving workshop |
| **Solution Train** | Several ARTs coordinated for one large solution |
| **Lean Portfolio Management (LPM)** | Funding by value stream; epics admitted through lean business cases |

Roles: **RTE** (Release Train Engineer — chief scrum master of the ART), **Product Management**
(owns the ART backlog of features), **Product Owner** (one team's backlog), **System Architect**
(architecture for the ART), **Business Owners** (accept PI objectives and assign business value).

---

## 2. Backlog items

**Epic → Capability → Feature → Story.** Each level can be a *business* item or an **enabler**.

- **Enabler** — work that builds technical foundation: architecture, infrastructure, exploration,
  compliance. Enabler features are how an architect gets platform work into the plan.
- **Architectural runway** — the existing code, components and infrastructure needed to deliver
  near-term features without excessive redesign. The architect keeps the runway ahead of the business
  features — not too short (teams blocked), not too long (speculative work).
- **NFRs** (non-functional requirements) — constraints on the backlog such as performance, security
  and data quality, attached to features or to the whole system.

**Prioritisation: WSJF** (Weighted Shortest Job First) = Cost of Delay ÷ Job Size, where Cost of
Delay = business value + time criticality + risk reduction / opportunity enablement. Enablers usually
win on the third term — that is the argument to make for platform work.

---

## 3. The System Architect role

- Defines and communicates the architectural vision for the ART; maintains the runway.
- Writes **enabler features and epics** and sizes them with Product Management.
- Takes part in **PI Planning**: presents the architecture briefing on day one, helps teams with
  dependencies and technical risks, joins the management review.
- Owns the NFRs; takes part in System Demos; supports Inspect & Adapt.
- Works with teams, not above them — guidance, not approval gates. SAFe calls the balance
  *intentional architecture* (planned, cross-team direction) and *emergent design* (what teams
  discover while building).

For a data or BI architect in a release train: data-model standards, semantic-layer decisions and
platform runway (catalog structure, CI/CD for pipelines and BI models) go in as enablers; KPI
definitions travel with the business features that need them.

---

## 4. Risks — ROAM

At PI Planning, risks go on a board and are **ROAMed**: **R**esolved, **O**wned, **A**ccepted or
**M**itigated.

---

## 5. Mapping familiar work to SAFe words

| Familiar programme work | SAFe name |
|---|---|
| Migrating many teams onto a shared platform in waves | Enabler epic sequenced across PIs, runway built first |
| Open questions listed by owner and by what each blocks | Program board dependencies plus ROAMed risks |
| A ranked, costed improvement roadmap a team owns | Enabler features prioritised by WSJF with the team's PO |
| An interface contract agreed before code across teams | Architectural runway / NFR agreed before the PI |
