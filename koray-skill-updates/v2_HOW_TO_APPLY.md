# How to apply the koray-framework skill v2 update

## TL;DR

Copy `v2_semantic-brief-create.md` from this folder over the existing file in your skill plugin folder:

**Source (this folder):**
```
D:\Danish\Claude\Projects\Transcure\koray-skill-updates\v2_semantic-brief-create.md
```

**Destination (overwrite this):**
```
C:\Users\muhammad.danish\AppData\Roaming\Claude\local-agent-mode-sessions\skills-plugin\36d7ac28-1bf2-4729-a6bd-237e91284bdd\74f2d0da-add8-4efa-8586-f28542b073af\skills\koray-framework\references\semantic-brief-create.md
```

PowerShell one-liner:

```powershell
Copy-Item -Force "D:\Danish\Claude\Projects\Transcure\koray-skill-updates\v2_semantic-brief-create.md" "C:\Users\muhammad.danish\AppData\Roaming\Claude\local-agent-mode-sessions\skills-plugin\36d7ac28-1bf2-4729-a6bd-237e91284bdd\74f2d0da-add8-4efa-8586-f28542b073af\skills\koray-framework\references\semantic-brief-create.md"
```

That's it. The Cowork session has the plugin folder mounted read-only, so I couldn't write to it directly. Once you copy the file over, the new rules take effect on the next skill invocation.

## Why this update is needed

Across the MIPS briefs (Performance Categories v3, Quality v3, Cost v2, PI v1, IA v1), I had to manually apply the same 20+ patterns every time because the skill didn't encode them. The most-repeated patterns:

- The 9-sheet XLSX structure (vs the skill's "Word document or Notion-pasteable Markdown" default)
- The Cover sheet's 20 metadata fields including title modification rationale
- The Contextual Flow recipe per Section D row (WHAT THIS IS / OPENING SENTENCE / etc.)
- The cross-cutting H2 set for regulatory category hubs (scoring + special-status + changes + decision + bridge + standalone Boolean)
- The standalone Boolean H2 pattern (MVP applicability)
- The worked numerical example in scoring H2s
- The 31-rule Section G with GOOD vs BAD examples
- The 25–30 item pre-publish checklist
- The 18–20 item common-mistakes catalogue

These are now in the skill so the next brief produces them automatically without me re-applying each pattern.

## Verification after applying

After overwriting, you can verify the change is live by:

1. Open the destination file in any editor
2. Search for these section headings — all should be present:
   - `## Default output format — XLSX 9-sheet brief`
   - `## Title decision process — modify or keep verbatim`
   - `### Section_D Contextual Flow recipe per row`
   - `#### Standalone Boolean H2 — for prominent booleans`
   - `#### Cross-cutting H2 patterns for regulatory / category hubs`
   - `#### Worked numerical examples — required in scoring H2s`
   - `### Section_G_WriterRules — GOOD vs BAD examples per rule`
   - `## Pre-publish checklist — 25–30 items per brief`
   - `## Common mistakes catalogue — 18–20 items per brief`
   - `## Reading order for writers`
   - `## Reference implementations`

If all 11 sections are present, the update is live.

## What changed in this version

See `v2_CHANGES_SUMMARY.md` in this folder for the full change rationale, the 20-item improvement table, and the impact on the next brief.

## Files in this folder

- `v2_HOW_TO_APPLY.md` — this file
- `v2_CHANGES_SUMMARY.md` — full change rationale with the 20-improvement table
- `v2_semantic-brief-create.md` — complete updated file ready to overwrite the original

Use `v2_semantic-brief-create.md` for the simple copy-paste approach.

## Earlier update files (also in this folder, from prior round)

- `semantic-brief-create.md` — the previous Koray-v2 heading-vector update (already applied; superseded by v2)
- `02_semantic-brief-create_SECTION_D_REPLACEMENT.md` — earlier section-only patch
- `01_CHANGES_SUMMARY.md` — earlier change summary
- `HOW_TO_APPLY.md` — earlier apply guide

These can be archived once v2 is applied — they're preserved for history but no longer needed.
