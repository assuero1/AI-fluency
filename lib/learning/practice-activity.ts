import { dateKeyInTimeZone as tzDateKeyInTimeZone } from "./tz";

export type PracticeActivity = {
  streak: number;
  practicedToday: boolean;
  activityDays: Array<{ label: string; date: string; active: boolean }>;
};

type PracticeActivityOptions = {
  now?: Date;
  timeZone?: string;
};

const weekdayLabels = ["D", "S", "T", "Q", "Q", "S", "S"];

export function getPracticeActivity(
  completedAt: Array<string | undefined>,
  { now = new Date(), timeZone = "UTC" }: PracticeActivityOptions = {}
): PracticeActivity {
  const resolvedTimeZone = safeTimeZone(timeZone);
  const today = dateKeyInTimeZone(now, resolvedTimeZone);
  const activeDates = new Set(completedAt.map((value) => value && dateKeyInTimeZone(new Date(value), resolvedTimeZone)).filter(Boolean));
  const practicedToday = activeDates.has(today);
  const startDate = practicedToday ? today : shiftDate(today, -1);
  let streak = 0;

  for (let offset = 0; offset < 365; offset += 1) {
    if (!activeDates.has(shiftDate(startDate, -offset))) break;
    streak += 1;
  }

  return {
    streak,
    practicedToday,
    // Semana-calendário (domingo → hoje), na mesma convenção D S T Q Q S S do
    // calendário — antes era uma janela rolante que lia como semana embaralhada.
    activityDays: Array.from({ length: weekdayIndex(today) + 1 }, (_, index) => {
      const date = shiftDate(today, index - weekdayIndex(today));
      return {
        label: weekdayLabels[weekdayIndex(date)],
        date,
        active: activeDates.has(date)
      };
    })
  };
}

export function formatPracticeStreak(streak: number) {
  return `${streak} ${streak === 1 ? "dia" : "dias"}`;
}

function dateKeyInTimeZone(value: Date, timeZone: string) {
  return tzDateKeyInTimeZone(value, safeTimeZone(timeZone));
}
function safeTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value;
  } catch {
    return "UTC";
  }
}

function shiftDate(value: string, offset: number) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
}

function weekdayIndex(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
