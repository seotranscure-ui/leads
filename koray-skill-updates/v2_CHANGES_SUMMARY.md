# Koray Skill Update v2 — Summary of Changes

**Date:** June 8, 2026
**Triggered by:** Chat-history review of MIPS Performance Categories, Quality, Cost, PI, IA briefs built across Macralytics project
**File to update:** `skills/koray-framework/references/semantic-brief-create.md`

## What changed and why

The skill file already had the Koray-v2 heading-vector rules (title=H1, intro 70-80 words, attribute H2s in title order, scattered booleans, no Supplementary marker). This update encodes the **brief-structure improvements** that emerged across the four MIPS category briefs — improvements I had to apply manually every time because they weren't in the skill.

### 20 manual improvements now encoded in the skill

| # | What I had to apply manually | Now encoded as |
|---|------------------------------|----------------|
| 1 | XLSX 9-sheet format (Cover / Section A-G / TFQT) | "Default output format — XLSX 9-sheet brief" section with sheet schema table |
| 2 | Cover sheet 20 metadata fields including title modification rationale | "Cover sheet — 20 metadata fields" with ordered list |
| 3 | Title decision process — when canonical query differs from topical-map title, modify | "Title decision process — modify or keep verbatim" section with worked PI example |
| 4 | Section D 11-column structure | "Section_D_HeadingVector — 11 columns" table |
| 5 | Contextual Flow recipe per row (WHAT THIS IS / OPENING / THEN COVER / FORMAT / NUMBERS / BOLD / LINK / DO NOT / END WITH) | "Section_D Contextual Flow recipe per row" subsection with template |
| 6 | Contextual Flow entries 600–1,800 chars, with literal drafts for Intros and Booleans | Length target + "when to provide a literal draft" list |
| 7 | Standalone Boolean H2 pattern (MVP-applicability boolean across all category briefs) | "Standalone Boolean H2 — for prominent booleans" subsection with use cases |
| 8 | Cross-cutting H2 pattern set for regulatory hubs (scoring/special-status/changes/decision/bridge/standalone) | "Cross-cutting H2 patterns for regulatory / category hubs" table |
| 9 | Worked numerical example required in scoring H2s | "Worked numerical examples — required in scoring H2s" subsection with template |
| 10 | Section B 4-subsection structure (primary / upstream / downstream / cousin) | Section B description expanded with subsection list |
| 11 | Section C tier-based table (UNIQUE / ROOT / RARE) with `Where to Place` column | Section C three sub-blocks described in detail |
| 12 | Section C SPO triplets 10–18 with year stamps | "Required SPO Triplets" sub-block spec |
| 13 | Section C Unique Information Gain 6–8 levers | "Unique Information Gain" sub-block spec |
| 14 | Section E inbound count (4–6) + outbound count (6–11) + anchor discipline 8 rules | Section E description expanded with discipline rules list |
| 15 | Section E closing-up-link duplicate allowance (same target/anchor as H2.1) | Encoded in anchor discipline rule #3 |
| 16 | Section F 10 fields including reviewer credential matching | Section F expanded with 10-field list |
| 17 | Section G 31 rules with GOOD vs BAD examples format | "Section_G_WriterRules — GOOD vs BAD examples per rule" subsection + 31-rule list |
| 18 | TFQT scorecard with Answer/Evidence/Risk-Mitigation columns + Verdict line | TFQT scorecard format spec |
| 19 | Pre-publish checklist 25–30 items per brief with bracketed substitutions | "Pre-publish checklist — 25–30 items per brief" section with template |
| 20 | Common mistakes catalogue 18–20 items (10 universal + 8–10 page-specific) | "Common mistakes catalogue" section split into universal + page-specific |

### What stayed the same

The Koray-v2 heading-vector rules from the previous update are preserved verbatim:
- Title format patterns (4 patterns: colon-list, comparison, listicle, question-form)
- H1 = title verbatim rule
- Intro 70-80 words, no header
- H3/H4 nesting under attribute H2s
- Boolean scattering pattern
- No Supplementary marker

The new file is a SUPERSET — it preserves everything that was right and adds what we evolved.

### File size

- Previous version: ~16 KB, 228 lines
- New v2 version: ~36 KB, ~520 lines

The size doubled mostly because of the XLSX template specification (a new major section) and the rule-by-rule details for Sections D, F, G.

## How to apply

The skill folder is on a read-only mount inside the Cowork sandbox — confirmed `-r-x------` permissions. Direct edit from this session is blocked. Apply manually:

### Option A — Full-file replace (recommended)

Open File Explorer (or PowerShell) and copy:

**From:** `D:\Danish\Claude\Projects\Transcure\koray-skill-updates\v2_semantic-brief-create.md`

**To (overwrite):** `C:\Users\muhammad.danish\AppData\Roaming\Claude\local-agent-mode-sessions\skills-plugin\36d7ac28-1bf2-4729-a6bd-237e91284bdd\74f2d0da-add8-4efa-8586-f28542b073af\skills\koray-framework\references\semantic-brief-create.md`

PowerShell one-liner:

```powershell
Copy-Item -Force "D:\Danish\Claude\Projects\Transcure\koray-skill-updates\v2_semantic-brief-create.md" "C:\Users\muhammad.danish\AppData\Roaming\Claude\local-agent-mode-sessions\skills-plugin\36d7ac28-1bf2-4729-a6bd-237e91284bdd\74f2d0da-add8-4efa-8586-f28542b073af\skills\koray-framework\references\semantic-brief-create.md"
```

### Option B — Verify before applying

Open the v2 file in your editor and scroll-compare against the live skill file. The big new additions are:

1. "Default output format — XLSX 9-sheet brief" (new major section, ~80 lines)
2. "Title decision process — modify or keep verbatim" (new section, ~25 lines)
3. "Section_D Contextual Flow recipe per row" (new subsection, ~40 lines)
4. "Standalone Boolean H2 — for prominent booleans" (new subsection, ~20 lines)
5. "Cross-cutting H2 patterns for regulatory / category hubs" (new subsection, ~25 lines)
6. "Worked numerical examples — required in scoring H2s" (new subsection, ~15 lines)
7. "Section_G_WriterRules — GOOD vs BAD examples per rule" with 31-rule list (new subsection, ~50 lines)
8. "Pre-publish checklist — 25–30 items per brief" (new section, ~30 lines)
9. "Common mistakes catalogue — 18–20 items per brief" (new section, ~25 lines)
10. "Reading order for writers" (new section, ~10 lines)
11. "Reference implementations" (new section, ~10 lines)

## Verification after applying

After overwriting:

1. Open the destination file in your editor.
2. Search for `"Default output format"` — should hit the new major section.
3. Search for `"Title decision process"` — should hit.
4. Search for `"Contextual Flow recipe per row"` — should hit.
5. Search for `"Standalone Boolean H2"` — should hit.
6. Search for `"Cross-cutting H2 patterns for regulatory"` — should hit.
7. Search for `"Pre-publish checklist"` — should hit.
8. Search for `"GOOD vs BAD examples per rule"` — should hit.

If all 7 searches hit, the update is live.

## Impact on next brief

The next time you ask me to build a semantic brief, I will:

1. **Automatically produce a 9-sheet XLSX** (not Markdown or Word) without you asking.
2. **Pull Ahrefs volume + KD** for the canonical query and decide whether to modify the title before locking it.
3. **Document the title modification rationale** on the Cover sheet.
4. **Populate every Section D row with the full Contextual Flow recipe** (WHAT THIS IS / OPENING SENTENCE / THEN COVER / FORMAT / NUMBERS / BOLD / LINK / DO NOT / END WITH).
5. **Add the standard cross-cutting H2 set** for category hubs (scoring + special-status + 2026 changes + decision + bridge + standalone Boolean).
6. **Add a worked numerical example** in any scoring H2.
7. **Populate Section G with 31 rules each having GOOD vs BAD examples**.
8. **Generate the 25–30 item pre-publish checklist** automatically with bracketed substitutions filled in.
9. **Generate the 18–20 item common-mistakes catalogue** with universal + page-specific entries.
10. **Include the "Reading guide for writers"** on the Cover sheet.

No more manual repetition of the patterns we evolved across the four briefs.

## Open question — also evolve other reference files?

The same evolution likely benefits these adjacent skill files (not changed in this update):

- `references/semantic-brief-review.md` — should mirror the new 9-sheet template for the review checklist.
- `references/topical-map-create.md` — could reference the title decision process when proposing slugs.
- `references/page-audit.md` — could use the same Pre-publish checklist as the audit baseline.

Tell me if you want me to roll these forward in a follow-up update, or leave them as-is until they're triggered.
