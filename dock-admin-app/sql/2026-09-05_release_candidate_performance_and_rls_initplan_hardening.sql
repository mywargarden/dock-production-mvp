begin;

-- Foreign-key support indexes: preserve semantics, improve deletes/joins as Dock grows.
create index if not exists idx_dock_district_domains_district_id on public.dock_district_domains(district_id);
create index if not exists idx_dock_license_audit_events_district_id on public.dock_license_audit_events(district_id);
create index if not exists idx_dock_license_audit_events_license_id on public.dock_license_audit_events(license_id);
create index if not exists idx_dock_license_users_district_id on public.dock_license_users(district_id);
create index if not exists idx_dock_licenses_district_id on public.dock_licenses(district_id);
create index if not exists idx_workspace_versions_created_by on public.workspace_versions(created_by);
create index if not exists idx_workspace_versions_workspace_id on public.workspace_versions(workspace_id);

-- Exact duplicate of idx_profiles_org_id. Keep one canonical copy.
drop index if exists public.idx_profiles_organization_id;

-- Evaluate authenticated identity once per statement instead of once per row.
alter policy organizations_admin_select on public.organizations
  using (public.dock_admin_access_allowed((select auth.uid()), id));
alter policy organizations_admin_update on public.organizations
  using (public.dock_admin_access_allowed((select auth.uid()), id))
  with check (public.dock_admin_access_allowed((select auth.uid()), id));

alter policy personal_memories_delete_own on public.personal_memories
  using (((select auth.uid()) = user_id) and public.dock_user_access_allowed((select auth.uid()), null::uuid));
alter policy personal_memories_insert_own on public.personal_memories
  with check (((select auth.uid()) = user_id) and screenshot_data_url is null and public.dock_user_access_allowed((select auth.uid()), null::uuid));
alter policy personal_memories_select_own on public.personal_memories
  using (((select auth.uid()) = user_id) and public.dock_user_access_allowed((select auth.uid()), null::uuid));
alter policy personal_memories_update_own on public.personal_memories
  using (((select auth.uid()) = user_id) and public.dock_user_access_allowed((select auth.uid()), null::uuid))
  with check (((select auth.uid()) = user_id) and screenshot_data_url is null and public.dock_user_access_allowed((select auth.uid()), null::uuid));

alter policy user_memories_delete_own on public.user_memories
  using (((select auth.uid()) = user_id) and public.dock_user_access_allowed((select auth.uid()), null::uuid));
alter policy user_memories_insert_own on public.user_memories
  with check (((select auth.uid()) = user_id) and screenshot_data_url is null and public.dock_user_access_allowed((select auth.uid()), null::uuid));
alter policy user_memories_select_own on public.user_memories
  using (((select auth.uid()) = user_id) and public.dock_user_access_allowed((select auth.uid()), null::uuid));
alter policy user_memories_update_own on public.user_memories
  using (((select auth.uid()) = user_id) and public.dock_user_access_allowed((select auth.uid()), null::uuid))
  with check (((select auth.uid()) = user_id) and screenshot_data_url is null and public.dock_user_access_allowed((select auth.uid()), null::uuid));

alter policy workspace_tabs_admin_delete on public.workspace_tabs
  using (exists (select 1 from public.workspaces w where w.id = workspace_tabs.workspace_id and public.dock_admin_access_allowed((select auth.uid()), w.organization_id)));
alter policy workspace_tabs_admin_insert on public.workspace_tabs
  with check (exists (select 1 from public.workspaces w where w.id = workspace_tabs.workspace_id and public.dock_admin_access_allowed((select auth.uid()), w.organization_id)));
alter policy workspace_tabs_admin_select on public.workspace_tabs
  using (exists (select 1 from public.workspaces w where w.id = workspace_tabs.workspace_id and public.dock_admin_access_allowed((select auth.uid()), w.organization_id)));
alter policy workspace_tabs_admin_update on public.workspace_tabs
  using (exists (select 1 from public.workspaces w where w.id = workspace_tabs.workspace_id and public.dock_admin_access_allowed((select auth.uid()), w.organization_id)))
  with check (exists (select 1 from public.workspaces w where w.id = workspace_tabs.workspace_id and public.dock_admin_access_allowed((select auth.uid()), w.organization_id)));

alter policy workspace_versions_admin_select on public.workspace_versions
  using (public.dock_admin_access_allowed((select auth.uid()), organization_id));

alter policy workspaces_admin_delete on public.workspaces
  using (public.dock_admin_access_allowed((select auth.uid()), organization_id));
alter policy workspaces_admin_insert on public.workspaces
  with check (public.dock_admin_access_allowed((select auth.uid()), organization_id));
alter policy workspaces_admin_select on public.workspaces
  using (public.dock_admin_access_allowed((select auth.uid()), organization_id));
alter policy workspaces_admin_update on public.workspaces
  using (public.dock_admin_access_allowed((select auth.uid()), organization_id))
  with check (public.dock_admin_access_allowed((select auth.uid()), organization_id));

-- Service-role policies should target service_role directly rather than PUBLIC + auth.role().
alter policy "Service role can manage audit logs" on public.audit_logs to service_role using (true) with check (true);
alter policy "Service role can manage organization admins" on public.organization_admins to service_role using (true) with check (true);
alter policy "service role manages organization allowed emails" on public.organization_allowed_emails to service_role using (true) with check (true);
alter policy organization_allowed_users_service_role_all on public.organization_allowed_users to service_role using (true) with check (true);
alter policy workspace_versions_service_role_all on public.workspace_versions to service_role using (true) with check (true);

commit;
