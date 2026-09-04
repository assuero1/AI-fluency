import type { TalkitoIconName } from "@/components/TalkitoIcon";

export const suggestions = [
  {
    title: "Viagem e aeroporto",
    meta: "Praticado 2x esta semana",
    badge: "Recomendado",
    tone: "primary" as const,
    talkitoIcon: "travel-suitcase" as TalkitoIconName
  },
  {
    title: "Expressar opiniões",
    meta: "Você errou verbos modais ontem",
    badge: "Recomendado",
    tone: "warning" as const,
    talkitoIcon: "listening-bubble" as TalkitoIconName
  },
  {
    title: "Trabalho remoto",
    meta: "Novo vocabulário para reuniões",
    badge: "Recomendado",
    tone: "info" as const,
    talkitoIcon: "remote-laptop" as TalkitoIconName
  }
];

export const feedbackMetrics = [
  {
    value: "8/10",
    label: "Correções aplicadas",
    foot: "Muito bem!",
    talkitoIcon: "check-stamp" as TalkitoIconName,
    tone: "primary" as const
  },
  {
    value: "3",
    label: "Erros recorrentes",
    foot: "Ver detalhes",
    talkitoIcon: "alert-badge" as TalkitoIconName,
    tone: "warning" as const
  },
  {
    value: "+12",
    label: "Novas palavras",
    foot: "Ótimo progresso!",
    talkitoIcon: "sparkles" as TalkitoIconName,
    tone: "info" as const
  }
];

export const words = [
  {
    title: "actually",
    meta: "usada 6 vezes nas últimas conversas",
    badge: "recente",
    tone: "primary" as const
  },
  {
    title: "schedule",
    meta: "última vez há 9 dias",
    badge: "revisar",
    tone: "warning" as const
  },
  {
    title: "improve",
    meta: "apareceu em trabalho remoto",
    badge: "+3 usos",
    tone: "info" as const
  },
  {
    title: "have / had",
    meta: "erro corrigido hoje",
    badge: "correção",
    tone: "warning" as const
  }
];

export const calendarSuggestions = [
  {
    title: "Projetos em andamento",
    meta: "treina work on e passado simples",
    talkitoIcon: "target" as TalkitoIconName,
    tone: "primary" as const
  },
  {
    title: "Perguntas de follow-up",
    meta: "melhora fluidez em conversas",
    talkitoIcon: "listening-bubble" as TalkitoIconName,
    tone: "info" as const
  }
];

export const strengths = [
  { title: "Responder perguntas simples", talkitoIcon: "check-stamp" as TalkitoIconName, tone: "primary" as const },
  { title: "Vocabulário de trabalho", talkitoIcon: "travel-suitcase" as TalkitoIconName, tone: "info" as const },
  { title: "Compreensão por áudio", talkitoIcon: "growth-stairs" as TalkitoIconName, tone: "warning" as const }
];

export const progressMetrics = [
  { value: "8/10", label: "Correções aplicadas", talkitoIcon: "check-stamp" as TalkitoIconName, tone: "primary" as const },
  { value: "3", label: "Erros recorrentes", talkitoIcon: "alert-badge" as TalkitoIconName, tone: "warning" as const },
  { value: "+42", label: "Palavras este mês", talkitoIcon: "growth-stairs" as TalkitoIconName, tone: "info" as const }
];

export const languages = [
  { code: "EN", title: "Inglês", meta: "Conversação, trabalho e viagem" },
  { code: "ES", title: "Espanhol", meta: "Situações reais do dia a dia" },
  { code: "FR", title: "Francês", meta: "Vocabulário e pronúncia" },
  { code: "IT", title: "Italiano", meta: "Conversas leves e cultura" },
  { code: "JA", title: "Japonês", meta: "Conversação, escrita e dia a dia" },
  { code: "ZH", title: "Mandarim", meta: "Pronúncia, tons e conversação" },
  { code: "HI", title: "Hindi", meta: "Conversação, cultura e viagem" }
];

export const summaryWords = [
  { title: "breakfast", meta: "apareceu na pergunta inicial", talkitoIcon: "travel-suitcase" as TalkitoIconName },
  { title: "toast", meta: "usada na resposta corrigida", talkitoIcon: "listening-bubble" as TalkitoIconName },
  { title: "routine", meta: "tema central da conversa", talkitoIcon: "calendar-desk" as TalkitoIconName }
];
