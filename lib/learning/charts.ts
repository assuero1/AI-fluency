// Geometria de sparkline pura (testável sem React): mapeia valores para o
// atributo `points` de uma <polyline> SVG.
export function chartPoints(values: number[], width: number, height: number) {
  if (!values.length) return "";
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min;
  if (range === 0 || values.length === 1) {
    // Linha plana: preserva TODOS os pontos no meio (mantém a forma temporal);
    // com um único valor, desenha o segmento mínimo para o <polyline> aparecer.
    const y = Math.round(height / 2);
    if (values.length === 1) return `0,${y} ${width},${y}`;
    return values.map((_, index) => `${Math.round((index / Math.max(1, values.length - 1)) * width)},${y}`).join(" ");
  }
  return values
    .map((value, index) => {
      const x = Math.round((index / (values.length - 1)) * width);
      const y = Math.round(height - ((value - min) / range) * height);
      return `${x},${y}`;
    })
    .join(" ");
}
