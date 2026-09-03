import { handleApiError, jsonOk } from "@/lib/api/responses";
import { updatePreferences } from "@/lib/learning/account";

export async function PATCH(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const record = await updatePreferences({
      correctionStyle: typeof body.correctionStyle === "string" ? body.correctionStyle : undefined,
      level: typeof body.level === "string" ? body.level : undefined,
      audioEnabled: typeof body.audioEnabled === "boolean" ? body.audioEnabled : undefined,
      transcriptEnabled: typeof body.transcriptEnabled === "boolean" ? body.transcriptEnabled : undefined,
      calendarMemoryEnabled: typeof body.calendarMemoryEnabled === "boolean" ? body.calendarMemoryEnabled : undefined,
      weeklyConversationGoal: typeof body.weeklyConversationGoal === "number" ? body.weeklyConversationGoal : undefined,
      weeklyWordGoal: typeof body.weeklyWordGoal === "number" ? body.weeklyWordGoal : undefined,
      dailyGoalMinutes: typeof body.dailyGoalMinutes === "number" ? body.dailyGoalMinutes : undefined,
      reminderHour: body.reminderHour === null ? null : typeof body.reminderHour === "number" ? body.reminderHour : undefined
    });
    return jsonOk({ ok: true, record });
  } catch (error) {
    return handleApiError(error);
  }
}
