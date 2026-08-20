# SEO Intern Evaluation

`seo-intern-quiz.html` — a single-file assessment for an SEO intern after ~2 months on
on-page, off-page and technical SEO.

## Running it

No server, no install. Double-click the file, or:

```bash
open assessments/seo-intern-quiz.html        # macOS
xdg-open assessments/seo-intern-quiz.html    # Linux
start assessments\seo-intern-quiz.html       # Windows
```

Everything runs in the browser tab. Nothing is uploaded; progress is kept in that
browser's localStorage so an accidental refresh does not lose the attempt.

## Structure

| Part | Content | Scoring |
|---|---|---|
| A — Knowledge | 46 multiple-choice questions: On-Page (12), Off-Page (11), Technical (15), Tools & Analytics (8) | Auto-scored, 70% of the final mark |
| B — Applied judgement | 5 written scenarios: traffic-drop triage, a page stuck on page two, link-prospect qualification, audit prioritisation, client communication | Reviewer scores each 0–5 against an on-screen rubric, 30% of the final mark |

Options are shuffled on every attempt, so the correct answer is never in a fixed
position and two candidates do not see the same order.

Time guide: 45 minutes. The timer counts down and then counts up in red — it never
locks the candidate out, but the time used is recorded on the result sheet.

## Bands

| Final | Band |
|---|---|
| 85–100 | Exceeds expectations |
| 70–84 | Meets expectations |
| 55–69 | Developing |
| below 55 | Below expectations |

Until Part B is graded, the headline number is a provisional Part A score.

## Reviewer workflow

1. Fill in candidate name + reviewer, hand over the laptop, closed book.
2. Intern completes Part A and Part B and hits **Submit & score**.
3. Reviewer reads each Part B answer with its rubric visible and picks 0–5. The final
   score, band and section breakdown update live.
4. The result page produces a per-section read (Strong / Adequate / Gap), a four-week
   focus plan generated from the weakest sections, and a list of questions to walk
   through in the 1:1.
5. **Download result file** saves a plain-text record (scores, written answers, every
   wrong answer with the correct one and the reasoning). **Print / save as PDF** gives a
   clean printable version. Keep one of those for the review file — the browser copy
   is discarded on **New attempt**.

## Editing the questions

The bank lives in the `QUESTIONS` array inside the file. Each entry is
`{s: section, q: stem, o: [options], a: index of the correct option, why: explanation}`.
`OPEN` holds the five written prompts and their rubrics. Section names, weights and
the band thresholds are all at the top of the script block.
