---
title: Knowledge graphs for data architects
summary: RDF, OWL, SKOS, SHACL, SPARQL, property graphs and GraphRAG, mapped onto the relational and dimensional modelling and governance a data architect already does.
---

## Frame

A data architect already does the hard half of knowledge-graph work: settling contested definitions
with the people who own them, writing them down as data, propagating them along lineage. What this
guide adds is the vocabulary of the W3C semantic-web stack and the decisions of running it on a graph
store. It closes the *vocabulary and decision* gap; it does not make anyone a knowledge engineer.

Three mental models:

1. **A knowledge graph is a governed vocabulary plus the facts stated in it.** The vocabulary is the
   ontology (classes, properties, constraints); the facts are the instances. The value is in the
   vocabulary being *shared* — across teams, systems and documents — not in the graph shape. A
   governed semantic layer is vocabulary governance without the graph.
2. **The RDF stack separates meaning, validation and query into different specs.** RDF = the data
   model; RDFS/OWL = what the terms mean and what can be inferred; SKOS = controlled vocabularies;
   SHACL = what a valid graph looks like; SPARQL = how you ask. Knowing which spec does which job is
   most of the vocabulary.
3. **RDF vs property graph is the first real architecture decision.** A requirement that names RDF,
   OWL and SPARQL has already chosen a side.

Specs are stable (RDF 1.1 / SPARQL 1.1 / SHACL are 2014–2017 W3C Recommendations; RDF 1.2 and
SPARQL 1.2 are in progress). **Product capabilities change — verify before citing a vendor feature.**

---

## 1. RDF: the data model

**A triple is `subject predicate object`.** Subjects and predicates are IRIs; objects are IRIs or
literals (typed values: `"2026-03-31"^^xsd:date`). A set of triples is a graph. A **named graph** is
a graph with its own IRI — the unit for provenance ("these triples came from source X on date Y")
and for access control.

```turtle
@prefix ex:   <https://example.org/kg/> .
@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .

ex:matter-4711   a              ex:Matter ;
                 ex:client      ex:client-88 ;
                 ex:practiceArea ex:pa-corporate-ma ;
                 ex:openedOn    "2026-02-14"^^xsd:date .
```

**Serialisations:** Turtle (readable, above), N-Triples (one triple per line, for bulk loads),
JSON-LD (JSON with an `@context`; what APIs emit), RDF/XML (legacy, still seen in government data).

**Map onto what you know:** a triple is a row in a three-column table `(entity, attribute, value)`
where attributes are globally identified. An IRI is a primary key that is also a URL. A named graph
is a schema or partition with provenance attached. A conceptual model translates almost one-to-one:
entities → classes, relationships → object properties, attributes → datatype properties.

**Reification / RDF-star:** stating facts *about* a triple (confidence, source, valid time).
RDF-star (`<< s p o >> ex:confidence 0.8`) is the modern form — how LLM-extracted facts get their
confidence score attached.

## 2. RDFS, OWL and SKOS: what the terms mean

**RDFS** gives `rdfs:Class`, `rdfs:subClassOf`, `rdf:Property`, `rdfs:domain`, `rdfs:range`,
`rdfs:label` — enough for a class taxonomy and typed properties. Cheap inference: if `ex:Matter
rdfs:subClassOf ex:WorkItem` and `ex:m1 a ex:Matter`, then `ex:m1 a ex:WorkItem`. Note that domain
and range *infer* types; they never reject data.

**OWL** (2, DL profiles) adds the expressive machinery: `owl:equivalentClass`, `owl:sameAs` (entity
identity across sources — and a notorious footgun), `owl:inverseOf`, `owl:TransitiveProperty`,
cardinality restrictions, disjointness, property chains. OWL is what a *reasoner* consumes to infer
new triples. **The architecture point:** OWL reasoning is expensive, and most enterprise graphs use
a small profile (OWL 2 RL or RDFS+) or no reasoner at all, materialising inferences at load time.
"Which OWL profile, and where does inference run?" is the question to ask.

**SKOS** is the spec for *thesauri and taxonomies*: `skos:Concept`, `skos:broader` /
`skos:narrower`, `skos:prefLabel` / `skos:altLabel`, `skos:ConceptScheme`. "Taxonomy management"
means a SKOS concept scheme, and the tools (PoolParty, TopBraid EDG, Synaptica) edit SKOS.
`skos:broader` is navigation between concepts; unlike `rdfs:subClassOf` it implies nothing about
instances. **Map:** a business glossary is a SKOS scheme; the glossary → conceptual → logical
progression is SKOS → OWL → SHACL.

**Ontology design:** competency questions first ("what must the graph be able to answer?"), then
classes and properties, then reuse before invention — Schema.org, Dublin Core, FOAF, PROV-O
(provenance), the Organization ontology, sector ontologies (FIBO for finance, SALI LMSS for legal).
Versioning and change management of the ontology is the governance problem — the same problem as
schema evolution on a schema registry.

## 3. SHACL and SPARQL: validation and query

**SHACL** (Shapes Constraint Language) says what a *valid* graph looks like: node shapes, property
shapes, cardinality, datatype, value set, pattern. It is *closed-world* (checks the data you have)
where OWL is *open-world* (infers from the data you have) — a missing value fails a shape but is
merely unknown to OWL. **Map:** SHACL shapes are dbt tests / data-contract assertions expressed
against the graph; a SHACL validation report is a data-quality report.

```turtle
ex:MatterShape a sh:NodeShape ;
    sh:targetClass ex:Matter ;
    sh:property [ sh:path ex:client ; sh:minCount 1 ; sh:class ex:Client ] ;
    sh:property [ sh:path ex:openedOn ; sh:datatype xsd:date ; sh:maxCount 1 ] .
```

**SPARQL 1.1** — pattern matching over triples. `SELECT` / `CONSTRUCT` / `ASK` / `DESCRIBE`;
`OPTIONAL` (left join), `FILTER`, `UNION`, aggregation (`GROUP BY`, `COUNT`), **property paths**
(`ex:broader+` for transitive closure — the thing SQL is bad at), `SERVICE` for federation across
endpoints, and SPARQL Update for writes. **Map:** basic graph patterns are self-joins on the triple
table; property paths are recursive CTEs you no longer write.

```sparql
SELECT ?matter ?client WHERE {
  ?matter a ex:Matter ; ex:client ?client ; ex:practiceArea/skos:broader* ex:pa-corporate .
}
```

A public endpoint (Wikidata's) is the usual place to practise `OPTIONAL`, a property path and an
aggregate.

## 4. RDF triple store vs labelled property graph, and the platform landscape

| | RDF / triple store | Labelled property graph (LPG) |
|---|---|---|
| Model | Triples, global IRIs, named graphs | Nodes and edges with property maps, local IDs |
| Schema | Ontology (RDFS/OWL) + SHACL; standards-based | Optional / schema-light; vendor-specific |
| Query | SPARQL (W3C standard) | Cypher / openCypher, Gremlin; GQL (ISO standard, 2024) |
| Strength | Interoperability, shared vocabularies, reasoning, linked open data, provenance | Developer ergonomics, traversal performance, graph algorithms, analytics |
| Weakness | Ergonomics; reification for edge properties (RDF-star mitigates); fewer developers | Meaning lives in application code; harder to federate across organisations |
| Chosen when | Knowledge management, regulatory/reference data, cross-organisation vocabularies, legal/public sector | Fraud, recommendations, network analysis, identity graphs, ops dependency maps |

Choosing RDF buys a shared vocabulary that survives the platform, at the cost of fewer engineers and
heavier tooling. The two are not exclusive — many estates run an RDF knowledge layer and an LPG for
analytics.

**Platforms (verify current capabilities before citing):**
- **RDF:** Ontotext GraphDB, Stardog (virtual graphs over relational sources, reasoning), Apache
  Jena / Fuseki (open source), Oxigraph (Rust, embeddable), Amazon Neptune (RDF *and* LPG),
  Virtuoso, RDF4J.
- **LPG:** Neo4j (Cypher; graph data science algorithms), Neptune, TigerGraph, Memgraph, ArangoDB
  (multi-model).
- **Taxonomy / ontology management:** PoolParty, TopBraid EDG, Synaptica, Protégé (free ontology
  editor).
- **On the lakehouse:** Databricks and Snowflake have no native graph store; graph workloads run in
  GraphFrames/Spark or an external store, with the lakehouse as the source of truth. The architecture
  work is designing the *sync* between the two.

## 5. Enterprise KG architecture: the decisions that matter

1. **Scope by competency questions.** Which twenty questions must the graph answer that nothing else
   can? If a well-modelled warehouse can answer them, the graph is not the answer.
2. **Identity and entity resolution.** The same customer under three names in three systems — where
   the first quarter goes. `owl:sameAs` is a claim, not a solution; design a canonical-ID service and
   a match/merge process with human review — the graph form of conforming dimensions across sources.
3. **Ingestion layers.** Structured sources (relational → RDF via R2RML/RML mappings or ETL to
   triples), semi-structured (JSON-LD), and documents (NLP/LLM extraction of entities and relations,
   with confidence and provenance attached via RDF-star or named graphs). Extraction quality is
   measured, gated and reviewed — never a one-off.
4. **Provenance and versioning.** PROV-O for "where did this fact come from"; named graphs per source
   and load; ontology versions as first-class, with a change process — the same discipline as schema
   registry compatibility rules.
5. **Access control on a graph.** Row-level security has no direct analogue; policy is by named
   graph, by class, or by query rewriting. Confidentiality constraints are architecture, not an
   afterthought.
6. **Serving.** SPARQL endpoints are for engineers; the business consumes the graph through search
   (facets from the taxonomy), an API (GraphQL over the graph is common), dashboards and,
   increasingly, an LLM.
7. **Governance.** Who owns each concept; how a term is added, deprecated or split; how conflicts
   between owning groups are resolved.

## 6. Knowledge graphs and LLMs: GraphRAG and grounding

**Why a KG next to a vector index.** Vector retrieval finds *similar text*; a graph finds *related
facts* with explicit provenance. A KG gives an LLM disambiguated entities (which "Apollo" — the
customer, the project or the product), multi-hop context (contract → customer → parent company →
sanctions status), and a citation that is a node, not a paragraph.

**Patterns, in increasing ambition:**
- **KG-grounded answers:** the LLM writes a SPARQL/Cypher query (text-to-query); the graph computes
  the answer. Computed, not generated — every answer traces to a recorded query.
- **GraphRAG** (Microsoft's term, 2024): build a graph *from* the corpus by LLM extraction, cluster
  it into communities, summarise them, and retrieve community summaries plus local subgraphs at query
  time. Better at "global" questions over a corpus than vector RAG; expensive to build and refresh.
- **Hybrid retrieval:** vector search finds candidate nodes, graph expansion pulls structured
  context, a reranker orders the combined set. The practical default.
- **KG as evaluation oracle:** the graph is the ground truth an evaluation harness scores answers
  against.

The graph does not remove hallucination; it gives the model something to refuse against. "I don't
have that fact" is only possible when facts are enumerable.

## 7. Domain example: legal knowledge management

A law-firm knowledge-management function curates precedents and know-how, maintains practice-area
taxonomies, runs enterprise search over matters and documents, and supports conflict checks and
client intake. Core entities: **client, matter, practice area, jurisdiction, lawyer, document,
precedent/clause, court, legislation**. Core constraints: matter-level confidentiality,
**information barriers** (ethical walls between teams inside one firm), client-imposed handling
terms, retention. In a graph, an information barrier is an access-control constraint the design must
never leak through.

**Standards to know by name:**
- **SALI LMSS** (Legal Matter Standard Specification) — the legal industry's ontology/taxonomy for
  matters, areas of law and services, published as OWL/SKOS.
- **ELI** (European Legislation Identifier) and **ECLI** (European Case Law Identifier) — IRIs for
  legislation and case law, published as linked data.
- **Akoma Ntoso** (LegalDocML) — XML schema for legal documents; **LegalRuleML** for rules. See
  [XML, XSD, XPath, XSLT and Schematron](./xml-xsd-xslt-xpath-schematron.md).
- **LKIF** — an older legal core ontology; history only.

---

## Summary lines

- RDF is the model, OWL says what the terms mean, SHACL says what valid data looks like, SPARQL asks
  the question, SKOS is the taxonomy. Most enterprise value is in SKOS and SHACL, not in OWL
  reasoning.
- Entity resolution is where the first quarter goes. `owl:sameAs` is a claim; a canonical ID with a
  reviewed merge process is a solution.
- A knowledge graph next to an LLM does not stop hallucination; it makes refusal possible.
- Ontology versioning is schema-registry compatibility rules with a different serialisation.
