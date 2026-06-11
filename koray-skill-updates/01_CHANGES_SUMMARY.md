# Koray Skill Update — Summary of Changes

**Date:** May 18, 2026
**Triggered by:** Analysis of artistsinbusiness.com and thecoolist.com (both Koray-implemented reference sites)
**File to update:** `skills/koray-framework/references/semantic-brief-create.md`

## What changed and why

Four rules in our skill diverged from what Koray actually publishes on his live reference sites. After crawling 8 pages across two Koray-implemented sites, we updated the skill to match the live pattern.

### Change 1 — H1 rule by title format (NEW explicit rules)

**Was:** "H1 — question-form, restates the canonical query."

**Now:** H1 = Title verbatim for colon-list, comparison, and listicle titles. Only when the title itself is a question does H1 stay Q-form.

**Evidence:** Every page on artistsinbusiness.com and thecoolist.com renders H1 as the title verbatim — never rewritten into question form. Examples:
- Title "Success Coaching: Definition, Programs, Process, Importance, and History" → H1 same exact string
- Title "Business Coaching vs. Mentoring: Definition, Purpose, Objective, and Qualifications" → H1 same
- Title "15 Top Business Coaches in the World" → H1 same
- Title "Life Path Number 1 (Leader and Pioneer) Meaning, Traits, and Relationships" → H1 same

### Change 2 — H3/H4 nesting under attribute H2s (REVERSED previous rule)

**Was:** "Each attribute H2 = one tight paragraph (180–220 words). NO H3 under attribute H2s — children own the depth."

**Now:** Develop each attribute H2 with H3 (and H4 where needed) sub-questions. Keep the tight-block exception ONLY when a dedicated grandchild URL exists for the attribute.

**Evidence:** artistsinbusiness.com "Success Coaching" page shows the canonical execution:

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

Every attribute H2 gets developed, not collapsed to a paragraph + hand-off.

### Change 3 — Booleans scatter throughout, not clustered at bottom (REVERSED previous rule)

**Was:** "Boolean H3s sit at the BOTTOM under a 'quick answers' parent H2. Bottom cluster opened by a real parent question."

**Now:** Boolean H3/H4/H5 scatter throughout the article inside the relevant attribute section, where contextually appropriate. Prominent booleans can even occupy H2 level.

**Evidence:**
- "Is Coaching Considered the Same as Leadership?" → H4 inside Coaching definition H2 on coaching-vs-leadership page
- "Do Leaders Need a Coach?" → H4 inside Leadership Responsibilities H3
- "Is a Business Mentor Cheaper Than a Business Coach?" → H5 inside Similarities H3 inside Qualifications H2 (4 levels deep!)
- "Does life path number 1 have an old soul?" → H2 on thecoolist.com (not nested at all)
- "Is life path number 1 lucky?" → H2 on thecoolist.com

There is no bottom-cluster pattern on any Koray-implemented page we observed.

### Change 4 — No "Supplementary Section" marker (REMOVED)

**Was:** "Supplementary section begins after attribute H2s — add a section break heading row in Section D of the brief."

**Now:** Cross-cutting H2s just flow naturally after attribute H2s. No visual marker. Two acceptable strategies:
- **Strategy A** (artistsinbusiness): Drill supplementary questions DOWN into the last attribute H2 as H3/H4 children. Last attribute becomes a catch-all.
- **Strategy B** (thecoolist): Append additional H2s after the title's attributes.

**Evidence:** Zero pages on either site have a "Supplementary" header or visual break. The content just continues.

### Decision held — no required Table of Contents

We considered requiring a visible TOC between intro and H2s (which artistsinbusiness.com renders). Decision: NOT required. thecoolist.com doesn't render visible TOCs, so it's optional rather than universal Koray practice.

## How to apply

1. Open the live skill file at `C:\Users\muhammad.danish\AppData\Roaming\Claude\local-agent-mode-sessions\skills-plugin\36d7ac28-1bf2-4729-a6bd-237e91284bdd\74f2d0da-add8-4efa-8586-f28542b073af\skills\koray-framework\references\semantic-brief-create.md`
2. Locate the section starting with `### Section D — On-page structure`
3. Replace the entire bullet-list block under that heading (about 9 bullet points covering URL, Title, Meta description, H1, Initial Contact, Heading vector, List/table requirements, First-image alt, Last-paragraph close) with the contents of file `02_semantic-brief-create_SECTION_D_REPLACEMENT.md` in this folder.
4. Save the file.

The patch only touches Section D. Section A (when to run this), Sections B/C/E/F/G content, the TFQT scoring at the end, the common mistakes list — none of those need changes.

## Impact on previously created briefs

The four MIPS briefs already produced (`Semantic_Brief_MIPS_Performance_Categories_v3.xlsx`, `Semantic_Brief_MIPS_Quality_v1.xlsx`, `Semantic_Brief_MIPS_Cost_v1.xlsx`) all use the OLD rules:
- ✅ Title-as-H1 is correct (this part already matched Koray)
- ✅ Intro paragraph under H1 is correct
- ❌ Each attribute H2 is one tight paragraph with no H3 — Koray would develop these fully
- ❌ Boolean cluster is a parent H2 + 5 booleans at the bottom — Koray would scatter
- ❌ Section D has a `[Section break: Supplementary Content...]` row — should be removed

**Recommendation:** Future MIPS briefs use the new rules. For the existing three briefs, you can either:
- Rebuild them with the new rules (cleaner, but means re-doing 3 files)
- Leave them as-is since the MIPS context has deep grandchild URLs for every subtopic and the "tight + hand-off" pattern IS defensible when child pages exist. Document the divergence and move on.

My recommendation: leave the three existing MIPS briefs as-is (they use the tight pattern justifiably because children exist) but apply the new Koray-aligned rules for any brief where the cluster does NOT have deep children yet.
