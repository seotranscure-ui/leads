# Workflow — Create a semantic content brief

A semantic content brief is the writer's complete spec for a single URL. Done well, two writers using the same brief produce nearly identical pages. The brief encodes Koray's discipline at the page level: canonical query, entity inventory, SPO triplets, heading vector, schema, internal-link plan, and E-E-A-T layer.

## When to run this

User wants to brief a writer on a specific page. Phrasings: "build me a brief for X", "write a content brief for our cardiology billing page", "brief this article", "Koray-style brief", "semantic brief", "what should this page cover".

## Inputs you need

1. **The target URL** (or slug if not yet live).
2. **The canonical query** — one specific query this URL is the answer to. Confirm with Ahrefs volume/KD before locking.
3. **The intent layer** — informational / commercial-national / commercial-local / etc.
4. **The Source Context** — confirm or quote verbatim from the topical map.
5. **Position in the topical map** — what's the parent C-node, what are the sibling I-nodes, what does this URL link out to, what grandchildren exist (these become hand-off targets).
6. **The topical-map title** — the title the topical map proposes. Check whether to modify per the "Title decision process" below.
7. **Performance year** (for regulatory/year-dated content) — e.g., 2026.

## Default output format — XLSX 9-sheet brief

The default deliverable is a **9-sheet Excel workbook** built with openpyxl using the xlsx skill. Sheet order is fixed (writers read in this order):

| # | Sheet name | Purpose | Columns |
|---|------------|---------|---------|
| 1 | `Cover` | Brief metadata + reading guide | 2 (key, value) |
| 2 | `Section_A_Apex` | Domain positioning | 2 (key, value) |
| 3 | `Section_B_Queries` | Query semantics with Ahrefs data | 7 |
| 4 | `Section_C_Entities` | Tiered entity inventory + SPO triplets + unique gain | 5 |
| 5 | `Section_D_HeadingVector` | Master heading table with writer instructions | 11 |
| 6 | `Section_E_Links` | Internal-link plan | 5 |
| 7 | `Section_F_EEAT_Schema` | E-E-A-T layer + schema stack | 2 (key, value) |
| 8 | `Section_G_WriterRules` | Writer-tone rules with GOOD vs BAD examples | 3 |
| 9 | `TFQT_Scorecard` | 4-question scorecard + verdict + pre-publish checklist + common mistakes | 4 |

Styling: navy headers (`#1F3864`) with white text; light-blue label cells (`#D9E2F3`) with navy bold text; Arial font; wrap-text on body cells; thin border (`#BFBFBF`) on every body cell.

The Markdown / Word format is acceptable only when the user explicitly requests it (e.g., "give me a Notion-pasteable brief"). Default to XLSX.

### Cover sheet — 20 metadata fields

In this exact order (some fields may not apply to every page; mark "n/a"):

1. Project (e.g., "Macralytics QPP Topical Map v3")
2. URL (slug)
3. Title (60 ch) — with "MODIFIED from topical map" suffix if applicable
4. H1 (= Title verbatim)
5. Title modification rationale (if modified — explain canonical-query-led decision)
6. Meta Description (130 ch)
7. Canonical Query — with volume/KD/SERP features
8. Query Template Class (per topical map)
9. Intent
10. Wave
11. Parent Slug
12. Position in Map — full sibling + child + bridge listing
13. Source Context (verbatim from topical map)
14. Central Entity (Informational)
15. Central Entity (Commercial bridge)
16. Heading-vector rule applied — short summary of Koray v2 pattern
17. Performance Year (for year-dated regulatory content)
18. Brief Author / Date
19. Brief Version
20. Sheet Index
21. Reading guide for writers — tells beginners: read Sections A, F, G first; walk Section D top to bottom as a recipe

### Section_D_HeadingVector — 11 columns (the core)

| # | Column | What it holds |
|---|--------|---------------|
| 1 | `#` | Row number for stable reference |
| 2 | `Level` | H1 / Intro / H2.1-H2.n / H3 / H4 / Close |
| 3 | `Section (Main / Cross-cutting)` | "Main (Definition)", "Main (Attribute attribute)", "Cross-cutting", "Cross-cutting (Commercial Bridge)", "Cross-cutting (standalone Boolean)", or "Main" for H1/Intro/Close |
| 4 | `Heading` | Literal heading text (Q-form except H1) |
| 5 | `Question Type` | Definitional / Grouping / Comparative / Boolean (+ optional sub-tag like "freshness", "scoring", "Selection attribute") |
| 6 | `Required Entities (UNIQUE -> ROOT -> RARE)` | Pipe-separated, tier-prefixed |
| 7 | `Required SPO / Facts` | Numeric SPOs the writer must state |
| 8 | `Contextual Flow — WRITER INSTRUCTIONS (beginner-friendly)` | The recipe (see below) |
| 9 | `Snippet / Schema Target` | Featured Snippet / FAQ entry / ItemList / etc. |
| 10 | `Word Budget` | Range, e.g., "180-220 words" or "70-80 words" |
| 11 | `Internal Link / Anchor (max 1)` | URL + anchor text, or empty |

Adaptive row heights: longer Contextual Flow entries need taller rows. Use `max(120, min(500, cf_len / 3.5))` as a rule of thumb.

### Section_D Contextual Flow recipe per row

**This is the single most important quality lever in the brief.** Every Section D row's Contextual Flow column follows the same recipe so a beginner writer can execute the brief without Koray-framework background:

```
WHAT THIS IS:
  [The role of this section in the article — one sentence]

OPENING SENTENCE (or LITERAL DRAFT):
  [The first sentence the writer can copy verbatim or adapt.
   For Intro and Boolean H3s, provide a complete literal draft.]

THEN COVER (in this order):
  1. [Specific fact 1 with example]
  2. [Specific fact 2 with example]
  3. [Specific fact 3 with example]

FORMAT:
  [Paragraph / 2-row table / numbered list / formula callout / bullet list]

NUMBERS TO STATE:
  [Every number that must appear, with the year]

PHRASES TO BOLD:
  ['the exact words to wrap in <b>']

LINK (if any):
  [URL + exact anchor text + placement instruction]

DO NOT:
  - [Mistake 1]
  - [Mistake 2]

END WITH:
  [What the closing sentence does — transition, hand-off, link]
```

Length target per Contextual Flow entry: 600–1,800 characters. Anything under 300 chars is too terse for a beginner; anything over 2,500 chars is bloated.

Examples of when to provide a literal draft (rather than just "open with..."):
- **Intro paragraph** — always provide a full 70–80 word draft.
- **Boolean H3s** — always provide the full 50–80 word draft with sentence 1 = Yes/No.
- **Worked-example callouts** — write the numbers and arithmetic out.
- **Closing paragraph** — provide a full draft with the literal up-link anchor.

For attribute H2s and other definitional sections, provide a sentence pattern with a worked example, not necessarily a full draft (writer adapts to topic).

### Section_G_WriterRules — GOOD vs BAD examples per rule

The writer-tone rules table has 3 columns: `#`, `Rule (Koray + semantic-content-writing)`, `How to apply on /url/`.

The third column **must contain a GOOD example + a BAD example** for every rule. Pattern:

```
GOOD: [literal example of what to write]
BAD: [literal anti-pattern, ideally pulled from a competitor page in the SERP]
BAD: [second anti-pattern if useful]
```

Total rule count: 31 numbered rules (the standard set). The first 6 cover the Koray-v2 structural rules (Title=H1, Intro, attribute order, develop with H3, scatter booleans, no Supplementary marker). The remaining 25 cover the semantic-content-writing rules (Q-form headings, answer-first, factual certainty, no pronouns, definitive numbers, examples after plural nouns, short sentences, bold the answer, eliminate fluff, POS consistency, etc.).

### TFQT_Scorecard sheet — 4 sections

1. **The 4-question table** with `Question / Answer / Evidence / Risk-Mitigation` columns.
2. **Verdict** — 4/4 YES (typical) with green "Ship the brief" line.
3. **Pre-publish checklist** — 25–30 specific checks. See "Pre-publish checklist template" below.
4. **Common mistakes to avoid** — 18–20 brief-specific mistakes. See "Common mistakes catalogue" below.

## Title decision process — modify or keep verbatim

Before locking the title:

1. **Pull Ahrefs volume + KD for the canonical query** named in the topical map.
2. **Compare** to the topical-map title's expected match potential.
3. **Modify the title** when one of these conditions holds:
   - The topical-map title is in "Guide" format ("X (Y) Category Guide", "X Overview", "X Complete Guide") — these don't match Koray's colon-list pattern.
   - The canonical query has measurable volume (10+) and isn't in the topical-map title verbatim.
   - There are 3 attribute pain points unique to this entity that aren't shared with sibling URLs — these become the colon-list attributes.
4. **Keep the title verbatim** when:
   - The topical-map title is already in colon-list / comparison / listicle / question-form pattern.
   - The canonical query is already in the title verbatim.
5. **Always document the rationale** in the Cover sheet field `Title modification rationale` if modifying. State: (a) what Ahrefs volume/KD/SERP features the canonical query has, (b) why the new 3 attributes are unique to this entity, (c) final char count.

Worked example (MIPS Promoting Interoperability):

- Topical map title: "MIPS Promoting Interoperability (PI) Category Guide" — Guide format.
- Canonical query: "MIPS promoting interoperability" — 20 vol, KD 1, Question/PAA + sitelink.
- Three PI-unique attributes: Measures (base+performance+bonus tiers), CEHRT (the technology prerequisite), SRA (the two-attestation requirement).
- Modified title: "MIPS Promoting Interoperability: Measures, CEHRT & SRA" — 54 chars.
- Rationale: leads with canonical query verbatim; three attributes unique to PI (no other MIPS category has CEHRT or SRA); colon-list pattern matches Koray reference sites.

## Step-by-step content (per Section)

### Section A — Domain positioning (the apex)

10 key-value rows. Brief opens with the apex the writer reads first:

- Source Context (one sentence — verbatim from the topical map)
- Central Entity for this URL (specific entity, not the site's apex entity)
- Topical Borders — IN (what's covered)
- Topical Borders — OUT (what's deferred to children, siblings, or out of scope entirely)
- Where this URL sits in the map (parent + siblings + children + bridges)
- Why this URL exists (what gap it fills, what intent it owns, what's deferred)
- Intent layer served (informational / commercial / etc., plus role: Outer-Section / Inner-Section)
- Quality threshold (competition) — SERP top 10 summary + threshold-clearing levers
- SERP feature configuration (AI Overview / PAA / sitelinks / image pack)
- Macro context (semantic frame) — one paragraph the writer never drifts away from

The writer must understand the apex before writing the first sentence — otherwise content drifts off-context.

### Section B — Query semantics

Four subsections inside one sheet:

1. **Primary queries** — 25–35 queries with: `# | Query | Role | Volume (US) | KD | Intent / SERP Feature | Use in Brief`. The `Use in Brief` column points each query to a specific H2 or H3.
2. **Upstream queries (link FROM)** — 2–4 queries from sibling I-nodes that send users to this page. The brief tells the writer which inbound anchors to expect.
3. **Downstream queries (link TO)** — 4–7 queries this URL hands users off to. The brief tells the writer where each hand-off lives in Section D.
4. **Cousin / comparative queries** — 2–4 queries that are out-of-scope but worth a single mention or a comparative H3.

Each query is annotated with the SERP-dominant intent and any visible SERP features.

### Section C — Entity inventory

This is the Koray-specific section most briefs omit. Three sub-blocks inside one sheet:

**1. Tiered entity table** (5 cols: `Tier | Entity | Wikidata / Source | Attribute Type | Where to Place`):

- **UNIQUE entities** (12–20) — anchor H1 / Intro / attribute H2s. These are the entities Wikidata-resolvable to this URL's central entity, plus its sub-entities (e.g., for MIPS Quality: Quality category, 6-measure rule, decile benchmark, data completeness 75%, topped-out measure, etc.).
- **ROOT entities** (8–12) — anchor Intro and cross-cutting H2s. These are the parent / grandparent entities (MIPS, QPP, CMS, MACRA, Medicare Part B, etc.).
- **RARE entities** (5–15) — single-mention entities inside attribute H3s or cross-cutting sections.
- A final "[DISAMBIGUATION ONLY]" row for any same-acronym entities the page must NOT mention (e.g., MIPS-helmet for MIPS-medical content).

The `Where to Place` column references specific headings (H2.1, H3.2a, etc.) so the writer knows exactly where each entity must appear.

**2. Required SPO Triplets** — 10–18 Subject-Predicate-Object factual statements the page must declare:

- Format: `- Subject - Predicate - Object`
- Include numeric SPOs with the year (e.g., "The Quality category - is weighted at - 30 percent of the 2026 MIPS final score").
- Every SPO must appear in body verbatim or near-verbatim. Writer pre-publish checklist verifies coverage.

**3. Unique Information Gain** — 6–8 levers that beat the SERP Quality Threshold:

- Original tables (e.g., reweighting redistribution diagram, bonus-stack table, attribution decision tree).
- Worked numerical examples with arithmetic.
- Named-expert quote.
- Year-specific change callouts.
- Internal data point (e.g., "Across [N] PY2025 submissions, Macralytics clients averaged [X]").
- Competitor outdate flag — note which top-10 SERP pages still publish stale data.

### Section D — On-page structure

Specify exactly:

- **URL** — final path. Kebab-case. No parameters. No trailing slash variations.
- **Title** — 50–60 chars. Pick the right title format for the page:
  - **Colon-list**: "X: A1, A2, A3" (most common Koray pattern — e.g., "Success Coaching: Definition, Programs, Process, Importance, and History")
  - **Comparison**: "X vs Y: A1, A2, A3"
  - **Listicle**: "N X" or "N Top X for Y"
  - **Question-form**: "What is X?", "How does X work?" (only when the canonical query is itself a question)

  Always include central entity verbatim. Apply the "Title decision process" above before locking.
- **Meta description** — 140–160 chars. Distinct from title. Don't pre-write it as boilerplate; tie it to the unique information gain.
- **H1** — **= Title verbatim** for colon-list, comparison, and listicle titles. For question-form titles, H1 = Title (still Q-form). **Never rewrite a declarative title as a question for H1.** Verified across artistsinbusiness.com and thecoolist.com (both Koray-implemented).
- **Initial Contact** — first 70–80 words directly under H1, **no header**. Names the entity, all attributes in title order, key numeric SPOs. Establishes parent-framing for disambiguation. Functions as the AI Overview seed and Featured Snippet candidate. No "in this article we will explore" filler. **Always provide a full literal draft in the Contextual Flow column.**
- **Heading vector** — every H2 and H3 in question form. H1 is the only exception when the title is declarative. See "Heading-vector pattern by title format" below.

#### Heading-vector pattern by title format

The H2/H3 structure follows directly from the title format. Apply the right pattern.

**Pattern 1 — Colon-list title** ("X: A1, A2, A3"):

- H1 = title verbatim
- Intro paragraph (70–80 words, no header) — full context implied
- H2.1 = Definition of X — "What is X?" (the framework definition), developed with 2–3 H3 sub-questions (typically: how X contributes to parent score, how big the inventory is for [year], Boolean freshness check)
- H2.2 = A1 in question form — "What is A1?" / "What are A1 of X?", developed with 3–5 H3 sub-questions
- H2.3 = A2 in question form, with H3/H4 drill-down
- H2.4 = A3 in question form, with H3/H4 drill-down
- (Additional attribute H2s in title order, each fully developed)
- Cross-cutting H2s (scoring math, special-status / multiplier, year-specific changes, prioritization decision, commercial bridge, standalone Boolean) appear AFTER attribute H2s — **no visual "Supplementary Section" header**, the H2s just flow
- Closing paragraph (60–95 words) — restates central entity, single up-link to parent

Reference: see "Success Coaching: Definition, Programs, Process, Importance, and History" on artistsinbusiness.com for the canonical execution.

**Pattern 2 — Comparison title** ("X vs Y: A1, A2, A3"):

- H1 = title verbatim
- Intro paragraph — names the difference up front
- H2: What is X? (Topic A definition)
- H2: A1 of X — drill with H3 as needed
- H2: A2 of X — drill
- H2: A3 of X — drill
- H2: What is Y? (Topic B definition)
- H2: A1 of Y — drill
- H2: A2 of Y — drill
- H2: A3 of Y — drill
- H2: What Are the Similarities Between X and Y? (synthesis, near the end)
- Booleans nest inside relevant attribute sections, not at bottom

Reference: "Business Coaching vs. Mentoring: Definition, Purpose, Objective, and Qualifications" on artistsinbusiness.com.

**Pattern 3 — Listicle title** ("N X for [Audience]"):

- H1 = title verbatim
- Intro paragraph (2–3 paragraphs typical)
- H2 per list item (N H2s, each named for the item)
- H2: What is X? (definition catch-all near the end)
  - H3s for related drill-down questions
- H2: How does/should X work? (mechanism catch-all)
  - H3s/H4s for tangential questions including booleans

Reference: "15 Top Business Coaches in the World" on artistsinbusiness.com.

**Pattern 4 — Question-form title** ("What is X?", "How does X work?"):

- H1 = title verbatim (still Q-form)
- Intro paragraph
- H2s drill into sub-aspects of the canonical question
- H3/H4 nesting as the topic requires

#### H3/H4 nesting under attribute H2s

**Develop each attribute H2 with H3 (and H4 where needed) sub-questions.** Do not keep attribute H2s as tight one-paragraph blocks unless the page has a dedicated child URL that owns the deep coverage. The Koray-published pattern is full drill-down inside each attribute:

```
H2: What Is the Success Coaching Process?
  H3: Which Success Coaching Techniques Are Most Effective?
  H3: What Are Some Real-Life Examples of Success Coaching?
  H3: What Are the Benefits of Success Coaching?
  H3: What Are the Limitations of Success Coaching?
    H4: What Are the Facts of Success Coaching?
    H4: What Are the Myths of Success Coaching?
    H4: What Are the Principles of Success Coaching?
    H4: What Are the Alternatives to Success Coaching?
```

When to keep attribute H2s tight (single paragraph + hand-off): only when a dedicated grandchild page exists for the attribute AND is already published in the topical map. Even then, lean toward H3 drill-down (the hub gives concept-level coverage; the grandchild owns inventory-level depth).

Per-attribute count targets:
- Definition H2.1: 2–3 H3s
- Attribute H2s (H2.2–H2.4): 3–5 H3s each
- Cross-cutting H2s: 0–2 H3s each
- Boolean H3s: 50–80 words (3 sentences typical)
- Total page heading count: 8–10 H2s + 12–18 H3s for a colon-list hub with 3 attributes

#### Boolean question placement — scattered, not clustered

Boolean H3/H4/H5 questions **scatter throughout the article inside the relevant attribute section**, NOT clustered at the bottom under a "quick answers" parent. The bottom-cluster approach is a misreading of Koray and is NOT what the reference sites publish.

Common patterns observed on artistsinbusiness.com and thecoolist.com:

- "Is X the same as Y?" — H4 inside X's definition H2
- "Does X require Z?" — H4 inside the relevant attribute H2
- "Can a [persona] do X?" — H3 inside the relevant attribute H2
- "Is X cheaper than Y?" — H5 inside a comparison H4 inside a Similarities H3 inside an attribute H2
- "Did [thing] change for [year]?" — H3 inside the Definition H2 (freshness check)

Each boolean H3/H4 answers Yes/No (or "Partial" / "Sometimes" only when factually accurate) in sentence 1, then 1–2 sentences of elaboration with the SPO triplet. 40–80 words total. Provide a literal draft in the Contextual Flow column.

#### Standalone Boolean H2 — for prominent booleans

When a Boolean is too prominent or too cross-cutting to nest inside any single attribute H2, it can occupy H2 level on its own. Pattern:

- **Position**: as one of the last 2 H2s before the closing.
- **Length**: 80–120 words (slightly longer than a Boolean H3 because it carries H2 weight).
- **Format**: paragraph (no list), with the Yes/No verdict in sentence 1.
- **Use cases**: cross-cluster applicability ("Do MVPs include [this category]?"), framework comparison ("Is X the same as Y?"), regulatory-status questions.

Examples from the Macralytics MIPS briefs:
- H2.9 "Do MIPS Value Pathway (MVP) cost measures match Traditional MIPS cost measures?" — standalone Boolean on the Cost brief.
- H2.8 "Do MIPS Quality measures apply to MIPS Value Pathway (MVP) reporting?" — standalone Boolean on the Quality brief.
- H2.9 "Do MIPS Value Pathway (MVP) requirements include PI measures?" — standalone Boolean on the PI brief.
- H2.9 "Do MIPS Value Pathway (MVP) requirements include Improvement Activities?" — standalone Boolean on the IA brief.

Each is contextually relevant enough that nesting it as H3 would bury it; standalone H2 status surfaces it for both readers and FAQ schema.

#### Cross-cutting H2 patterns for regulatory / category hubs

For pages that document a regulatory framework component (a MIPS performance category, a tax form, a compliance domain), the cross-cutting H2 set after the attribute sequence typically follows this pattern:

| Order | H2 pattern | Question type | Purpose |
|-------|-----------|---------------|---------|
| 1 | "How is the [X] score calculated?" | Definitional (scoring) | The formula + worked example |
| 2 | "Which special statuses trigger [X-specific exception]?" | Grouping | Category-specific reweighting / multiplier / exemption |
| 3 | "What changed for [X] in [year]?" | Grouping (freshness) | Year-over-year delta with citations to the Final Rule |
| 4 | "How can a practice influence [X] performance?" | Definitional (decision) | Practical levers when direct action isn't possible (optional, only when applicable) |
| 5 | "How does [Brand] support [X]?" | Definitional (Commercial Bridge) | The ONE commercial bridge, 4-step service description, no marketing language |
| 6 | "[Standalone Boolean — typically MVP/alternative-pathway applicability]" | Boolean (standalone H2) | The prominent yes/no that doesn't fit anywhere else |

Not every page uses all six — pick the patterns that apply. The order matters: scoring first (because attribute H2s set up the scoring inputs); commercial bridge last in the non-Boolean group; standalone Boolean as the final H2 before closing.

#### Worked numerical examples — required in scoring H2s

Any H2 that explains a score, formula, or weight calculation **must include a literal worked example with step-by-step arithmetic**. Format:

```
Worked example — [persona]:
Step 1 — [calculation 1]: [numbers] = [result] points
Step 2 — [calculation 2]: [numbers] = [result]
Step 3 — Weighted contribution: [result] x [weight]% = [final result] of [max] possible points.
```

The example must use realistic numbers, not placeholders. For brevity, use one example per scoring H2 (two if comparing standard vs special-status outcomes).

#### Supplementary content — no visual marker

Cross-cutting H2s that don't fit neatly under any single title attribute (final score combination, year-specific changes, prioritization decision, commercial bridge, standalone Boolean) just **appear as additional H2s after the attribute sequence**. Do NOT add a "[Section break: Supplementary Content...]" header to the brief — it doesn't render on Koray-implemented sites and adds noise to the heading vector.

Two acceptable placement strategies:

- **Strategy A (artistsinbusiness.com)**: Drill supplementary questions DOWN into the last attribute H2 as H3/H4 children. The last attribute becomes a catch-all for tangentially related questions.
- **Strategy B (thecoolist.com)**: Append additional H2s after the title's attributes, each its own question. Works when the supplementary topics are too prominent to nest as H3.

For regulatory category hubs, Strategy B is the default (see "Cross-cutting H2 patterns" above).

- **List / table requirements** — where the page must include enumerations (types of X, list of Y). Specify completeness rules: "all 4 modifiers", "all states with these regulations".
- **First-image alt** — must contain central entity verbatim.
- **Last-paragraph close** — must mention central entity and link to the parent C-node.

#### Question-type distribution compliance check

Section D ends with a small compliance table verifying all four Koray question types appear at both H2 and H3 levels:

| Level | Definitional | Grouping | Comparative | Boolean | Total |
|-------|--------------|----------|-------------|---------|-------|
| H1 | 0 | 0 | 0 | 0 | 1 (title verbatim) |
| Main H2 (Definition) | 1 | 0 | 0 | 0 | 1 |
| Main H2 (attributes) | varies | varies | 0 | 0 | 3 |
| Supplementary H2 | varies | varies | 0 | 1 (standalone) | 4–6 |
| H3 | varies | varies | varies | 4–5 (scattered) | 12–18 |

Note any compliance failure inline (e.g., "Comparative absent at H2 because cross-category comparisons live on parent" — this is acceptable if H3 level has Comparative coverage).

### Section E — Internal-link plan

Specify the link relationships before writing. Five columns: `# | Link Direction | Target URL | Anchor Text (Q-form preferred) | Rationale (Koray rule)`.

Default counts:
- **Inbound links** (4–6) — list URLs from the topical map's `Incoming links` field, with anchor text for each. Anchor text matches this page's H1/H2 verbatim (Q-form anchor rule).
- **Outbound links** (6–11) — one per Section D heading that has a link in its row.
- Total: 10–17 unique link rows.

Per-heading link assignment:
- **H2.1 (Definition)** — up-link to parent C-node with anchor matching parent's H1.
- **Attribute H2s** — one hand-off link each to the relevant grandchild (when a grandchild exists in the topical map).
- **Attribute H3s** — one hand-off link each only when the H3 surfaces a sub-topic that has its own grandchild page.
- **H2 scoring** — forward link to /scoring-payment/ or equivalent.
- **H2 commercial bridge** — THE single commercial bridge, with non-marketing anchor.
- **Closing paragraph** — up-link to parent, allowed to duplicate the H2.1 anchor/target.
- **Other H2s** — usually no link.

Anchor-text discipline (encode this as a "discipline rules" block at the bottom of the sheet, 8 items):

1. Anchor text matches destination's H2/H3 verbatim where possible (Q-form anchor).
2. Never the same anchor for two different targets.
3. Never two different anchors for the same target — exception allowed for parent up-link in H2.1 + closing with SAME anchor.
4. No "click here", "learn more", or "read more".
5. No links to redirects, 404s, or self.
6. First image alt text contains [central entity] verbatim.
7. ONE link per heading row.
8. Total unique outbound count: [target number for this page].

### Section F — E-E-A-T layer

Mandatory. The single highest-leverage LLM-presence and Quality-Threshold lever. 10 key-value rows:

1. **Author (named, credentialed)** — pattern: '[Name], [credentials], [role], [Brand]. [N] years of [relevant] experience.' Photo + role + LinkedIn URL + 2-line bio block above the fold (after H1, before Intro) and at article end.
2. **Reviewer (technical / YMYL)** — second named expert with credentials matched to the content domain (e.g., CISSP/CHPS for HIPAA-scope content; CRC for HCC-coding content; CPC/CPMA for billing content). Required for YMYL Medicare-reimbursement content.
3. **Date stamps** — visible 'Published: [Date]' and 'Last updated: [Date]'. Update cadence specific to the regulatory domain (annual Final Rule cycle for QPP content).
4. **Citations — primary sources (≥4)** — embed inline, not piled at bottom. Examples: qpp.cms.gov, CMS Final Rule (Federal Register), HHS, ONC, AMA, AAPC. DO NOT cite Wikipedia or competitor SEO blogs.
5. **Original element (uniqueness)** — at least ONE of: original diagram, worked numerical example, brand-internal data point, named expert quote, year-specific change callout.
6. **Schema stack** — Article + Person (author) + FAQ + BreadcrumbList + Organization. Validate in Rich Results Test. DO NOT add Service / MedicalBusiness schema on informational pages — those belong on /services/.
7. **Image strategy** — hero image alt = entity-rich; filename kebab-case; 2–3 additional images per page (diagrams, callouts).
8. **Trust signals** — NAP block (footer), author bio, reviewer attestation, date stamps, primary-source citations inline. NO testimonials in informational body.
9. **Update cadence** — refresh on every regulatory release (e.g., annual CMS Final Rule cycle for QPP). Update dateModified + re-validate schema.
10. **Draft JSON-LD schema** — full JSON-LD block ready for the developer, with `about.sameAs` pointing to the canonical authoritative source (e.g., qpp.cms.gov for QPP content). This is the entity disambiguation hook for the Knowledge Graph.

### Section G — Writer-tone rules

31 numbered rules, each with a `Rule` cell and a `How to apply (with concrete GOOD vs BAD examples)` cell. The first 6 rules cover the Koray-v2 structural rules; the remaining 25 cover semantic-content-writing.

Rule 1 — Title = H1 verbatim
Rule 2 — Intro before H2.1 (70–80 words, no header)
Rule 3 — Attribute H2 order matches title
Rule 4 — Develop attribute H2s with H3 (Koray v2)
Rule 5 — Booleans scatter through the body (Koray v2)
Rule 6 — No Supplementary Section marker (Koray v2)
Rule 7 — Question-form headings (H2 and below)
Rule 8 — Disambiguation discipline (full name on first reference)
Rule 9 — Answer-first structure (first sentence = CAP)
Rule 10 — Factual certainty (remove modals)
Rule 11 — No pronouns — repeat the entity
Rule 12 — Definitive numbers — always with the year
Rule 13 — Examples after every plural noun
Rule 14 — Short sentences (≤20 words avg)
Rule 15 — Bold the answer, not the query
Rule 16 — Eliminate fluff
Rule 17 — Part-of-speech consistency in lists
Rule 18 — Subordinate text matches heading
Rule 19 — 'If' clauses come second
Rule 20 — No analogies, no opinions, no first person
Rule 21 — Definitions on first use (appositive form)
Rule 22 — Information density (≥2 SPOs per paragraph)
Rule 23 — Unique n-grams (don't copy CMS verbatim)
Rule 24 — Opening + closing consistency (entity name in both)
Rule 25 — No promotion in informational body
Rule 26 — Avoid these exact phrases (forbidden words list)
Rule 27 — Numeric format consistency
Rule 28 — Tables — setup + table + outro
Rule 29 — Length rule (with rough budget by section)
Rule 30 — Boolean discipline (Yes/No in sentence 1)
Rule 31 — [Domain-specific] disambiguation handled by ancestors (or other page-specific rule)

Each rule's right-column cell must contain at least one GOOD and one BAD example. The BAD examples should be real anti-patterns from competitor pages in the SERP whenever possible.

## TFQT scorecard for the brief itself

Before delivering, score the brief against:

- **Leads.** If this is a commercial-intent URL, does the brief specify the lead-capture path (CTA placement, form, contact link)? Does it show the writer how to convert without violating the no-marketing-language rule for the informational sections?
- **LLM presence.** Does the brief require Person schema, named author, original element, citations? If any of those is missing, the brief will not produce an LLM-citable page.
- **Clicks / impressions.** Is the heading vector designed for both classical SERP (Featured Snippet, FAQ, People-Also-Ask coverage) and rich results (FAQ schema)?
- **Topical authority.** Does the brief require ≥ 80% entity coverage from the entity inventory? Does it specify the link-up to the parent C-node and lateral siblings?

Show the scorecard inline with Answer / Evidence / Risk-Mitigation columns. Add a "Verdict" line (typically "4/4 YES. Ship the brief.").

## Pre-publish checklist — 25–30 items per brief

The checklist verifies the brief produced a page that matches the Koray v2 pattern. Default template:

```
[ ] H1 reads '[Title]' verbatim (= Title tag).
[ ] Intro (70-80 words, no header) sits directly under H1 and names [key numeric SPOs].
[ ] Intro disambiguates via '[Full Parent Entity Name]' parent framing.
[ ] H2.1 defines [entity] + the [key concept] gate/rule. [N] H3s underneath.
[ ] H2.2 ([Attribute 1]), H2.3 ([Attribute 2]), H2.4 ([Attribute 3]) follow TITLE ORDER.
[ ] Each attribute H2 has 3-5 H3 sub-questions developed.
[ ] No '[Section break: Supplementary Content]' header anywhere.
[ ] [N] Booleans scattered through the body inside attribute sections + standalone H2.[N]. NOT bottom-clustered.
[ ] All UNIQUE entities ([N]) appear in body. All ROOT entities appear. All RARE entities appear at least once.
[ ] All [N] SPO triplets stated verbatim or near-verbatim with year on numeric SPOs.
[ ] Every H2/H3 (excluding H1) is a question.
[ ] ONE INTERNAL LINK PER HEADING - [N] unique outbound + 1 duplicate closing up-link.
[ ] [Commercial bridge URL] bridge appears EXACTLY ONCE - H2.[N]. Non-marketing anchor.
[ ] [Original element 1] present in H[N.N].
[ ] [Original element 2] present in H[N.N].
[ ] [Worked example] present in H[N.N] scoring section.
[ ] Author bio + photo + LinkedIn under H1, before Intro.
[ ] Reviewer attestation + date visible.
[ ] Schema validated: Article + FAQPage + BreadcrumbList + Person + Organization. 'about.sameAs' = [canonical URL].
[ ] Schema headline = title verbatim.
[ ] No hedging modals.
[ ] No pronouns replacing entity names.
[ ] Word count: [target range].
[ ] Closing mentions '[central entity]' verbatim. Single up-link to parent.
[ ] First image alt text contains '[central entity]' verbatim.
[ ] Date stamps visible. Both match dateModified in schema.
[ ] All citations primary. No competitor blogs, no Wikipedia.
[ ] Page does NOT duplicate grandchild content.
```

Customize per page by substituting the bracketed values.

## Common mistakes catalogue — 18–20 items per brief

A "Common Mistakes to Avoid" block at the bottom of TFQT_Scorecard captures the anti-patterns specific to the brief's domain. The first 10 are universal (apply to every brief); the remaining 8–10 are page-specific.

Universal mistakes (always include):

1. Rewriting H1 as a question. H1 = title verbatim for colon-list titles.
2. Reordering attribute H2s. Order = [A1, A2, A3] (title order).
3. Collapsing attribute H2s to tight 1-paragraph blocks. Develop with H3.
4. Bottom-clustering booleans under a 'quick answers' parent. Booleans scatter.
5. Adding a '[Section break: Supplementary Content]' header.
6. Decorative headings (excluding H1). Every H2/H3 is a question.
7. Multiple internal links per heading.
8. Marketing CTAs in body. Commercial pitch confined to the bridge H2.
9. Citing Wikipedia or generic SEO blogs.
10. Forgetting to update dateModified after [regulatory release cycle].

Page-specific mistakes (8–10, tailored to the entity):

- Stating obsolete weights / counts / dates.
- Confusing the central entity with a related-but-different entity (e.g., the IA category-multiplier vs the MIPS Final Score small-practice bonus).
- Listing every sub-entity in the body when a grandchild owns the inventory.
- Misstating the gate / threshold / cap rule for the entity.
- Mis-citing the source authority (e.g., HIPAA Privacy Rule vs Security Rule).
- Closing with bunched links.

## Output deliverable

Default: 9-sheet XLSX built with openpyxl + the xlsx skill, saved to the user's project folder. Typical file size 40–50 KB. Validate row heights are adaptive to content length (especially Section D Contextual Flow column which can run 1,500+ chars per cell).

A typical brief is 2,800–3,600 words (the resulting article, not the brief itself). The brief itself is several hundred rows of structured data across the 9 sheets.

A Markdown / Word format is acceptable only when the user explicitly requests it (e.g., "give me a Notion-pasteable brief"). Default to XLSX.

## Reading order for writers

When briefs are handed to writers (especially beginners), the reading order baked into the Cover sheet should be:

1. **Sections A, F, G** — apex, E-E-A-T, tone rules (the "what kind of page is this and how do I write it"context)
2. **Section D top to bottom** — the heading-vector recipe (the "what do I write in each section" structure)
3. **Sections B, C, E** as reference — query/entity/link maps the writer consults during drafting

This ordering is included as the "Reading guide for writers" field on the Cover sheet.

## Reference implementations

Live pages exemplifying the Koray pattern (use as visual references):

- **artistsinbusiness.com** — see "Success Coaching: Definition, Programs, Process, Importance, and History" for the canonical colon-list pattern. See "Business Coaching vs. Mentoring" for the comparison pattern. See "15 Top Business Coaches in the World" for the listicle pattern.
- **thecoolist.com** — see "Life Path Number 1 (Leader and Pioneer) Meaning, Traits, and Relationships" and the angel-numbers pages for standalone Boolean H2s and the scattered-boolean pattern.
- **svalbardi.com** — historical Koray reference site for bottled-water domain authority.

When in doubt, pull a live page from one of these sites and mirror its structure.
