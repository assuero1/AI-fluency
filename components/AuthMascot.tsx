export function AuthMascot({ bubble }: { bubble: string }) {
  return (
    <svg
      className="auth-mascot"
      viewBox="0 0 200 172"
      role="img"
      aria-label={`Mascote papagaio dizendo: ${bubble}`}
    >
      <circle cx="72" cy="102" r="62" fill="var(--brand-soft)" />

      {/* cauda */}
      <path d="M34 120 q-16 4 -22 20 q18 4 30 -4 z" fill="var(--brand-deep)" />

      {/* corpo */}
      <ellipse cx="72" cy="102" rx="40" ry="44" fill="var(--brand)" />
      <ellipse cx="74" cy="116" rx="23" ry="26" fill="var(--brand-soft)" />

      {/* asa */}
      <path
        d="M44 96 q-14 22 6 35 q16 -3 14 -18 q-2 -15 -20 -17 z"
        fill="var(--brand-deep)"
      />

      {/* topete */}
      <path
        d="M62 58 q10 -12 20 0"
        fill="none"
        stroke="var(--brand-deep)"
        strokeWidth="5"
        strokeLinecap="round"
      />

      {/* olho */}
      <circle cx="88" cy="88" r="12" fill="#fff" />
      <circle cx="90" cy="90" r="5" fill="var(--text)" />
      <circle cx="92" cy="88" r="1.8" fill="#fff" />

      {/* bico */}
      <path
        d="M100 92 q20 2 22 13 q-2 13 -22 11 q7 -11 0 -24 z"
        fill="#ff9600"
        stroke="#d97c00"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* pés */}
      <rect x="56" y="142" width="15" height="9" rx="4.5" fill="#ff9600" />
      <rect x="78" y="142" width="15" height="9" rx="4.5" fill="#ff9600" />

      {/* balão de fala */}
      <g className="auth-mascot-bubble">
        <path d="M110 46 L98 64 L126 50 Z" fill="#fff" stroke="var(--line)" strokeWidth="3" strokeLinejoin="round" />
        <rect x="88" y="4" width="108" height="46" rx="17" fill="#fff" stroke="var(--line)" strokeWidth="3" />
        <text x="142" y="33" textAnchor="middle" fontSize="15" fontWeight="800" fill="var(--text)">
          {bubble}
        </text>
      </g>
    </svg>
  );
}
