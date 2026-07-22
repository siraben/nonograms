UPDATE attempt_moves
SET seq = (
  SELECT COUNT(*)
  FROM attempt_moves AS earlier
  WHERE earlier.attempt_id = attempt_moves.attempt_id
    AND (
      earlier.seq < attempt_moves.seq
      OR (earlier.seq = attempt_moves.seq AND earlier.id <= attempt_moves.id)
    )
);

DROP INDEX idx_attempt_moves_attempt_seq;
CREATE UNIQUE INDEX idx_attempt_moves_attempt_seq ON attempt_moves(attempt_id, seq);
