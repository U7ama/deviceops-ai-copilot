-- Durable reservations survive a worker crash. Only the private service role accesses this ledger.
CREATE TABLE ops_embedding_reservations (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 status text NOT NULL CHECK(status IN ('running','completed','unknown')),
 reserved_usd numeric(12,6) NOT NULL,
 cost_usd numeric(12,6),
 lease_until timestamptz NOT NULL,
 completed_at timestamptz
);
REVOKE ALL ON ops_embedding_reservations FROM deviceops_app;
