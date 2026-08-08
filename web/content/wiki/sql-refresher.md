---
title: SQL Refresher — Architect-Level Patterns
summary: Window functions, gap-and-island, dedupe, SCD2 and MERGE — the patterns that matter for reconciliation and period-end work, written for speed under pressure.
topic: data-engineering
format: refresher
tags: [sql, window-functions, cte, merge, scd2, reconciliation, finance]
updated: 2026-08-07
---

## Frame

This is a refresher, not a tutorial. It skips SELECT/JOIN basics and goes straight to the patterns that come up when writing SQL under time pressure on a shared screen, and in finance/ERP data work — reconciliation, period-end aggregation, slowly-changing master data.

Hold three things in your head while writing under pressure:

1. **State the grain first.** Always. "One row per posting line per company code per fiscal period." If you can't state the grain in one sentence, your query will be wrong.
2. **CTE-first composition.** Even if a query *could* be a one-liner, chain CTEs. They're free, they're readable, and the optimizer collapses them. Learn more at: https://www.tigerdata.com/learn/how-to-use-common-table-expression-sql
3. **Talk while you type.** Narrate intent ("I'll dedupe first, then aggregate, then join the dim"), not syntax. Interviewers grade *how* you reason, not how fast your fingers move.

---

## 1. Window functions — the most-tested thing

Window functions split into three families. Know which one you reach for and why.

### Ranking / numbering
```sql
ROW_NUMBER()    -- always unique, no ties
RANK()          -- ties share rank, leaves gaps (1,1,3)
DENSE_RANK()    -- ties share rank, no gaps (1,1,2)
NTILE(n)        -- bucket rows into n groups
```

**Canonical use — dedupe-keep-latest** (one row per posting key, latest version wins):
```sql
SELECT *
FROM gl_postings_raw
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY posting_id
  ORDER BY ingestion_ts DESC
) = 1;
```
`QUALIFY` is **Snowflake / BigQuery / Databricks SQL**. In PostgreSQL / HANA / Oracle, wrap in a CTE and filter:
```sql
WITH ranked AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY posting_id ORDER BY ingestion_ts DESC) AS rn
  FROM gl_postings_raw
)
SELECT * FROM ranked WHERE rn = 1;
```

### Aggregation as windows
```sql
SUM(amount) OVER (PARTITION BY account ORDER BY posting_date
                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
  AS running_balance
```

**Canonical use — running GL balance per account:**
```sql
SELECT
  account,
  posting_date,
  amount,
  SUM(amount) OVER (
    PARTITION BY account
    ORDER BY posting_date, posting_id
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS running_balance
FROM gl_postings;
```
**Watchout:** `ORDER BY` in a window without an explicit `ROWS BETWEEN` clause defaults to `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`, which includes peers (rows with the same ORDER BY value). For exact running sums, always be explicit.

### Offset / navigation
```sql
LAG(col, n)  OVER (...)  -- value from row n back
LEAD(col, n) OVER (...)  -- value from row n forward
FIRST_VALUE / LAST_VALUE OVER (...)
```

**Canonical use — period-over-period delta on close balances:**
```sql
SELECT
  account,
  fiscal_period,
  close_balance,
  close_balance - LAG(close_balance) OVER (
    PARTITION BY account ORDER BY fiscal_period
  ) AS mom_delta
FROM monthly_close;
```

### The hidden gotcha: `LAST_VALUE`
`LAST_VALUE` without an explicit frame returns the current row, not the partition's last value. You almost always want:
```sql
LAST_VALUE(col) OVER (PARTITION BY ... ORDER BY ...
                      ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
```
If you forget this in an interview and quietly fix it after a colleague's puzzled face, that's the right move. Don't pretend you knew.

---

## 2. CTEs and recursive CTEs

### Plain CTEs — readability for the grader
Chain them. Name each step after the *output grain*, not the action:
```sql
WITH postings_deduped AS ( ... ),                  -- one row per posting_id
     postings_with_period AS ( ... ),              -- + fiscal_period
     period_balances AS ( ... ),                   -- one row per account per period
     period_balances_with_prior AS ( ... )         -- + lagged prior balance
SELECT ...
FROM period_balances_with_prior;
```
This *also* gives you natural pause points in an interview — you can stop, sanity-check one CTE, then continue.

### Recursive CTEs — hierarchies and runs
Two common shapes:

**Cost-center hierarchy walk:**
```sql
WITH RECURSIVE cc_tree AS (
  -- anchor: top-level cost centers
  SELECT cc_id, parent_id, cc_id AS root_id, 1 AS lvl
  FROM cost_centers
  WHERE parent_id IS NULL

  UNION ALL

  -- recursive: walk children
  SELECT c.cc_id, c.parent_id, t.root_id, t.lvl + 1
  FROM cost_centers c
  JOIN cc_tree t ON c.parent_id = t.cc_id
)
SELECT * FROM cc_tree;
```

**Gap-and-island detection** (find runs of consecutive posting dates per account):
```sql
WITH numbered AS (
  SELECT account, posting_date,
         ROW_NUMBER() OVER (PARTITION BY account ORDER BY posting_date) AS rn
  FROM daily_postings
),
grouped AS (
  SELECT account, posting_date,
         posting_date - INTERVAL '1 day' * rn AS grp
  FROM numbered
)
SELECT account, MIN(posting_date) AS run_start, MAX(posting_date) AS run_end
FROM grouped
GROUP BY account, grp;
```
The trick: subtract row-number-as-days from the date — consecutive dates share the same `grp`. This is a classic interview pattern. Memorize it.

---

## 3. Deduplication — every variant

| Pattern | Use when |
|---|---|
| `DISTINCT` | All columns identical, want unique tuple |
| `GROUP BY` all cols | Same as DISTINCT, but you can add HAVING |
| `ROW_NUMBER() ... QUALIFY rn=1` | Need to keep *one specific* row per key (latest, highest, etc.) |
| `DISTINCT ON (key)` (PostgreSQL only) | Same as above, PG-native |
| `SELECT MAX(*) GROUP BY key` | If only one non-key column matters |

**PostgreSQL `DISTINCT ON` shorthand:**
```sql
SELECT DISTINCT ON (posting_id) *
FROM gl_postings_raw
ORDER BY posting_id, ingestion_ts DESC;
```
PG-only but elegant. Don't use in cross-dialect code.

---

## 4. Reconciliation — the heart of finance SQL

Finance reconciliation queries answer: *what's in A but not in B, what's in B but not in A, and where do they disagree?*

### Three reconciliation patterns

**Pattern 1 — FULL OUTER JOIN with NULL detection** (most flexible):
```sql
SELECT
  COALESCE(sap.posting_id, snow.posting_id) AS posting_id,
  sap.amount  AS sap_amount,
  snow.amount AS snow_amount,
  CASE
    WHEN sap.posting_id  IS NULL THEN 'missing_in_sap'
    WHEN snow.posting_id IS NULL THEN 'missing_in_snowflake'
    WHEN sap.amount <> snow.amount THEN 'amount_mismatch'
    ELSE 'matched'
  END AS recon_status
FROM sap_gl       sap
FULL OUTER JOIN snowflake_gl snow
  ON sap.posting_id = snow.posting_id
WHERE sap.posting_id IS NULL
   OR snow.posting_id IS NULL
   OR sap.amount <> snow.amount;
```

**Pattern 2 — EXCEPT / MINUS** (set difference, all columns must match):
```sql
SELECT posting_id, amount FROM sap_gl
EXCEPT
SELECT posting_id, amount FROM snowflake_gl;
```
Snowflake/PG/HANA use `EXCEPT`; Oracle uses `MINUS`.
**Watchout:** `EXCEPT` is `EXCEPT DISTINCT` by default in most dialects. `EXCEPT ALL` preserves duplicate counts — sometimes critical for reconciliation (5 dupes in A, 3 in B should report 2).

**Pattern 3 — anti-join** (in A, not in B — semantically clearest):
```sql
SELECT a.*
FROM sap_gl a
WHERE NOT EXISTS (
  SELECT 1 FROM snowflake_gl b WHERE b.posting_id = a.posting_id
);
```
Prefer `NOT EXISTS` over `NOT IN` — `NOT IN` blows up with NULLs (any NULL in the subquery list returns zero rows from the outer).

### The reversal-pair pattern
Finance source data often has reversal pairs (a posting and its negation). To net them out:
```sql
SELECT account, fiscal_period, SUM(amount) AS net_amount
FROM gl_postings
GROUP BY account, fiscal_period
HAVING SUM(amount) <> 0;  -- only show non-zero nets
```
For matching pairs explicitly:
```sql
SELECT posting_id, reversed_by_id, amount
FROM gl_postings p
WHERE EXISTS (
  SELECT 1 FROM gl_postings r
  WHERE r.posting_id = p.reversed_by_id
    AND r.amount = -p.amount
);
```

---

## 5. Slowly Changing Dimensions

### SCD Type 2 — the standard
A vendor master where each version has a validity window:
```
vendor_id | name        | valid_from | valid_to   | is_current
V001      | ACME Old    | 2023-01-01 | 2024-06-15 | false
V001      | ACME New    | 2024-06-15 | 9999-12-31 | true
```

**Pattern — close out current row + insert new row** (handled by dbt snapshots / AutomateDV satellites, but you should be able to write it raw):
```sql
-- close current
UPDATE vendor_dim
SET valid_to = CURRENT_DATE, is_current = FALSE
WHERE vendor_id = 'V001' AND is_current = TRUE;

-- insert new
INSERT INTO vendor_dim (vendor_id, name, valid_from, valid_to, is_current)
VALUES ('V001', 'ACME Newest', CURRENT_DATE, '9999-12-31', TRUE);
```

### Point-in-time joins (the hard part)
Most SCD2 mistakes happen on the read side. To get the vendor name *as of the posting date*:
```sql
SELECT
  p.posting_id,
  p.posting_date,
  v.name AS vendor_name_at_posting_time
FROM gl_postings p
JOIN vendor_dim v
  ON v.vendor_id = p.vendor_id
 AND p.posting_date >= v.valid_from
 AND p.posting_date <  v.valid_to;
```
**Watchout:** `< valid_to` (strict), not `<= valid_to`, when intervals are half-open `[from, to)`. Get this wrong and you get duplicate rows on the cutover day. Always confirm interval convention with whoever owns the dim.

---

## 6. Late-arriving and out-of-order data

The pattern: events arrive after their period closed; you must recompute the period.

**Find affected periods:**
```sql
SELECT DISTINCT fiscal_period
FROM gl_postings_landing
WHERE ingestion_ts > :last_run_ts
  AND posting_date < :last_run_ts;  -- arrived late
```

**Recompute and merge:**
```sql
MERGE INTO period_balances tgt
USING (
  SELECT account, fiscal_period, SUM(amount) AS bal
  FROM gl_postings
  WHERE fiscal_period IN (
    SELECT DISTINCT fiscal_period
    FROM gl_postings_landing
    WHERE ingestion_ts > :last_run_ts
  )
  GROUP BY account, fiscal_period
) src
ON tgt.account = src.account AND tgt.fiscal_period = src.fiscal_period
WHEN MATCHED THEN UPDATE SET balance = src.bal
WHEN NOT MATCHED THEN INSERT (account, fiscal_period, balance) VALUES (src.account, src.fiscal_period, src.bal);
```

`MERGE` exists in Snowflake, HANA, Oracle, BigQuery, recent PostgreSQL (15+). Syntax is mostly consistent.

---

## 7. Aggregation patterns

### GROUPING SETS / ROLLUP / CUBE
For a single query returning multiple aggregation grains (a Universal-Journal-style multi-dimensional report):

```sql
SELECT
  company_code,
  cost_center,
  account,
  SUM(amount) AS total
FROM gl_postings
GROUP BY GROUPING SETS (
  (company_code, cost_center, account),  -- finest grain
  (company_code, cost_center),           -- subtotal per cost center
  (company_code),                        -- subtotal per company
  ()                                      -- grand total
);
```
`ROLLUP(a,b,c)` is shorthand for the hierarchical version; `CUBE(a,b,c)` does all 2^n combinations.

Detect which level you're on:
```sql
SELECT
  ...,
  GROUPING(company_code) AS is_company_total,
  GROUPING(cost_center)  AS is_cc_total
```

### Conditional aggregation (FILTER / CASE)
Standard SQL has `FILTER`:
```sql
SELECT
  account,
  SUM(amount) FILTER (WHERE amount > 0) AS debits,
  SUM(amount) FILTER (WHERE amount < 0) AS credits
FROM gl_postings
GROUP BY account;
```
PostgreSQL + Snowflake support `FILTER`. Oracle / HANA / older engines: use CASE:
```sql
SUM(CASE WHEN amount > 0 THEN amount END) AS debits
```
Note: `END` without `ELSE` returns NULL, which `SUM` ignores — exactly what you want.

---

## 8. Date and fiscal period handling

Finance lives on fiscal calendars, not the Gregorian calendar. Two patterns matter:

**Calendar table approach (preferred):**
```sql
-- dim_date columns: date_id, fiscal_year, fiscal_period, fiscal_quarter,
--                   is_business_day, week_of_year, ...
SELECT d.fiscal_period, SUM(p.amount)
FROM gl_postings p
JOIN dim_date d ON d.date_id = p.posting_date
GROUP BY d.fiscal_period;
```
This is the *only* sane way to handle multi-jurisdiction fiscal calendars, week 53, business-day arithmetic.

**On-the-fly date manipulation (when no calendar dim):**
```sql
DATE_TRUNC('month', posting_date)         -- start of month
LAST_DAY(posting_date)                    -- end of month
DATEADD(month, -1, posting_date)          -- Snowflake / HANA
posting_date - INTERVAL '1 month'         -- PostgreSQL
ADD_MONTHS(posting_date, -1)              -- Oracle / Snowflake / BigQuery
EXTRACT(QUARTER FROM posting_date)
```

**Watchout — timezone in finance:** when joining transactional data crossing midnight UTC, always convert to the *business* timezone before truncating to date. Otherwise you split a single business day across two calendar days.
```sql
DATE_TRUNC('day', CONVERT_TIMEZONE('UTC', 'Europe/Amsterdam', event_ts))
```

---

## 9. PIVOT / UNPIVOT

**PIVOT — when you need wide reports:**
```sql
SELECT *
FROM (SELECT account, fiscal_period, amount FROM gl_postings)
PIVOT (SUM(amount) FOR fiscal_period IN ('2026-01', '2026-02', '2026-03'));
```
Available in Snowflake, SQL Server, Oracle. PostgreSQL needs `crosstab` from `tablefunc`.

**UNPIVOT — wide-to-tall** (often more useful, especially for reconciling SAP wide formats):
```sql
SELECT account, fiscal_period, amount
FROM monthly_wide
UNPIVOT (amount FOR fiscal_period IN (jan_amt, feb_amt, mar_amt));
```

Generic fallback (works everywhere): conditional aggregation for PIVOT, `UNION ALL` for UNPIVOT.

---

## 10. LATERAL joins and arrays

### LATERAL — per-row correlated subqueries
Get the top-3 most recent postings per vendor:
```sql
SELECT v.vendor_id, p.posting_id, p.amount, p.posting_date
FROM vendors v
JOIN LATERAL (
  SELECT * FROM gl_postings
  WHERE vendor_id = v.vendor_id
  ORDER BY posting_date DESC
  LIMIT 3
) p ON TRUE;
```
`CROSS APPLY` / `OUTER APPLY` are the SQL Server names. PostgreSQL, Snowflake, HANA support `LATERAL`.

### Array / JSON unnesting
Modern finance data often carries JSON (line items, tax lines, partner splits):
```sql
-- Snowflake
SELECT
  p.posting_id,
  l.value:account::string AS line_account,
  l.value:amount::number  AS line_amount
FROM postings_json p,
LATERAL FLATTEN(input => p.line_items) l;

-- PostgreSQL
SELECT p.posting_id, l->>'account', (l->>'amount')::numeric
FROM postings_json p,
LATERAL jsonb_array_elements(p.line_items) l;

-- BigQuery
SELECT p.posting_id, l.account, l.amount
FROM postings_json p, UNNEST(p.line_items) l;
```

---

## 11. Reading and critiquing SQL (the architect lens)

In a design round or boarding session, you may get a query and be asked "review this." Use a checklist:

1. **Grain.** What does one row of the result represent? Can the query author state this in one sentence?
2. **Duplicates.** Are joins fan-out safe? Any one-to-many without aggregation?
3. **NULL handling.** Outer joins + WHERE clauses on the outer table = silent inner join. Look for `WHERE outer.col = X` after a `LEFT JOIN outer`.
4. **Window frame defaults.** Any unframed `ORDER BY` in a window? (Probably wrong.)
5. **`DISTINCT` as a band-aid.** Usually masks a bad join. Ask: where do the dupes come from? Fix the join.
6. **Reservation of correctness.** Floating-point money? Always `NUMERIC(20,4)` or `DECIMAL`, never `FLOAT`/`DOUBLE`.
7. **Time-travel safety.** Does the query reference `CURRENT_DATE` or a snapshot timestamp? Auditors care.
8. **Predicate pushdown.** Filters on the outermost layer that could be inside the CTE → poor optimizer hint, but more importantly, a code-smell that the author didn't think about scan cost.

---

## 12. Performance — the architect view

Index-level tuning is rarely the architect's job. Knowing which knob to turn, and why, is.

| Lever | When |
|---|---|
| **Clustering keys** (Snowflake) | Large table, queries always filter by same high-cardinality cols |
| **Partitioning** (PG, BigQuery, Iceberg) | Bounded-cardinality cols like date, region; pruning at scan time |
| **Materialized views / dynamic tables** (Snowflake) | Repeated expensive aggregation; willing to trade freshness for read cost |
| **Pre-aggregation in dbt** | Same as above but explicit in the lineage |
| **Search optimization service** (Snowflake) | Lookup-style queries on big tables (rare in finance, common in observability) |
| **Result cache** | Free 24h cache if query text + underlying data unchanged |

**Money-saving heuristic:** *cost is dominated by what you scan, not what you return.* Architect-level answer to "this query is slow" is almost always: "what's the scan profile, and can we push the filter earlier?"

---

## 13. Dialect cheatsheet

| Feature | Snowflake | SAP HANA | PostgreSQL | Oracle | BigQuery |
|---|---|---|---|---|---|
| String concat | `||` or `CONCAT` | `||` | `||` | `||` | `CONCAT` |
| Date add | `DATEADD(m,-1,d)` | `ADD_MONTHS(d,-1)` | `d - INTERVAL '1 month'` | `ADD_MONTHS(d,-1)` | `DATE_SUB(d, INTERVAL 1 MONTH)` |
| Top-N filter | `QUALIFY` | CTE + ROW_NUMBER | CTE + ROW_NUMBER | CTE + ROW_NUMBER | `QUALIFY` |
| LIMIT | `LIMIT n` | `LIMIT n` | `LIMIT n` | `FETCH FIRST n ROWS ONLY` | `LIMIT n` |
| Set diff | `EXCEPT` | `EXCEPT` | `EXCEPT` | `MINUS` | `EXCEPT DISTINCT` (mandatory) |
| Boolean | `BOOLEAN` | `BOOLEAN` | `BOOLEAN` | (none — use 0/1) | `BOOL` |
| MERGE | yes | yes | yes (15+) | yes | yes |
| FILTER clause | yes | no — use CASE | yes | no — use CASE | no — use CASE |
| Recursive CTE | yes (`WITH RECURSIVE`) | yes | yes (`WITH RECURSIVE`) | yes (`WITH ... CONNECT BY` alt) | yes (`WITH RECURSIVE`) |
| Money type | `NUMBER(p,s)` | `DECIMAL(p,s)` | `NUMERIC(p,s)` | `NUMBER(p,s)` | `NUMERIC` / `BIGNUMERIC` |

### SAP HANA specifics worth knowing
- **Calculation views / CDS views** are consumed via SQL but designed in the SAP modeller. As a downstream consumer you just `SELECT FROM "_SYS_BIC"."path/to/calc_view"`.
- **Input parameters** on calc views are passed as `WITH PARAMETERS ('PLACEHOLDER' = ('P_FROM','2026-01-01'))` — ugly, worth remembering syntactically.
- HANA is column-store by default; aggregation is fast, but joins on many-to-many can blow up — same architectural watchouts as any column store.

---

## 14. Practice drills (do these out loud, on paper, no autocomplete)

Time yourself: 15 minutes each. If you can't, you need more reps before the interview.

1. **Top-3 latest postings per vendor.** (LATERAL or window.)
2. **Running balance per account, ordered by posting date.** (Window with explicit frame.)
3. **Reconcile SAP GL vs. Snowflake GL — show missing-in-A, missing-in-B, and amount-mismatch in one result.** (FULL OUTER JOIN + COALESCE + CASE.)
4. **Vendor SCD2 — return the vendor name as of any given posting date.** (Interval join.)
5. **Period balance with multiple subtotals (per company, per cost center, grand total) in one query.** (GROUPING SETS.)
6. **Cost-center hierarchy — for each leaf cost center, return the root.** (Recursive CTE.)
7. **Gap detection — find vendors with no postings for 60+ consecutive days in 2025.** (Gap-and-island.)
8. **Late-arriving recompute — find fiscal periods affected by yesterday's ingestion and merge a recomputed balance.** (DISTINCT + MERGE.)

**If you only drill two:** make them #3 and #4. Dedupe-keep-latest and gap-and-island turn up more often than anything else on this list, and they are the two that are hardest to reconstruct from first principles at speed.

---

## 15. The one-page mental model

Given any problem statement, run this loop:

```
1. State the grain of the input.
2. State the grain of the output.
3. Plan the CTEs from input grain → output grain, naming each by its grain.
4. For each CTE: is there a dedupe? aggregation? join? window?
5. Write it.
6. Sanity check with one row.
```

That's the whole job. Everything in this document is in service of step 5.

---


