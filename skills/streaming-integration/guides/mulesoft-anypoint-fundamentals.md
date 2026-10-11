---
title: MuleSoft Anypoint Platform Fundamentals
summary: Anypoint's product surface mapped onto generic integration concepts — Mule 4 and DataWeave, API-led connectivity, deployment models, API management and the connector library as a buy-versus-build lever.
---

## Frame

MuleSoft is mostly a **vocabulary and product-surface** topic for anyone who already knows
integration architecture. The thing MuleSoft sells — API-led connectivity, message mediation and
transformation, ESB-to-API modernisation, lifecycle governance — is general integration practice
under vendor names.

Three mental models:

1. **Map every Anypoint product to a generic equivalent.** API Manager ≈ any API gateway/management
   product (Apigee, Azure APIM, IBM API Connect). Mule runtime flows ≈ ESB message flows or an
   integration adapter. Exchange ≈ a private registry of reusable assets.
2. **"API-led connectivity" is MuleSoft's branded name for layered integration.** System → Process →
   Experience APIs is mediation + orchestration + backend-for-frontend under vendor packaging.
3. **DataWeave is the one genuinely new artefact** — MuleSoft's transformation language (Section 3).
   Its closest cousin is JSONata.

---

# Section 1 — Anypoint Platform: the shape of the thing

## 1a. What the names mean

- **MuleSoft** — the company (Salesforce-owned since 2018). Much of its enterprise pull is "we
  already run Salesforce".
- **Anypoint Platform** — the product: one platform to design, build, deploy, manage and govern both
  **APIs** and **integrations**.
- **Mule runtime engine** — the integration runtime that executes flows. A "Mule app" is one
  deployable integration application. Current major version: **Mule 4**.

Anypoint bundles the API-management plane and the integration-runtime plane in one product, where
many estates assemble a separate gateway and a separate runtime. That bundling is the
buy-versus-assemble trade-off.

## 1b. Component map

| Anypoint component | What it is | Generic equivalent |
|---|---|---|
| **Design Center** | Browser IDE for designing APIs (RAML/OAS) and simple flows | OpenAPI authoring |
| **Anypoint Studio** | Eclipse-based desktop IDE for building Mule apps | Integration developer IDE |
| **Exchange** | Internal marketplace of reusable APIs, connectors, templates, fragments | Private module/artefact registry |
| **API Manager** | Policies, gateways, SLA tiers and security for APIs | Apigee / Azure APIM / IBM API Connect |
| **Runtime Manager** | Deploy, scale, monitor Mule apps | Deployment plane (e.g. GitOps + Kubernetes) |
| **CloudHub 2.0** | MuleSoft-managed runtime (SaaS) | A managed container platform |
| **Runtime Fabric (RTF)** | Mule runtime on *your* Kubernetes (cloud or on-prem) | Self-hosted services on your cluster |
| **Anypoint MQ** | MuleSoft's managed message queue | SQS-style queueing |
| **Anypoint Monitoring** | Dashboards, alerts, metrics for Mule apps | APM / observability |
| **Anypoint CLI / Terraform provider** | Scripted platform management | Platform-as-code onboarding |

## 1c. ESB modernisation in MuleSoft's vocabulary

| Generic modernisation step | MuleSoft's name for it |
|---|---|
| Replace legacy API management | "Migrated to Anypoint API Manager" |
| Set REST/SOAP design, versioning and lifecycle standards | "API-led governance and lifecycle in Anypoint" |
| Move message mediation and transformation off an ESB | "Re-platformed ESB flows onto Mule / DataWeave" |
| Self-service onboarding as code | "Automated with Anypoint CLI + Exchange asset reuse" |
| Federated API estate under central governance | "Per-team autonomy under central governance" |

## 1d. Versions

- **Mule 4** — current. One **Mule Event** carrying message + attributes + variables; DataWeave 2.0
  as the expression language everywhere; built-in error handling; streaming by default.
- **Mule 3** — legacy. **MEL** (Mule Expression Language) instead of DataWeave, a different message
  model. A Mule 3 → 4 migration is a modernisation engagement in its own right.

---

# Section 2 — API-led connectivity

MuleSoft's signature pattern: a **three-layer decomposition of integration**.

| Layer | What it does | Plain-English analog |
|---|---|---|
| **System APIs** | Unlock data from systems of record (ERP, databases, legacy) — thin, stable, reusable | Adapters to source systems |
| **Process APIs** | Orchestrate and compose across System APIs; business logic; aggregation | Orchestration / mediation layer |
| **Experience APIs** | Reshape data for one channel or consumer (mobile, web, partner) | Backend-for-frontend |

The pitch: build System APIs once, reuse them under many Process APIs, expose many Experience APIs —
reuse compounds. It is layered reuse plus separation of concerns.

The critique: reuse only pays off if the System API layer is genuinely canonical and governed.
Otherwise you get **three layers of pass-through — all the latency, none of the reuse.**

---

# Section 3 — DataWeave

DataWeave (`.dwl`) is MuleSoft's functional transformation language for mapping across JSON, XML,
CSV, Java and flat files inside Mule 4.

- **Structure** — a header (`%dw 2.0`, `output application/json`) and, after `---`, a body that is a
  single transformation expression.
- **`map`, `filter`, `reduce`, `pluck`** — the functional core; same shapes as JavaScript array
  methods. `pluck` turns an object's key–value pairs into an array.
- **Selectors** — `payload.user.name` (single value), `payload.*items` (all repeated values),
  `payload..price` (descendants at any depth).
- **`output` / `input` directives** — format is declared, not inferred; one header line switches the
  same transform from JSON to XML.
- **Everywhere** — DataWeave is Mule 4's expression language for routing conditions, variable
  assignment and connector parameters, not only the Transform step.

```dataweave
%dw 2.0
output application/json
---
payload.orders map (order) -> {
  id: order.orderId,
  total: sum(order.lines map $.qty * $.unitPrice),
  status: if (order.paid) "COMPLETE" else "PENDING"
}
```

---

# Section 4 — Deployment models

Where Mule apps run is the consequential architecture choice.

| Model | What it is | When |
|---|---|---|
| **CloudHub 2.0** | MuleSoft-managed SaaS runtime (their cloud) | Offload operations, move fast |
| **Runtime Fabric (RTF)** | Mule runtime on your Kubernetes (cloud or on-prem) | Data residency, regulated workloads, existing Kubernetes estate |
| **Hybrid / customer-hosted** | Mule runtime on your VMs or servers, managed from the SaaS control plane | Legacy on-prem, gradual migration |
| **Private Cloud Edition (PCE)** | The whole Anypoint platform — control and data plane — self-hosted | Full sovereignty |

RTF vs CloudHub is the usual customer-infrastructure-versus-offload-operations decision: regulated or
residency-sensitive workloads land on RTF; speed-first teams take CloudHub. A platform team often
supports both plus a migration path — the same instinct as Confluent Platform vs Cloud.

---

# Section 5 — API management and governance

Anypoint **API Manager** does what any enterprise API gateway does:

- **API proxies** — front the backend and apply policies at the edge without changing it.
- **Policies** — rate limiting, spike control, OAuth 2.0 / OIDC enforcement, JWT validation, IP
  allowlist, client-ID enforcement, mTLS.
  - *Rate limiting* caps requests per window and rejects the excess; *spike control* smooths short
    bursts by queueing and retrying before rejecting.
- **SLA tiers** — per-consumer throughput contracts; a client application is granted a tier and the
  gateway enforces its limits.
- **Client applications and contracts** — consumers request access, receive credentials, and are
  governed centrally.
- **Exchange** — the reuse and discovery layer.
- **API Governance** — automated conformance checks of specs against rulesets (naming, security, OAS
  validity), replacing manual design review.

---

# Section 6 — Connectors and Exchange

MuleSoft's commercial pull is its **connector library** — hundreds of pre-built connectors
(Salesforce, SAP, ServiceNow, databases, SaaS APIs) from Exchange.

- **Connectors** — pre-built, configurable integration endpoints.
- **Mule SDK** — build your own connector when none exists (successor to the Connector DevKit).
- **Templates** — pre-built integration apps for common patterns.
- **Fragments** — reusable API-definition pieces (shared security schemes, data types).

The connector library is the real buy-versus-build lever. When the integration surface is dominated
by well-supported SaaS, pre-built connectors are a genuine time-to-value win; when it is bespoke
internal systems, the advantage thins and you pay a platform premium for custom work.

---

# Section 7 — Certification

- **MuleSoft Certified Developer — Level 1 (Mule 4)** (MCD-Level-1): about 60 multiple-choice
  questions in 120 minutes, online proctored, pass mark around 70%.
- **Prep:** MuleSoft's free, self-paced **"Anypoint Platform Development: Fundamentals (Mule 4)"**
  course (it often bundles a free exam attempt), plus the online DataWeave playground.

| Days | Focus |
|---|---|
| 1–3 | Anypoint tour, Mule 4 event model, first flows in Studio |
| 4–7 | DataWeave 2.0 — map/filter/reduce, format transforms |
| 8–10 | Connectors, error handling, flow control, API-led build |
| 11–12 | API Manager, deployment (CloudHub), governance |
| 13–14 | Practice questions and weak areas |

---

## Related guides

- [Confluent Platform, Connectors and Schema Governance](./confluent-platform-and-connectors.md) —
  the same managed-vs-self-hosted and managed-vs-custom-connector instincts on the streaming plane.
- [Boomi](./boomi.md) — the low-code sibling iPaaS, and how the two differ.
