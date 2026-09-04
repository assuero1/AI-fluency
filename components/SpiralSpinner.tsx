// Espiral da cauda do mascote — motivo de marca para carregamentos curtos.
// Rotação linear (movimento constante, §2.6) + traço interrompido que lê
// como "desenhando". Uso: substituir dots genéricos; nunca empilhar com
// LoadingScene (o mascote é a cena, a espiral é o detalhe).

type SpiralSpinnerProps = {
  label: string;
  size?: 16 | 20 | 24 | 32;
  className?: string;
};

export function SpiralSpinner({ label, size = 24, className }: SpiralSpinnerProps) {
  return (
    <span
      className={["spiral-spinner", className].filter(Boolean).join(" ")}
      role="status"
      aria-label={label}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M21 12a9 9 0 1 0-9 9 6.75 6.75 0 1 0-6.75-6.75 4.5 4.5 0 1 0 4.5-4.5 2.25 2.25 0 1 0-2.25 2.25" />
      </svg>
    </span>
  );
}
