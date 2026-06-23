-- Remove UTF-8 BOM and common invisible Unicode from stored domain values.
-- Safe to run multiple times. Compatible with PostgreSQL 14+ (uses chr(), not \x{...} regex).

-- U+FEFF BOM, U+200B ZWSP, U+200C ZWNJ, U+200D ZWJ, U+2060 WORD JOINER
-- chr() builds the regex class without invalid escape sequences in string literals.

UPDATE blocked_domains
SET original_value = regexp_replace(
  original_value,
  '^[' || chr(65279) || chr(8203) || chr(8204) || chr(8205) || chr(8288) || ']+',
  '',
  'g'
)
WHERE original_value ~ ('^[' || chr(65279) || chr(8203) || chr(8204) || chr(8205) || chr(8288) || ']');

UPDATE blocked_domains
SET normalized_domain = regexp_replace(
  normalized_domain,
  '^[' || chr(65279) || chr(8203) || chr(8204) || chr(8205) || chr(8288) || ']+',
  '',
  'g'
)
WHERE normalized_domain ~ ('^[' || chr(65279) || chr(8203) || chr(8204) || chr(8205) || chr(8288) || ']');
