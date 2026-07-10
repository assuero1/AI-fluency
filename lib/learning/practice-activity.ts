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
    activityDays: Array.from({ length: 7 }, (_, index) => {
      const date = shiftDate(today, index - 6);
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
  if (Number.isNaN(value.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
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
