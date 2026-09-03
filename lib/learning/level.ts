// Nível real: derivado de domínio mensurável (palavras consolidadas no SRS +
// fluência média medida pela IA). Substitui a barra estática fake.
export type LevelDetail = {
  code: string;
  label: string;
  percent: number;
  missing: string | null;
};

type StageTarget = { next: string; code: string; consolidated: number; fluency: number };

const STAGE_TARGETS: Record<string, StageTarget> = {
  "Iniciante": { next: "Intermediário (B1)", code: "A2→B1", consolidated: 50, fluency: 5 },
  "Intermediário (B1)": { next: "Avançado", code: "B1→C1", consolidated: 150, fluency: 7 },
  "Avançado": { next: "Avançado", code: "C1", consolidated: 300, fluency: 9 }
};

const CONSOLIDATED_WEIGHT = 0.7;
const FLUENCY_WEIGHT = 0.3;

export function computeLevelProgress(input: { level: string; wordsConsolidated: number; avgFluency: number | null; xpTotal: number }): LevelDetail {
  const stage = STAGE_TARGETS[input.level] ?? STAGE_TARGETS["Iniciante"];
  const consolidatedRatio = Math.min(1, Math.max(0, input.wordsConsolidated) / stage.consolidated);

  if (input.avgFluency === null || input.avgFluency === undefined) {
    return {
      code: stage.code,
      label: stage.next,
      percent: Math.round(consolidatedRatio * 70),
      missing: "Conclua uma conversa para medir sua fluência."
    };
  }

  const fluencyRatio = Math.min(1, Math.max(0, input.avgFluency) / stage.fluency);
  const complete = input.wordsConsolidated >= stage.consolidated && input.avgFluency >= stage.fluency;
  const percent = complete ? 100 : Math.round((consolidatedRatio * CONSOLIDATED_WEIGHT + fluencyRatio * FLUENCY_WEIGHT) * 100);
  const missingWords = Math.max(0, stage.consolidated - input.wordsConsolidated);
  const missing = complete
    ? null
    : missingWords > 0
      ? `Faltam ~${missingWords} palavra${missingWords === 1 ? "" : "s"} consolidada${missingWords === 1 ? "" : "s"} para ${stage.next}.`
      : `Suba a fluência média para ${stage.fluency}/10 para ${stage.next}.`;
  return { code: stage.code, label: stage.next, percent, missing };
}
