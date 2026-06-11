# How to apply the koray-framework skill update

## TL;DR

Copy `semantic-brief-create.md` from this folder over the existing file in your skill plugin folder:

**Source (this folder):**
```
D:\Danish\Claude\Projects\Transcure\koray-skill-updates\semantic-brief-create.md
```

**Destination (overwrite this):**
```
C:\Users\muhammad.danish\AppData\Roaming\Claude\local-agent-mode-sessions\skills-plugin\36d7ac28-1bf2-4729-a6bd-237e91284bdd\74f2d0da-add8-4efa-8586-f28542b073af\skills\koray-framework\references\semantic-brief-create.md
```

That's it. The Cowork session has the plugin folder mounted read-only, so I couldn't write to it directly. Once you copy the file over, the new rules take effect on the next skill invocation.

## Why this is needed

The skill folder is on a read-only mount inside the Cowork sandbox (`-r-x------` permissions). Editing requires write access from your host Windows shell.

## Verification after applying

After overwriting, you can verify the change is live by:

1. Open the destination file in any editor
2. Look for `### Section D — On-page structure`
3. Confirm it contains the new subsections:
   - `#### Heading-vector pattern by title format`
   - `#### H3/H4 nesting under attribute H2s`
   - `#### Boolean question placement (Koray-aligned: scattered, not clustered)`
   - `#### Supplementary content — no visual marker`

If those four subsections are present under Section D, the update is live.

## What changed in this version

See `01_CHANGES_SUMMARY.md` in this folder for the full diff with evidence from artistsinbusiness.com and thecoolist.com.

In short, four rules were updated based on a live-site analysis:

1. **H1 = Title verbatim** for colon-list, comparison, and listicle titles (not Q-form)
2. **Develop attribute H2s with H3/H4** — don't collapse to one paragraph (unless dedicated child URL exists)
3. **Booleans scatter through the body** inside relevant attribute sections — not bottom-clustered
4. **No visual "Supplementary Section" marker** — cross-cutting H2s just flow

Plus updates to Section G (writer-tone rules) and "Common mistakes to avoid" so they reflect the new H1 rule.

## Files in this folder

- `HOW_TO_APPLY.md` — this file
- `01_CHANGES_SUMMARY.md` — full change rationale with site evidence
- `02_semantic-brief-create_SECTION_D_REPLACEMENT.md` — section-only patch (alternative to the full-file copy)
- `semantic-brief-create.md` — complete updated file ready to overwrite the original

Use `semantic-brief-create.md` for the simple copy-paste approach. Use the SECTION_D_REPLACEMENT file if you'd rather hand-merge just the changed section.
