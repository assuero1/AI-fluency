import { NewWordsTrainer } from "@/components/NewWordsTrainer";
import { LearningStateError } from "@/lib/learning/access";
import { getActiveLanguageProfile, getSessionUser } from "@/lib/learning/profile";

export const dynamic = "force-dynamic";

export default async function NewWordsPracticePage() {
  let languageName = "idioma estudado";
  try {
    const user = await getSessionUser();
    const profile = await getActiveLanguageProfile(user);
    if (profile?.fields.language_name) languageName = profile.fields.language_name;
  } catch {
    // Sem perfil resolvido, o trainer segue com o rótulo genérico.
  }
  return <NewWordsTrainer initialLanguageName={languageName} />;
}
