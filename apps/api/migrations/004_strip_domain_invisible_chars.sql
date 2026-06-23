-- Remove UTF-8 BOM and common invisible Unicode from stored domain values.
-- Safe to run multiple times.

UPDATE blocked_domains
SET original_value = regexp_replace(original_value, '^[\x{FEFF}\x{200B}\x{200C}\x{200D}\x{2060}]+', '', 'g')
WHERE original_value ~ '^[\x{FEFF}\x{200B}\x{200C}\x{200D}\x{2060}]';

UPDATE blocked_domains
SET normalized_domain = regexp_replace(normalized_domain, '^[\x{FEFF}\x{200B}\x{200C}\x{200D}\x{2060}]+', '', 'g')
WHERE normalized_domain ~ '^[\x{FEFF}\x{200B}\x{200C}\x{200D}\x{2060}]';
