-- Alerts born on the server (Meu Pluggy signed out, the sheet unreadable): the browser gets them
-- by push at once, and the Android app, which has no push service, picks them up the next time it
-- checks in (its 08:00 and evening reminders, and the widget's read every 3 hours). One row per
-- kind per day, so each is shown once; a row goes when its problem is solved, or after a week.
CREATE TABLE notice (
  -- The kind and the day, as "meu-pluggy:2026-11-11".
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  -- Where a tap opens: "/" is Hoje.
  url TEXT NOT NULL,
  created_at TEXT NOT NULL
);
