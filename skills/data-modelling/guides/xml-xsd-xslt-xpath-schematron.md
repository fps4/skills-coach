---
title: XML, XSD, XPath, XSLT and Schematron
summary: The structured-document toolchain — schema design, path expressions, transforms, rule-based validation and testing — for integration and publishing architects.
---

> Goal: explain XML tooling two follow-up questions deep, and write a working transform, schema
> and rule set from memory. Hands-on with **Saxon-HE** (free, Java):
> `brew install saxon` → `saxon -s:in.xml -xsl:t.xsl -o:out.xml`.

## 1. XML fundamentals

- **Well-formed vs valid.** Well-formed = parses. Valid = also conforms to a schema (DTD, XSD,
  RELAX NG).
- **Namespaces.** A namespace is a URI; the prefix is only a local alias. `xmlns="…"` sets the
  default namespace for elements, **not** for attributes. A frequent bug: XPath `//article` finds
  nothing because the document has a default namespace — you must bind a prefix
  (`xpath-default-namespace` in XSLT 2.0+).
- **Mixed content.** Text interleaved with elements (`<p>See <ref>Art. 3</ref> above.</p>`). Normal
  in legal and publishing XML, rare in data/integration XML. Legal documents are *document-centric*;
  integration messages are *data-centric* — the distinction drives most tooling choices below.
- **Entities, CDATA, encoding.** Character references (`&#x2014;`), CDATA for unescaped blocks,
  UTF-8 by default. Older formats such as FORMEX use a DTD plus entities.
- **Identity and IDs.** `xml:id`, `ID`/`IDREF` types; cross-references between parts of a legal act
  depend on them.

## 2. XSD — schema design

| Topic | What to know |
|---|---|
| **Design patterns** | *Russian doll* (all anonymous nested types — tight, not reusable), *Salami slice* (all global elements — reusable elements, many roots), *Venetian blind* (global named types, one global root — the usual choice for large schemas) |
| **Types** | simple (restrictions with `pattern`, `enumeration`, `minInclusive`…) vs complex; `xs:extension` (add content) vs `xs:restriction` (narrow it); abstract types and substitution groups for extensibility |
| **Content models** | `sequence`, `choice`, `all`; `minOccurs`/`maxOccurs`; `mixed="true"` for document text |
| **Namespaces** | `targetNamespace`, `elementFormDefault="qualified"` (almost always), `import` (other namespace) vs `include` (same namespace) vs `redefine`/`override` |
| **Identity constraints** | `xs:key`, `xs:keyref`, `xs:unique` with XPath selectors — XSD's own referential integrity |
| **XSD 1.1** | `xs:assert` (XPath assertions on a type), conditional type assignment. Supported by Saxon-EE and Xerces, **not** by many tools — one reason Schematron is still used |
| **Versioning** | Add optional elements only; never make an optional element required in a minor version; version in the namespace URI for breaking changes, or a `version` attribute for compatible ones; extension points with `xs:any namespace="##other" processContents="lax"` |

**Why is XSD alone not enough?** It cannot express co-occurrence constraints well ("if
`type=amendment` then `<affects>` is required", "end date after start date", "article numbers are
continuous"). XSD 1.1 asserts help but are poorly supported. That is the Schematron layer.

## 3. XPath 3.1

- **Axes:** `child::`, `descendant::`, `parent::`, `ancestor::`, `following-sibling::`,
  `preceding-sibling::`, `attribute::` (`@`), `self::`. `//x` = descendant-or-self from the root;
  `.//x` = from the context node — a classic trick question.
- **Predicates:** `article[@eId='art_3']`; `//article[1]` (first in each parent) vs `(//article)[1]`
  (first in the document).
- **2.0+:** everything is a **sequence**; typed values; `for`, `if`, `some`/`every`; regex
  (`matches`, `replace`, `tokenize`); dates (`xs:date('2026-10-10') gt …`).
- **3.0/3.1:** maps and arrays (`map{ 'a': 1 }`), arrow operator (`$s => upper-case()`),
  higher-order functions, `parse-json`/`json-to-xml` — the bridge to JSON payloads.

## 4. XSLT (1.0 → 3.0)

- **Push vs pull.** Push = `xsl:apply-templates` + template matching (suits document XML and mixed
  content). Pull = `xsl:for-each` + `xsl:value-of` (fine for flat data XML). Legal documents need push.
- **Identity transform** — copy everything, override what changes. In 3.0:
  `<xsl:mode on-no-match="shallow-copy"/>`. The base pattern of most format conversions (e.g.
  FORMEX → Akoma Ntoso).
- **Template priority and conflict resolution**, **modes** (process the same nodes differently, e.g.
  a TOC pass and a body pass), **named templates** and `xsl:function`.
- **Grouping (2.0):** `xsl:for-each-group` with `group-by`, `group-adjacent`, `group-starting-with`
  — for turning flat paragraphs into nested structure (up-conversion).
- **Multiple outputs:** `xsl:result-document` (one act → many files).
- **3.0:** `xsl:iterate` (loop with state), **streaming** (`xsl:mode streamable="yes"` — large
  documents in constant memory, restricted XPath, Saxon-EE), **packages** (`xsl:package`, reusable
  compiled modules), `xsl:try/catch`, JSON in and out.
- **Saxon editions:** HE (free, no schema awareness, no streaming), PE, EE (schema-aware, streaming,
  XSD 1.1). Saxon and Oxygen are common in EU publishing.

**Data-centric mappings.** Integration-middleware mappings are usually pull-style XSLT over
data-centric XML: field-to-field, lookups, code-list translation. Migrating one to a cloud
integration platform typically means recovering the source-to-target spec from the XSLT,
re-implementing it (e.g. in JSONata), and keeping an XML serialisation where a consumer still needs it.

## 5. Schematron (ISO/IEC 19757-3)

```xml
<sch:schema xmlns:sch="http://purl.oclc.org/dsdl/schematron" queryBinding="xslt2">
  <sch:ns prefix="akn" uri="http://docs.oasis-open.org/legaldocml/ns/akn/3.0"/>
  <sch:pattern id="dates">
    <sch:rule context="akn:FRBRWork">
      <sch:assert test="akn:FRBRdate/@date castable as xs:date"
                  role="error">Work date must be a valid xs:date.</sch:assert>
    </sch:rule>
  </sch:pattern>
  <sch:pattern id="numbering">
    <sch:rule context="akn:article[preceding-sibling::akn:article]">
      <sch:assert test="xs:integer(akn:num/replace(., '\D', ''))
                        = xs:integer(preceding-sibling::akn:article[1]/akn:num/replace(., '\D', '')) + 1">
        Article numbering is not continuous.</sch:assert>
    </sch:rule>
  </sch:pattern>
</sch:schema>
```

- **Model:** `pattern` → `rule` (with an XPath `context`) → `assert` (fires when false) / `report`
  (fires when true). `role`/`flag` for severity. `let` variables, abstract rules and patterns,
  `phase` to run subsets.
- **How it runs:** compiled to XSLT (the classic "skeleton", now **SchXslt** or Schematron Quick
  Fix); the output is **SVRL** (Schematron Validation Report Language) — an XML report you can
  render as HTML or fail a CI build on.
- **Where it sits:** XSD for structure and types; Schematron for business rules and co-occurrence.
  The same two-layer design as a table schema plus rule-based data-quality checks.

## 6. XSpec and pipelines

- **XSpec:** unit tests for XSLT, XQuery and Schematron. A scenario gives input (`x:context`) and
  expected output (`x:expect`), or expects a Schematron assert to fire. Runs in Oxygen, Ant, Maven or
  a CI job.
- **XProc 3.0:** XML pipeline language — chain `p:validate-with-xml-schema`,
  `p:validate-with-schematron`, `p:xslt`, `p:store`. Implementations: XML Calabash, MorganaXProc.
  Comparable to a step-function / pipeline definition, for XML.
- **Build:** Ant or Maven with Saxon; a CI job running Saxon + XSpec + SchXslt in a container.
- **Oxygen XML Editor:** the default IDE in this world (schema-aware editing, XSLT debugging,
  Schematron, XSpec).

## 7. Two-hour hands-on drill

1. Write an XSD (Venetian blind) for a mini "act" with `article/num/heading/paragraph`, mixed content
   in `paragraph`, and `xs:key` on article IDs.
2. Write an identity-transform XSLT 3.0 that renames `paragraph` → `p`, adds `eId` attributes, and
   produces a TOC with a second mode.
3. Write three Schematron rules (numbering, date, mandatory metadata) and run them with SchXslt.
4. Write two XSpec scenarios, one for the XSLT and one for the Schematron.
5. Run all of it in one CI job.
