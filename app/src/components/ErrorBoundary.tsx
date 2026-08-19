import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

// Without this, any render-time throw anywhere in the tree unmounts the whole
// app with nothing on screen and nothing in the UI to explain why — the app
// simply goes blank. This catches it and shows the actual error instead, which
// is the difference between "undiagnosable" and "one screenshot away from a fix".
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#f5f3f8' }}>
        <div style={{ maxWidth: 560, background: '#fff', borderRadius: 16, padding: 28, boxShadow: '0 24px 70px rgba(0,0,0,.15)' }}>
          <h1 style={{ fontSize: 18, margin: '0 0 8px', color: '#241f2b' }}>Something went wrong</h1>
          <p style={{ fontSize: 13, color: '#6e6878', margin: '0 0 14px' }}>
            The page hit an error and stopped rendering. Reloading usually fixes it — if the app was just updated,
            this device may have been caching an older version.
          </p>
          <pre style={{
            fontSize: 12, background: '#fbe8ea', color: '#9a1b2a', padding: '10px 12px', borderRadius: 9,
            overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200,
          }}>{error.message}</pre>
          <button
            onClick={() => location.reload()}
            style={{
              marginTop: 16, background: 'linear-gradient(135deg,#7b2d6b,#5c2050)', color: '#fff', border: 0,
              padding: '9px 18px', borderRadius: 10, fontWeight: 600, cursor: 'pointer', fontSize: 13,
            }}
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
