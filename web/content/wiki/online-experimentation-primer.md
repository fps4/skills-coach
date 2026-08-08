---
title: Online Experimentation — Primer
summary: A/B testing for ML and ranking products — assignment, metrics, variance reduction, sequential testing, interleaving, and marketplace interference.
topic: ml-ai
format: primer
tags: [experimentation, ab-testing, ranking, statistics, interleaving, marketplace]
updated: 2026-08-07
---

## Frame

The most experimentation-driven consumer companies run very large numbers of
concurrent A/B tests as a matter of course — it is how the product gets built at
all. Working on ranking or marketplace systems means reasoning about
experimentation as an engineer *and* knowing the statistical traps and the
marketplace-specific caveats (interference between buyers and sellers) that make
naive A/B testing quietly wrong. This guide is the practical version.

Three mental models to hold going in:

1. **An experiment is a causal measurement, and the design is what makes it
   causal.** Randomization is the whole trick: split users into control and
   treatment so the *only* systematic difference is the change you made, then any
   metric difference is caused by it. Everything else — assignment, metrics,
   statistics — is in service of keeping that causal claim valid.
2. **The dangerous failures are silent.** Peeking at a running test and stopping
   when it looks significant, a metric that moved by chance, an assignment bug that
   correlates with a covariate, or marketplace interference that breaks the
   independence assumption — none of these throw an error. They just give you a
   confident wrong answer. Being able to name them is the senior signal.
3. **In a marketplace, the standard A/B assumption is often violated.** Classic
   A/B testing assumes one user's treatment doesn't affect another user's outcome
   (SUTVA / no interference). In a two-sided market — shared inventory, prices,
   supply — treating some users changes what control users see. This is *the*
   marketplace caveat, and switchback / cluster designs are the response.

Why this matters: ranking, pricing, and recommendation changes are validated by
online experiments, and designing them correctly — avoiding the classic
statistical traps and handling marketplace interference — is what separates a
result you can act on from one you can only publish.

---

# Section 1 — A/B testing for ML and ranking products

The basic frame: you have a change (a new ranking model, a new price, a new
layout). You want to know if it's *better* for users/business, not just different.

- **Control** — the current experience (the "A").
- **Treatment** — the new experience (the "B").
- **Randomize** — assign each unit to control or treatment at random.
- **Measure** — compare a metric between the groups; use statistics to decide if
  the difference is real or noise.

For **ML/ranking** specifically, the thing under test is usually a *model or
policy*, not a single UI element: "does ranking model v2 produce more bookings
than v1?" The output is a ranked list, which makes evaluation subtler (Section 8
on interleaving) and makes the metric a downstream behavior (clicks, bookings,
revenue) rather than a direct model score.

---

# Section 2 — Randomization unit and assignment

## 2a. The randomization unit

*What* you randomize matters as much as *that* you randomize.

- **User (or visitor/cookie/account)** — the most common unit. Consistent
  experience per user across sessions; needed when the change affects the whole
  journey.
- **Session / request** — finer-grained, more statistical power, but a user can
  flip between variants — invalid if the effect spans sessions or the
  inconsistency itself hurts.
- **Cluster / geo / market / time-slice** — coarser units used to handle
  interference (Section 9). Fewer independent units → less power, but valid when
  individual-level randomization would leak.

Rule: **randomize at the level at which the treatment acts and at which you need
independence.** A ranking change that affects shared inventory can't be validly
randomized per user (interference); a UI color can.

## 2b. Deterministic hash bucketing

The standard assignment mechanism. Instead of storing a random assignment per
user, you *compute* it deterministically:

```
bucket = hash(experiment_id + ":" + unit_id) % 10000
if bucket < treatment_share * 10000:
    variant = "treatment"
else:
    variant = "control"
```

Why this design:

- **Deterministic** — the same user gets the same variant every time, on every
  server, with no state lookup. Consistency for free.
- **Stateless** — no assignment database on the request path; just a hash.
- **`experiment_id` in the hash** — so a user's bucket in experiment A is
  independent of their bucket in experiment B. Without it, overlapping experiments
  would be correlated and confound each other.
- **Salting / independent hashing** — lets you run many concurrent experiments and
  layered experiments without them interfering in assignment.

Say: *"Assignment is a deterministic hash of experiment id plus unit id, mod a
bucket count. It's stateless, consistent per user, and independent across
experiments because the experiment id is in the hash — which is what lets you run
thousands of experiments concurrently."*

## 2c. Sample ratio mismatch (SRM) — the assignment sanity check

If you intended a 50/50 split and observe 52/48 at scale, something is wrong with
assignment or logging (a bug, a redirect, a bot filter applied unevenly). **SRM is
a chi-square check on the observed vs expected split**; a failing SRM invalidates
the experiment — you don't analyze it, you fix it. Always run this check first.

---

# Section 3 — Metrics: primary, guardrail, and the OEC

- **Primary metric** — the one the experiment is designed to move and decide on
  (e.g. conversion/bookings). One primary, chosen in advance.
- **Guardrail metrics** — metrics that must *not* get worse even if the primary
  improves: latency/page-load time, revenue, cancellation rate, customer-service
  contacts, error rate. A treatment that lifts bookings but tanks latency or
  spikes cancellations is not a win. Guardrails catch the unintended damage.
- **Secondary / diagnostic metrics** — help explain *why* the primary moved
  (mechanism), not decision-drivers on their own.

## 3a. The OEC (Overall Evaluation Criterion)

The **OEC** is the single agreed metric (or composite) that defines success for
the experiment — ideally one that is causally movable in the short term but
correlated with long-term value. The discipline: **decide the OEC before you run**,
so you're not fishing through metrics afterward for one that's significant. In a
marketplace, a good OEC balances short-term conversion against long-term customer
and supply health, so you don't optimize a quarter and damage the ecosystem.

Worth being able to say: *"One primary metric / OEC chosen up front, a set of guardrails
that must not regress, and diagnostics to explain the mechanism. The failure mode
I watch for is picking the winning metric after the fact — the OEC has to be
pre-registered."*

---

# Section 4 — Variance reduction (CUPED)

Experiments are often underpowered — the effect is small and the metric is noisy,
so you'd need huge samples or long runtimes. **Variance reduction** buys power
without more traffic.

**CUPED (Controlled-experiment Using Pre-Experiment Data)** is the standard
technique. The idea: a lot of the variance in a user's outcome is explained by
their *pre-experiment* behavior (a heavy user before the test tends to be a heavy
user during it). Use a pre-period covariate to *adjust* the metric, removing the
variance that has nothing to do with the treatment:

```
Y_adjusted = Y - theta * (X - mean(X))
# X = pre-experiment covariate (e.g. the same metric measured before the test)
# theta chosen to minimize variance (the regression coefficient of Y on X)
```

The treatment effect estimate is unchanged (unbiased), but its variance drops —
often enough to cut required sample size or runtime substantially. The covariate
must be **pre-experiment** (unaffected by treatment) or you bias the result.

Say: *"CUPED uses each user's pre-experiment behavior as a covariate to strip out
baseline variance. Same effect estimate, tighter confidence interval — it's how
you get significant results faster without more traffic, as long as the covariate
is strictly pre-period."*

---

# Section 5 — Sequential testing and the peeking problem

## 5a. The peeking problem

Classic (fixed-horizon) A/B statistics assume you fix the sample size in advance,
then test *once* at the end. If you instead watch the p-value continuously and stop
the moment it dips below 0.05, your real false-positive rate is far higher than 5%
— because with enough looks a true-null test will cross the threshold by chance.
**Peeking at a fixed-horizon test and stopping early inflates false positives.**
This is one of the most common real-world experimentation mistakes.

## 5b. The fixes

- **Fixed horizon, no peeking** — compute the sample size up front (Section 7),
  run to completion, test once. Simple, but slow and tempting to violate.
- **Sequential testing / always-valid inference** — statistical methods designed
  to be looked at continuously: group-sequential boundaries (O'Brien-Fleming),
  always-valid p-values / confidence sequences (mSPRT), Bayesian approaches. These
  *let* you monitor and stop early without inflating error, at the cost of some
  power or wider intervals.

The senior framing: *"If you want to be able to stop early — and product teams
always do — you don't peek at a fixed-horizon test, you use a sequential method
with always-valid inference. Otherwise you either commit to a fixed sample size and
don't look, or you accept an inflated false-positive rate. There's no free lunch
where you fixed-horizon-test and peek."*

---

# Section 6 — Interleaving for ranking evaluation

For **ranking** specifically there's a much more sensitive method than A/B.

- **A/B for ranking** — user A sees ranker 1's list, user B sees ranker 2's list;
  compare aggregate clicks/bookings *between* users. Between-user variance is large,
  so you need a lot of traffic.
- **Interleaving** — for the *same* user/query, blend the two rankers' results into
  one list (team-draft or balanced interleaving), show it, and attribute each click
  to whichever ranker contributed that item. Now the comparison is *within* the
  same user, cancelling out user/query variance.

The payoff: interleaving is **far more sensitive** — it can detect ranking
differences with orders of magnitude less traffic than A/B, because each user
directly compares both rankers. The catch: it measures a *proxy* (click
attribution / relevance preference), so you typically use interleaving to cheaply
*screen* many ranker candidates, then confirm the winner with a full A/B on the
real business metric (bookings/revenue).

Worth being able to say: *"For ranking I'd interleave to screen candidates — it's dramatically
more sensitive than A/B because it compares both rankers within the same query — then
run a proper A/B on the survivor to confirm the business metric. Interleaving for
speed, A/B for the real decision."*

---

# Section 7 — Sample size and statistical power

Before running, you size the experiment:

- **Power** — the probability of detecting a true effect of a given size
  (conventionally aim for 80%). Underpowered tests waste traffic and produce
  inconclusive results.
- **Minimum Detectable Effect (MDE)** — the smallest effect you care to detect.
  Smaller MDE → much larger sample needed.
- **Significance level (α)** — the false-positive tolerance (commonly 5%).
- **Baseline rate and variance** — of the metric; higher variance → bigger sample
  (hence CUPED).

The drivers, intuitively: **sample size grows with metric variance and shrinks
with the square of the effect size you want to detect.** Halving the MDE roughly
quadruples the required sample. This is why variance reduction (CUPED) and
sensitive designs (interleaving) matter — they change the economics of what you can
detect in a reasonable runtime. Also account for **multiple comparisons**: testing
many metrics/variants inflates false positives; correct for it (Bonferroni / FDR)
or pre-register the primary.

---

# Section 8 — Network effects and marketplace interference (the key caveat)

This is the core of the whole topic for any two-sided platform, and the part
most often skipped.

## 8a. The problem (SUTVA violation)

Standard A/B analysis assumes **no interference**: one unit's treatment doesn't
affect another unit's outcome (the "stable unit treatment value assumption",
SUTVA). In a **two-sided marketplace** this breaks:

- **Shared inventory** — if treatment users book more of a limited supply, fewer
  rooms remain for control users; control's outcome is *changed by* treatment. The
  measured difference is contaminated.
- **Pricing / auction interference** — a treatment that bids/prices differently
  moves the market for everyone, including control.
- **Supply-side / seller effects** — treating some sellers changes the experience
  of buyers who are in control, and vice versa.
- **Cannibalization** — treatment "wins" bookings that would have gone to control
  anyway; the aggregate didn't grow, it just moved — but naive A/B credits
  treatment.

The result: **user-level A/B over- or under-estimates the true effect** because the
groups aren't independent. This is not a small correction; it can flip the sign of
a conclusion.

## 8b. The responses

- **Cluster / market randomization** — randomize whole markets/cities/regions
  instead of users, so interference stays *inside* a unit. Fewer independent units
  (less power) but valid.
- **Two-sided / bipartite designs** — randomize on the supply side, or use graph-
  cluster randomization to minimize cross-group spillover.
- **Switchback tests** (Section 9) — the time-based answer, common for
  pricing/dispatch/marketplace-balance experiments.
- **Budget-split / inventory-split designs** — partition the shared resource so
  groups don't compete for the same supply.

Worth being able to say: *"In a marketplace I don't trust a naive user-level A/B for
anything touching shared supply or price, because it violates SUTVA — treatment and
control compete for the same inventory. Depending on the change I'd move to
market-level cluster randomization or a switchback design so the interference stays
inside the randomization unit. That's the difference between measuring a real
marketplace effect and measuring cannibalization."*

---

# Section 9 — Switchback tests

When the treatment affects a **shared system state** (prices, supply-demand
balance, dispatch) and you can't cleanly split users, you split *time*:

- **Mechanism** — for a given region (or the whole system), switch the entire
  population between control and treatment over successive **time windows**
  (e.g. alternate every 30–60 minutes), randomizing which window is which.
- **Why** — everyone experiences the same policy at any instant, so there's no
  cross-user interference *within* a window; you compare treatment-windows vs
  control-windows.
- **Trade-offs** — fewer independent units (each window is one observation), so
  lower power; **carryover effects** (a treatment window's state bleeds into the
  next window) must be handled with washout periods or modeling; time-of-day and
  day-of-week effects must be balanced across variants.

Switchbacks are the standard tool for pricing, incentives, and supply-demand
experiments in marketplaces/logistics precisely because they sidestep the
interference problem that breaks user-level A/B.

---

# Section 10 — The practical experiment lifecycle

1. **Hypothesis** — a specific, falsifiable claim ("ranker v2 lifts bookings by
   ≥ X% without hurting latency").
2. **Design** — pick the randomization unit, the OEC/primary + guardrails, the
   MDE, and run a power calculation for the required sample/runtime. Choose the
   design (A/B, interleaving, cluster, switchback) based on interference risk.
3. **Instrument** — assignment (deterministic hash bucketing), exposure logging,
   and metric logging. Decide fixed-horizon vs sequential up front.
4. **Sanity-check** — A/A test the platform, verify SRM, confirm exposure logging
   before trusting anything.
5. **Run** — to the planned horizon (or monitor with a valid sequential method);
   don't peek-and-stop on a fixed-horizon test.
6. **Analyze** — treatment effect with confidence interval on the OEC, check
   guardrails, apply CUPED for variance reduction, correct for multiple
   comparisons, watch for novelty/primacy effects (early behavior differs from
   steady state).
7. **Decide and ship** — ship, iterate, or kill; roll out gradually (ties to the
   canary/rollout section of the model-serving primer) and monitor post-launch.

---

# Key points to be able to explain

1. **"How do you assign users to variants at scale?"** → Deterministic hash of
   experiment id + unit id, mod buckets. Stateless, consistent per user,
   independent across experiments because the experiment id is in the hash. Check
   SRM before analyzing.
2. **"Primary vs guardrail metrics; what's an OEC?"** → One pre-registered primary
   / OEC to decide on; guardrails (latency, revenue, cancellations) that must not
   regress; diagnostics to explain mechanism. Pre-register to avoid metric fishing.
3. **"What's the peeking problem and how do you handle it?"** → Continuously
   testing a fixed-horizon experiment inflates false positives. Fix: fixed horizon
   with no peeking, or a sequential / always-valid-inference method if you want to
   stop early.
4. **"What is CUPED?"** → Variance reduction using a pre-experiment covariate;
   same unbiased effect estimate, tighter interval, less traffic needed — covariate
   must be strictly pre-period.
5. **"How do you evaluate a ranking change efficiently?"** → Interleaving to screen
   (within-query comparison, far more sensitive), then A/B on the survivor for the
   real business metric.
6. **"Why can't you just A/B test a marketplace change?"** → SUTVA/interference:
   shared inventory and pricing mean treatment affects control, so user-level A/B
   is contaminated (cannibalization vs real growth). Use cluster/market
   randomization or switchback designs.
7. **"When a switchback test?"** → When treatment changes shared system state
   (price, supply-demand) and you can't split users cleanly; randomize over time
   windows, handle carryover with washout, balance time-of-day effects.
8. **"How do you size an experiment?"** → Power (~80%), MDE, α, baseline variance;
   sample grows with variance and ~quadruples as MDE halves; correct for multiple
   comparisons.

---

# Further reading

- **Kohavi, Tang & Xu, *Trustworthy Online Controlled Experiments*** — the
  definitive practitioner book; OEC, guardrails, SRM, and pitfalls.
- **Booking.com and Microsoft ExP experimentation blogs/papers** — real large-
  scale platform practice, including interference and metric design.
- **CUPED** — Deng, Xu, Kohavi & Walker, *"Improving the Sensitivity of Online
  Controlled Experiments by Utilizing Pre-Experiment Data."*
- **Interleaving** — Chapelle et al., *"Large-Scale Validation and Analysis of
  Interleaved Search Evaluation."*
- **Sequential testing** — Johari et al., *"Always Valid Inference"* (mSPRT /
  confidence sequences).
- **Marketplace interference / switchbacks** — the Lyft/DoorDash/Uber engineering
  posts on switchback and cluster-randomized experiments.

---

