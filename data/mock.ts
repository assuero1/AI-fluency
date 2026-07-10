import {
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CircleAlert,
  Laptop,
  MessageCircle,
  Plane,
  Star,
  Target,
  TrendingUp
} from "lucide-react";

export const suggestions = [
  {
    title: "Viagem e aeroporto",
    meta: "Praticado 2x esta semana",
    badge: "Recomendado",
    tone: "primary" as const,
    icon: BriefcaseBusiness
  },
  {
    title: "Expressar opiniões",
    meta: "Você errou verbos modais ontem",
    badge: "Recomendado",
    tone: "warning" as const,
    icon: MessageCircle
  },
  {
    title: "Trabalho remoto",
    meta: "Novo vocabulário para reuniões",
    badge: "Recomendado",
    tone: "info" as const,
    icon: Laptop
  }
];

export const feedbackMetrics = [
  {
    value: "8/10",
    label: "Correções aplicadas",
    foot: "Muito bem!",
    icon: Check,
    tone: "primary" as const
  },
  {
    value: "3",
    label: "Erros recorrentes",
    foot: "Ver detalhes",
    icon: CircleAlert,
    tone: "warning" as const
  },
  {
    value: "+12",
    label: "Novas palavras",
    foot: "Ótimo progresso!",
    icon: Star,
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
    icon: Target,
    tone: "primary" as const
  },
  {
    title: "Perguntas de follow-up",
    meta: "melhora fluidez em conversas",
    icon: MessageCircle,
    tone: "info" as const
  }
];

export const strengths = [
  { title: "Responder perguntas simples", icon: Check, tone: "primary" as const },
  { title: "Vocabulário de trabalho", icon: BriefcaseBusiness, tone: "info" as const },
  { title: "Compreensão por áudio", icon: BarChart3, tone: "warning" as const }
];

export const progressMetrics = [
  { value: "8/10", label: "Correções aplicadas", icon: Check, tone: "primary" as const },
  { value: "3", label: "Erros recorrentes", icon: CircleAlert, tone: "warning" as const },
  { value: "+42", label: "Palavras este mês", icon: TrendingUp, tone: "info" as const }
];

export const languages = [
  { code: "EN", title: "Inglês", meta: "Conversação, trabalho e viagem" },
  { code: "ES", title: "Espanhol", meta: "Situações reais do dia a dia" },
  { code: "FR", title: "Francês", meta: "Vocabulário e pronúncia" },
  { code: "IT", title: "Italiano", meta: "Conversas leves e cultura" }
];

export const summaryWords = [
  { title: "breakfast", meta: "apareceu na pergunta inicial", icon: Plane },
  { title: "toast", meta: "usada na resposta corrigida", icon: MessageCircle },
  { title: "routine", meta: "tema central da conversa", icon: CalendarDays }
];
