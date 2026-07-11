import "server-only";
import { createChatCompletion } from "@/lib/ai/client";
import { LearningStateError } from "./access";

export type SelectionExplanation = { translation: string; grammar: string; usage: string; example: string };

export async function explainSelection(text: string, language: string, context: string): Promise<SelectionExplanation> {
  const clean = text.trim();
  if (!clean || clean.length > 300) throw new LearningStateError("Selecione uma palavra ou frase de até 300 caracteres.", 400);
  const ai = await createChatCompletion([
    { role: "system", content: [
      "Você é professor de idiomas para um aluno brasileiro.",
      "Explique a seleção inteiramente em português brasileiro.",
      "Responda somente JSON válido com translation, grammar, usage e example.",
      "translation: tradução natural; grammar: estrutura e função gramatical; usage: como e quando se usa; example: exemplo curto no idioma alvo com tradução em português."
    ].join("\n") },
    { role: "user", content: `Idioma alvo: ${language}\nSeleção: ${clean}\nContexto: ${context.slice(0, 900)}` }
  ], { temperature: 0.2, maxTokens: 600 });
  const match = ai.content.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(match?.[0] ?? "{}") as Partial<SelectionExplanation>;
  if (!parsed.translation || !parsed.grammar || !parsed.usage) throw new Error("A explicação retornou incompleta.");
  return { translation: parsed.translation, grammar: parsed.grammar, usage: parsed.usage, example: parsed.example ?? "" };
}
