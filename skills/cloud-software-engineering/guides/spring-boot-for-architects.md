---
title: Spring Boot for architects
summary: Enough Spring Boot to set standards and run architecture reviews — DI, the REST layer, data access and transactions, security, production readiness on Kubernetes, and testing.
---

# Spring Boot for architects

The goal is not to become a Java developer. It is to review a Spring Boot service the way you would
review any service: know where the layers are, where the bodies are buried (transactions, N+1
queries, blocking calls, fat controllers), what good looks like, and what standards to set.

Three mental models:

1. **Spring Boot is a web framework + infrastructure modules + platform conventions, collapsed into
   one.** Node/Express gives a minimal core you assemble; Spring Boot ships the assembled opinion
   ("auto-configuration") and you override where needed. Most of learning Spring Boot is learning
   which conventions it already decided for you.
2. **Dependency injection is the organizing principle.** The container constructs and wires
   everything (beans); the annotations are wiring instructions. Once DI clicks, most Spring code
   reads naturally.
3. **In a legacy migration, where database logic lands is the architect question.** When business
   logic lives in PL/SQL packages, whether it moves to JPA entities and services, to plain SQL, or
   stays temporarily as converted stored procedures is a migration-strategy decision (§4).

---

## 1. JVM ecosystem orientation

- **Java LTS versions**: 17 and 21 are the LTS releases in production use; Spring Boot 3.x
  **requires Java 17+**. An estate on Java 8/11 has a JVM upgrade embedded in its migration.
- **Spring Framework vs Spring Boot vs Spring Cloud**: Framework is the DI container + core
  libraries; **Boot** is the opinionated packaging (auto-configuration, embedded server, starters);
  **Spring Cloud** is the distributed-systems layer (config server, gateway, circuit breakers). On
  Kubernetes you often need *less* Spring Cloud than teams assume — the cluster and platform already
  provide config, discovery and gateway.
- **Build tools**: **Maven** (`pom.xml`, most common in enterprises) and **Gradle** (`build.gradle`,
  Groovy/Kotlin DSL). The `mvnw`/`gradlew` wrappers mean no local install.
- **Boot 2 → 3 break**: Boot 3 (2022) moved `javax.*` → `jakarta.*` and requires Java 17. An estate
  on Boot 2 is on a dead line.
- **Jakarta EE / "J2EE"**: older estates run EAR/WAR deployments on app servers (WebLogic,
  WebSphere, JBoss); Spring Boot collapses that into a self-contained JAR with an embedded server
  (Tomcat by default) — the shift from app-server era to container era.

Rough map: JDK ≈ Node runtime version; Maven/Gradle ≈ npm + scripts; a starter ≈ an opinionated
Express boilerplate + middleware stack; embedded Tomcat ≈ Node's built-in HTTP server.

## 2. Anatomy: starters, auto-configuration, DI

```
src/main/java/com/acme/orders/
  OrdersApplication.java          ← @SpringBootApplication, main() entrypoint
  api/OrderController.java        ← REST layer
  service/OrderService.java       ← business logic
  repository/OrderRepository.java ← data access
  domain/Order.java               ← entity/domain model
src/main/resources/
  application.yml                 ← configuration (profiles, DB, ports)
  db/migration/V1__init.sql       ← Flyway migrations (if used)
pom.xml / build.gradle            ← dependencies ("starters")
```

- **Starters** — `spring-boot-starter-web`, `-data-jpa`, `-security`, `-actuator`… Each pulls a
  curated dependency set *and* triggers auto-configuration. The starter list tells you a service's
  architecture faster than the code does.
- **Auto-configuration** — Boot configures beans based on the classpath (add the JPA starter + a
  Postgres driver → a connection pool and transaction manager appear, configured from
  `application.yml`). The rule: *classpath + properties → beans, overridable by defining your own.*
- **`application.yml` + profiles** — externalized config with per-environment profiles
  (`application-prod.yml`, `SPRING_PROFILES_ACTIVE=prod`). On Kubernetes this is env vars /
  ConfigMaps / secrets. Standard: **no environment logic in code, profiles + env overrides only.**

### Dependency injection

- The container scans for **`@Component`** classes (and the role aliases **`@Service`**,
  **`@Repository`**, **`@RestController`**) and instantiates them as singletons ("beans").
- **Constructor injection is the reviewable standard**; field injection (`@Autowired` on a field)
  hides dependencies and hurts testability — a legitimate review flag.
- **`@Configuration` + `@Bean`** methods define beans manually — the escape hatch where
  auto-configuration isn't enough (a custom `WebClient`, a Kafka producer).

```java
@Service
public class OrderService {
  private final OrderRepository repository;   // final + constructor = good
  public OrderService(OrderRepository repository) {
    this.repository = repository;
  }
}
```

NestJS is a direct Spring clone; anyone who has read NestJS already knows the shape.

## 3. The REST layer

| Concern | Spring mechanism |
|---|---|
| Routing | `@RestController`, `@GetMapping("/orders/{id}")`, `@PostMapping` |
| Request binding | `@PathVariable`, `@RequestParam`, `@RequestBody` on a DTO |
| Validation | Jakarta Bean Validation — `@Valid` on the DTO, `@NotNull`/`@Size`/`@Pattern` on fields |
| Error handling | `@RestControllerAdvice` + `@ExceptionHandler` → RFC 7807 problem responses |
| API docs | **springdoc-openapi** — OpenAPI 3 + Swagger UI generated from the annotations |
| Versioning | Path/header versioning — framework-agnostic |

Review flags:

- **Fat controllers** — business logic in the controller instead of services.
- **Entities leaking into API responses** — JPA entities serialized directly instead of DTOs couples
  the wire contract to the DB schema and breaks any anti-corruption layer against a legacy system.
  For a strangler migration, DTOs at the boundary are a standard, not a preference.
- **Blocking calls on hot paths** — Spring MVC is thread-per-request (predictable); WebFlux is the
  reactive alternative and rarely justified. Default to **MVC + virtual threads on Java 21**;
  WebFlux only with a demonstrated concurrency need.

## 4. Data access and transactions

When migrating logic out of stored procedures (e.g. Oracle PL/SQL to a PostgreSQL target), where it
lands is a per-workload decision:

| Option | What it is | When it's right |
|---|---|---|
| **Spring Data JPA** (Hibernate) | Entities mapped to tables, repositories generate SQL, logic in Java services | Default for *redesigned* domains; best long-term testability |
| **`JdbcTemplate` / jOOQ / MyBatis** | Hand-written SQL with light mapping | Set-based, SQL-heavy logic that translates naturally — often *truer* to the original than forced ORM entities |
| **Retained stored procedures** (PL/pgSQL after conversion) | Keep converted procedures, call via `@Procedure` / `SimpleJdbcCall` | Transitional waves: convert, parity-test, wrap, extract later. A legitimate strangler step |

As a strategy: classify logic three ways — extract to Java services where the domain is being
redesigned, translate to plain SQL where it is set-based, and temporarily retain converted
procedures where parity risk is highest — then burn down the retained tier in later waves.

Mechanics to know at review level:

- **Entities**: `@Entity`, `@Id`, `@OneToMany`. Lazy vs eager fetching — the **N+1 query problem**
  (a list of N entities → N extra queries for a lazy association) is the classic JPA performance
  failure. Look for `join fetch` / `@EntityGraph` on hot read paths.
- **`@Transactional`**: declarative transactions via proxies. Gotchas: it only applies to calls
  *through* the proxy (self-invocation bypasses it — a real bug class), and default rollback is on
  unchecked exceptions only. Transaction boundaries belong at the **service layer**, never the
  controller.
- **Connection pooling**: HikariCP is the default; pods × pool size vs the database's connection
  limit is a real concern at cluster scale (consider RDS Proxy or PgBouncer).
- **Schema migrations**: **Flyway** (versioned SQL files, `V1__init.sql`) or Liquibase, run on
  startup or in CI. The converted schema lives under version control and the same migrations run in
  every environment — the anchor for parity testing.

## 5. Spring Security

- **Resource server in one dependency + one property**: `spring-boot-starter-oauth2-resource-server`
  + `spring.security.oauth2.resourceserver.jwt.issuer-uri: https://<issuer>` — Boot fetches the JWKS
  and validates tokens.
- **`SecurityFilterChain`** bean: request-authorization rules
  (`.requestMatchers("/admin/**").hasRole("ADMIN")`). A servlet filter pipeline — the same
  middleware-chain model as Express.
- **Method security**: `@PreAuthorize("hasAuthority('orders:write')")` on service methods —
  scope/claim enforcement behind the gateway.
- The stance: **authN and coarse authZ at the gateway, fine-grained authZ in the service, JWT claims
  as the contract** — defence in depth; the token doesn't stop at the edge.

## 6. Production readiness on Kubernetes

- **Actuator** (`spring-boot-starter-actuator`): `/actuator/health` (with **liveness/readiness
  groups** mapping to Kubernetes probes), `/actuator/metrics`, `/actuator/info`. Standard: Actuator
  on an internal port, probes wired to the groups, no public exposure.
- **Micrometer**: the metrics facade (SLF4J for metrics) with exporters for Prometheus and others;
  Micrometer Tracing for traces — or the OpenTelemetry Java agent, which needs no code changes and is
  often the better platform-level standard.
- **Containerization**: hand-written multi-stage Dockerfile, **Cloud Native Buildpacks** (`mvn
  spring-boot:build-image`), or **Jib** (daemonless, layers dependencies apart from classes for cache
  efficiency). Pick one as the estate standard.
- **JVM in containers**: `-XX:MaxRAMPercentage=75` rather than a fixed `-Xmx`; JVM cold start is
  seconds, so readiness probes must gate traffic; **CDS/AOT** in Boot 3.x or **GraalVM native
  image** cut startup (native image = fast and small, but build complexity — a per-workload
  trade-off, not a default).
- **Graceful shutdown**: `server.shutdown: graceful` + a Kubernetes `preStop` hook drains in-flight
  requests on pod rotation.

## 7. Testing

- **Unit**: JUnit 5 + **Mockito** — services with mocked dependencies (constructor injection pays off
  here). Fast, no container.
- **Slice tests**: `@WebMvcTest` (controllers with mocked services, via `MockMvc`), `@DataJpaTest`
  (repositories against a database). Narrow Spring context = fast feedback.
- **`@SpringBootTest`**: full application context — slow. Standard: few of these, many slice and
  unit tests.
- **Testcontainers**: a real PostgreSQL (or Kafka, LocalStack) in Docker per test run — the modern
  standard for DB-touching tests, and non-negotiable for a migration: H2's "compatibility mode" is
  not PostgreSQL and will lie about the converted schema.
- **Parity in a migration**: characterization/golden-master tests capture legacy outputs for a
  recorded input set and assert the new service reproduces them; run legacy and target side by side
  (dual-run / shadow traffic) with automated comparison as the **wave exit criterion**.

## 8. Hands-on build

One small service end to end — `orders-service`, a deliberately boring domain so the framework is
the learning surface.

| Step | Build | What it teaches |
|---|---|---|
| 1 | [start.spring.io](https://start.spring.io) → Maven, Java 21, Boot 3.x; starters: web, data-jpa, validation, actuator, postgresql, flyway. Local Postgres via Docker. `V1__init.sql`, one `@Entity` + repository, REST CRUD with `@Valid` DTOs + `@RestControllerAdvice` errors | Anatomy, auto-config, DI, REST layer, Flyway |
| 2 | A service method spanning two tables under `@Transactional`; trigger a rollback. Add springdoc-openapi and inspect the spec. Two Mockito unit tests, one `@WebMvcTest`, one Testcontainers repository test | Transactions, the testing pyramid, contract generation |
| 3 | `oauth2-resource-server` validating JWTs against a dev identity provider; Actuator health groups; containerize (buildpacks or a Dockerfile with `MaxRAMPercentage`); run it, kill it gracefully | Security, Actuator, JVM in containers |
| 4 (optional) | Deploy to kind/minikube with probes wired to Actuator; or port a small stored-procedure-style routine into a `JdbcTemplate` method with a golden-master test | Kubernetes end to end; the migration story in miniature |
