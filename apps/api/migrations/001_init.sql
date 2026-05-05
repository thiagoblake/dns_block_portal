CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS block_lists (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL,
  process_number TEXT,
  description TEXT,
  dns_action TEXT NOT NULL,
  redirect_ip TEXT,
  status TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  submitted_at TIMESTAMP,
  approved_at TIMESTAMP,
  applied_at TIMESTAMP,
  revoked_at TIMESTAMP,
  expires_at TIMESTAMP,
  revoke_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_block_lists_status ON block_lists(status);
CREATE INDEX IF NOT EXISTS idx_block_lists_source_type ON block_lists(source_type);

CREATE TABLE IF NOT EXISTS blocked_domains (
  id UUID PRIMARY KEY,
  block_list_id UUID REFERENCES block_lists(id),
  original_value TEXT NOT NULL,
  normalized_domain TEXT NOT NULL,
  is_valid BOOLEAN DEFAULT true,
  validation_error TEXT,
  created_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_blocked_domains_normalized_domain ON blocked_domains(normalized_domain);

CREATE TABLE IF NOT EXISTS uploaded_files (
  id UUID PRIMARY KEY,
  block_list_id UUID REFERENCES block_lists(id),
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  sha256_hash TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS apply_runs (
  id UUID PRIMARY KEY,
  status TEXT NOT NULL,
  started_at TIMESTAMP DEFAULT now(),
  finished_at TIMESTAMP,
  triggered_by UUID REFERENCES users(id),
  output TEXT,
  error_message TEXT,
  generated_file_path TEXT,
  backup_file_path TEXT,
  created_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_apply_runs_created_at ON apply_runs(created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  old_value JSONB,
  new_value JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
