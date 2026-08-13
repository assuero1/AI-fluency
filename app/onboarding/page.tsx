import { AppShell } from "@/components/AppShell";
import { OnboardingForm } from "@/components/OnboardingForm";
import { getActiveLanguageProfile, getSessionUser, LanguageProfileFields } from "@/lib/learning/profile";
import { getTeableClient } from "@/lib/teable/client";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode } = await searchParams;
  const user = await getSessionUser();
  const profile = user ? await getActiveLanguageProfile(user) : null;
  const profiles = user ? await getTeableClient().listRecords<LanguageProfileFields>("languageProfiles", 50) : [];
  const profileLevels = profiles
    .filter((item) => item.fields.user_id === user?.id)
    .map((item) => ({ languageCode: item.fields.language_code, level: item.fields.level }));

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
        profileLevels={profileLevels}
      />
    </AppShell>
  );
}
