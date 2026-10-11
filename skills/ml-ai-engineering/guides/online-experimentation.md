---
title: Online Experimentation
summary: A/B testing for ML and ranking products — assignment, metrics, variance reduction, sequential testing, interleaving, power, and marketplace interference.
---

## Frame

Product changes driven by ML — ranking, pricing, recommendations — are validated by online
experiments. Running them well means reasoning about experimentation as an engineer *and* knowing
the statistical traps and the marketplace-specific caveats (interference between buyers and
sellers) that make naive A/B testing wrong.

Three mental models:

1. **An experiment is a causal measurement, and the design is what makes it causal.** Randomization
   is the whole trick: split units into control and treatment so the *only* systematic difference is
   the change, and any metric difference is caused by it. Assignment, metrics and statistics all
   serve to keep that claim valid.
2. **The dangerous failures are silent.** Peeking and stopping when a test looks significant, a
   metric that moved by chance, an assignment bug correlated with a covariate, interference that
   breaks independence — none throws an error. Each gives a confident wrong answer.
3. **In a marketplace, the standard A/B assumption is often violated.** Classic A/B assumes one
   user's treatment does not affect another's outcome (SUTVA). In a two-sided market — shared
   inventory, prices, supply — treating some users changes what control users see. Switchback and
   cluster designs are the response.

---

## 1. A/B testing for ML and ranking products

- **Control** — the current experience (A).
- **Treatment** — the new experience (B).
- **Randomize** — assign each unit to control or treatment at random.
- **Measure** — compare a metric between groups; use statistics to decide whether the difference is
  real or noise.

In ML and ranking, the thing under test is usually a *model or policy*, not a UI element: "does
ranking model v2 produce more conversions than v1?" The output is a ranked list, which makes
evaluation subtler (section 6), and the metric is downstream behaviour — clicks, bookings, revenue —
rather than a model score.

---

## 2. Randomization unit and assignment

### 2a. The randomization unit

- **User (visitor, cookie, account)** — the most common unit. Consistent experience across sessions;
  needed when the change affects the whole journey.
- **Session / request** — finer-grained, more statistical power, but a user can flip between
  variants — invalid if the effect spans sessions or the inconsistency itself hurts.
- **Cluster / geo / market / time slice** — coarser units used to contain interference (section 8).
  Fewer independent units means less power, but the result is valid where individual randomization
  would leak.

Rule: **randomize at the level at which the treatment acts and at which you need independence.** A
ranking change that affects shared inventory cannot be validly randomized per user; a button colour
can.

### 2b. Deterministic hash bucketing

```
bucket = hash(experiment_id + ":" + unit_id) % 10000
if bucket < treatment_share * 10000:
    variant = "treatment"
else:
    variant = "control"
```

- **Deterministic** — the same unit gets the same variant every time, on every server.
- **Stateless** — no assignment database on the request path.
- **`experiment_id` in the hash** — a unit's bucket in experiment A is independent of its bucket in
  B. Without it, overlapping experiments would be correlated and confound each other.
- **Salting / independent hashing** — makes many concurrent and layered experiments possible
  without interfering in assignment.

### 2c. Sample ratio mismatch (SRM)

If you intended a 50/50 split and observe 52/48 at scale, something is wrong with assignment or
logging (a bug, a redirect, a bot filter applied unevenly). **SRM is a chi-square test of the
observed against the expected split**; a failing SRM invalidates the experiment — you fix it, you do
not analyse it. Run this check first.

---

## 3. Metrics: primary, guardrail, OEC

- **Primary metric** — the one the experiment is designed to move and decide on (e.g. conversion).
  One, chosen in advance.
- **Guardrail metrics** — must *not* get worse even if the primary improves: latency, revenue,
  cancellation rate, support contacts, error rate. A lift that tanks page load is not a win.
- **Diagnostic metrics** — explain *why* the primary moved; they do not decide on their own.

### 3a. The OEC (Overall Evaluation Criterion)

The **OEC** is the single agreed metric (or composite) that defines success — ideally causally
movable in the short term and correlated with long-term value. **Decide it before the run**, so
nobody fishes through metrics afterwards for one that is significant. In a marketplace a good OEC
balances short-term conversion against long-term customer and supply health.

---

## 4. Variance reduction (CUPED)

Experiments are often underpowered: the effect is small and the metric noisy. **Variance reduction**
buys power without more traffic.

**CUPED (Controlled-experiment Using Pre-Experiment Data)**: much of the variance in a unit's outcome
is explained by its *pre-experiment* behaviour (a heavy user before the test is a heavy user during
it). Use a pre-period covariate to adjust the metric:

```
Y_adjusted = Y - theta * (X - mean(X))
# X = pre-experiment covariate (e.g. the same metric before the test)
# theta = the regression coefficient of Y on X (minimizes variance)
```

The effect estimate stays unbiased; its variance drops, often enough to cut required sample size or
runtime substantially. The covariate must be **pre-experiment** — unaffected by treatment — or the
result is biased.

---

## 5. Sequential testing and the peeking problem

### 5a. The peeking problem

Fixed-horizon statistics assume the sample size is fixed in advance and the test is run *once* at
the end. Watching the p-value continuously and stopping the moment it dips below 0.05 makes the real
false-positive rate far higher than 5%, because with enough looks a null effect crosses the
threshold by chance.

### 5b. The fixes

- **Fixed horizon, no peeking** — compute the sample size up front (section 7), run to completion,
  test once.
- **Sequential testing / always-valid inference** — methods designed to be monitored continuously:
  group-sequential boundaries (O'Brien-Fleming: very strict thresholds at early interim looks,
  relaxing towards the end), always-valid p-values and confidence sequences (mSPRT), Bayesian
  approaches. They allow early stopping without inflating error, at the cost of some power or wider
  intervals.

There is no option in which a fixed-horizon test is peeked at for free.

---

## 6. Interleaving for ranking evaluation

- **A/B for ranking** — user A sees ranker 1's list, user B sees ranker 2's; aggregate outcomes are
  compared *between* users. Between-user variance is large, so it needs a lot of traffic.
- **Interleaving** — for the *same* user and query, blend both rankers' results into one list
  (team-draft: the rankers take turns picking their next-best unpicked item; or balanced
  interleaving), show it, and credit each click to the ranker that contributed the item. The
  comparison is *within* user, cancelling user and query variance.

Interleaving is **far more sensitive** — it can detect ranking differences with orders of magnitude
less traffic. It measures a *proxy* (click preference), so it is used to cheaply *screen* many
ranker candidates; a full A/B on the real business metric then confirms the winner.

---

## 7. Sample size and statistical power

- **Power** — the probability of detecting a true effect of a given size (conventionally 80%).
- **Minimum Detectable Effect (MDE)** — the smallest effect worth detecting.
- **Significance level (α)** — the false-positive tolerance (commonly 5%).
- **Baseline rate and variance** of the metric.

**Sample size grows with metric variance and shrinks with the square of the effect size.** Halving
the MDE roughly quadruples the required sample — which is why variance reduction and sensitive
designs change what is detectable in reasonable time. **Multiple comparisons** — testing many
metrics or variants — inflates false positives; correct with Bonferroni or FDR, or pre-register the
primary.

---

## 8. Network effects and marketplace interference

### 8a. The problem (SUTVA violation)

Standard A/B analysis assumes **no interference**: one unit's treatment does not affect another
unit's outcome (the *stable unit treatment value assumption*). In a two-sided marketplace it breaks:

- **Shared inventory** — if treatment users consume limited supply, less remains for control;
  control's outcome is changed by treatment.
- **Pricing / auction interference** — a treatment that prices or bids differently moves the market
  for everyone.
- **Supply-side effects** — treating some sellers changes the experience of buyers in control, and
  vice versa.
- **Cannibalization** — treatment wins conversions that would have gone to control anyway; the total
  did not grow, it moved — yet naive A/B credits treatment.

User-level A/B then **over- or under-estimates the true effect**, sometimes enough to flip the sign
of the conclusion.

### 8b. The responses

- **Cluster / market randomization** — randomize whole markets, cities or regions so interference
  stays *inside* a unit. Less power, but valid.
- **Two-sided / bipartite designs** — randomize on the supply side, or use graph-cluster
  randomization to minimize spillover.
- **Switchback tests** (section 9) — the time-based answer.
- **Budget-split / inventory-split designs** — partition the shared resource so groups do not
  compete for the same supply.

---

## 9. Switchback tests

When the treatment affects **shared system state** (prices, supply–demand balance, dispatch) and
users cannot be split cleanly, split *time*:

- **Mechanism** — switch a whole region (or system) between control and treatment over successive
  **time windows** (e.g. every 30–60 minutes), randomizing which window gets which.
- **Why** — everyone experiences the same policy at any instant, so there is no cross-user
  interference within a window; compare treatment windows with control windows.
- **Trade-offs** — each window is one observation, so power is low; **carryover** (a treatment
  window's state bleeding into the next) needs washout periods or modelling; time-of-day and
  day-of-week effects must be balanced across variants.

Switchbacks are the standard tool for pricing, incentive and supply–demand experiments in
marketplaces and logistics.

---

## 10. The experiment lifecycle

1. **Hypothesis** — specific and falsifiable ("ranker v2 lifts conversion by ≥ X% without hurting
   latency").
2. **Design** — randomization unit, OEC/primary + guardrails, MDE, power calculation; choose A/B,
   interleaving, cluster or switchback based on interference risk.
3. **Instrument** — deterministic assignment, **exposure logging** (record that a unit actually saw
   its variant, so analysis counts exposed units), metric logging. Decide fixed-horizon or sequential
   up front.
4. **Sanity-check** — an **A/A test** (control against itself) validates the platform; verify SRM and
   exposure logging before trusting anything.
5. **Run** — to the planned horizon, or monitor with a valid sequential method.
6. **Analyse** — effect with confidence interval on the OEC, guardrails, CUPED, multiple-comparison
   correction; watch for **novelty and primacy effects** (early behaviour differs from steady state).
7. **Decide** — ship, iterate or kill; roll out gradually and monitor after launch (see
   [Model Serving Patterns](./model-serving-patterns.md)).

---

## Review questions

1. **How are units assigned at scale?** A deterministic hash of experiment id + unit id, mod a bucket
   count; check SRM before analysing.
2. **Primary vs guardrail; what is an OEC?** One pre-registered decision metric, guardrails that must
   not regress, diagnostics for mechanism.
3. **The peeking problem?** Continuous testing of a fixed-horizon experiment inflates false
   positives; fix with no peeking or a sequential method.
4. **CUPED?** Variance reduction with a strictly pre-period covariate; same estimate, tighter
   interval.
5. **Evaluating a ranking change efficiently?** Interleave to screen, A/B to confirm.
6. **Why not A/B a marketplace change naively?** SUTVA violation through shared inventory and price;
   use cluster randomization or switchbacks.
7. **Sizing?** Power, MDE, α, variance; sample ~quadruples as the MDE halves.

---

## Further reading

- Kohavi, Tang & Xu, *Trustworthy Online Controlled Experiments* — OEC, guardrails, SRM, pitfalls.
- Microsoft ExP experimentation papers — large-scale platform practice.
- Deng, Xu, Kohavi & Walker, *"Improving the Sensitivity of Online Controlled Experiments by
  Utilizing Pre-Experiment Data"* (CUPED).
- Chapelle et al., *"Large-Scale Validation and Analysis of Interleaved Search Evaluation."*
- Johari et al., *"Always Valid Inference"* (mSPRT, confidence sequences).
- Engineering write-ups from ride-hailing and delivery platforms on switchback and cluster-randomized
  experiments.
