---
title: Spring Boot for Architects
summary: Enough Spring Boot to set standards, run architecture reviews, and govern a Java delivery team credibly — without becoming a Java developer.
topic: app-development
format: guide
tags: [spring-boot, java, dependency-injection, jpa, rest, plsql, migration]
updated: 2026-08-07
---

## Frame

"Solid Spring Boot microservices and REST API design experience" is a common
requirement, and it hides two very different skills. REST API design is
framework-independent — anyone who has authored API standards for a multi-team
estate owns it already. Spring Boot itself is the other half, and it is entirely
possible to govern Java teams competently for years without having shipped Spring
code yourself.

The goal here is **not** to become a Java developer in five evenings. The goal is
that when a delivery team shows you a Spring Boot service, you can review it the
way you review a Node or Python service: know where the layers are, where the
bodies are buried (transactions, N+1 queries, blocking calls, fat controllers),
what "good" looks like, and what standards to set. Plus one small service built
by hand, because review judgement without any build experience is brittle in a
specific and predictable way.

Three mental models to hold going in:

1. **Spring Boot is a minimal web core plus platform conventions, collapsed into
   one framework.** Node gives you a small core and you assemble the rest;
   Spring Boot ships the assembled opinion ("auto-configuration") and you
   override where needed. Most of learning Spring Boot is learning *which
   conventions it already decided for you.*
2. **Dependency injection is the organizing principle.** Where Node wires by
   hand through `require`/`import`, Spring's container constructs and wires
   everything (`beans`), and the annotations are wiring instructions. Once DI
   clicks, 80% of Spring code reads naturally.
3. **On a legacy-modernization programme, the PL/SQL question is the architect
   question.** Migrating Oracle Forms or APEX applications whose business logic
   lives in PL/SQL packages raises a decision Spring developers are usually
   *worse* placed to make than architects: where that logic lands in the target —
   JPA entities plus services, plain SQL via `JdbcTemplate`/jOOQ, or temporarily
   retained stored procedures. That is a migration-strategy call, and Section 4
   is the highest-leverage section in this guide because of it.

Time-box: **3–5 evenings** (Sections 1–7 reading + Section 8 build). Don't drift
into Java-language depth — you are learning the framework's shape, not the
language's corners.

---

# Section 1 — JVM ecosystem orientation (30 minutes, don't over-invest)

The minimum vocabulary so version/tooling talk doesn't wrong-foot you:

- **Java LTS versions**: 17 and 21 are the LTS releases in production use;
  Spring Boot 3.x **requires Java 17+**. A client "on Java 8/11" has a JVM
  upgrade embedded in their migration — flag it in wave planning.
- **Spring Framework vs Spring Boot vs Spring Cloud**: Framework is the DI
  container + core libraries; **Boot** is the opinionated packaging
  (auto-configuration, embedded server, starters) — what everyone means today;
  **Spring Cloud** is the distributed-systems add-on layer (config server,
  gateway, circuit breakers). Target architectures on EKS often need *less*
  Spring Cloud than teams assume — K8s + your platform already provide config,
  discovery, and gateway. That's an architect's simplification call you can
  own.
- **Build tools**: **Maven** (`pom.xml`, XML, most common in enterprises) and
  **Gradle** (`build.gradle`, Groovy/Kotlin DSL). Read-level on both; the
  `mvnw`/`gradlew` wrapper scripts in a repo mean no local install needed.
- **Spring Boot 2 → 3 break**: Boot 3 (2022) moved `javax.*` → `jakarta.*`
  namespaces and requires Java 17. A client estate on Boot 2 is on a dead line
  — another modernization line-item to spot in assessment.
- **Jakarta EE / "J2EE"**: the legacy enterprise-Java standard. Older estates
  (WebLogic, WebSphere, JBoss app servers) run EAR/WAR deployments; Spring Boot
  collapses that into a self-contained JAR with an embedded server (Tomcat by
  default) — the same shift you know from app-server-era to
  container-era deployment.

Your equivalent map: JDK ≈ Node runtime version; Maven/Gradle ≈ npm + scripts;
Spring Boot starter ≈ an opinionated Express boilerplate + middleware stack;
embedded Tomcat ≈ Node's built-in HTTP server.

---

# Section 2 — Spring Boot anatomy: starters, auto-configuration, DI

## 2a. Project shape

A Spring Boot service is recognizable in seconds:

```
src/main/java/com/acme/orders/
  OrdersApplication.java        ← @SpringBootApplication, main() entrypoint
  api/OrderController.java      ← REST layer
  service/OrderService.java     ← business logic
  repository/OrderRepository.java ← data access
  domain/Order.java             ← entity/domain model
src/main/resources/
  application.yml               ← configuration (profiles, DB, ports)
  db/migration/V1__init.sql     ← Flyway migrations (if used)
pom.xml / build.gradle          ← dependencies ("starters")
```

- **Starters** — `spring-boot-starter-web`, `-data-jpa`, `-security`,
  `-actuator`... Each pulls a curated dependency set *and* triggers
  auto-configuration. Review tip: the starter list in `pom.xml` tells you the
  service's architecture faster than the code does.
- **Auto-configuration** — Boot configures beans based on what's on the
  classpath (add the JPA starter + a Postgres driver → a connection pool and
  transaction manager appear, configured from `application.yml`). Magic until
  you know the rule: *classpath + properties → beans, overridable by defining
  your own.*
- **`application.yml` + profiles** — externalized config with per-environment
  profiles (`application-prod.yml`, activated via
  `SPRING_PROFILES_ACTIVE=prod`). On EKS this is env vars / ConfigMaps /
  secrets — exactly your 12-factor expectations. Standard to set: **no
  environment logic in code, profiles + env overrides only.**

## 2b. Dependency injection (the thing to actually internalize)

- The container scans for **`@Component`** classes (and the role-flavored
  aliases **`@Service`**, **`@Repository`**, **`@RestController`**) and
  instantiates them as singletons ("beans").
- Wiring: declare a constructor parameter of the needed type and the container
  supplies it. **Constructor injection is the reviewable standard**; field
  injection (`@Autowired` on a field) hides dependencies and hurts testability
  — a legitimate review flag.
- **`@Configuration` + `@Bean`** methods define beans manually — the escape
  hatch where auto-configuration isn't enough (e.g., building a custom
  `WebClient` or Kafka producer).

```java
@Service
public class OrderService {
  private final OrderRepository repository;   // final + constructor = good
  public OrderService(OrderRepository repository) {
    this.repository = repository;
  }
}
```

Your equivalent: hand-wired module imports in Node, or an IoC container like
NestJS's — Spring's is the original. NestJS is, in fact, a direct Spring clone;
if you've read any NestJS, Spring's shape is already familiar.

---

# Section 3 — The REST layer (your home turf, new annotations)

This is where your standards authorship lands one-to-one:

| Concern | Spring mechanism | Your standard it implements |
|---|---|---|
| Routing | `@RestController`, `@GetMapping("/orders/{id}")`, `@PostMapping` | Resource/verb design from your API standards |
| Request binding | `@PathVariable`, `@RequestParam`, `@RequestBody` on a DTO | Contract-first request shapes |
| Validation | Jakarta Bean Validation — `@Valid` on the DTO, `@NotNull`/`@Size`/`@Pattern` on fields | Schema validation you did with JSON Schema/JSONata |
| Error handling | `@RestControllerAdvice` + `@ExceptionHandler` → RFC 7807 problem responses | Uniform error contract across the estate |
| API docs | **springdoc-openapi** — generates OpenAPI 3 + Swagger UI from the annotations | Your OpenAPI-contract governance |
| Versioning | Path/header versioning — framework-agnostic, your rules apply | Your versioning & lifecycle standards |

Review flags worth naming in a design review:

- **Fat controllers** — business logic in the controller instead of services.
- **Entities leaking into API responses** — JPA entities serialized directly
  instead of DTOs: couples the wire contract to the DB schema, breaks the
  anti-corruption layer you'd want against a legacy migration. For a strangler
  migration this is a *standard*, not a preference.
- **Blocking calls on hot paths** — Spring MVC is thread-per-request (fine,
  predictable); WebFlux is the reactive alternative (rarely justified —
  recommend MVC + virtual threads on Java 21 as the default, complexity
  only where measured need exists). Knowing to *say* "MVC by default, WebFlux
  only with a demonstrated concurrency need" is architect-grade Spring
  fluency.

---

# Section 4 — Data access & transactions (the PL/SQL migration section)

**The highest-leverage section in this guide.** The classic legacy shape is
business logic living in PL/SQL packages behind Oracle Forms or APEX pages, with
Spring on a PostgreSQL-family target. Where that logic lands is a per-workload
architecture decision:

| Option | What it is | When it's right in the migration |
|---|---|---|
| **Spring Data JPA** (Hibernate) | Entities mapped to tables, repositories generate SQL, logic in Java services | Default for *refactored* domains — logic extracted from PL/SQL into services; best long-term testability |
| **`JdbcTemplate` / jOOQ / MyBatis** | Hand-written SQL with light mapping | Set-based, SQL-heavy logic that translates naturally from PL/SQL — often *truer* to the original behavior than forcing ORM entities |
| **Retained stored procedures** (PL/pgSQL after conversion) | Keep converted procedures, call via `@Procedure`/`SimpleJdbcCall` | Transitional waves: AWS SCT converts PL/SQL → PL/pgSQL; parity-test the procedure, wrap it, extract later. A legitimate strangler step, not a failure |

Say it as a strategy: *"Per workload I'd classify PL/SQL logic three ways —
extract to Java services where the domain is being redesigned, translate to
plain SQL where the logic is set-based, and temporarily retain converted
PL/pgSQL where parity risk is highest — then burn down the retained tier in
later waves."* That classification is worth more than a week of Hibernate study,
because it is the decision that determines how much Hibernate you need at all.

The mechanics to know at review level:

- **Entities**: `@Entity`, `@Id`, `@OneToMany` etc. Lazy vs eager fetching —
  the **N+1 query problem** is the classic JPA performance failure (list of N
  entities → N extra queries for a lazy association). Review flag: look for
  `join fetch`/`@EntityGraph` on hot read paths.
- **`@Transactional`**: declarative transactions via proxies. The two
  review-relevant gotchas: it only works on *external* bean method calls
  (self-invocation bypasses the proxy — a real bug class), and default
  rollback is on unchecked exceptions only. Transaction boundaries belong at
  the **service layer**, never the controller — that's a standard to set.
- **Connection pooling**: HikariCP is the Boot default; pool sizing vs Aurora
  connection limits is a real EKS-scale concern (many pods × pool size —
  consider RDS Proxy). This is your infrastructure instinct applied to a
  Spring default.
- **Schema migrations**: **Flyway** (versioned SQL files, `V1__init.sql`) or
  Liquibase, run on startup or in CI. For Oracle→PostgreSQL this is where the
  converted schema lives under version control — insist on it as a standard;
  it is also your parity-testing anchor (same migrations applied to every
  environment).

---

# Section 5 — Spring Security (your identity work, one new filter chain)

Gateway-level OAuth2/OIDC — an IdP issuing tokens, JWT validation at the edge —
is the same model most estates already run. Spring Security is its in-service
enforcement:

- **Resource server in one dependency + one property**:
  `spring-boot-starter-oauth2-resource-server` +
  `spring.security.oauth2.resourceserver.jwt.issuer-uri: https://<tenant>` —
  Boot fetches the JWKS and validates tokens exactly as your gateway policies
  did. You can review this configuration *today*.
- **`SecurityFilterChain`** bean: the request-authorization rules
  (`.requestMatchers("/admin/**").hasRole("ADMIN")`...). It's a servlet filter
  pipeline — the same middleware-chain mental model as Express.
- **Method security**: `@PreAuthorize("hasAuthority('orders:write')")` on
  service methods — scope/claim enforcement in depth behind the gateway.
- Architecture stance you already hold: **authN and coarse authZ at the
  gateway, fine-grained authZ in the service, JWT claims as the contract** —
  defense in depth, and the token doesn't stop at the edge. Spring Security is
  just where the inner check lives.

---

# Section 6 — Production readiness on EKS (your platform depth, their runtime)

This is where you outrank most Spring developers — the containers/observability
side is yours; only the Spring-specific surface is new:

- **Actuator** (`spring-boot-starter-actuator`): ops endpoints —
  `/actuator/health` (with **liveness/readiness groups** that map directly to
  K8s probes), `/actuator/metrics`, `/actuator/info`. Standard to set: Actuator
  on an internal port, liveness/readiness wired to the EKS probes, no public
  exposure.
- **Micrometer**: the metrics facade (Spring's SLF4J-for-metrics) — exporters
  for Prometheus/Datadog; Micrometer Tracing for distributed tracing (or
  OTel-java agent auto-instrumentation, which needs no code changes — often the
  better platform-level standard, your call to make).
- **Containerization**: three routes — hand-written multi-stage Dockerfile,
  **Cloud Native Buildpacks** (`mvn spring-boot:build-image`), or **Jib**
  (daemonless, layers dependencies vs classes for cache efficiency). Any is
  fine; pick one as the estate standard.
- **JVM-in-container gotchas** (review gold): respect container memory —
  `-XX:MaxRAMPercentage=75` rather than fixed `-Xmx`; JVM cold start is
  seconds, so readiness probes must gate traffic; **CDS/AOT** in Boot 3.x or
  **GraalVM native-image** cut startup dramatically (native-image = fast/small
  but build complexity — a per-workload tradeoff, not a default).
- **Graceful shutdown**: `server.shutdown: graceful` + K8s `preStop` — in-flight
  requests drain on pod rotation. Same pattern you know; different flag names.

---

# Section 7 — Testing (feeds the behavioral-parity conversation)

The Spring testing pyramid, review-level:

- **Unit**: JUnit 5 + **Mockito** — plain tests on services with mocked
  dependencies (constructor injection pays off here). Fast, no container.
- **Slice tests**: `@WebMvcTest` (controllers with mocked services, via
  `MockMvc`), `@DataJpaTest` (repositories against an embedded/containerized
  DB). Narrow Spring context = fast feedback.
- **`@SpringBootTest`**: full application context — integration tests. Slow;
  standard to set: few of these, many slice/unit tests.
- **Testcontainers**: real PostgreSQL (or Kafka, LocalStack) in Docker per test
  run — *the* modern standard for DB-touching tests, and non-negotiable for a
  migration estate: H2-in-memory "compatibility mode" is **not** PostgreSQL and
  will lie to you about the converted schema.
- **The parity link**: characterization/golden-master tests — capture legacy
  outputs for a recorded input set, assert the Spring service reproduces them;
  run legacy and target side-by-side (dual-run/shadow traffic) with automated
  comparison as the **wave exit criterion**. This is the same discipline as
  cutover parity or reconciliation on a data migration; Testcontainers plus
  golden-master is the Spring-flavored expression of it.

---

# Section 8 — The build (2–3 evenings; makes "I've built with it" true)

One small service, end to end, on your machine. Suggested: `orders-service` —
deliberately boring domain, so the framework is the learning surface.

| Evening | Build | What it teaches |
|---|---|---|
| 1 | [start.spring.io](https://start.spring.io) → Maven, Java 21, Boot 3.x; starters: web, data-jpa, validation, actuator, postgresql, flyway. Run local Postgres via Docker. Write `V1__init.sql` Flyway migration, one `@Entity` + repository, REST CRUD with `@Valid` DTOs + `@RestControllerAdvice` errors | Project anatomy, auto-config, DI, REST layer, Flyway |
| 2 | Add a service-layer method spanning two tables under `@Transactional`; trigger and observe a rollback. Add springdoc-openapi and inspect the generated spec against your own API standards. Write: 2 unit tests (Mockito), 1 `@WebMvcTest`, 1 Testcontainers repository test | Transactions, the testing pyramid, contract generation |
| 3 | Add `oauth2-resource-server` validating JWTs against any dev tenant (Auth0 free tier — your own stack); expose Actuator health groups; containerize (buildpacks or Dockerfile with `MaxRAMPercentage`); run it, hit it, kill it gracefully | Security, Actuator, JVM-in-container |
| Optional 4 | Deploy to a local kind/minikube with liveness/readiness wired to Actuator; or port one small PL/SQL-style procedure into a `JdbcTemplate` method with a golden-master test against fixed inputs | The EKS story end-to-end; the migration story in miniature |

Keep the repo. It is not a portfolio headline (maestro and sovereign-copilot
are); it is the honest backing for "I've built a Spring Boot service against
PostgreSQL with Flyway, Testcontainers, and OAuth2 — at learning depth, and I
govern teams who do it at production depth."

---

# Section 9 — What to say, and what not to claim

**Where this guide plus the build actually gets you:**

- Governing Spring Boot delivery — standards and architecture reviews — backed
  by having built a service by hand against PostgreSQL with Flyway,
  Testcontainers, and OAuth2 resource-server validation. That is reviewing from
  knowledge rather than from a checklist, and the difference is visible.
- "My hands-on production languages are Node.js and Python; on the JVM I work
  at the architecture and review level, and the standards I'd set — DTOs at
  the boundary, transactions at the service layer, Testcontainers over H2,
  MVC-by-default, Actuator-wired probes — don't depend on me being the fastest
  Java typist in the room."
- The PL/SQL three-way classification from Section 4 — deliver it unprompted
  when logic migration comes up.
- "NestJS in the Node world is a direct Spring clone, so the DI/decorator
  model was already familiar."

**Don't claim:**

- Years of production Spring Boot delivery, or fluent Java at depth
  (generics arcana, concurrency internals, JVM tuning war stories).
- WebFlux/reactive production experience.
- Spring Cloud operational experience — say "on EKS I'd deliberately minimize
  Spring Cloud in favor of platform primitives" instead, which is both true
  and a stronger position.

The honest position: **a polyglot modernization architect who governs Spring
Boot teams, has built with the framework at learning depth, and makes the
migration-strategy calls — where PL/SQL logic lands, what parity gates a wave —
that pure Spring developers are not positioned to make.**

---

## Related guides

- `cloud-db-migration-to-aws-refresher.md` — SCT/DMS Oracle→PostgreSQL; pairs
  with Section 4 (the converted PL/pgSQL is what the retained-procedure tier
  calls).
- `upskilling.md §11` (JVM/Kotlin track) — the sibling *demo-repo* track:
  Kotlin Spring Boot for the ATS filter at JVM-heavy employers. This guide is
  the *review-credibility* track; do §11 only if a JVM-first employer
  surfaces. Kotlin-vs-Java is syntax, the Spring surface here transfers 1:1.
- `togaf-refresher.md`, `c4-modeling-refresher.md` — the governance framing the
  review standards in Sections 3–6 plug into.
