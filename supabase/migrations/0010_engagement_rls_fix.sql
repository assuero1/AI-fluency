-- 0010: alinha as policies RLS das tabelas de engajamento (0008) ao padrão do
-- resto do schema. A 0008 usou `auth.uid()`, mas o vínculo real é
-- users.auth_user_id → auth.users: o user_id gravado nas linhas é
-- public.users.id (veja 0004/0006). Com auth.uid(), o SELECT não via linhas
-- alheias... nem as próprias — e o INSERT era rejeitado, o que impedia
-- persistir conquistas e assinaturas de push.

alter table public.engagement_achievements enable row level security;
alter table public.push_subscriptions enable row level security;

do $$
begin
  execute format('drop policy if exists %I on public.%I', 'engagement_achievements_select_own', 'engagement_achievements');
  execute format('drop policy if exists %I on public.%I', 'engagement_achievements_insert_own', 'engagement_achievements');
  execute format('drop policy if exists %I on public.%I', 'engagement_achievements_owner_all', 'engagement_achievements');
  execute format('create policy %I on public.%I for select using (user_id = (select public.current_user_id()))', 'engagement_achievements_select_own', 'engagement_achievements');
  execute format('create policy %I on public.%I for insert with check (user_id = (select public.current_user_id()))', 'engagement_achievements_insert_own', 'engagement_achievements');

  execute format('drop policy if exists %I on public.%I', 'push_subscriptions_select_own', 'push_subscriptions');
  execute format('drop policy if exists %I on public.%I', 'push_subscriptions_insert_own', 'push_subscriptions');
  execute format('drop policy if exists %I on public.%I', 'push_subscriptions_delete_own', 'push_subscriptions');
  execute format('drop policy if exists %I on public.%I', 'push_subscriptions_update_own', 'push_subscriptions');
  execute format('drop policy if exists %I on public.%I', 'push_subscriptions_owner_all', 'push_subscriptions');
  execute format('create policy %I on public.%I for select using (user_id = (select public.current_user_id()))', 'push_subscriptions_select_own', 'push_subscriptions');
  execute format('create policy %I on public.%I for insert with check (user_id = (select public.current_user_id()))', 'push_subscriptions_insert_own', 'push_subscriptions');
  execute format('create policy %I on public.%I for delete using (user_id = (select public.current_user_id()))', 'push_subscriptions_delete_own', 'push_subscriptions');
  execute format('create policy %I on public.%I for update using (user_id = (select public.current_user_id())) with check (user_id = (select public.current_user_id()))', 'push_subscriptions_update_own', 'push_subscriptions');
end $$;
