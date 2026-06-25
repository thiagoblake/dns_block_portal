CREATE TABLE IF NOT EXISTS revocation_batches (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL,
  process_number TEXT,
  description TEXT,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  reject_reason TEXT,
  created_by UUID REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  submitted_at TIMESTAMP,
  approved_at TIMESTAMP,
  applied_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_revocation_batches_status ON revocation_batches(status);

CREATE TABLE IF NOT EXISTS revocation_batch_items (
  id UUID PRIMARY KEY,
  revocation_batch_id UUID NOT NULL REFERENCES revocation_batches(id) ON DELETE CASCADE,
  original_value TEXT NOT NULL,
  normalized_domain TEXT NOT NULL DEFAULT '',
  match_status TEXT NOT NULL,
  validation_error TEXT,
  blocked_domain_id UUID,
  block_list_id UUID,
  block_list_title TEXT,
  created_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_revocation_batch_items_batch ON revocation_batch_items(revocation_batch_id);
CREATE INDEX IF NOT EXISTS idx_revocation_batch_items_match ON revocation_batch_items(match_status);

ALTER TABLE revocation_requests
  ADD COLUMN IF NOT EXISTS revocation_batch_id UUID REFERENCES revocation_batches(id);
