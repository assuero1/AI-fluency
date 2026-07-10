import { AppShell } from "@/components/AppShell";
import { OnboardingForm } from "@/components/OnboardingForm";
import { getActiveLanguageProfile, getExistingPersonalUser } from "@/lib/learning/profile";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode } = await searchParams;
  const user = await getExistingPersonalUser();
  const profile = user ? await getActiveLanguageProfile(user) : null;

  return (
    <AppShell noNav>
      <OnboardingForm
        initialProfile={
          profile
            ? {
                languageCode: profile.fields.language_code,
                languageName: profile.fields.language_name,
                level: profile.fields.level,
                learningGoal: profile.fields.learning_goal,
                correctionStyle: profile.fields.correction_style,
                audioEnabled: profile.fields.audio_enabled,
                transcriptEnabled: profile.fields.transcript_enabled,
                calendarMemoryEnabled: profile.fields.calendar_memory_enabled,
                weeklyConversationGoal: profile.fields.weekly_conversation_goal,
                weeklyWordGoal: profile.fields.weekly_word_goal
              }
            : null
        }
        languageSelectionOnly={mode === "language"}
      />
    </AppShell>
  );
}
