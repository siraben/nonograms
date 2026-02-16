ALTER TABLE users ADD COLUMN invite_code_id TEXT REFERENCES invite_codes(id) ON DELETE SET NULL;
