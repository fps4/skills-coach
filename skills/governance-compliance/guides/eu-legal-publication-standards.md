---
title: EU legal and publication standards
summary: The XML formats, identifiers and vocabularies that carry EU legislation from drafting to publication — Akoma Ntoso and AKN4EU, FORMEX, ELI, IMMC, EU Vocabularies and CELLAR.
---

> Version numbers change; verify them on op.europa.eu before quoting them.

## 1. The landscape in one picture

```
Drafting (Commission DGs, Council, Parliament)        Publication (Publications Office, Luxembourg)
  LEOS editor ──► AKN4EU (XML) ──► interinstitutional ──► FORMEX (XML) ──► Official Journal (PDF/HTML)
                        │            exchange: IMMC                  │
                        └──────────────────────────────────────────► CELLAR repository
                                                                     (RDF metadata, CDM ontology,
                                                                      ELI identifiers, EuroVoc)
                                                                     └► EUR-Lex (public portal)
```

The architect's work sits on the arrows: schemas, mappings between formats, validation at each
hand-over, metadata models, and the pipelines that carry documents across institutions.

## 2. Akoma Ntoso and AKN4EU

- **Akoma Ntoso (LegalDocML)** — OASIS standard (v1.0, 2018) XML vocabulary for parliamentary,
  legislative and judicial documents. Namespace
  `http://docs.oasis-open.org/legaldocml/ns/akn/3.0`.
- **Key ideas:**
  - **Document types:** `act`, `bill`, `amendment`, `judgment`, `debate`, `documentCollection`…
  - **Hierarchy:** `book/part/title/chapter/section/article/paragraph/point`, each with `num`,
    `heading`, `content`.
  - **FRBR metadata** in `meta/identification`: **Work** (the abstract act) → **Expression** (a
    language version at a date) → **Manifestation** (a format, e.g. XML) → Item. Each level has an
    IRI. This is the conceptual centre.
  - **`eId` / `wId`** attributes — stable identifiers for every structural element; amendments and
    cross-references point to them.
  - **Lifecycle and modifications:** `lifecycle/eventRef`, `analysis/activeModifications` /
    `passiveModifications` describe what amends what — the basis of consolidation.
- **AKN4EU** — the EU institutions' profile of Akoma Ntoso (v3.0 published 2020, later versions
  since); restricts and extends AKN for EU acts. Used by **LEOS** (the Commission's open-source
  legislation editor) and in the interinstitutional drafting chain.

```xml
<akomaNtoso xmlns="http://docs.oasis-open.org/legaldocml/ns/akn/3.0">
  <act>
    <body>
      <article eId="art_1">
        <num>Article 1</num>
        <heading>Subject matter</heading>
        <paragraph eId="art_1__para_1">…</paragraph>
      </article>
    </body>
  </act>
</akomaNtoso>
```

## 3. FORMEX

- The Publications Office's **XML format for exchange with its contractors** and for the **Official
  Journal** (current major version: Formex v6, schema-based; earlier versions DTD).
- Document-centric, optimised for **publishing** (layout-relevant structure, OJ series and
  numbering), not for drafting semantics.
- Converting AKN4EU (drafting semantics) ↔ FORMEX (publication structure) is a classic XSLT up/down
  conversion problem: different granularity, mixed content, IDs that must survive, and validation on
  both sides — a mapping between two models designed for different purposes.

## 4. ELI — European Legislation Identifier

- Council conclusions 2012 (revised 2019). Three pillars:
  1. **HTTP URI templates** for legislation, e.g. `http://data.europa.eu/eli/reg/2016/679/oj` (GDPR)
     — type / year / number / version.
  2. **Metadata ontology** (ELI ontology, RDF/OWL, FRBR-based: `LegalResource`, `LegalExpression`,
     `Format`).
  3. **Serialisation** — RDFa embedded in HTML pages, or JSON-LD.
- Member States implement it too, so ELI is the interoperability layer across national gazettes.
- An ELI URI is to a legal act what an event type + version is to a contract in an event platform: a
  stable identifier everyone agrees on before exchange.

## 5. IMMC — Interinstitutional Metadata and Formats Committee

- The committee (and the name of its specifications) that defines **metadata and formats exchanged
  between EU institutions** during the legislative procedure — e.g. the metadata package sent with a
  document from the Commission to the Publications Office.
- In practice: an XML metadata envelope with controlled values (document type, procedure, author
  institution, languages) validated against schemas and authority tables.
- Analogy: an event envelope — metadata separated from payload, controlled vocabulary for types,
  versioned schema.

## 6. EU Vocabularies, CELLAR and CDM

- **EU Vocabularies** (op.europa.eu/web/eu-vocabularies): **authority tables** (languages, countries,
  corporate bodies, resource types…), **EuroVoc** (multilingual thesaurus, SKOS), schemas (FORMEX,
  AKN4EU, TED eForms).
- **Controlled vocabularies in SKOS:** `skos:Concept`, `prefLabel`/`altLabel` per language,
  `broader`/`narrower`.
- **CELLAR** — the Publications Office's semantic repository behind EUR-Lex; metadata in RDF following
  the **CDM (Common Data Model)** ontology, queryable through a public **SPARQL endpoint**.

## 7. HTML5 / RDFa / JSON-LD

- Official texts are also published as HTML; ELI metadata can be embedded as **RDFa** attributes
  (`property="eli:date_document"`) or as a **JSON-LD** script block.
- Research such as *LegalHTML* (ESWC 2023) proposes HTML-based representation of legal acts.

## 8. Hands-on (2–3 hours)

1. Download one regulation from EUR-Lex in FORMEX and its HTML.
2. Open an AKN4EU sample from op.europa.eu; map 10 elements FORMEX ↔ AKN4EU in a table.
3. Query the CELLAR SPARQL endpoint for the work, its expressions and its ELI.

## Sources

- OP — AKN4EU: https://op.europa.eu/en/web/eu-vocabularies/akn4eu
- OP — Formex: https://op.europa.eu/en/web/eu-vocabularies/formex
- OP — Schemas: https://op.europa.eu/en/web/eu-vocabularies/schemas
- AKN4EU documentation v3.0 (2020): http://publications.europa.eu/resource/cellar/7675b2e4-5fbb-11eb-8146-01aa75ed71a1.0001.01/DOC_1
- ISA² — Digitising EU law production: https://ec.europa.eu/isa2/actions/digitising-eu-law-production_en/
- LegalHTML paper (ESWC 2023): https://2023.eswc-conferences.org/wp-content/uploads/2023/05/paper_Stellato_2023_LegalHTML.pdf
