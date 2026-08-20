import { useEffect, useState } from 'react'
import { useAppData } from '../data/AppData'
import { remapStages } from '../lib/api'
import { stageForIn, type FunnelConfig, type FunnelStage } from '../lib/projects'

const BLANK: FunnelStage = { name: '', color: '#94a3b8', reachedDemo: false, won: false, lost: false, statuses: [] }

/**
 * Per-project funnel editor: the ordered stages, their colours, which count as
 * demo-reached / won / lost, and the CRM statuses that map onto each.
 *
 * Stage is stored on each lead rather than derived on read, so saving a changed
 * mapping offers to re-map existing leads — otherwise old rows keep their old
 * stages and the numbers silently disagree with the configuration.
 */
export default function FunnelEditor() {
  const { project, funnel, updateProject, refresh } = useAppData()
  const [stages, setStages] = useState<FunnelStage[]>(funnel.stages)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  // Reset the draft when the workspace changes.
  useEffect(() => { setStages(funnel.stages); setMsg(null) }, [project.id, funnel])

  const set = (i: number, patch: Partial<FunnelStage>) =>
    setStages((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))

  const move = (i: number, dir: -1 | 1) => setStages((prev) => {
    const j = i + dir
    if (j < 0 || j >= prev.length) return prev
    const next = [...prev]
    ;[next[i], next[j]] = [next[j], next[i]]
    return next
  })

  const remove = (i: number) => setStages((prev) => prev.filter((_, idx) => idx !== i))
  const add = () => setStages((prev) => [...prev, { ...BLANK }])

  const validate = (): string | null => {
    const names = stages.map((s) => s.name.trim())
    if (names.some((n) => !n)) return 'Every stage needs a name.'
    if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) return 'Stage names must be unique.'
    if (!stages.some((s) => s.won)) return 'Mark exactly one stage as the Won stage — sales and revenue depend on it.'
    if (stages.filter((s) => s.won).length > 1) return 'Only one stage can be the Won stage.'
    if (stages.filter((s) => s.lost).length > 1) return 'Only one stage can be the Lost stage.'
    if (!stages.some((s) => s.lost)) return 'Mark one stage as the Lost stage — auto-marking Lost needs somewhere to move leads to.'
    // A status mapped to two stages would make stageFor ambiguous.
    const seen = new Map<string, string>()
    for (const s of stages) {
      for (const raw of s.statuses) {
        const st = raw.trim().toLowerCase()
        if (!st) continue
        const owner = seen.get(st)
        if (owner) return `Status "${st}" is mapped to both ${owner} and ${s.name.trim()}.`
        seen.set(st, s.name.trim())
      }
    }
    return null
  }

  const save = async () => {
    const bad = validate()
    if (bad) { setMsg({ kind: 'err', text: bad }); return }
    setBusy(true); setMsg(null)
    const clean: FunnelConfig = {
      stages: stages.map((s) => ({
        ...s,
        name: s.name.trim(),
        statuses: s.statuses.map((x) => x.trim().toLowerCase()).filter(Boolean),
      })),
    }
    try {
      await updateProject({ funnel: clean })
      const n = await remapStages(project.id, (status) => stageForIn(clean, status))
      await refresh()
      setMsg({
        kind: 'ok',
        text: n
          ? `Funnel saved. ${n} lead${n === 1 ? '' : 's'} moved to a different stage under the new mapping.`
          : 'Funnel saved. No lead changed stage.',
      })
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  const dirty = JSON.stringify(stages) !== JSON.stringify(funnel.stages)

  return (
    <div className="card" style={{ maxWidth: 860 }}>
      <p className="small muted" style={{ marginTop: 0 }}>
        The pipeline for <b>{project.name}</b>. Order sets how the Funnel page draws the bars.
        <b> Demo?</b> marks the stages that count toward Leads→Demos. <b>Won</b> drives sales and revenue;
        <b> Lost</b> is where auto-marked leads go. <b>Statuses</b> are the CRM values that land a lead on that
        stage — one per line, case-insensitive.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {stages.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, padding: '9px 11px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <button className="btn ghost" style={{ padding: '0 6px', fontSize: 11, lineHeight: 1.5 }}
                      disabled={i === 0} onClick={() => move(i, -1)} title="Move up">▴</button>
              <button className="btn ghost" style={{ padding: '0 6px', fontSize: 11, lineHeight: 1.5 }}
                      disabled={i === stages.length - 1} onClick={() => move(i, 1)} title="Move down">▾</button>
            </div>

            <input value={s.name} onChange={(e) => set(i, { name: e.target.value })}
                   placeholder="Stage name" style={{ width: 130, fontWeight: 600 }} />

            <input type="color" value={s.color} onChange={(e) => set(i, { color: e.target.value })}
                   title="Bar and badge colour"
                   style={{ width: 38, height: 34, padding: 2, border: '1px solid var(--line)', borderRadius: 8, background: '#fff' }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11.5, fontWeight: 600, color: 'var(--muted)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <input type="checkbox" checked={s.reachedDemo} onChange={(e) => set(i, { reachedDemo: e.target.checked })} /> Demo?
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <input type="checkbox" checked={s.won}
                       onChange={(e) => setStages((prev) => prev.map((x, idx) => ({ ...x, won: idx === i ? e.target.checked : false })))} /> Won
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <input type="checkbox" checked={s.lost}
                       onChange={(e) => setStages((prev) => prev.map((x, idx) => ({ ...x, lost: idx === i ? e.target.checked : false })))} /> Lost
              </label>
            </div>

            <label style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.3px', color: 'var(--muted)', fontWeight: 700 }}>
              CRM statuses
              <textarea rows={3} value={s.statuses.join('\n')}
                        onChange={(e) => set(i, { statuses: e.target.value.split('\n') })}
                        placeholder={'agreement sent\ncontract sent'}
                        style={{ font: 'inherit', fontSize: 12, textTransform: 'none', letterSpacing: 0, fontWeight: 400, padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 7, resize: 'vertical' }} />
            </label>

            <button className="btn warn" style={{ padding: '4px 9px', fontSize: 11 }}
                    disabled={stages.length <= 2} onClick={() => remove(i)}
                    title={stages.length <= 2 ? 'A funnel needs at least two stages' : 'Remove this stage'}>
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="controls" style={{ marginTop: 12 }}>
        <button className="btn ghost" onClick={add}>+ Add stage</button>
        <button className="btn" onClick={save} disabled={busy || !dirty} style={{ marginLeft: 'auto' }}>
          {busy ? 'Saving…' : dirty ? 'Save funnel & re-map leads' : 'No changes'}
        </button>
        {dirty && <button className="btn ghost" onClick={() => setStages(funnel.stages)} disabled={busy}>Discard</button>}
      </div>

      <div className="note" style={{ marginTop: 4 }}>
        Saving re-maps every existing lead in this workspace from its stored CRM status. A lead whose status
        matches no stage falls back to the first stage in the list.
      </div>

      {msg && <div className={'note ' + (msg.kind === 'ok' ? 'ok' : 'err')} style={{ marginTop: 12 }}>{msg.text}</div>}
    </div>
  )
}
