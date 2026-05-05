-- Marca domínios que já existiam em outra lista ativa (texto para exibição na UI).
ALTER TABLE blocked_domains
  ADD COLUMN IF NOT EXISTS preexisting_note TEXT NOT NULL DEFAULT '';
