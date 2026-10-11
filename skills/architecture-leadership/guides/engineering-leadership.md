---
title: Engineering leadership
summary: What moving from architect to engineering manager or CTO demands — people and org design, commercial ownership, executive communication and delivery governance.
---

## Frame

Technical guides answer *"can you build it?"*. Engineering-manager and CTO roles ask three
different questions:

1. **How many engineers have reported to you?**
2. **What budget have you owned?**
3. **Whom have you hired, promoted and let go?**

Two mental models:

1. **The gap closes with evidence, not study.** Leadership is demonstrated by what you have run and
   can point to. Reading supports evidence-building; it does not replace it.
2. **Much architecture work is leadership work written up the wrong way.** A consolidation across
   many product teams, a vendor decommission, a savings programme — these are organisational and
   commercial outcomes. Frame them as such.

---

## 1. The capability map

| # | Block | What it covers |
|---|---|---|
| 1 | **People & organisation** | Headcount, hiring, performance, levelling, org design |
| 2 | **Commercial ownership** | Budget, run-rate, vendor negotiation, build-vs-buy |
| 3 | **Executive communication** | Strategy narrative, roadmap defence, risk |
| 4 | **Delivery governance at portfolio scale** | DORA, SLOs as organisational contracts, cross-team dependencies |
| 5 | **Regulated accountability** | Being the accountable executive, not the advising architect |

The first three are usually the blockers for an architect moving into leadership; the last two are
differentiators.

---

## 2. People and organisation

### The bar

| Capability | The bar |
|---|---|
| **Line management** | Weekly 1:1s, growth plans and a documented performance cycle for N reports. Can state N. |
| **Hiring** | Designed a loop (screen → technical → system design → values), calibrated interviewers, knows offer-accept rate and time-to-hire |
| **Levelling** | Authored or applied a career ladder; can explain senior versus staff *in writing* |
| **Performance management** | Has run a calibration session, written a PIP, managed someone out |
| **Org design** | Can defend a specific team topology for a specific problem — platform vs stream-aligned, Conway's-law consequences, dependency load |
| **Attrition & retention** | Knows the regretted-attrition number and what moved it |

### Building evidence

- **Formal line management**, even of a small team for some months, unlocks every item above.
- **Own a hiring loop without owning headcount.** Designing the technical interview, writing the
  scorecard and calibrating interviewers is usually available for the asking and produces a concrete
  artefact.
- **Write a career ladder** — junior → medior → senior → staff, with observable behaviours per level.
  Writing one forces an actual philosophy of seniority.
- **Founder experience proves some things, not others.** Running a venture shows product ownership,
  technical strategy and co-founder dynamics; building it alone does not show team building.
- **A delivery model is an org-design thesis.** A written opinion on how engineering should be
  structured — who proposes changes, who merges, how review is split, what the unit of work is — is a
  differentiated leadership artefact when argued as org design rather than tooling.

### Org-design vocabulary

- **Stream-aligned team** — delivers a flow of business value end to end.
- **Platform team** — provides internal services that reduce stream-aligned teams' cognitive load.
- **Enabling** and **complicated-subsystem** teams complete the four Team Topologies types.
- **Conway's law** — systems mirror the communication structure of the organisation that builds
  them, so org design is also an architecture decision.
- **Dependency load** — how many other teams a team must wait on to ship.

### Questions a leader should be able to answer

- How many people have you managed, and what was the largest org you were responsible for? — a
  truthful number plus the strongest adjacent evidence, without apology. Inflation fails at reference
  checks.
- How do you tell a senior engineer from a staff engineer?
- Two teams both need the platform team this quarter. How do you decide, and how do you tell the
  team that loses?
- Your best engineer says they are leaving. What do you do in the first ten minutes?
- Design an engineering org for a 40-person company shipping a regulated product.

---

## 3. Commercial ownership

Owning a budget means being able to answer: what is the annual **run-rate**, what drives it, what did
you commit to reduce it by, and what did you deliver? Plus vendor selection and negotiation,
build-vs-buy with a written case, headcount cost as a first-class number, and capex/opex framing.

- **A savings number without a baseline is a marketing claim, not a commercial one.** A credible
  claim states baseline, drivers, commitment, realised delta and period.
- **A vendor exit is a commercial event**: licence cost, contract exit terms, migration cost, and the
  cost and risk of running both in parallel. It needs a business case, not only a migration plan.
- **One-page platform business case**: baseline, options, three-year TCO, risk, decision, realised
  outcome.
- **TCO** — licences, infrastructure, people, migration and run costs over a horizon, not just the
  purchase price.
- **Build vs buy** — buying is wrong when the capability is a differentiator; building is wrong when
  it is not.
- **Capex vs opex** — capital expenditure is capitalised and depreciated over years; operating
  expenditure hits the P&L as it is spent. Enough P&L literacy to know where engineering costs land
  and why a CFO cares about the difference.
- **FinOps** — cloud cost as a managed discipline: unit economics (cost per order, transaction,
  customer), showback (reporting each team's cost) vs chargeback (billing it to their budget),
  committed-use discounts, cost-per-transaction.

Questions: What is the annual run-rate of the platform you owned? How do you decide between spending
headcount and spending money? Your cloud bill grew 40% this year — what do you do?

---

## 4. Executive communication

An engineering leader translates in both directions: business intent into technical strategy, and
technical reality into business risk.

- **Two-page technology strategy**: where the business is going → what that demands of the platform
  → the three bets → what we are explicitly not doing → what could go wrong. **The "not doing"
  section is the one that signals seniority.**
- **Board-style deck**: eight slides maximum, no architecture diagrams, every slide answering a
  business question — neither a status report nor a sales pitch.
- **Risk in business terms**: not "our schema registry has no compatibility enforcement" but "a
  breaking change from any one of twenty teams can halt order processing, we have no automated gate,
  and the fix is six weeks of platform work."
- **Risk register**: likelihood, impact, owner and mitigation, written so an executive reads it.
- **Invisible platform work** is justified in terms of risk removed, cost avoided and future delivery
  speed — never as technical tidiness.
- **First 90 days**: learn, secure early wins, build alliances and set direction in a deliberate
  sequence (*The First 90 Days*, Watkins).

Questions: What is your technology strategy for the next 18 months, and what did you decide *not*
to do? How do you explain three months of platform work with no customer-visible feature to a CEO?
Tell me about a time you were wrong about a major technical decision.

---

## 5. Delivery governance at portfolio scale

- **DORA metrics** — deployment frequency, lead time for changes, change failure rate, time to
  restore service. The standard executive vocabulary for engineering performance; the source is
  *Accelerate* (Forsgren, Humble, Kim).
- **SLOs as organisational contracts, not dashboards** — who agreed the target, what happened on
  breach, how the **error budget** changed prioritisation.
- **Cross-team dependency management** — consolidating a shared capability across many product
  teams is a change-management programme: how teams were persuaded to move, what resistance looked
  like, what was done about the team that refused.
- **Incident command** — one person coordinates a major incident (roles, communication, decisions),
  separate from those fixing it, followed by a blameless post-incident review.
- **Paved road** — the platform's supported default way to build and ship; leaving it should be a
  negotiated, costed exception, not a ban or a free-for-all.

---

## 6. Regulated accountability

The shift is from **advising** on compliance to being **accountable** for it. An engineering leader
in a regulated organisation personally owns data residency, key custody, admin-access boundaries,
audit readiness, and the answer to "where exactly does this data live and who can reach it?"

- **Data residency** — where data physically lives and is processed, and who can reach it.
- **Key custody** — who holds the encryption keys; holding them yourself (customer-managed or
  external keys) is what makes residency enforceable rather than promised.
- **Sovereign platform** — models, data and keys kept within a jurisdiction, with explicit, written
  constraint decisions (ADRs) about routing and risk class. Writing such decisions down is itself
  executive behaviour.
- **Credentials**: a governance-framed security certification (such as CISM) signals leadership;
  more cloud or data certifications at this level signal the individual-contributor track.

---

## 7. Common mistakes

- **Answering a people question with a technology answer** — the most common failure of architects
  moving into leadership. Practise people answers out loud until they are structured.
- **Stacking technical certifications**, or an MBA / management course, instead of building
  evidence.
- **Inflating people-management history** — executive reference checks are thorough.

The honest reason an architect wants to manage: architects do the *influence* half of leadership
without the *authority* half, and influence alone caps what you can change.

**Startup CTO vs enterprise EM**: a startup CTO role is equity-heavy and usually won through
ecosystem referral; an enterprise engineering-manager role is cash-heavy and won on process
credibility. They reward different lead evidence.

---

## 8. Reading

1. **The Engineering Executive's Primer** — Will Larson. The CTO job: strategy, org design, executive
   relationships, technical quality at organisation scale.
2. **The Manager's Path** — Camille Fournier. The ladder from IC to tech lead, manager, director and
   CTO, and what each rung requires.
3. **Scaling People** — Claire Hughes Johnson. Operating templates for hiring, onboarding and
   performance cycles.
4. **Team Topologies** — Skelton & Pais. The org-design vocabulary.

Situational: **Accelerate** (DORA) · **The First 90 Days** (Watkins) · **High Output Management**
(Grove) · **An Elegant Puzzle** (Larson) for org scaling · **Crucial Conversations** for performance
conversations.
