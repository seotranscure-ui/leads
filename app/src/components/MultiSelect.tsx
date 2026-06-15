import { useEffect, useRef, useState } from 'react'

interface Props {
  label: string
  options: string[]
  selected: string[]
  onChange: (v: string[]) => void
}

// A dropdown that lets the user tick multiple options. Empty selection = "all".
export default function MultiSelect({ label, options, selected, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const toggle = (opt: string) =>
    onChange(selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt])

  const summary = selected.length === 0 ? `${label}: all` : selected.length === 1 ? selected[0] : `${label}: ${selected.length}`

  return (
    <div className="ms" ref={ref}>
      <button type="button" className={'ms-btn' + (selected.length ? ' active' : '')} onClick={() => setOpen((o) => !o)} title={selected.join(', ')}>
        <span className="ms-label">{summary}</span><span className="ms-caret">▾</span>
      </button>
      {open && (
        <div className="ms-pop">
          <div className="ms-actions">
            <a onClick={() => onChange(options)}>Select all</a>
            <a onClick={() => onChange([])}>Clear</a>
          </div>
          <div className="ms-list">
            {options.length === 0 && <div className="ms-empty">no options</div>}
            {options.map((opt) => (
              <label key={opt} className="ms-opt">
                <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} />
                <span>{opt}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
