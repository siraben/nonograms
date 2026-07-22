-- Existing rows contain bearer tokens and cannot be transformed without the
-- client-side token. Revoke them; new sessions store only SHA-256 digests.
DELETE FROM sessions;
