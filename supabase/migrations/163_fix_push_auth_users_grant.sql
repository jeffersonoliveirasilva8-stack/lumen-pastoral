-- Migration 163 — Grant SELECT on auth.users para resolver FK check na upsert_push_subscription
GRANT SELECT ON auth.users TO authenticated;
GRANT SELECT ON auth.users TO service_role;
