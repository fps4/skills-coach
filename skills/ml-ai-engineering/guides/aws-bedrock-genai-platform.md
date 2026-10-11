---
title: AWS Bedrock and the AWS-Native GenAI Platform
summary: The Bedrock stack — Converse, inference profiles, Guardrails, Knowledge Bases, Agents and AgentCore, Evaluations — mapped onto the components of a self-built LLM gateway, agent runtime and RAG stack, with where each managed service stops.
---

## Frame

Many teams have built some version of a GenAI platform themselves: an OpenAI-compatible LLM gateway
(e.g. LiteLLM) with model-tier routing and per-consumer cost tracking, a hand-written agent loop over
MCP tools, hybrid RAG on pgvector with a reranker, and an eval harness. AWS packages most of these
capabilities as managed services. This guide gives the product names, the shape of each service, and
the places where the managed option runs out — so a build-versus-adopt discussion is about
trade-offs.

Three things to hold:

1. **Bedrock is not one service, it is a stack.** Model access (Converse), safety (Guardrails),
   retrieval (Knowledge Bases), agents (Agents / AgentCore), evaluation (Evaluations), and cost and
   routing controls (inference profiles). They are adopted separately.
2. **Almost every managed component has a "where it stops" line.** The interesting question is never
   "can Bedrock do it" but "at what point do we take this back in-house, and what do we lose."
3. **The AWS-native answer to an AI gateway is not one product.** It is Bedrock as a multi-model
   endpoint, plus application inference profiles for cost attribution, plus optionally API Gateway +
   Lambda (or a LiteLLM proxy on ECS) in front for organisation-specific policy.

> **Fast-moving surface.** Bedrock ships features constantly, and AgentCore in particular is new.
> Check current AWS docs for GA status and region availability; do not treat this guide as the
> authority on what is GA.

---

## 1. Model access

### Converse vs InvokeModel

- **`Converse` / `ConverseStream`** — the unified message API. One request shape across model
  families (Anthropic, Amazon Nova, Meta, Mistral, Cohere, AI21): `messages`, `system`,
  `inferenceConfig`, `toolConfig`. **The one to build on** — one API, swappable model behind it,
  much like an OpenAI-compatible surface.
- **`InvokeModel` / `InvokeModelWithResponseStream`** — the raw, model-native payload, hand-built per
  provider. Needed only for model-specific parameters Converse does not expose.

```python
client.converse(
    modelId="eu.anthropic.claude-...",
    system=[{"text": "You are terse."}],
    messages=[{"role": "user", "content": [{"text": "Hi"}]}],
    inferenceConfig={"maxTokens": 512},
)
```

**Tool use** works through `toolConfig`: declare tool specs with JSON Schema input, the model returns
a `toolUse` content block, the application executes it and sends back a `toolResult`. Structurally
identical to the OpenAI-style tool-calling loop. Bounded iterations, an audit chain and tool-chain
validation remain the application's to write.

### Inference profiles — cost attribution

- **Cross-region inference profiles** route requests across regions within a geography for
  throughput and resilience. Model IDs carry a geography prefix (`eu.`, `us.`).
- **Application inference profiles** wrap a model with **your own tags**. Usage and cost become
  attributable per tag in Cost Explorer — per team, application or agent.

Cost attribution across a shared gateway on AWS is application inference profiles plus a tagging
convention — and the convention needs an owner, or the tags are worthless.

### Capacity modes

- **On-demand** — per token, no commitment. Default.
- **Provisioned Throughput** — reserved model units, hourly commitment. Needed for guaranteed
  throughput and for custom / fine-tuned models.
- **Batch inference** — large asynchronous jobs at a lower rate.

### Routing

**Intelligent Prompt Routing** routes each prompt between models *within one family* based on
predicted response quality, to cut cost on easy requests. It is narrower than an explicit platform
routing policy (fast / standard / strong tiers with per-consumer overrides), which is why many
organisations still put a proxy in front of Bedrock.

---

## 2. Guardrails

**Amazon Bedrock Guardrails** is a policy layer on input, output or both:

- **Content filters** — hate, insults, sexual, violence, misconduct, prompt attack; each with a
  configurable strength.
- **Denied topics** — natural-language topic definitions to refuse.
- **Word filters** — profanity plus custom word lists.
- **Sensitive information filters** — PII detection with block or mask, plus custom regex.
- **Contextual grounding check** — scores the response against a supplied source passage for
  *grounding* and against the query for *relevance*, with thresholds.

Guardrails attach to a Converse call or an Agent, or run standalone through **`ApplyGuardrail`** —
which lets one organisational policy cover models and flows that do not run through Bedrock at all.

**Where it stops:** contextual grounding scores text against a passage. It cannot require that a
*number* in the answer came from a *specific deterministic tool call recorded in an audit log*. It
reduces hallucination probabilistically; a design in which every figure must trace to an audited
tool call makes an unsourced figure structurally impossible. That is a real architectural
difference.

---

## 3. Knowledge Bases (managed RAG)

### Ingestion

- **Data sources** — S3 primarily; also web crawler, Confluence, SharePoint, Salesforce, custom
  ingestion.
- **Chunking** — fixed-size (with overlap), **semantic**, **hierarchical** (parent/child: retrieve on
  the small child, return the large parent), or **none** (pre-chunked), plus a Lambda hook for custom
  transformation.
- **Embedding models** — Amazon Titan Text Embeddings v2 (256/512/1024 dimensions) and Cohere Embed.
  An open-source embedding model (e.g. BGE-M3) means a custom ingestion path or leaving Knowledge
  Bases.
- **Metadata** — per-document metadata files enable filtered retrieval — the usual answer to
  multi-tenancy and permissions.

### Vector stores

Knowledge Bases writes into a store you choose:

| Store | Notes |
|---|---|
| **OpenSearch Serverless** | The default. Fast, fully managed, but **a baseline OCU cost floor** even when idle — the standard complaint in a cost conversation |
| **Aurora PostgreSQL Serverless v2 (pgvector)** | Cheaper at small scale and a familiar SQL surface — the pragmatic pick for a team already on pgvector |
| **Neptune Analytics** | GraphRAG — entity and relationship traversal on top of retrieval |
| **Pinecone, MongoDB Atlas, others** | Third-party managed |

### Retrieval

- **`Retrieve`** — returns chunks; you do the generation. Use it when you already have an agent loop,
  so retrieval stays a tool.
- **`RetrieveAndGenerate`** — managed RAG end to end, returning an answer with citations. Fast to
  demo, less controllable.
- **Reranking** — Amazon Rerank or Cohere Rerank models, inside Knowledge Bases or standalone.

A typical self-built hybrid RAG (dense embeddings + reranker + retrieval exposed as a tool) maps to
Knowledge Bases with hierarchical chunking, a rerank model, metadata filtering, and `Retrieve`
surfaced as a tool. Custom retrieval logic — e.g. scoping retrieval to a document section, or a
fallback strategy — has no managed equivalent.

---

## 4. Agents: Bedrock Agents and AgentCore

There are two generations.

### Agents for Amazon Bedrock (the original)

A managed agent runtime you *configure*:

- **Action groups** — tools backed by a Lambda function, described by an **OpenAPI schema** or
  simpler function definitions. The agent chooses, Bedrock invokes the Lambda.
- **Knowledge base association** — retrieval wired in.
- **Advanced prompts** — override the pre-processing, orchestration, knowledge-base-response and
  post-processing prompt templates; the escape hatch when the default orchestration prompt is wrong
  for the domain.
- **Return of control** — the agent hands the tool call back to the application to execute instead of
  invoking a Lambda: managed orchestration, execution kept in your runtime.
- **Session state and memory**, **code interpreter**, **multi-agent collaboration** (a supervisor
  agent delegating to collaborator agents).

### Amazon Bedrock AgentCore (2025)

A platform-shaped set of services for running agents you *write*, framework-agnostic:

- **Runtime** — serverless, session-isolated execution for agent code, with long execution windows.
- **Gateway** — turns existing APIs and Lambda functions into agent tools exposed over **MCP**; the
  closest AWS analogue to a self-built MCP tool surface.
- **Memory** — managed short- and long-term agent memory.
- **Identity** — agent identity and delegated access to third-party services.
- **Code Interpreter** and **Browser** — sandboxed tools.
- **Observability** — traces and metrics for agent runs via CloudWatch / OpenTelemetry.

Managed gets you isolation, identity and observability; a custom runtime keeps control over the
loop, the audit chain and the eval hooks. Which is right is a real decision, not a default.

### Orchestration outside the agent

Not everything should be an agent. **Step Functions** is the AWS answer for deterministic multi-step
LLM workflows:

- An optimized Bedrock integration as a task state.
- **Distributed Map** for fan-out over large document sets — the standard batch enrichment pattern.
- Retries, catch and timeouts as configuration rather than code.

Agent loops for open-ended reasoning; Step Functions wherever the sequence is known — cheaper,
debuggable, and it does not regress when a prompt changes. **Bedrock Prompt Flows** is a lighter,
visual variant; **Prompt Management** versions prompts as resources.

---

## 5. Evaluation

**Amazon Bedrock Evaluations**:

- **Model evaluation** — automatic (built-in metrics on curated or custom datasets),
  **LLM-as-a-judge**, and human evaluation workflows.
- **RAG evaluation** — a Knowledge Base's retrieval and generation, with judge metrics such as
  correctness, completeness, faithfulness and relevance.

**Where it stops:** these evaluate *text quality*. They do not validate the **expected tool chain
against the actual tool chain**, nor report a verdict taxonomy (answered / partial / declined /
loop-exhausted / tool-error). For an agentic system, a right-looking answer reached through the wrong
tools is a latent failure that text metrics miss. Pair evaluation with the deploy-gate discipline
from [LLMOps and LLM Evaluation](./llmops-and-llm-eval.md): the harness runs in CI and gates the
change, or a shared agent template cannot safely be changed.

---

## 6. The "AI gateway" question

"We need an AI gateway" usually means some subset of: one endpoint for all models, per-team access
control, cost attribution and quota, routing and fallback, guardrail enforcement, prompt versioning,
and logging.

| Need | AWS answer |
|---|---|
| One endpoint, many models | Bedrock `Converse` |
| Per-team access control | IAM policies scoped to model IDs / inference profiles |
| Cost attribution, chargeback | **Application inference profiles + tags** → Cost Explorer |
| Quota / throttling | Per-model service quotas; API Gateway usage plans if fronted |
| Routing and fallback | Intelligent Prompt Routing (narrow); cross-region profiles for resilience; anything richer needs your own layer |
| Safety policy | Guardrails, centrally owned, per call or via `ApplyGuardrail` |
| Prompt versioning | Bedrock Prompt Management |
| Logging / observability | Model invocation logging → CloudWatch/S3; CloudWatch metrics; OpenTelemetry |
| Organisation-specific policy, non-Bedrock models, OpenAI-compatible surface | A thin proxy — API Gateway + Lambda, or LiteLLM on ECS/Fargate — in front of Bedrock |

A pure-Bedrock gateway is the right default. The proxy layer earns its place only when the
organisation needs an OpenAI-compatible surface for existing code, models outside Bedrock, or routing
richer than AWS's — owning a proxy has a real cost.

---

## 7. Translation table

| Self-built component | AWS-native equivalent |
|---|---|
| OpenAI-compatible gateway (e.g. LiteLLM) | Bedrock `Converse` API |
| Model-tier routing with per-consumer overrides | Intelligent Prompt Routing (narrower); otherwise your own layer |
| Per-consumer cost tracking | Application inference profiles + cost allocation tags |
| Self-hosted models (e.g. Ollama) | Bedrock on-demand / Provisioned Throughput; SageMaker for true self-hosting of open-weight models |
| Hand-built agent loop | Agents for Bedrock, or AgentCore Runtime |
| MCP tool surface | AgentCore Gateway (MCP), or action groups (Lambda + OpenAPI) |
| Agent memory | Agent session state; AgentCore Memory |
| pgvector + reranker hybrid RAG | Knowledge Bases + OpenSearch Serverless or Aurora pgvector, + rerank models |
| Open-source embedding models | Titan Text Embeddings v2 / Cohere Embed (others need custom ingestion) |
| Anti-hallucination via audit-traceable tool calls | Guardrails contextual grounding (probabilistic, not structural) |
| Eval harness with tool-chain validation | Bedrock Evaluations + RAG evaluation (text quality only) |
| Container deployment | ECS/Fargate, Lambda, AgentCore Runtime |
| Loki/Grafana observability | CloudWatch, X-Ray, OpenTelemetry, invocation logging |

---

## 8. Why AI platform teams stall

The gap in most central AI platform teams is rarely building components; it is **adoption and
regression safety**. Shared services get used when they are cheaper for a team than the alternative,
and they stay usable when an eval harness gates changes to them.

---

## Suggested study order

1. **Converse API + tool use** — run one Converse call with a tool definition.
2. **Inference profiles** — cross-region vs application, and the tagging/cost story.
3. **Guardrails** — the policy types and `ApplyGuardrail`.
4. **Knowledge Bases** — chunking strategies, vector-store options and the OpenSearch Serverless cost
   floor, `Retrieve` vs `RetrieveAndGenerate`.
5. **Agents + AgentCore** — action groups, return of control, the AgentCore components; check GA
   status.
6. **Step Functions with Bedrock** — the optimized integration and Distributed Map.

Related: [LLMOps and LLM Evaluation](./llmops-and-llm-eval.md);
[Model Serving Patterns](./model-serving-patterns.md).
