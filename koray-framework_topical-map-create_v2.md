# Workflow — Create a topical map

A topical map is the pre-publish blueprint of every URL the site needs to publish to cover its knowledge domain exhaustively. Done well, it is decided in a spreadsheet before any content is written. Done badly, it is invented page-by-page after content goes live.

## When to run this

The user wants a topical map for a brand, product, or vertical. Phrasings: "build me a topical map for X", "what should we publish on X", "plan out the content for our medical billing site", "I'm starting a site about X".

## Inputs you need (ask if not provided)

Use AskUserQuestion to fill blanks, max three questions per batch:

1. **Source Context statement.** One sentence: what is the source for, from the user's perspective?
2. **Central Entity** at the apex.
3. **Priority axes.** For B2B/SaaS: industries × problems. For local services: states × cities × specialties. For e-commerce: categories × attributes. For publishers: pillars × intent templates.
4. **Existing site (if any).** URL + sitemap. The map you produce must merge with what already exists, not replace it.
5. **Target language(s) and locale(s).** Multilingual symmetry matters.
6. **Excluded territories.** What's explicitly out of Source Context (e.g., for Transcure: clinical-care content, doctor reviews, medical advice).

Stop and ask if the user hasn't named the Source Context — the whole map collapses without it.

## Step-by-step

### Step 1 — Define the apex

Write three artifacts in this exact order:

1. **Source Context statement.** One sentence, present tense. *"Transcure operates end-to-end medical billing, credentialing and revenue-cycle services for U.S. physician practices and ambulatory surgery centers."*
2. **Central Entity.** A single named entity, ideally resolvable in Wikipedia or Wikidata. *"Medical billing"* (informational layer apex) and *"Medical billing services"* (commercial layer apex).
3. **Topical Borders.** Two lists: what's IN, what's OUT. *In: billing workflows, codes, modifiers, denials, EMR integration, RCM analytics, credentialing, ASCs, practice management. Out: clinical care, drug information, patient-facing content, doctor reviews, malpractice topics.*

### Step 2 — Enumerate the contextual vectors

A contextual vector is an axis along which the central entity can be expanded. Typical vectors for any vertical:

- **Specialty / sub-vertical** (cardiology, orthopedics, dental — for medical billing)
- **Geography** (state, city, county)
- **Software / tool integration** (eClinicalWorks, Athena, Kareo)
- **Process / workflow stage** (eligibility, charge entry, denials, AR follow-up)
- **Code system** (CPT, HCPCS, ICD-10, modifiers)
- **Customer profile** (solo practitioner, group practice, ASC, hospital-employed)
- **Special status / regulatory** (small-practice, rural, hardship, EUC, exemptions)

Pick 4–8 vectors. Resist the urge to add more — vectors multiply, and each additional vector is N more URLs to publish.

### Step 3 — Cross intent templates with each entity / attribute node

For every entity in the map, multiply by intent templates:

- **What is X?** (informational)
- **How does X work / How to do X?** (informational, procedural)
- **Types of X** (informational, enumerative)
- **X codes / modifiers / list of Y in X** (informational, reference)
- **X for [audience / specialty / state / EMR]** (commercial-modified)
- **Best X provider / X services** (commercial)
- **X in [city / state]** (commercial-local)
- **X vs Y** (comparative)
- **X pricing / cost of X** (transactional-research)

Not every entity needs every intent — kill intents the entity doesn't naturally take. Prefer fewer, deeper URLs over many shallow ones. Koray's benchmark from /theoretical-seo/topical-authority/: *"For telescopes maybe 300 articles is enough; for electric cars even 4,000 might not suffice."*

### Step 4 — Decide the URL structure (do this before naming any slug)

URL structure is not cosmetic — it encodes the topical graph that Google reads as your site architecture. Apply these rules in order:

**1. Hierarchical nested paths.** Slugs reflect the topical hierarchy. `/qpp/mips/categories/quality/measures/` — not flat `/mips-quality-measures-list/`. The path *is* the breadcrumb. Each segment is a Wikidata-resolvable concept.

**2. Hub-as-definition.** The hub URL itself answers "what is X". `/qpp/mips/` IS the "what is MIPS" page. Do **not** create a separate `/qpp/mips/what-is-mips/`. That split fragments Historical Data across two URLs that target the same intent.

**3. Sub-folder hubs by relationship type.** Group leaves by what they have in common, not by what they are:
- `/categories/` for performance / taxonomy categories
- `/reporting/` for reporting methods
- `/specialty/` for specialty-segmented pages
- `/audience/` for practice-type / customer-profile pages
- `/integrations/` for software / tool pages
- `/special-statuses/` for regulatory exemption pages
- `/audits/` for compliance / review pages
- `/performance-year/` for year-stamped content

Each sub-folder is itself a C-node hub with its own canonical query and Q-form H2s.

**4. Two parallel trees with bridges.** Knowledge tree at `/{topic}/...` (informational), service tree at `/{topic}/services/...` or `/services/{topic}/...` (commercial). They link to each other via Q-form anchors but never duplicate URLs. The Source Context determines which tree is the "main" one.

**5. Brand pages at root.** `/`, `/about/`, `/contact/`, `/case-studies/` live at the top of the URL tree. They link into both knowledge and service trees.

**6. Year-specific content under a year hub.** Year-stamped URLs go at `/{topic}/performance-year/2026/`, not at root. Keeps the evergreen hub clean and lets the year page compound its own Historical Data without polluting the parent.

**7. Comparison pages get their own URL inside the relevant cluster.** `/qpp/mips/mips-vs-apm/`, `/qpp/mips/reporting/qcdr-vs-registry/`. A comparison is a distinct intent layer — it earns a canonical URL.

**8. Slug naming discipline.** Kebab-case, no trailing slash variations, no redundant prefixes (don't repeat the parent name in the slug — `/qpp/mips/mips-eligibility/` should be `/qpp/mips/eligibility/` or simply `/qpp/mips/criteria/`), and no stop-words unless they're the canonical phrase ("vs" stays).

**9. Reachability rule.** Every leaf must be reachable from `/` (S-node) in ≤ 3 hops via C-node hubs. If a slug needs 4+ segments, the structure is wrong — add an intermediate hub or merge two sibling clusters.

### Step 5 — Produce the URL list

Output a table (CSV / XLSX / Word table) with this exact column set:

| Column | Description |
|---|---|
| Topics | Cluster name (e.g. "MIPS Categories", "Specialty MIPS"). Used for filtering / grouping. |
| Parent URL Slug | Explicit parent C-node — the slug this URL hangs from. `-` for the brand root, `/` for top-level URLs. |
| Title (60 ch) | SEO title, ≤ 60 characters. Q-form preferred for I-nodes. |
| Slug | Final URL path. Hierarchical, kebab-case. No trailing slash variations. |
| Meta Description (130 ch) | ≤ 130 characters. Sells the click. |
| Image URL | Hero/cover image path. `/images/{slug}cover.jpg` is a fine default placeholder. |
| Image Alt | Descriptive alt text — names the central entity. Not a keyword stuffing field. |
| Central Entity | The single named entity at this URL. Ideally Wikidata-resolvable. |
| Entity Type | Government Program / Performance Category / Reporting Method / Service / Specialty / etc. Helps schema selection later. |
| Canonical Query | The single query this URL is the authoritative answer to. Quote it. |
| Query Template Class | Which intent template from §3: "What is X", "How to X", "Types of X", "X vs Y", "Best X for Z", "Pricing", etc. |
| Intent | Informational / Commercial / Transactional / Comparison / Navigational. |
| Core H2s Question Form | 3–5 Q-form H2s separated by " / ". These ARE the writer's outline AND the LLM citation hooks. |
| S-node links (slug, anchor) | **Sibling links** — lateral peers within the same micro-cluster. Format: `/slug/ (anchor text); /slug/ (anchor text)`. |
| C-node links (slug, anchor) | **Up-and-bridge links** — UP to the category hub AND across to the commercial `/services/` tree. Same format. |
| I-node links (slug, anchor) | **Lateral / down to other I-nodes** — cross-cluster information links that build Contextual Bridges. Same format. |
| Incoming links (from slugs) | Which existing or planned URLs will link IN to this one. Comma-separated slugs. |
| Wave | Publishing wave 1 / 2 / 3 / 4 (see §7). |
| Schema | Article / FAQPage / ItemList / MedicalBusiness / Service / Person / etc. Stacked, not single. |
| E-E-A-T author | Named credentialed author. Drives Person schema and LLM citation. |
| Notes | Source Context border check, special facts, dependencies on other URLs. |

A complete map for medium-complexity B2B (e.g., medical billing, QPP/MIPS) typically lands at 100–250 URLs across 5–7 vectors with proper hub-as-definition compression. Without compression (i.e., if you naively spawn a `/what-is-X/` for every entity) the same map balloons to 200–400 URLs and starves Historical Data. The Kanbanize case study cites *"Over 200 content briefs"* for a B2B SaaS topical authority build (Tier 1 evidence — see framework-fundamentals.md).

### Step 6 — Build the S/C/I link graph

For every URL in the table, decide three link relationships and capture each as `slug (anchor)` so anchor-text is data, not an afterthought:

- **S-node links — lateral siblings.** Each I-node links to 2–4 sibling I-nodes inside the same micro-cluster. This is the Contextual Bridge between peers — at least 3 bridges per cluster pair.
- **C-node links — up to category hub + commercial bridge.** Each I-node links UP to its parent C-node, and crosses over to the commercial counterpart in `/services/...`. The commercial bridge is what makes the Outer Section earn leads.
- **I-node links — cross-cluster information links.** Lateral or downward links to information leaves in adjacent clusters (e.g., a Specialty page links DOWN to the Quality measures list). These bridge two contextual sub-graphs.

**Anchor-text discipline (now enforced at planning time):**

- Anchor text matches the destination's H2 verbatim where possible (Q-form anchors).
- Never the same anchor for two different targets.
- Never two different anchors for the same target.
- Capture the anchor in the link-column cell — the format `/slug/ (anchor text)` makes the rule visible during review.

**SCC convention summary** (memorise — workflows use these terms inconsistently otherwise):

| Notation | Means | Example link from `/qpp/mips/categories/quality/` |
|---|---|---|
| **S-node** (in a link column) | Lateral sibling — peer I-node in the same micro-cluster | `/qpp/mips/categories/cost/`, `/qpp/mips/categories/pi/` |
| **C-node** (in a link column) | UP to category hub + bridge to commercial tree | `/qpp/mips/categories/`, `/qpp/services/measure-selection/` |
| **I-node** (in a link column) | Cross-cluster information link | `/qpp/mips/reporting/registry/` (different cluster, lateral info) |

(Note: "S-node" in the *Strongly Connected Components* sense still refers to the **Source** node — the homepage. The link-column usage above is a column-naming convention from the spreadsheet and does NOT redefine SCC theory. Use the table to disambiguate.)

### Step 7 — Sequence the publishing waves

Four waves, in this order. The first three are mandatory; Wave 4 is held until Historical Data confirms the cluster is earning.

- **Wave 1 — Foundation.** Brand root (`/`, `/about/`, `/contact/`) + apex C-node hubs + the canonical I-node for every priority entity + 5–10 commercial service hubs/leaves so leads can be earned from day one. Ship as a **single big-bang launch**. Koray's IstanbulBogaziciEnstitu case ships an entire network on a single day (Tier 3 evidence) and outranks the historical-data deficit. Staggered Wave 1 launches consume the freshness budget twice and underperform.
- **Wave 2 — Density.** Fill each cluster — every attribute, every intent variant for the priority entities. Specialty matrix, audience matrix, integrations matrix, reporting-method leaves, exception/audit/review pages, comparative pages. This is where the Topical Coverage half of the formula is built.
- **Wave 3 — Borders / Reference catalogs.** Reference-grade lists (full measure / code / pathway lists), benchmarks methodologies, year-specific hubs, niche audience pages. These are long-tail magnets — high effort per URL, payoff arrives once the parent cluster has accumulated 6+ months of Historical Data.
- **Wave 4 — Deep / FAQ / glossary / sub-leaves.** Glossary, master FAQ, calculator/tool pages, deep-dive sub-leaves under priority I-nodes. **Hold Wave 4 until GSC shows the parent cluster is ranking and earning clicks.** Publishing Wave 4 too early dilutes Historical Data across pages competitors won't even index.

The right call for many engagements is: launch Waves 1+2 together, hold Wave 3 for 6 months and prioritize from GSC, defer Wave 4 indefinitely until the parent cluster is winning.

### Step 8 — Assign E-E-A-T and schema

For each URL, name a credentialed author (E-E-A-T) and the schema stack:

- All pages: Article + Organization
- Service / commercial pages: + Service / MedicalBusiness / Product as relevant
- Informational pages: + FAQ
- Listicle pages: + ItemList (and Review only when the listicle is genuinely a comparison, not a vendor's ad)
- Author pages: + Person with sameAs links to LinkedIn / professional registry

Person schema is the single highest-leverage LLM-citation lever. Skipping it is the most common quality-floor failure.

## Output deliverable format

Produce two artifacts:

1. **A Word document** containing: the apex (Source Context, Central Entity, Borders), the contextual vectors, the URL-structure strategy summary, the wave plan, the S/C/I model, and the rationale.
2. **An XLSX** with at least four sheets:
   - `Apex_and_Borders` — Source Context, Central Entity (informational + commercial apex), Borders IN/OUT, contextual vectors, wave logic, anchor-text rule, internal-link rule, SCC convention.
   - `Topical_Map` — the URL table from Step 5 with the full column set. Color-code by Wave. Filter-ready.
   - `Wave_Summary` — count + description per wave.
   - `URL_Strategy` — the URL-structure rules from Step 4 captured as a reference sheet so the team applies them consistently to future expansions.

Use the docx and xlsx skills to format these. The Word doc is the briefing leadership reviews; the spreadsheet is the work-order content / SEO ops execute against.

## TFQT scorecard for the map (always include)

Score the proposed map against:

- **Leads.** Does the map prioritise commercial / commercial-local URLs in the priority specialties? If the map is 80% informational, it will not earn leads. Aim for 25–35% commercial URLs (the Outer Section still has to dominate by count, but the commercial layer must be present in Wave 1).
- **LLM presence.** Are the canonical informational URLs deep enough (1500+ words, citations, FAQ schema, Q-form H2s) to be the most-citable single source per query? Hub-as-definition pattern improves citation precision because there's one canonical URL per intent.
- **Clicks / impressions.** Is the keyword density of the map calibrated to the addressable search volume? If the priority queries don't have search volume, the map will not earn clicks.
- **Topical authority.** Does the map saturate the topical graph for the priority vector × intent matrix? Coverage must be near-complete or the framework underperforms.

## Quality checklist before delivering

- [ ] Source Context statement written in one sentence, present tense.
- [ ] Topical Borders explicit (in / out lists).
- [ ] 4–8 contextual vectors named.
- [ ] URL structure follows the 9 rules in Step 4 (hierarchical, hub-as-definition, relationship-based sub-folders, parallel trees, brand at root, year-hub, comparison URLs, slug discipline, ≤ 3-hop reachability).
- [ ] Every URL has Parent URL Slug, Title (≤ 60 ch), Meta (≤ 130 ch), Image URL/Alt, Central Entity, Entity Type, Canonical Query, Query Template Class, Intent, Q-form H2s, schema plan, author, Wave.
- [ ] Every link cell is in `slug (anchor)` format.
- [ ] No duplicate slugs. Every Parent URL Slug resolves to a slug that exists in the same sheet (no orphans).
- [ ] Every I-node is reachable from S in ≤ 3 hops via C-node.
- [ ] Anchor-text discipline noted for the publishing team (Q-form, no duplicate anchors per target, no shared anchors across different targets).
- [ ] Four waves sequenced with a single big-bang Wave 1.
- [ ] TFQT scorecard included.
- [ ] No URL violates Source Context.

## Common mistakes to avoid

- **Building a map without a Source Context statement.** Every other decision unravels.
- **Using too many vectors.** Each new vector multiplies URL count. Five vectors at five attributes = 25 URLs; six vectors = 36; seven = 49. Pick the four that matter most.
- **Skipping the intent split.** Producing one URL per entity collapses the informational/commercial layers. Build both — but as parallel trees with bridges, not as duplicate URLs.
- **Forgetting the Outer Section.** Most "topical maps" people send to leadership are commercial-only. The Outer Section (definitional / educational content) is what builds the Topical Coverage half of the formula.
- **Flat slugs.** `/mips-quality-measures-list/` instead of `/qpp/mips/categories/quality/measures/`. Flat slugs hide the topical graph from Google and force readers to re-derive hierarchy from breadcrumbs that don't exist.
- **Spawning a `/what-is-X/` for every entity.** Use hub-as-definition: `/qpp/mips/` IS the "what is MIPS" page. The split URL fragments Historical Data and competes with itself.
- **Inventing anchor text at write time.** If the link cell isn't in `slug (anchor)` format, writers default to "click here" or "read more". Capture the anchor in the plan.
- **Slug repetition with the parent.** `/qpp/mips/mips-eligibility/` is wrong; the correct slug is `/qpp/mips/eligibility/` (or, better, `/qpp/mips/criteria/`). Repeating the parent in the leaf slug bloats URLs and signals weak hierarchy.
- **Year-stamping the parent hub.** Don't put `/qpp/mips-2026/` at the cluster root. The hub is evergreen; year-specific content lives under `/qpp/mips/performance-year/2026/`.
- **Publishing Wave 1 in dribs and drabs.** Big-bang launches outperform staggered launches in Koray's case studies (IstanbulBogaziciEnstitu). The freshness budget is consumed once per cluster.
- **Shipping Wave 4 with Wave 1.** Wave 4 (FAQ, glossary, deep sub-leaves) only earns its keep after the parent cluster has accumulated Historical Data. Publishing too early dilutes signal across pages no one is searching for yet.
