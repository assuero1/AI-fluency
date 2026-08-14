export function AuthMascot({ bubble }: { bubble: string }) {
  return (
    <svg
      className="auth-mascot"
      viewBox="0 0 200 172"
      role="img"
      aria-label={`Mascote dizendo: ${bubble}`}
    >
      <circle cx="72" cy="102" r="62" fill="var(--brand-soft)" />

      {/* chifres */}
      <path d="M52 60 q-6 -16 6 -20 q8 10 2 22 z" fill="var(--brand-deep)" />
      <path d="M92 60 q6 -16 -6 -20 q-8 10 -2 22 z" fill="var(--brand-deep)" />

      {/* braços */}
      <ellipse cx="30" cy="108" rx="9" ry="13" fill="var(--brand-deep)" />
      <ellipse cx="114" cy="108" rx="9" ry="13" fill="var(--brand-deep)" />

      {/* corpo */}
      <ellipse cx="72" cy="104" rx="42" ry="42" fill="var(--brand)" />
      <ellipse cx="72" cy="120" rx="24" ry="20" fill="var(--brand-soft)" />

      {/* olhos */}
      <circle cx="56" cy="88" r="12" fill="#fff" />
      <circle cx="88" cy="88" r="12" fill="#fff" />
      <circle cx="59" cy="90" r="5.5" fill="var(--text)" />
      <circle cx="91" cy="90" r="5.5" fill="var(--text)" />
      <circle cx="61" cy="88" r="2" fill="#fff" />
      <circle cx="93" cy="88" r="2" fill="#fff" />

      {/* bochechas */}
      <circle cx="44" cy="103" r="6" fill="#ffb3d9" opacity="0.85" />
      <circle cx="100" cy="103" r="6" fill="#ffb3d9" opacity="0.85" />

      {/* boca aberta com língua */}
      <path d="M58 104 q14 18 28 0 q-2 16 -14 16 q-12 0 -14 -16 z" fill="#4a2b6b" />
      <ellipse cx="72" cy="116" rx="8" ry="4.5" fill="#ff8fb3" />

      {/* pés */}
      <rect x="54" y="141" width="16" height="10" rx="5" fill="var(--brand-deep)" />
      <rect x="78" y="141" width="16" height="10" rx="5" fill="var(--brand-deep)" />

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
