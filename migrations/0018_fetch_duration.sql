-- How long each fetch took, in milliseconds, when it was timed.
ALTER TABLE fetch_history ADD COLUMN duration_ms INTEGER;
