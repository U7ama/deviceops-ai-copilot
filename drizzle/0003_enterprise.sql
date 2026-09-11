-- Additive feature records; existing operational state and checkpoint data are preserved.
CREATE TABLE ops_enterprise (
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 kind text NOT NULL CHECK(kind IN ('baseline','anomaly','artifact','analysis','control')),
 id text NOT NULL, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,kind,id)
);
CREATE INDEX ops_enterprise_status ON ops_enterprise(tenant_id,kind,(data->>'status'));
CREATE INDEX ops_enterprise_incident ON ops_enterprise(tenant_id,kind,(data->>'incidentId'));
ALTER TABLE ops_enterprise ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_enterprise FORCE ROW LEVEL SECURITY;
CREATE POLICY ops_enterprise_tenant ON ops_enterprise
 USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON ops_enterprise TO deviceops_app;
DROP INDEX ops_one_model_invocation;
CREATE UNIQUE INDEX ops_one_model_per_tenant ON ops_invocations(tenant_id) WHERE status='running';
ALTER TABLE ops_invocations ADD COLUMN workflow text NOT NULL DEFAULT 'single' CHECK(workflow IN ('single','specialists'));
ALTER TABLE ops_invocations ADD COLUMN tool_limit int NOT NULL DEFAULT 12 CHECK(tool_limit BETWEEN 1 AND 24);
