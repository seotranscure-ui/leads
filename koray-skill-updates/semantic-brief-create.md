# Workflow — Create a semantic content brief

A semantic content brief is the writer's complete spec for a single URL. Done well, two writers using the same brief produce nearly identical pages. The brief encodes Koray's discipline at the page level: canonical query, entity inventory, SPO triplets, heading vector, schema, internal-link plan, and E-E-A-T layer.

## When to run this

User wants to brief a writer on a specific page. Phrasings: "build me a brief for X", "write a content brief for our cardiology billing page", "brief this article", "Koray-style brief", "semantic brief", "what should this page cover".

## Inputs you need

1. **The target URL** (or slug if not yet live).
2. **The canonical query** — one specific query this URL is the answer to.
3. **The intent layer** — informational / commercial-national / commercial-local / etc.
4. **The Source Context** — confirm or quote.
5. **Position in the topical map** — what's the parent C-node, what are the sibling I-nodes, what does this URL link out to.

## Step-by-step

### Section A — Domain positioning (the apex)

Brief opens with one paragraph the writer reads first:

- Source Context (one sentence — verbatim from the topical map)
- Central Entity for the site
- Topical Borders (one-line in/out)
- Where this URL sits in the map (parent C-node + sibling I-nodes)
- Why this URL exists (what gap it fills, what intent it owns)

The writer must understand the apex before writing the first sentence — otherwise content drifts off-context.

### Section B — Query semantics

Document the query landscape this URL serves:

- **Canonical query** — the one query this URL is the canonical answer to. Verbatim, no rephrasing.
- **Sub-intents** — 4–8 follow-up queries users issue after the canonical query. These become H2/H3 sections.
- **Upstream queries** — queries users typed *before* this one. The brief tells the writer which sibling I-node to link from for users coming downstream.
- **Downstream queries** — queries users will issue *after* this one. The brief tells the writer which sibling I-node to link to.
- **Adjacent / cousin queries** — comparison queries ("X vs Y") and entity-attribute queries ("attribute of X").

Each query is annotated with the SERP-dominant intent (informational / commercial / transactional / comparative) and any visible SERP features (FAQ, People-Also-Ask, AI Overview, Featured Snippet, Local Pack).

### Section C — Entity inventory

This is the Koray-specific section most briefs omit. List every entity, attribute, and SPO triplet the page MUST contain:

- **Central entity** — the one named entity this URL resolves. Single, ideally Wikipedia-resolvable.
- **Required entities** — 8–20 entities that must appear in the body for the engine to read the page as on-topic. Examples for "what is cardiology billing": cardiology, CPT code, ICD-10, modifier, EOB, denial management, prior authorisation, AMA, CMS, Medicare, Medicaid, RVU, fee schedule, ASC, eligibility, cardiology specialty codes (33XXX series), echocardiogram, stress test, cardiac catheterisation.
- **Required SPO triplets** — Subject-Predicate-Object factual statements the page must declare. Examples: "Cardiology billing uses CPT codes in the 33XXX–33XXX range", "Modifier -26 indicates the professional component", "Medicare reimburses cardiology procedures via the MPFS".
- **Unique information gain** — what does this URL say that no other source on the SERP says. This is the lever for Quality Threshold clearance. Could be: original research, a screenshot of a real EOB, a denial breakdown by reason, a CPT-by-payer analysis.

### Section D — On-page structure

Specify exactly:

- **URL** — final path. Kebab-case. No parameters. No trailing slash variations.
- **Title** — 50–60 chars. Pick the right title format for the page:
  - **Colon-list**: "X: A1, A2, A3" (most common Koray pattern — e.g., "Success Coaching: Definition, Programs, Process, Importance, and History")
  - **Comparison**: "X vs Y: A1, A2, A3" (e.g., "Business Coaching vs. Mentoring: Definition, Purpose, Objective, and Qualifications")
  - **Listicle**: "N X" or "N Top X for Y" (e.g., "15 Top Business Coaches in the World")
  - **Question-form**: "What is X?", "How does X work?" (only when the canonical query is itself a question)

  Always include central entity verbatim.
- **Meta description** — 140–160 chars. Distinct from title. Don't pre-write it as boilerplate; tie it to the unique information gain.
- **H1** — **= Title verbatim** for colon-list, comparison, and listicle titles. For question-form titles, H1 = Title (still Q-form). **Never rewrite a declarative title as a question for H1.** This is verified across artistsinbusiness.com and thecoolist.com (both Koray-implemented).
- **Initial Contact** — first 70–80 words directly under H1, **no header**. Names the entity, all attributes in title order, key numeric SPOs. Establishes parent-framing for disambiguation. Functions as the AI Overview seed and Featured Snippet candidate. No "in this article we will explore" filler.
- **Heading vector** — every H2 and H3 in question form. H1 is the only exception when the title is declarative. See "Heading-vector pattern by title format" below.

#### Heading-vector pattern by title format

The H2/H3 structure follows directly from the title format. Apply the right pattern.

**Pattern 1 — Colon-list title** ("X: A1, A2, A3"):

- H1 = title verbatim
- Intro paragraph (70–80 words, no header) — full context implied
- H2.1 = Definition of X — "What is X?" (the framework definition)
- H2.2 = A1 in question form — "What is A1?" / "What are A1 of X?"
  - H3s drill into A1 sub-topics (each its own Q-form heading; H4 when sub-sub-question is needed)
- H2.3 = A2 in question form, with H3/H4 drill-down
- H2.4 = A3 in question form, with H3/H4 drill-down
- (Additional attribute H2s in title order, each fully developed)
- Cross-cutting H2s (scoring, year-specific changes, decision/prioritization, commercial bridge) appear AFTER attribute H2s — **no visual "Supplementary Section" header**, the H2s just flow
- Closing paragraph (60–90 words) — restates central entity, single up-link to parent

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

When to keep attribute H2s tight (single paragraph + hand-off): only when a dedicated grandchild page exists for the attribute and is already published in the topical map. Otherwise, develop fully.

#### Boolean question placement (Koray-aligned: scattered, not clustered)

Boolean H3/H4/H5 questions **scatter throughout the article inside the relevant attribute section**, NOT clustered at the bottom under a "quick answers" parent. The bottom-cluster approach is a misreading of Koray and is NOT what the reference sites publish.

Common patterns observed on artistsinbusiness.com and thecoolist.com:

- "Is X the same as Y?" — H4 inside X's definition H2
- "Does X require Z?" — H4 inside the relevant attribute H2
- "Can a [persona] do X?" — H3 inside the relevant attribute H2
- "Is X cheaper than Y?" — H5 inside a comparison H4 inside a Similarities H3 inside an attribute H2
- Prominent standalone booleans can occupy H2 level when their answer is short and self-contained (e.g., "Is life path number 1 rare?", "Is life path number 1 lucky?" — each is an H2 with a 60-word answer on thecoolist.com)

Each boolean H3/H4 answers Yes/No (or "Partial"/"It depends" only when factually accurate) in sentence 1, then 1–2 sentences of elaboration with the SPO triplet. 40–70 words total.

#### Supplementary content — no visual marker

Cross-cutting H2s that don't fit neatly under any single title attribute (final score combination, year-specific changes, prioritization decision, commercial bridge, "quick answers" type content) just **appear as additional H2s after the attribute sequence**. Do NOT add a "[Section break: Supplementary Content...]" header to the brief — it doesn't render on Koray-implemented sites and adds noise to the heading vector. The reader should see attribute H2s flow naturally into cross-cutting H2s into the closing.

Two acceptable placement strategies for supplementary content:

- **Strategy A (artistsinbusiness.com)**: Drill supplementary questions DOWN into the last attribute H2 as H3/H4 children. The last attribute becomes a catch-all for tangentially related questions.
- **Strategy B (thecoolist.com)**: Append additional H2s after the title's attributes, each its own question. Works when the supplementary topics are too prominent to nest as H3.

Pick the strategy that fits the page. Either way, no visual "Supplementary" marker.

- **List / table requirements** — where the page must include enumerations (types of X, list of Y). Specify completeness rules: "all 4 modifiers", "all states with these regulations".
- **First-image alt** — must contain central entity verbatim.
- **Last-paragraph close** — must mention central entity and link to the parent C-node.

### Section E — Internal-link plan

Specify the link relationships before writing:

- **Inbound links** — list at least 4 existing URLs that will link to this page on publication, with anchor text for each. Anchor text matches this page's H1/H2 (Q-form anchor rule).
- **Outbound links to siblings (lateral)** — 2–4 sibling I-nodes inside the same micro-cluster. Anchor text = destination's H2.
- **Outbound up to C-node** — exactly one link to the parent C-node, with the C-node's H1 as anchor.
- **Outbound to commercial counterpart (Contextual Bridge)** — if this is an informational page, link once to the commercial counterpart with appropriate anchor (e.g. "see our cardiology billing services"). And vice versa.
- **No links to redirects, 404s, or self.**

### Section F — E-E-A-T layer

Mandatory. The single highest-leverage LLM-presence and Quality-Threshold lever:

- **Author** — named, with credentials (RCM manager / certified coder / ASC director). Author bio block on the page with sameAs link to LinkedIn and any professional registry.
- **Reviewer** (for YMYL or technical content) — second named expert reviews and approves.
- **Date** — published date + last-updated date, both visible.
- **Citations** — at least three primary-source citations (AMA, CMS, AAPC, HHS, state Medicaid). Embedded inline, not piled at the bottom.
- **Original element** — a screenshot, a chart from internal data, a quote from an internal expert. Something no competitor has.
- **Schema stack** — Article + Person (author) + FAQ + Organization. For commercial pages add Service or MedicalBusiness or Product. For listicles add ItemList. Validate in Rich Results Test before publish.

### Section G — Writer-tone rules

Specific to Koray-aligned writing:

- **H1 = Title verbatim** for colon-list, comparison, and listicle titles. Only when the title is itself a question does the H1 stay Q-form. Never rewrite a declarative title as a question for H1.
- **H2/H3/H4 are question-form** — no decorative ones ("Best practices for…" is decorative; "What are the best practices for cardiology billing denials?" is Koray).
- Each H2/H3 answered in ≤ 60 words before any expansion (the Candidate Answer Passage).
- SPO triplets stated explicitly, multiple times — don't assume the engine infers them.
- No marketing language on informational / YMYL content (Hangikredi case Tier 3: removing CTAs and marketing language was the recovery lever).
- No "click here" / "learn more" anchor text.
- No first-image alt as "image1.jpg" — always entity-rich.

## Output deliverable

A Word document or Notion-pasteable Markdown with sections A–G in order. Use the docx skill when the user wants a Word file. The brief is the contract with the writer — be exhaustive on Section C (entity inventory) because that's where most briefs cut corners and where the page's topical-relevance score is determined.

A typical brief is 1,500–3,000 words.

## TFQT scorecard for the brief itself

Before delivering, score the brief against:

- **Leads.** If this is a commercial-intent URL, does the brief specify the lead-capture path (CTA placement, form, contact link)? Does it show the writer how to convert without violating the no-marketing-language rule for the informational sections?
- **LLM presence.** Does the brief require Person schema, named author, original element, citations? If any of those is missing, the brief will not produce an LLM-citable page.
- **Clicks / impressions.** Is the heading vector designed for both classical SERP (Featured Snippet, FAQ, People-Also-Ask coverage) and rich results (FAQ schema)?
- **Topical authority.** Does the brief require ≥ 80% entity coverage from the entity inventory? Does it specify the link-up to the parent C-node and lateral siblings?

## Common mistakes to avoid

- **Rewriting a declarative title as a Q-form H1.** Colon-list, comparison, and listicle titles map to H1 verbatim — never reformat to a question. Reference sites artistsinbusiness.com and thecoolist.com confirm this universally.
- **Collapsing every attribute H2 to a single paragraph.** This was an over-correction. Develop each attribute H2 with H3 (and H4 where needed) sub-questions, unless a dedicated grandchild URL already exists to own the depth.
- **Bottom-clustering booleans under a "quick answers" parent H2.** Booleans scatter through the body inside the relevant attribute section. Reference Koray-implemented sites never publish a bottom boolean cluster.
- **Adding a visual "Supplementary Section" header.** Cross-cutting H2s flow naturally after attribute H2s with no marker. The marker doesn't render on live Koray sites.
- **Skimping on Section C.** Most briefs are 80% Section D (on-page structure). The Koray brief is 30% A+B+C, 30% D, 40% E+F+G. The entity inventory does the heavy semantic lifting.
- **Omitting unique information gain.** A brief that doesn't tell the writer what the page must say *that no other source says* will produce a Quality-Threshold-failing page.
- **Decorative headings.** Any H2/H3/H4 that isn't a user question should be reworded. (H1 exception above for declarative titles.)
- **Vague E-E-A-T.** "Add an author bio" is not enough. Name the author, write the credentials, link the schema, draft the bio.
- **Pre-writing the meta description.** Write it last, after the unique information gain is decided.
