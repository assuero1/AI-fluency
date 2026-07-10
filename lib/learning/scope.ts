export type LearningScope = {
  userId: string;
  profileId: string;
};

type UserScopedFields = {
  user_id?: string;
};

type LearningScopedFields = UserScopedFields & {
  language_profile_id?: string;
};

export function matchesUserScope(fields: UserScopedFields, userId: string) {
  return Boolean(userId) && fields.user_id === userId;
}

export function matchesLearningScope(fields: LearningScopedFields, scope: { userId: string; profileId?: string | null }) {
  return Boolean(scope.userId && scope.profileId) &&
    fields.user_id === scope.userId &&
    fields.language_profile_id === scope.profileId;
}
