-- Additive v2 records: individually identified devices, incidents, proposals, commands,
-- observations, runbooks, topology and discovery candidates. v1 remains unchanged.
CREATE TABLE ops_records (
 tenant_id uuid NOT NULL REFERENCES tenants(id), kind text NOT NULL CHECK (kind IN ('meta','devices','observations','incidents','approvals','commands','runbooks','topology','discovery')),
 id text NOT NULL, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,kind,id)
);
CREATE INDEX ops_records_status ON ops_records(tenant_id,kind,(data->>'status'));
CREATE TABLE ops_events (
 sequence bigserial PRIMARY KEY, id uuid NOT NULL UNIQUE, tenant_id uuid NOT NULL REFERENCES tenants(id),
 incident_id uuid, type text NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL
);
CREATE INDEX ops_events_tenant_sequence ON ops_events(tenant_id,sequence);
CREATE TABLE ops_invocations (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), incident_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN ('running','completed','failed')), grant_hash text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL, lease_until timestamptz NOT NULL, reserved_usd numeric(12,6) NOT NULL,
 input_tokens bigint NOT NULL DEFAULT 0, output_tokens bigint NOT NULL DEFAULT 0, model_calls int NOT NULL DEFAULT 0,
 tool_calls int NOT NULL DEFAULT 0, cost_usd numeric(12,6) NOT NULL DEFAULT 0, error text,
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE UNIQUE INDEX ops_one_model_invocation ON ops_invocations((true)) WHERE status='running';
CREATE TABLE ops_budget (
 id text PRIMARY KEY, limit_usd numeric(12,6) NOT NULL CHECK(limit_usd>=0), spent_usd numeric(12,6) NOT NULL DEFAULT 0,
 reserved_usd numeric(12,6) NOT NULL DEFAULT 0
);
CREATE TABLE ops_collectors (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), token_hash text NOT NULL UNIQUE,
 device_ids uuid[] NOT NULL, source_mode text NOT NULL CHECK(source_mode IN ('simulated','live')),
 last_seen_at timestamptz, expires_at timestamptz NOT NULL, revoked_at timestamptz
);
CREATE TABLE ops_requests (
 tenant_id uuid NOT NULL REFERENCES tenants(id), actor_id uuid NOT NULL, key text NOT NULL,
 request_hash text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,actor_id,key)
);
CREATE TABLE ops_notifications (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), incident_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'queued', attempts int NOT NULL DEFAULT 0, payload jsonb NOT NULL,
 available_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, last_error text,
 UNIQUE(tenant_id,incident_id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['ops_records','ops_events','ops_invocations','ops_collectors','ops_requests','ops_notifications'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY ops_tenant_isolation ON %I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE,DELETE ON ops_records,ops_events,ops_invocations,ops_collectors,ops_requests,ops_notifications TO deviceops_app;
GRANT USAGE,SELECT ON SEQUENCE ops_events_sequence_seq TO deviceops_app;
REVOKE ALL ON ops_budget FROM deviceops_app;
