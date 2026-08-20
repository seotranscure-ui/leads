import { useAppData } from '../data/AppData'
import { stageByName } from '../lib/projects'

/**
 * Stage badge coloured from the active project's funnel config.
 *
 * Replaces the old `className={'chip stage-' + stage}` approach, which relied on
 * a CSS class per stage name (.stage-Won, .stage-Lost, …). Those only existed for
 * the original pipeline, so any project with different stage names rendered
 * unstyled chips. Reading the colour from config means new stages need no CSS.
 */
export default function StageChip({ stage }: { stage: string | null | undefined }) {
  const { funnel } = useAppData()
  if (!stage) return null

  const cfg = stageByName(funnel, stage)
  // A stage not in the current config (e.g. left over from an earlier mapping)
  // still renders, just in the neutral chip style.
  if (!cfg) return <span className="chip">{stage}</span>

  return (
    <span className="chip" style={{ background: cfg.color + '22', color: cfg.color, fontWeight: 700 }}>
      {stage}
    </span>
  )
}
