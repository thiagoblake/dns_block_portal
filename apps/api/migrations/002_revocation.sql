-- Revogação unitária e solicitações
ALTER TABLE blocked_domains
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS revocation_requests (
  id UUID PRIMARY KEY,
  kind TEXT NOT NULL,
  block_list_id UUID NOT NULL REFERENCES block_lists(id),
  blocked_domain_id UUID,
  status TEXT NOT NULL,
  reason TEXT,
  reject_reason TEXT,
  requested_by UUID REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  approved_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_revocation_requests_status ON revocation_requests(status);
CREATE INDEX IF NOT EXISTS idx_revocation_requests_block_list ON revocation_requests(block_list_id);
