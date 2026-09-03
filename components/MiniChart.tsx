import { chartPoints } from "@/lib/learning/charts";

type MiniChartProps = { values: number[]; labels?: string[]; ariaLabel: string; tone?: "primary" | "info" };

// Gráfico de linha minimalista em SVG puro (sem dependências). Os valores
// são normalizados ao viewport; sem dado, quem decide esconder é o chamador.
export function MiniChart({ values, labels, ariaLabel, tone = "primary" }: MiniChartProps) {
  const width = 280;
  const height = 72;
  return <figure className="mini-chart" role="img" aria-label={ariaLabel}>
    <svg viewBox={`0 0 ${width} ${height + 12}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline
        className={`mini-chart-line ${tone}`}
        fill="none"
        points={chartPoints(values, width, height)}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="translate(0 6)"
      />
    </svg>
    {labels && labels.length ? <figcaption>{labels[0]} → {labels[labels.length - 1]}</figcaption> : null}
  </figure>;
}
