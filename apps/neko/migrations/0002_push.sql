-- Browsers that asked for the daily reminders. The endpoint is the push service URL; p256dh and
-- auth are the browser's keys to encrypt each message (RFC 8291).
CREATE TABLE push_subscription (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL
);
