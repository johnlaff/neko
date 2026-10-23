-- How often each screen opens and each button is used, per day and per app, so what to keep or
-- cut is decided with data. Counts only: never an amount, a name or anything that was on the
-- screen.
CREATE TABLE usage_day (
  day TEXT NOT NULL,
  event TEXT NOT NULL,
  app TEXT NOT NULL CHECK (app IN ('web', 'android')),
  count INTEGER NOT NULL,
  PRIMARY KEY (day, event, app)
);
