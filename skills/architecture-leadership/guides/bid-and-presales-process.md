---
title: Bid and presales process for architects
summary: How a system integrator runs a gated pursuit — lifecycle, roles, solution review and the proposal — and where the architect owns the technical truth of the bid.
---

## Frame

An SI bid is reference-architecture, estimation and stakeholder-presentation work wrapped in a
governance process with gates and roles. This guide names the gates and roles so the vocabulary is
familiar when a bid manager says "we're at the qual gate" or "the architect owns the solution section
of the response".

Two things to hold:

1. **The substance is familiar; the packaging is what to learn.** Reference architectures, standards,
   presentations — a bid wraps them in gates and roles.
2. **The architect is the technical truth-teller of the bid.** The role exists to make sure what
   sales promises is technically deliverable, correctly costed and defensible in review — the
   *technical conscience* of the pursuit.

---

## 1. The bid lifecycle

Every large SI runs opportunities through a **staged, gated pursuit process**. Names differ per firm;
the shape is universal.

| Stage | What happens | Architect's role |
|---|---|---|
| **Lead / opportunity identification** | Sales or the account team spots a deal | Usually none yet |
| **Qualification (bid/no-bid gate)** | Decide whether to pursue — cost of bidding vs win probability | Early feasibility input: is this deliverable, and roughly how? |
| **Solutioning** | Design the solution and its shape | **Core work** — architecture, integration approach, technology choices |
| **Costing / estimation** | Size effort, price it, build the commercial model | Feeds effort and complexity estimates; validates the technical basis of the price |
| **Solution review / governance gate** | Internal peer and risk review before submission | Defends the design while peers challenge it |
| **Proposal / response writing** | Produce the written bid and presentation | Authors the solution and architecture sections |
| **Presentation / orals / clarification** | Present to the customer, answer questions | Presents the technical solution |
| **Negotiation & close** | Commercial and contract finalisation | Supports on technical scope and assumptions |
| **Handover to delivery** | Won deal moves to the project team | Hands the design to delivery architects |

The mental model in seven verbs: **qualify → solution → cost → govern → respond → present → hand
over.**

---

## 2. Who is in the room

| Role | What they own | Architect's interface |
|---|---|---|
| **Bid Manager / Pursuit Lead** | Runs the bid end to end — timeline, resources, gates, submission | Holds you to deadline; you feed the solution and estimates |
| **Solution Manager** | The overall solution and its commercial shape — the deal's solution owner | Primary partner; receives the technical architecture into the solution |
| **Sales / Account Executive / Client Partner** | The customer relationship and the commercial win | You keep them technically honest — what is promised must be buildable |
| **Enterprise / domain architects** | Adjacent domains: infrastructure, security, data, applications | You integrate across their domains end to end |
| **Delivery / Engagement Lead** | Runs the project if won | Receives the design at handover and holds you to it |
| **Commercial / Finance / Risk** | Pricing, margin, contractual risk | You supply the technical basis for cost and flag delivery risk |

The architect does not own the customer relationship or the price. The architect owns that the
*technical solution* is coherent, deliverable and defensible, and that it stitches the domains
together end to end.

---

## 3. Solution governance and review

SIs gate bids through **internal solution review boards** before anything reaches the customer, to
catch under-costed, over-promised or technically shaky solutions. It is the bid-time equivalent of an
architecture review board — except that here your own proposal is the design under review.

What reviewers push on, and what to pre-empt:

- **Deliverability** — can we build this, with the people we have, in the time quoted?
- **Costing basis** — is the effort estimate defensible, or optimistic?
- **Risk and assumptions** — what are we assuming about the customer's environment, and what happens
  if it is wrong?
- **Reuse and standards** — are we reinventing what the firm already has (assets, accelerators,
  reference architectures)?
- **Dependencies and integration seams** — where the systems meet and who is responsible on each side.

An over-optimistic estimate or an unstated integration assumption is far cheaper to challenge in
review than to discover in delivery.

---

## 4. The proposal and the presentation

**The solution section of the response** — the architecture and integration narrative inside the bid
document or RFP response:

- Lead with the customer's *outcome*, not the technology stack.
- Make the approach and its rationale explicit — why this pattern, this sequencing.
- State assumptions and dependencies openly; reviewers and customers trust a bid that names them.
- Show the *end to end*, not a pile of components.

**The customer presentation (orals)** — presenting the solution live, handling technical Q&A and
clarifications, typically as technical author alongside the Solution Manager. Presenting in the
customer's language can matter as much as the content.

---

## 5. How a large integrator is organised

Large SIs are usually structured around **service lines and accounts**. Architects sit in a
solutioning or architecture practice — a matrixed organisation — and are loaned into pursuits and
accounts, flexing between pre-sales and delivery rather than being tied to one deal.

---

## 6. Boundaries of the architect's role

- **The architect owns** the technical solution, its estimates' technical basis, and its
  defensibility in review.
- **The architect does not own** the price or the commercials — commercial and finance do.
- **The posture**: challenge the design before it fails in delivery.
