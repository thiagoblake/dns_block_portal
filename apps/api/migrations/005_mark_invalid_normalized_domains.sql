-- Marca domínios com normalized_domain fora do padrão DNS (evita linhas inválidas no Unbound).
-- Padrão alinhado ao worker/API: labels a-z0-9-, TLD 2-63 chars, termina com ponto.

UPDATE blocked_domains
SET is_valid = false,
    validation_error = COALESCE(NULLIF(validation_error, ''), 'invalid normalized_domain (migration 005)')
WHERE is_valid = true
  AND revoked_at IS NULL
  AND normalized_domain !~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\.$';
