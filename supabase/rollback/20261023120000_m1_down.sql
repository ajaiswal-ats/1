-- Undo milestone 1 (supabase/migrations/20261023120000_m1_tenancy_stage_events.sql). Development database only.
-- Removes everything the migration created, including the fictional seed rows and memberships, in one transaction.
-- The fictional test users in auth.users are removed AFTER this (npm run db:rollback does both, in that order):
-- while these tables exist, a member who made a move cannot be deleted, because their events refer to them.
-- Run with: npm run db:rollback -- --confirm
begin;
drop function if exists public.client_move_stage(uuid, text, integer, uuid);
drop table if exists app_private.idempotency_keys;
drop table if exists public.submission_events;
drop table if exists public.submissions;
drop table if exists public.people;
drop table if exists public.roles;
drop table if exists public.client_members;
drop table if exists public.clients;
drop function if exists app_private.my_client_id();
drop function if exists app_private.events_are_append_only();
drop schema if exists app_private;
commit;
