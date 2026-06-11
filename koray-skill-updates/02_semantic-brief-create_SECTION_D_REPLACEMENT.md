# Section D — On-page structure (REPLACEMENT)

Paste this entire block in place of the existing `### Section D — On-page structure` bullet-list in `references/semantic-brief-create.md`. Keep everything before and after this section intact.

---

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
