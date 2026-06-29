// Renders the uploaded Transcure logo (a data: URL from Admin settings) when
// available; otherwise a branded wordmark fallback.
export default function Logo({ size = 30, src }: { size?: number; src?: string | null }) {
  if (src) return <img className="logo-img" src={src} alt="Transcure" style={{ height: size }} />
  return (
    <span className="logo">
      <svg className="logo-mark" width={size} height={size * 1.1} viewBox="0 0 40 44" aria-hidden="true">
        <defs>
          <linearGradient id="tc-leaf" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#7b2d6b" />
            <stop offset="1" stopColor="#8cc63f" />
          </linearGradient>
        </defs>
        <path d="M20 2 C33 13 33 31 20 42 C7 31 7 13 20 2 Z" fill="url(#tc-leaf)" />
        <path d="M20 7 C16 18 16 30 20 39" stroke="#fff" strokeWidth="1.7" fill="none" opacity="0.6" strokeLinecap="round" />
        <circle cx="12.4" cy="10" r="3.2" fill="#7b2d6b" />
      </svg>
      <span className="logo-word"><span className="lp">Trans</span><span className="lg">cure</span></span>
    </span>
  )
}
