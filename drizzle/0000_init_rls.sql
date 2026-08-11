-- Migration: 0000_init_rls.sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'deviceops_app') THEN
    CREATE ROLE deviceops_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

CREATE TYPE membership_role AS ENUM ('owner', 'admin', 'manager', 'technician', 'viewer');
CREATE TYPE session_kind AS ENUM ('web', 'mobile');
CREATE TYPE run_state AS ENUM ('queued', 'running', 'waiting_for_tool', 'awaiting_approval', 'completed', 'failed', 'cancelled', 'expired');
CREATE TYPE incident_state AS ENUM ('proposed', 'approval_pending', 'approved', 'denied', 'expired', 'dispatching', 'delivered', 'retrying', 'dead_lettered', 'cancelled');
CREATE TYPE document_version_state AS ENUM ('pending', 'processing', 'published', 'retired', 'failed');
CREATE TYPE media_kind AS ENUM ('image', 'voice');
CREATE TYPE media_state AS ENUM ('created', 'uploading', 'quarantined', 'scanning', 'normalizing', 'ready', 'attached', 'rejected', 'failed', 'expired', 'deleted');

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  demo_mode BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  failed_logins INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role membership_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships (user_id);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  kind session_kind NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  refresh_hash TEXT UNIQUE,
  csrf_hash TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  refresh_expires_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_tenant_idx ON sessions (user_id, tenant_id);

CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rooms_tenant_idx ON rooms (tenant_id);

CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  room_id UUID NOT NULL REFERENCES rooms(id),
  name TEXT NOT NULL,
  manufacturer TEXT NOT NULL,
  model TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS devices_tenant_room_idx ON devices (tenant_id, room_id);

CREATE TABLE IF NOT EXISTS device_status_snapshots (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  device_id UUID NOT NULL REFERENCES devices(id),
  payload JSONB NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS device_status_latest_idx ON device_status_snapshots (tenant_id, device_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS document_sources (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  title TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_url TEXT,
  license TEXT NOT NULL,
  allowed_roles membership_role[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_sources_tenant_idx ON document_sources (tenant_id);

CREATE TABLE IF NOT EXISTS document_versions (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  source_id UUID NOT NULL REFERENCES document_sources(id),
  version_label TEXT NOT NULL,
  checksum TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  state document_version_state NOT NULL,
  published_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT document_versions_checksum_uq UNIQUE (tenant_id, source_id, checksum)
);
CREATE INDEX IF NOT EXISTS document_versions_state_idx ON document_versions (tenant_id, state);

CREATE TABLE IF NOT EXISTS document_chunks (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  source_id UUID NOT NULL REFERENCES document_sources(id),
  source_version_id UUID NOT NULL REFERENCES document_versions(id),
  page INT,
  start_offset INT NOT NULL,
  end_offset INT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  text_search TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  embedding VECTOR(1536) NOT NULL,
  embedding_model TEXT NOT NULL,
  injection_signals TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT document_chunks_hash_uq UNIQUE (tenant_id, source_version_id, content_hash)
);
CREATE INDEX IF NOT EXISTS document_chunks_tenant_version_idx ON document_chunks (tenant_id, source_version_id);
CREATE INDEX IF NOT EXISTS document_chunks_fts_idx ON document_chunks USING gin (text_search);
CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx ON document_chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS assistant_runs (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  requester_id UUID NOT NULL REFERENCES users(id),
  room_id UUID NOT NULL REFERENCES rooms(id),
  device_id UUID NOT NULL REFERENCES devices(id),
  state run_state NOT NULL,
  question TEXT NOT NULL,
  diagnosis JSONB,
  correlation_id UUID NOT NULL,
  error_code TEXT,
  error_detail TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assistant_runs_tenant_state_idx ON assistant_runs (tenant_id, state, created_at DESC);

CREATE TABLE IF NOT EXISTS run_messages (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  run_id UUID NOT NULL REFERENCES assistant_runs(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS run_messages_run_idx ON run_messages (tenant_id, run_id, created_at ASC);

CREATE TABLE IF NOT EXISTS run_events (
  sequence BIGSERIAL PRIMARY KEY,
  id UUID NOT NULL UNIQUE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  run_id UUID NOT NULL REFERENCES assistant_runs(id),
  type TEXT NOT NULL,
  correlation_id UUID NOT NULL,
  data JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS run_events_replay_idx ON run_events (tenant_id, run_id, sequence ASC);

CREATE TABLE IF NOT EXISTS retrieval_results (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  run_id UUID NOT NULL REFERENCES assistant_runs(id),
  chunk_id UUID NOT NULL REFERENCES document_chunks(id),
  rank INT NOT NULL,
  score NUMERIC(12, 8) NOT NULL,
  retrieval_config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS retrieval_results_run_idx ON retrieval_results (tenant_id, run_id, rank ASC);

CREATE TABLE IF NOT EXISTS tool_calls (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  run_id UUID NOT NULL REFERENCES assistant_runs(id),
  name TEXT NOT NULL,
  arguments JSONB NOT NULL,
  result_summary JSONB,
  policy_version TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tool_calls_run_idx ON tool_calls (tenant_id, run_id, created_at ASC);

CREATE TABLE IF NOT EXISTS model_usage (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  run_id UUID NOT NULL REFERENCES assistant_runs(id),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INT NOT NULL,
  output_tokens INT NOT NULL,
  estimated_cost_usd NUMERIC(12, 6) NOT NULL,
  latency_ms INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS model_usage_run_idx ON model_usage (tenant_id, run_id);

CREATE TABLE IF NOT EXISTS approval_requests (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  run_id UUID NOT NULL REFERENCES assistant_runs(id),
  requester_id UUID NOT NULL REFERENCES users(id),
  proposal JSONB NOT NULL,
  proposal_hash TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  state TEXT NOT NULL,
  decided_by UUID REFERENCES users(id),
  decision_reason TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT approval_proposal_uq UNIQUE (tenant_id, run_id, proposal_hash)
);

CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  run_id UUID NOT NULL REFERENCES assistant_runs(id),
  approval_id UUID NOT NULL REFERENCES approval_requests(id),
  state incident_state NOT NULL,
  command_key TEXT NOT NULL UNIQUE,
  summary TEXT NOT NULL,
  assigned_team TEXT NOT NULL,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS incidents_tenant_state_idx ON incidents (tenant_id, state);

CREATE TABLE IF NOT EXISTS incident_attempts (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  incident_id UUID NOT NULL REFERENCES incidents(id),
  attempt INT NOT NULL,
  status TEXT NOT NULL,
  response_code INT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT incident_attempt_uq UNIQUE (incident_id, attempt)
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox_events (published_at, available_at);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  incident_id UUID NOT NULL REFERENCES incidents(id),
  nonce TEXT NOT NULL,
  signature TEXT NOT NULL,
  state TEXT NOT NULL,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT webhook_delivery_nonce_uq UNIQUE (id, nonce)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  actor_id UUID NOT NULL REFERENCES users(id),
  route TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INT,
  response_body JSONB,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, actor_id, route, key)
);

CREATE TABLE IF NOT EXISTS audit_events (
  sequence BIGSERIAL PRIMARY KEY,
  id UUID NOT NULL UNIQUE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  actor_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID,
  metadata JSONB NOT NULL,
  previous_hash TEXT,
  event_hash TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_tenant_sequence_idx ON audit_events (tenant_id, sequence ASC);

CREATE TABLE IF NOT EXISTS eval_datasets (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT eval_dataset_version_uq UNIQUE (tenant_id, name, version)
);

CREATE TABLE IF NOT EXISTS eval_cases (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  dataset_id UUID NOT NULL REFERENCES eval_datasets(id),
  external_id TEXT NOT NULL,
  category TEXT NOT NULL,
  input JSONB NOT NULL,
  expected JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT eval_case_external_uq UNIQUE (dataset_id, external_id)
);

CREATE TABLE IF NOT EXISTS eval_runs (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  dataset_id UUID NOT NULL REFERENCES eval_datasets(id),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  config JSONB NOT NULL,
  state TEXT NOT NULL,
  summary JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS eval_runs_tenant_idx ON eval_runs (tenant_id, started_at DESC);

CREATE TABLE IF NOT EXISTS eval_results (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  eval_run_id UUID NOT NULL REFERENCES eval_runs(id),
  eval_case_id UUID NOT NULL REFERENCES eval_cases(id),
  retrieval_hit_at_5 BOOLEAN NOT NULL,
  abstention_correct BOOLEAN NOT NULL,
  schema_valid BOOLEAN NOT NULL,
  citation_valid BOOLEAN NOT NULL,
  latency_ms INT NOT NULL,
  cost_usd NUMERIC(12, 6) NOT NULL,
  detail JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT eval_result_case_uq UNIQUE (eval_run_id, eval_case_id)
);

CREATE TABLE IF NOT EXISTS media_assets (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  owner_id UUID NOT NULL REFERENCES users(id),
  run_id UUID REFERENCES assistant_runs(id),
  kind media_kind NOT NULL,
  state media_state NOT NULL,
  storage_provider TEXT NOT NULL,
  quarantine_key TEXT NOT NULL,
  clean_key TEXT,
  upload_token_hash TEXT,
  upload_expires_at TIMESTAMPTZ NOT NULL,
  declared_mime TEXT NOT NULL,
  detected_mime TEXT,
  bytes BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  width INT,
  height INT,
  duration_ms INT,
  scanner TEXT,
  scanner_version TEXT,
  scan_status TEXT,
  scanned_at TIMESTAMPTZ,
  processor_version TEXT NOT NULL,
  transcript TEXT,
  visual_observation TEXT,
  retention_expires_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_assets_tenant_state_idx ON media_assets (tenant_id, state, created_at DESC);

CREATE TABLE IF NOT EXISTS media_events (
  sequence BIGSERIAL PRIMARY KEY,
  id UUID NOT NULL UNIQUE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  media_id UUID NOT NULL REFERENCES media_assets(id),
  state media_state NOT NULL,
  detail JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_events_asset_idx ON media_events (tenant_id, media_id, sequence ASC);

-- The application role is subject to RLS. Authentication-only queries use a
-- separate administrative connection and never expose arbitrary SQL.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_tenants ON tenants
  USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY user_isolation_users ON users
  USING (id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.user_id', true), '')::uuid);

DO $$
DECLARE
  protected_table text;
BEGIN
  FOREACH protected_table IN ARRAY ARRAY[
    'memberships', 'sessions', 'rooms', 'devices', 'device_status_snapshots',
    'document_sources', 'document_versions', 'document_chunks', 'assistant_runs',
    'run_messages', 'run_events', 'retrieval_results', 'tool_calls', 'model_usage',
    'approval_requests', 'incidents', 'incident_attempts', 'outbox_events',
    'webhook_deliveries', 'idempotency_keys', 'audit_events', 'eval_datasets',
    'eval_cases', 'eval_runs', 'eval_results', 'media_assets', 'media_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', protected_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', protected_table);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_%I ON %I USING '
      '(tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) '
      'WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      protected_table,
      protected_table
    );
  END LOOP;
END
$$;

CREATE POLICY session_actor_isolation ON sessions AS RESTRICTIVE
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY membership_actor_isolation ON memberships AS RESTRICTIVE
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY idempotency_actor_isolation ON idempotency_keys AS RESTRICTIVE
  USING (actor_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (actor_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

GRANT USAGE ON SCHEMA public TO deviceops_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO deviceops_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO deviceops_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO deviceops_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO deviceops_app;
