---
title: OpenShift for Kubernetes users
summary: OpenShift as Kubernetes plus an opinionated enterprise layer — the vocabulary translation from EKS/AKS and the few behaviours that are genuinely OpenShift-specific.
---

# OpenShift for Kubernetes users

For someone with hands-on Kubernetes (EKS, AKS, Helm, GitOps) meeting OpenShift. The gap is branded
vocabulary and a few platform-specific behaviours, not container competence.

Three mental models to hold:

1. **OpenShift is Kubernetes with an opinionated enterprise layer on top — not a different thing.**
   OKD (the community distro) and OCP (Red Hat's supported product) are **CNCF-certified Kubernetes
   distributions**. Every `kubectl` command still works. Every standard object — Pod, Deployment,
   Service, ConfigMap, Secret, Ingress, PVC — is the same YAML. Red Hat adds a curated stack: an
   integrated console, a build system, an image registry, an operator framework, a hardened default
   security posture, and OpenShift-native resource types that *predate* or *wrap* the upstream
   equivalents.
2. **The sharpest difference is the security default.** OpenShift runs your container as an
   **arbitrary, randomly-assigned non-root UID** by default (the `restricted-v2` SCC). This is *the*
   reason a container that runs fine on EKS/AKS crash-loops on OpenShift.
3. **Know both names, and which is legacy.** OpenShift accumulated its own resource types (Route,
   DeploymentConfig, BuildConfig, ImageStream) *before* Kubernetes standardized Ingress, Deployment,
   and external build tooling. Modern OpenShift steers you toward the standard objects, but the
   native ones still exist in older clusters.

---

## 1. What OpenShift is

### OKD vs OCP vs the managed flavours

| Name | What it is |
|---|---|
| **Kubernetes** | The upstream CNCF orchestrator. The engine. |
| **OKD** | The community/upstream distribution of OpenShift (formerly "OpenShift Origin"). Free, unsupported. OKD is to OCP what Fedora is to RHEL. |
| **OCP (OpenShift Container Platform)** | Red Hat's commercially supported product built on OKD — self-managed on your own infrastructure (bare metal, vSphere, AWS, Azure). |
| **ROSA / ARO** | Managed OpenShift on AWS (Red Hat OpenShift Service on AWS) and Azure (Azure Red Hat OpenShift) — the OpenShift equivalent of EKS/AKS, jointly operated with the cloud provider. |
| **OpenShift Local** | Single-node OpenShift on a laptop (formerly **CRC / CodeReady Containers**, before that **minishift**). |

### What the enterprise layer adds

Vanilla Kubernetes gives you the orchestrator and expects you to assemble the rest. OpenShift ships
these **integrated and opinionated**:

- **Integrated web console** with an **Administrator perspective** (cluster ops) and a **Developer
  perspective** (topology view, deploy-from-git, build status).
- **Built-in container registry** and **ImageStreams**.
- **In-cluster build system** — BuildConfigs and Source-to-Image (S2I).
- **A hardened security default** — SecurityContextConstraints, non-root by default.
- **The router** — an HAProxy-based ingress layer exposed via **Routes**.
- **OperatorHub + OLM** — a curated catalog of lifecycle-managed operators.
- **Integrated monitoring/logging** (Prometheus, Grafana, Loki) preinstalled.
- **Projects** — namespaces with extra multi-tenancy and self-service.

## 2. The `oc` CLI vs `kubectl`

`oc` is `kubectl` **plus** OpenShift-specific verbs. Anything you type as `kubectl <x>` works as
`oc <x>` unchanged.

| Task | `kubectl` (still works) | `oc` idiom / addition |
|---|---|---|
| Authenticate | (kubeconfig context) | **`oc login <api-url> -u <user> -p <pw>`** or `--token=...` |
| Create a namespace | `kubectl create namespace foo` | **`oc new-project foo`** (namespace + project metadata) |
| Switch namespace | `kubectl config set-context --current --namespace=foo` | **`oc project foo`** |
| Apply manifests | `kubectl apply -f k8s/` | `oc apply -f k8s/` (identical) |
| Shell into a pod | `kubectl exec -it pod -- /bin/sh` | **`oc rsh <pod>`** |
| Deploy an app from source/image | (no upstream equivalent) | **`oc new-app`** |
| Expose a Service externally | `kubectl expose` → Ingress needed | **`oc expose svc/<name>`** → creates a **Route** |
| Who am I / permissions | `kubectl auth can-i` | `oc whoami`, `oc auth can-i` |

```bash
oc login https://api.cluster.example.com:6443 -u dev -p '****'
oc new-project demo                          # create + switch to a Project
oc apply -f k8s/                             # existing manifests, unchanged
oc get pods,svc,route                        # route is an OpenShift type
oc rsh deploy/web-api                        # remote shell into a running pod
oc get events --sort-by=.lastTimestamp       # debugging, identical to k8s
```

## 3. Projects, Routes, and the resource-type map

### Projects = namespaces with extras

A **Project** *is* a Kubernetes **namespace** with an annotation layer on top, one-to-one. It adds:

- **Self-service provisioning** — developers create their own Projects within quota.
- **Multi-tenancy metadata** — display name, description, requester annotations.
- **Default RBAC bindings and SCC associations** wired up on creation.

Namespace-scoped RBAC, ResourceQuotas, NetworkPolicies and LimitRanges apply identically.

### Routes vs Ingress — north-south traffic

- **Route** is the **older, OpenShift-native** way to expose a Service outside the cluster. It
  predates Kubernetes Ingress and is served by the built-in **HAProxy-based router**. `oc expose
  svc/<name>` gives a hostname like `myapp-demo.apps.cluster.example.com`.
- **Ingress** also works — the OpenShift ingress controller reads Ingress resources and generates
  Routes to serve them.
- **Gateway API**, the successor to Ingress, is supported on recent OpenShift through the ingress
  operator — the forward direction.

Route TLS termination modes:

| Route TLS mode | What terminates TLS | Use when |
|---|---|---|
| **edge** | The router; traffic to the pod is plain HTTP | Simplest; cert managed at the router |
| **passthrough** | Not terminated at the router — passed to the pod, which terminates it | The application must own TLS end-to-end (mTLS, pinned certs) |
| **re-encrypt** | Router terminates external TLS, then opens a *new* TLS connection to the pod | An edge cert *and* an encrypted hop to the backend |

### The resource-type map

| Kubernetes (standard) | OpenShift-native equivalent | Modern default |
|---|---|---|
| Namespace | **Project** | Both; Project adds self-service/RBAC |
| Ingress | **Route** | Route is native; Ingress also supported |
| Deployment | **DeploymentConfig** | **Deployment** (DeploymentConfig is legacy) |
| (external `docker build`) | **BuildConfig + S2I** | Either; most teams ship their own Dockerfiles |
| (external registry) | **ImageStream** + internal registry | Both |
| `kubectl` | **`oc`** | `oc` (superset) |

## 4. Building images on the cluster (BuildConfig + S2I)

**Source-to-Image (S2I)** builds a container image from application source *inside the cluster*,
without a Dockerfile. A **BuildConfig** points at a Git repo and a **builder image** (Python,
Node.js, …); S2I injects the source into the builder, runs its assemble script, and pushes the
result to the internal registry as an **ImageStreamTag**.

- **BuildConfig** — defines *how* to build: source (Git URL/branch), strategy (S2I, Docker, or
  pipeline), output ImageStreamTag. Triggered by webhooks, image changes, or `oc start-build`.
- **ImageStream** — a named pointer to a set of related images; **ImageStreamTags** (`myapp:latest`)
  are entries. Deployments can watch them and roll out automatically on a new image.
- **Builder image** — the language-specific base with the S2I assemble and run scripts.

`oc new-app` is the one-command "give me a running app" verb:

```bash
oc new-app https://github.com/example/web-api.git            # from source (S2I)
oc new-app --image=registry.example.com/demo/web-api:1.4     # from an existing image
oc expose svc/web-api
```

**S2I vs your own Dockerfile.** S2I suits teams that don't want to maintain Dockerfiles. A team with
tuned multi-stage Dockerfiles usually keeps them — building in existing CI and pushing to a
registry, or using a BuildConfig with the **Docker build strategy** so the Dockerfile stays the
source of truth.

## 5. DeploymentConfig vs Deployment

| | **DeploymentConfig** (legacy) | **Deployment** (standard Kubernetes) |
|---|---|---|
| Origin | OpenShift, predates the K8s Deployment | Upstream Kubernetes |
| Rollout engine | Cluster-side deployer pods | ReplicaSets |
| Triggers | **ImageChange** and **ConfigChange** — auto-redeploy on a new ImageStreamTag or config | None native (use CI/GitOps) |
| **Lifecycle hooks** | **pre / mid / post** hooks | None built in (initContainers / Jobs) |
| Strategies | Rolling, Recreate, custom | Rolling, Recreate |
| Status today | **Deprecated** | **The modern default on OpenShift** |

The two capabilities DeploymentConfig had that plain Deployments lack are image-change triggers and
lifecycle hooks; modern OpenShift covers those with GitOps/CI and initContainers/Jobs.

## 6. The security posture that trips up Kubernetes users

### SecurityContextConstraints (SCC)

**SCCs** are an OpenShift cluster-level admission mechanism (ancestor of, and complement to,
Kubernetes Pod Security Admission). An SCC controls **what a pod may do** — which UID it runs as,
whether it can be privileged, which capabilities and volume types it may use, host networking.
Every pod is admitted against an SCC based on its service account's permissions.

The default SCC for ordinary workloads is **`restricted-v2`**. Others, in increasing privilege:
`nonroot-v2`, `hostmount-anyuid`, `anyuid`, `privileged`. A more permissive SCC is **requested** by
binding it to a service account.

### The `restricted-v2` behaviour — arbitrary non-root UID

> Under `restricted-v2`, OpenShift runs the container as a **random, high-numbered, non-root UID**
> assigned per namespace (e.g. `1000680000`), **ignoring a root `USER` in the Dockerfile**. The
> process runs in the **root (0) group** but without root privileges.

Images that assume root, a fixed UID, or directories only that UID can write will fail — even though
they run on EKS/AKS, which by default honour the image's `USER`. Symptoms: `Permission denied` on
startup, failure to bind a port below 1024, failure to write logs/cache/tmp, a webserver that cannot
write its PID file.

### Arbitrary-UID-friendly images

- **Don't rely on running as root.** Set a numeric non-root `USER` (e.g. `USER 1001`) but don't
  *depend* on that number.
- **Make what the process writes owned by group 0 and group-writable:** `chgrp -R 0 /app && chmod -R
  g=u /app`. The arbitrary UID is always in group 0, so this works whatever UID is assigned. The
  canonical fix.
- **Write only where any UID can** — `/tmp` or prepared group-writable directories.
- **Don't hardcode a home directory tied to a UID** (use `nss_wrapper` if the app insists on a passwd
  entry).
- **Listen on an unprivileged port** (≥1024, e.g. 8080).
- **Avoid `USER root` at runtime** and unneeded capabilities.

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY . /app
RUN pip install --no-cache-dir -r requirements.txt \
    && chgrp -R 0 /app && chmod -R g=u /app   # group-0 writable
EXPOSE 8080                                    # unprivileged port
USER 1001                                      # non-root; OpenShift may reassign the UID
CMD ["python", "-m", "app", "--port", "8080"]
```

If a workload genuinely needs a fixed UID or root, request the `anyuid` SCC deliberately and
document why, rather than reaching for it first. These practices also harden images on plain
Kubernetes.

## 7. Operators, the registry, Helm, and GitOps

- An **Operator** is a Kubernetes controller that encodes operational knowledge for a piece of
  software (install, upgrade, backup, failover) as custom resources — "software that runs software".
  **OperatorHub** is OpenShift's curated in-console catalog; **OLM (Operator Lifecycle Manager)**
  installs and upgrades Operators and their CRDs through subscription channels.
- **Internal registry + ImageStreams** — on-cluster builds land in the built-in registry. You can
  still push from external CI or pull from Quay, ECR, ACR or Docker Hub.
- **OpenShift Templates** are the original native parameterized-manifest format (`oc process`),
  now legacy. **Helm is supported natively** — the CLI and a console catalog — so existing charts
  deploy unchanged, subject to the SCC check.
- **OpenShift GitOps** *is* Argo CD and **OpenShift Pipelines** *is* Tekton, both packaged as
  Operators. A GitOps model built on Argo CD transfers directly.
- `odo` is a developer-focused CLI for fast inner-loop workflows; for infrastructure work, `oc` +
  Helm + GitOps is the path.

## 8. Moving an existing app to OpenShift

```bash
oc new-project demo
# push images (built in CI) to a registry the cluster can pull from
oc apply -f k8s/            # or: helm install app ./charts/app
oc get pods -w              # this is where SCC issues surface
oc expose svc/web           # a Route for north-south access
```

Services (east-west), ConfigMaps, Secrets, Deployments and PVCs carry over unchanged. The one thing
to validate first is the arbitrary-UID behaviour: run each image, confirm it starts as a non-root
arbitrary UID, does not bind a privileged port, and can write where it needs to. Fix failing images
per §6 rather than granting `anyuid`.

## 9. Practising locally

**OpenShift Local** runs single-node OpenShift on a laptop — console, internal registry, `oc`, and
SCCs enforced. `crc setup && crc start`, then `oc login`. Deploy one service, watch it get an
arbitrary UID, add a root-only write to break it, then fix it with `chgrp -R 0 / chmod -R g=u`. The
**Developer Sandbox for Red Hat OpenShift** is a free hosted alternative.

## Out of scope for this guide

Cluster installation (`openshift-install`, IPI/UPI), authoring Operators with the Operator SDK,
Templates in depth, the full SCC field reference, subscription tiers, and Service Mesh internals
(OpenShift Service Mesh is Istio).
