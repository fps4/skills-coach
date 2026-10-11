---
title: Aviation and climate — contrails and contrail avoidance
summary: How contrails form and persist, why they warm the climate, how targeted avoidance works and when it backfires, and the observation and forecasting data a predict–act–verify loop needs.
---

## Frame

A domain ramp for a data or software engineer joining air-traffic-management (ATM) climate work with
no aviation background. The physics is not the job, but it decides which thresholds the pipelines
evaluate and why.

Four mental models:

1. **Contrails are a data problem wearing a physics hat.** When a contrail forms, whether it persists,
   and whether it warms or cools reduce to a handful of thresholds evaluated on a weather grid against
   a flight trajectory. That is grids, joins, thresholds, forecasts and optimisation.
2. **Everything rests on one asymmetry: a small fraction of flights cause most persistent-contrail
   warming.** If that were false, avoidance would mean rerouting everyone. Because it is true,
   **targeted avoidance is high-leverage** — nudge a few flights, remove most of the forcing.
3. **It is a "warming now vs warming later" optimisation, and it can backfire.** Avoiding a contrail
   costs a little extra fuel, hence extra CO2 that warms for centuries; the avoided contrail would have
   warmed for hours to a day. Avoidance wins only when the avoided forcing outweighs the extra CO2 —
   and only if the forecast was right. **Forecast skill is the whole game.**
4. **Two halves of one loop.** *Predict and decide*: physics on a weather grid picks the flights to
   nudge. *Observe and verify*: cameras, satellites and ML detect the contrails that actually formed.
   An operational programme runs both as one closed loop — predict, act, verify, feed back.

---

## 1. Contrail formation physics

### 1a. What a contrail is

A **condensation trail** is a line cloud of ice crystals. A jet engine burns kerosene and emits hot,
humid exhaust (water vapour plus soot and particles) into cold ambient air. As the plume mixes with the
surrounding air it cools. If, *during that mixing*, the air reaches **liquid-water saturation**, water
condenses on the soot particles (which act as condensation nuclei) and, at the sub-zero ambient
temperature, **freezes into ice crystals**.

The subtlety: the trigger is *transient liquid saturation during mixing*, not the ambient humidity by
itself. The plume follows a **mixing line** in temperature–humidity space between hot-wet exhaust and
cold-dry ambient air; whether that line crosses the liquid-saturation curve decides formation.

### 1b. The Schmidt–Appleman Criterion (SAC)

The **Schmidt–Appleman Criterion** answers *"will a contrail form at all?"* It is thermodynamics, not
statistics: a contrail forms if and only if the mixing plume reaches or exceeds **liquid saturation**
before it dilutes away.

The mixing line has a slope **G** — the ratio of water vapour to heat added by the engine per unit of
mixing:

```
G = (EI_H2O · cp · P) / (ε · Q · (1 − η))
```

| Symbol | Meaning | Effect on contrails |
|---|---|---|
| `EI_H2O` | water-vapour emission index (kg water / kg fuel) | higher → easier to form |
| `cp` | specific heat of air | — |
| `P` | ambient pressure (altitude proxy) | higher altitude (lower P) → colder, generally easier |
| `ε` | ratio of molar masses water/air (≈ 0.622) | constant |
| `Q` | specific combustion heat of the fuel | — |
| `η` | **engine overall efficiency** | **higher η → more contrails** |

The counter-intuitive one: **more fuel-efficient engines form contrails more readily.** Higher overall
efficiency leaves less waste heat in the exhaust, so the plume is relatively *wetter for its
temperature* — the mixing line is steeper and crosses saturation at warmer ambient temperatures.

The SAC yields a **threshold temperature** `T_SAC`: below it a contrail forms; above it none can. It
depends on pressure, humidity and `G` (hence on fuel and engine). Because it is a clean deterministic
function, it is the easy, computable part of the problem — a predicate per weather-grid cell.

### 1c. Temperature, humidity, pressure

- **Temperature** — the dominant control on *formation*. Contrails need cold air, which in practice
  means the upper troposphere at cruise altitudes. Warmer than `T_SAC`, no contrail, whatever the
  humidity.
- **Ambient humidity** — sets how far below the threshold the air is and, crucially, decides
  **persistence** (§2). Formation depends on relative humidity with respect to *water* (RHw);
  persistence on relative humidity with respect to *ice* (RHi).
- **Pressure / altitude** — enters `G` directly and sets the temperature environment. A flight level or
  two can cross both the temperature threshold and a humidity boundary — the basis of altitude-based
  avoidance.

---

## 2. Persistence — the part that matters for climate

### 2a. Short-lived vs persistent contrails

Formation is necessary but **not sufficient** for climate impact. What happens next depends on the
ambient humidity **with respect to ice**:

- **Sub-saturated for ice (RHi < 100%)** → the crystals **sublimate** within seconds to minutes. The
  contrail is **short-lived** and **climate-irrelevant**.
- **Supersaturated for ice (RHi > 100%)** → the crystals are stable and **grow** by taking up ambient
  water vapour. The contrail is **persistent**, lasts hours and spreads.

The two-gate logic:

```
contrail forms?          → SAC (temperature / pressure / engine)    [gate 1]
contrail persists?       → RHi > 100%  (ice supersaturation)        [gate 2]
climate-relevant contrail = gate 1 AND gate 2
```

### 2b. Ice-supersaturated regions (ISSR)

An **ice-supersaturated region** is a volume of clear-sky air with **RHi > 100%** but usually still
below liquid saturation — so no natural cloud forms and the sky looks clear. ISSRs are:

- **Patchy and thin** — often flat layers tens to hundreds of km wide but only hundreds of metres deep.
  That thinness is *why altitude avoidance works*: a small vertical change can exit the layer.
- **Hard to forecast** — humidity at cruise altitude is one of the least-well-observed and
  least-well-modelled quantities in numerical weather prediction. This is the central technical risk
  of contrail avoidance.
- **The condition that turns a harmless contrail into a climate problem.** No ISSR, no persistent
  contrail, nothing to avoid.

A persistent contrail spreading in an ISSR becomes **contrail cirrus** — a sheet of ice cloud
indistinguishable from natural cirrus, lasting many hours over large areas. Contrail cirrus, not the
thin line, is the climate agent.

---

## 3. Radiative forcing and the climate case

### 3a. Why contrails warm (net)

Contrail cirrus affects radiation in two opposite directions:

- **Longwave (greenhouse) effect — warming.** The ice cloud absorbs outgoing infrared from the warm
  surface and lower atmosphere and re-emits it at its cold top, trapping heat.
- **Shortwave (albedo) effect — cooling.** The cloud reflects some incoming sunlight back to space,
  during the day only.

The **net** is the difference of two large opposing terms, so it swings hard with conditions:

| Factor | Pushes toward |
|---|---|
| **Night** (no sunlight → no cooling term) | strong **warming** |
| **Day** (both terms active) | less warming, sometimes net cooling |
| **Winter / high latitude** (weak sun, long nights) | more warming |
| **Summer / low latitude** (strong sun) | less warming, can cool |

Averaged over the fleet, the **net effect is warming** — and the worst offenders (night, winter) are
identifiable.

### 3b. Magnitude vs aviation CO2, and the uncertainty

Contrail cirrus is one of the largest components of aviation's **non-CO2** climate impact (the
umbrella for contrails and NOx). In best-estimate assessments its **effective radiative forcing
(ERF)** is comparable to — plausibly larger than — the forcing from all the CO2 aviation has ever
emitted. Counting non-CO2 effects, aviation's total climate effect is on the order of **2–3× its CO2
alone**, with contrails the largest single non-CO2 term.

**State the uncertainty every time.** The contrail estimate carries a far wider band than the CO2
estimate, because it depends on cruise humidity fields, ice-cloud optical properties and the
day–night and seasonal mix — all poorly constrained. The honest register: *best estimate comparable to
or larger than aviation CO2, with a wide error bar — itself a reason to invest in observation and
forecasting.* Never quote a single number as settled.

### 3c. CO2-equivalent — and why it is slippery

To weigh a short-lived contrail against long-lived CO2, contrail forcing is converted to
**CO2-equivalent (CO2e)** — the mass of CO2 that would cause the same warming over a chosen time
horizon. The catch:

- CO2 warms for **centuries**; a contrail for **hours**. The CO2e figure depends entirely on the
  **time horizon** (GWP20 vs GWP100) and the **metric** (GWP vs GWP\*, a warming-equivalent metric for
  short-lived forcers). Over 20 years a contrail looks large in CO2e; over 100 years, much smaller.
- The avoidance decision weighs **extra CO2 burned now** against **avoided contrail forcing**, so the
  "right answer" moves with the horizon and metric. Treat CO2e as a **modelling choice**, not a fact,
  and say which one was used.

---

## 4. Avoidance — the operational idea

### 4a. A few flights cause most of the warming

Studies of traffic against humidity fields consistently find that **a small minority of flights —
on the order of a few percent — cause the bulk of persistent-contrail energy forcing**. Two reasons:
most flights never pass through an ISSR, and of those that do, the night and winter ones dominate the
warming.

So nobody needs to change how everyone flies: **identify the few offending flights and nudge them**.
That is a targeting problem, won with good data and good forecasts.

### 4b. The manoeuvre: small altitude changes

Because ISSRs are **thin layers**, the intervention is usually a **small vertical change** — climb or
descend a flight level or two — to fly above or below the supersaturated layer, in clear,
contrail-free air. Lateral rerouting is possible but costs more distance and fuel and complicates
traffic; **altitude is the cheap lever**. Any change must remain compatible with separation, sector
capacity and controller workload, which is why it has to be trialled in operational airspace, not only
in a lab.

### 4c. What operational trials have shown

Live avoidance trials in European upper airspace have reported roughly **64% fewer contrails on
treated flights for about 2% extra fuel on those flights**. The ~2% applies to the *individual treated
flights*, not the fleet: because few flights need treating, the fleet-average fuel penalty is far
smaller. That is the business case — a large contrail reduction for a small fleet-level fuel cost, *if*
the right flights are picked. Do not invent more precise figures.

### 4d. The climate-vs-fuel trade-off and the backfire risk

```
net climate benefit =  (avoided persistent-contrail forcing, as CO2e)
                     −  (extra CO2 from the manoeuvre's extra fuel)
Act only when this is positive by a comfortable margin.
```

Two failure modes:

1. **Forecast false positive.** Rerouting (and burning fuel) to avoid a contrail that would not have
   formed — pure loss. Common, because cruise humidity forecasts are weak; hence a **decision margin**,
   not a hair-trigger on the point forecast.
2. **Wrong-direction move.** Worse: a bad humidity field routes the flight *into* an ISSR thought to be
   clear. Avoidance on poor forecasts **can increase net warming** — the honest counter-argument to the
   scheme, and the reason verification exists.

The mature framing: *avoidance is net-positive only with sufficient forecast skill and a decision
threshold that accounts for forecast uncertainty and the CO2e horizon choice. Without verification
nobody can tell whether it is working.* What limits avoidance today is not the manoeuvre or the
physics but forecast skill for cruise-level humidity.

---

## 5. Observation and verification

### 5a. Ground-based sky cameras

To check whether forecasts and avoidance worked, someone has to *see* the sky. Ground-based sky
cameras provide the ground truth:

| Camera | Band | Coverage | Purpose |
|---|---|---|---|
| Visible (optical) | visible | **daytime** | detect and track contrails against the daytime sky |
| Infrared (thermal) | infrared | **day and night** | detect contrails without daylight |

Infrared matters disproportionately: the highest-warming contrails are the **night-time** ones, exactly
when a visible camera is blind.

### 5b. From classical CV to ML segmentation

Finding thin, faint, moving contrail lines in a noisy sky full of natural cloud was historically done
with **classical computer vision** — edge and line detectors with hand-tuned thresholds. Those break on
low-contrast targets against variable backgrounds, which is where **learned detection and
segmentation** wins. A **U-Net** — an encoder–decoder with skip connections that outputs a per-pixel
mask — is a textbook choice.

- **Semantic segmentation** says which pixels are contrail.
- **Instance segmentation** says which contrail is which — needed to follow one trail.
- **Tracking** follows one contrail across video frames over its life.
- **Attribution** correlates detections with **aircraft traffic data** (which flight, at what
  altitude, made which contrail) — effectively an entity-resolution join on space and time.
- **Satellite imagery** gives an independent overhead view of contrail cirrus to correlate with.

Open, instance-level annotated ground-camera video datasets for contrail detection, segmentation and
tracking have started to appear, which is what moves a model from single-frame
semantic segmentation to instance segmentation and tracking.

---

## 6. Forecasting and data inputs

The predict half needs a **4D atmospheric state** (temperature, humidity, pressure, wind over latitude,
longitude, altitude and time — humidity above all) and **flight trajectories**:

| Input | What it is | Role |
|---|---|---|
| **ERA5** | ECMWF's global reanalysis — a gridded, physically consistent historical record of the atmosphere | research and backtesting |
| **NWP** (numerical weather prediction) | forward weather forecasts | the operational humidity / ISSR forecast actually flown on |
| **ADS-B trajectories** (e.g. the OpenSky Network) | position, altitude and time broadcast by aircraft, collected by receiver networks | the traffic side of the join |
| **CoCiP** | the Contrail Cirrus Prediction model | the community reference lifecycle model: formation → spreading → radiative forcing → CO2e per contrail |

**Reanalysis vs forecast:** reanalysis reconstructs the past from observations; NWP forecasts forward
and is what operations act on. A backtest on reanalysis overstates operational skill — the same trap as
training on data that would not have been available at decision time.

### The pipeline shape

```
weather grid (T, P, RHi over lat / lon / altitude / time)   +   flight tracks (lat / lon / alt / time)
        │
        ▼   join each trajectory point to the grid cell it flies through
   [gate 1] SAC:  T < T_SAC(P, engine)?        → contrail forms?
   [gate 2] ISSR: RHi > 100% in that cell?      → contrail persists?
        │  persistent contrail = gate 1 AND gate 2
        ▼
   for persistent flights: search nearby flight levels for clear sky (non-ISSR)
        ▼
   cost model:  avoided_contrail_forcing_CO2e  −  extra_fuel_CO2
        ▼
   recommend the change only if net benefit exceeds the margin
```

The closed loop: **predict** persistent contrails, **act** by nudging flights, **verify** against
cameras and satellites, and **feed the errors back** into the humidity forecasts — which is what
actually limits avoidance today.

---

## 7. Self-check

1. When does a contrail form, and when does it persist? *(SAC — the plume reaches liquid saturation;
   persists only in ice-supersaturated air, RHi > 100%.)*
2. Why do more efficient engines make contrails more easily? *(Less waste heat → wetter plume for its
   temperature → steeper mixing line → higher threshold temperature.)*
3. Are contrails net warming or cooling? *(Net warming on average; strongest at night and in winter.)*
4. How big is the contrail effect vs aviation CO2? *(Best estimate comparable or larger, with a much
   wider uncertainty band.)*
5. What is the catch in converting a contrail to CO2e? *(It depends on the time horizon and metric.)*
6. Why is avoidance feasible at all? *(A few percent of flights cause most of the warming.)*
7. What is the manoeuvre? *(A small altitude change out of a thin ISSR layer.)*
8. How can avoidance make things worse? *(False positives waste fuel; a wrong humidity field routes
   into an ISSR.)*
9. How are contrails detected in sky imagery? *(ML segmentation such as U-Net; infrared for night.)*
10. What data does an avoidance pipeline need? *(A 4D humidity/temperature field — reanalysis to
    backtest, NWP to fly on — plus ADS-B trajectories; CoCiP as the reference model.)*

---

## Out of scope here

- Deriving the SAC from thermodynamics; know the drivers and the two-gate logic.
- Precise forcing figures or CO2e coefficients.
- Detailed ATM procedures (separation minima, sector handoffs, flight-plan message formats).
- NOx chemistry, cirrus microphysics, aerosol–cloud interactions.
- Satellite instrument specifics.
- Aviation climate policy (ETS, CORSIA).
