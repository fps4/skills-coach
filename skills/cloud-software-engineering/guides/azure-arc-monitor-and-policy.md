---
title: Azure Arc, Azure Monitor and Azure Policy
summary: The hybrid control plane and the Azure-native observability stack — onboarding, policy-driven standards, Data Collection Rules, cost levers and alerting.
---

# Azure Arc, Azure Monitor and Azure Policy

For an architect who has built cross-cloud governance, monitoring standards and alerting on other
tools (Terraform, AWS, a third-party observability vendor) and now meets the Microsoft names for the
same capability. The architecture transfers; the product surface is large and has to be learned. This
guide gives the vocabulary, the shape of each service, and the places where an architect's opinion
actually matters.

---

## 1. Azure Arc

Azure Arc **projects non-Azure resources into the Azure control plane** so they can be targeted by
the same tooling as native Azure resources: Azure Policy, Azure Monitor, RBAC, tags, Update Manager,
Defender for Cloud, and Resource Graph queries.

An on-prem VMware VM, an EC2 instance, a GCP VM, a bare-metal server or a Kubernetes cluster anywhere
gets an **agent**, and afterwards appears in the Azure Resource Manager (ARM) hierarchy as a
first-class resource with an ARM resource ID.

**Arc is a control plane, not a data plane.** It does not move workloads and it does not run them. It
makes a machine you do not host addressable by Azure's governance and monitoring machinery.

| Arc resource type | What it is |
|---|---|
| **Arc-enabled servers** | Windows/Linux machines anywhere. The core of a VM-monitoring brief |
| **Arc-enabled Kubernetes** | Any conformant cluster (EKS, on-prem, GKE) attached to Azure for GitOps, policy and monitoring |
| **Arc-enabled data services** | SQL MI / PostgreSQL running on your own infrastructure, managed from Azure |
| **Arc-enabled VMware / SCVMM / Azure Stack HCI** | The *hypervisor* is Arc-connected, so VMs can be discovered and onboarded in bulk |
| **Arc-enabled SQL Server** | SQL Server instances anywhere, for inventory, best-practice assessment and Defender |

For hybrid and multi-cloud VM monitoring, **Arc-enabled servers** is the subject and **Arc-enabled
VMware/SCVMM** is very often how you get there at scale.

## 2. How a machine gets Arc-connected

1. The **Azure Connected Machine agent** (`azcmagent`) is installed on the machine.
2. The agent **registers** against a resource group and region, creating a
   `Microsoft.HybridCompute/machines` resource with an ARM ID.
3. The machine gets a **system-assigned managed identity**, which lets it pull secrets, authenticate
   to Azure services and be targeted by RBAC — an on-prem server ends up with an Azure identity.
4. **Extensions** are pushed onto it — Azure Monitor Agent, Defender, Custom Script, DSC, Update
   Manager. Extensions are how everything after onboarding happens.
5. **Policy and tags** apply to it exactly as to an Azure VM.

### Onboarding at scale

| Method | When |
|---|---|
| Interactive script (per machine) | Proof of concept only |
| **Service-principal-based script** at scale | The default for a few hundred machines; the SP has only the Arc onboarding role |
| **Group Policy / Configuration Manager / Ansible** | Windows domain estates and existing config-management shops |
| **Arc-enabled VMware / SCVMM auto-onboarding** | When the estate is virtualised and the hypervisor can be connected once |

**The architect's decisions** are not the script. They are: which resource group and region a
machine lands in, who owns the onboarding credential, which tags are mandatory at onboarding, and
what happens to a machine decommissioned without being disconnected. Stale Arc resources are the
hybrid equivalent of orphaned infrastructure.

### Where Arc stops

- It is not a hypervisor, an orchestrator or a migration tool.
- The agent needs outbound HTTPS to a defined set of Azure endpoints — via proxy, or **Azure Arc
  Private Link Scope** for isolated networks. Network approval is usually the long pole, not the
  technology.
- Extensions need the agent healthy; agent-health monitoring must be designed, or you get silent
  blind spots.
- Cost: Arc's control plane for servers is free, but what it enables (Monitor ingestion, Defender,
  Update Manager at scale) is not.

## 3. Governance on top — Azure Policy

**Azure Policy** evaluates ARM resources against rules. Because Arc machines are ARM resources, the
same policy engine covers on-prem and other clouds — the whole point of the product.

- **Policy definition** — one rule with an effect (`audit`, `deny`, `deployIfNotExists`, `modify`).
- **Initiative** (policy set) — a bundle of definitions, which is what you actually assign.
  Regulatory baselines ship as initiatives.
- **Assignment** — an initiative bound to a **scope**: management group → subscription → resource
  group. Scope inheritance is the design decision.
- **Remediation task** — for `deployIfNotExists` / `modify`, brings existing non-compliant resources
  into line, using a managed identity you must grant rights to.
- **Exemption** — the escape hatch, with an expiry date. Design exemptions deliberately or people
  fork the policy instead.

**The canonical Arc pattern:** a `deployIfNotExists` policy at management-group scope that installs
the Azure Monitor Agent and the right Data Collection Rule association on every Arc-enabled server.
That is how monitoring becomes standard rather than per-machine.

**Machine Configuration** (formerly Guest Configuration) extends Policy *inside* the OS — audit or
enforce settings on the machine itself.

## 4. Azure Monitor — the stack, not the product

| Piece | What it holds |
|---|---|
| **Metrics** (time-series DB) | Numeric, low-latency, cheap, short retention. Platform metrics are free |
| **Logs** (Log Analytics) | Everything else. Tables in a workspace, queried with **KQL**. Where the money goes |
| **Azure Monitor Agent (AMA)** | The single agent on VMs and Arc servers. Replaced the retired legacy Log Analytics agent (MMA) |
| **Data Collection Rules (DCR)** | *What* the agent collects and *where* it sends it. The central design object |
| **Alerts** | Metric alerts, log search alerts, activity-log alerts → **action groups** |
| **VM Insights** | Packaged VM performance + dependency map, built on AMA + DCR |
| **Workbooks / Dashboards** | The reporting surface |
| **Application Insights** | APM; a Log Analytics workspace under the hood in the workspace-based model |

### Data Collection Rules

A DCR declares data sources (perf counters, Windows event logs, syslog, text logs), optional
**transformations** (a KQL snippet applied at ingestion — filter or reduce before you pay), and
destinations (one or more workspaces).

A **DCR association** binds a DCR to a machine. One DCR can be associated with thousands of
machines; one machine can have several DCRs.

**This is the object a monitoring standard is written in:** a small set of DCRs (baseline / database
server / application server / high-security), assigned by policy, versioned in IaC.

### Ingestion cost levers

Log Analytics bills mostly on **GB ingested** plus retention.

- **DCR transformations** — drop noisy events at ingestion. Verbose Windows security logs and chatty
  syslog facilities are the usual offenders.
- **Table plans** — *Analytics* (full KQL, alerting) vs **Basic/Auxiliary** (cheap ingestion,
  restricted query, no alerting) for high-volume, low-value data.
- **Retention tiers** — interactive retention vs cheap long-term archive, then *search jobs* /
  *restore* to query archived data.
- **Commitment tiers** — reserved GB/day pricing once volume is predictable.
- **Workspace topology** — below.

The discipline is the same as for any observability vendor: decide what is a metric, what is a log,
what is sampled, and what is dropped at the agent.

### Workspace topology

Centralised (one workspace) vs distributed (per environment, region or business unit):

- **Data sovereignty and region** — a workspace lives in one region; logs stay there.
- **RBAC** — workspace-level vs **resource-context** access, where a user sees only the logs of
  resources they can read. Resource-context is what makes a single central workspace workable.
- **Cross-workspace queries** work (`workspace()` in KQL) but complicate alerts and workbooks.
- **Cost** — commitment tiers reward consolidation.

The usual landing-zone answer: **one central platform workspace** for infrastructure and security,
plus application workspaces where teams need their own retention and RBAC.

## 5. Alerting that people still read

- **Alert rule** → **action group** (email, SMS, webhook, Logic App, ITSM connector, Azure Function)
  → **alert processing rule** (suppression during maintenance windows, routing overrides).
- **Metric alerts** are cheap and fast; **log search alerts** are flexible and billed per evaluation
  — a 1-minute log alert on 5,000 machines needs the arithmetic first.
- **Dynamic thresholds** on metric alerts learn a baseline. Useful, and also the thing people switch
  on to avoid deciding what "healthy" means.
- **Health**: Resource Health, Service Health, and agent health for Arc machines.

The stack-independent discipline: define per-component health indicators first, alert only on what
has an owner and an action, and measure alert volume as a KPI of the monitoring platform itself.

## 6. ITSM integration (ServiceNow)

- The Azure Monitor **ITSM connector** and the ServiceNow **event management** connector push alerts
  into ServiceNow as events or incidents.
- **Service Graph Connector for Azure** populates the CMDB from Azure — and with Arc, Arc-enabled
  servers appear as configuration items too, often a quiet second business case for Arc (one
  inventory instead of three).
- The design questions: what is the correlation key, is the CMDB or Azure the master, does an alert
  create an incident or an event that ServiceNow correlates, and what closes it.

## 7. IaC on this stack

- **Bicep** is ARM with readable syntax — modules, `existing` references, `az deployment group
  create`.
- **Terraform** `azurerm` covers Arc, DCRs, policy assignments and workspaces.
- **Azure CLI / PowerShell** — the Arc/AMA world is Azure CLI-capable throughout.
- **Azure Landing Zones (CAF/ALZ)** ship a management-group hierarchy with policy initiatives and a
  central monitoring workspace already wired. If one exists, the monitoring design lives inside it —
  ask early.

## 8. KQL — the minimum

```kql
// perf: p95 CPU per Arc server, last 24h
InsightsMetrics
| where TimeGenerated > ago(24h) and Name == "UtilizationPercentage"
| summarize p95 = percentile(Val, 95) by Computer, bin(TimeGenerated, 1h)
| order by p95 desc

// heartbeat: machines that stopped reporting
Heartbeat
| summarize LastSeen = max(TimeGenerated) by Computer, ResourceId
| where LastSeen < ago(30m)
```

Operators to know: `where`, `project`, `extend`, `summarize` (+ `by`, `bin`), `join
kind=leftouter`, `arg_max`, `make-series`, `render`, `let`, `union`, `materialize`. `search *` is
what a beginner writes and what an expensive query looks like.

## 9. Design positions

1. **Onboarding thousands of servers** — connect the hypervisor (VMware/SCVMM) where possible,
   service-principal scripting through existing config management otherwise. Decide the
   resource-group/region model and mandatory tags before the first machine. Policy-driven extension
   deployment, never per-machine. Start the network/proxy or Private Link Scope approval first.
2. **Keeping Log Analytics cost under control** — DCR transformations, table plans for high-volume
   low-value data, retention tiering, a commitment tier once predictable, and a monthly
   cost-per-source review with an owner.
3. **Central or distributed workspaces** — central platform workspace with resource-context RBAC as
   the default; distributed where sovereignty, retention or team autonomy genuinely require it.
4. **Stopping alert fatigue** — health indicators per component first, alerts only with an owner and
   an action, alert volume tracked as a platform KPI, processing rules for maintenance windows.
