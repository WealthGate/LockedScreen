CREATE TABLE IF NOT EXISTS exam_attempts (
  package_key TEXT NOT NULL,
  student_key TEXT NOT NULL,
  lease_hash TEXT NOT NULL,
  claims INTEGER NOT NULL DEFAULT 1,
  started_at INTEGER NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (package_key, student_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS exam_attempt_lease ON exam_attempts(lease_hash);
