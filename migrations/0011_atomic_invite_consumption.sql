CREATE TRIGGER consume_invite_before_user_insert
BEFORE INSERT ON users
WHEN NEW.invite_code_id IS NOT NULL
BEGIN
  UPDATE invite_codes
  SET uses = uses + 1
  WHERE id = NEW.invite_code_id
    AND disabled = 0
    AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
    AND (max_uses IS NULL OR uses < max_uses);

  SELECT CASE
    WHEN changes() != 1 THEN RAISE(ABORT, 'invite code exhausted')
  END;
END;
