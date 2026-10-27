-- Anonymous usage counts. No user ids, IPs or cookies.
CREATE TABLE IF NOT EXISTS opens (day TEXT NOT NULL, post_id INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, post_id));
CREATE TABLE IF NOT EXISTS pages (day TEXT NOT NULL, page TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, page));
CREATE TABLE IF NOT EXISTS searches (day TEXT NOT NULL, q TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, zero INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, q));
CREATE TABLE IF NOT EXISTS shares (day TEXT NOT NULL, post_id INTEGER NOT NULL, channel TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, post_id, channel));
CREATE TABLE IF NOT EXISTS pushes (ts TEXT NOT NULL, title TEXT, body TEXT, url TEXT, by_name TEXT, sent INTEGER);
CREATE TABLE IF NOT EXISTS uptime (ts TEXT NOT NULL, ok INTEGER NOT NULL, ms INTEGER, status INTEGER);
CREATE INDEX IF NOT EXISTS uptime_ts ON uptime (ts);
CREATE TABLE IF NOT EXISTS calendar (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, notes TEXT, status TEXT NOT NULL DEFAULT 'idea', due TEXT, source TEXT, created_by TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS attendance (person_id TEXT NOT NULL, name TEXT, day TEXT NOT NULL, check_in TEXT, check_out TEXT, mode TEXT, note TEXT, in_lat REAL, in_lng REAL, in_acc REAL, out_lat REAL, out_lng REAL, out_acc REAL, PRIMARY KEY (person_id, day));
-- Added 2026-10-27 to an existing database with: ALTER TABLE attendance ADD COLUMN in_lat REAL; (and in_lng, in_acc, out_lat, out_lng, out_acc)
CREATE TABLE IF NOT EXISTS reports (person_id TEXT NOT NULL, name TEXT, day TEXT NOT NULL, done TEXT, plan TEXT, blockers TEXT, links TEXT, submitted_at TEXT, PRIMARY KEY (person_id, day));
CREATE TABLE IF NOT EXISTS webposts (post_id INTEGER PRIMARY KEY, title TEXT, link TEXT, published TEXT, section TEXT, views INTEGER NOT NULL DEFAULT 0, checked_at TEXT);
CREATE INDEX IF NOT EXISTS webposts_published ON webposts (published);
CREATE TABLE IF NOT EXISTS webviews (post_id INTEGER NOT NULL, hour TEXT NOT NULL, views INTEGER NOT NULL, PRIMARY KEY (post_id, hour));
CREATE INDEX IF NOT EXISTS webviews_hour ON webviews (hour);
CREATE TABLE IF NOT EXISTS contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, designation TEXT, company TEXT, address TEXT, city TEXT, pin TEXT, phone TEXT, email TEXT, remark TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT, updated_at TEXT, updated_by TEXT);
CREATE TABLE IF NOT EXISTS mag_issues (id TEXT PRIMARY KEY, title TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS mag_dispatch (issue_id TEXT NOT NULL, contact_id INTEGER NOT NULL, status TEXT NOT NULL, courier TEXT, tracking TEXT, by_name TEXT, updated_at TEXT, PRIMARY KEY (issue_id, contact_id));
CREATE TABLE IF NOT EXISTS mkt_index (day TEXT NOT NULL, name TEXT NOT NULL, open REAL, high REAL, low REAL, close REAL NOT NULL, pts REAL, pct REAL, PRIMARY KEY (day, name));
CREATE TABLE IF NOT EXISTS mkt_stock (day TEXT NOT NULL, symbol TEXT NOT NULL, series TEXT, prev REAL, open REAL, high REAL, low REAL, close REAL NOT NULL, PRIMARY KEY (day, symbol));
CREATE TABLE IF NOT EXISTS mkt_meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS reel_refs (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT, size INTEGER, week TEXT, kind TEXT, note TEXT, by_name TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS ai_usage (day TEXT NOT NULL, who TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, who));
CREATE TABLE IF NOT EXISTS accounts (phone TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, created_at TEXT, approved_at TEXT, last_login TEXT, must_change INTEGER NOT NULL DEFAULT 0, last_seen TEXT);
-- Added 2026-10-27 to an existing database with: ALTER TABLE accounts ADD COLUMN must_change INTEGER NOT NULL DEFAULT 0; ALTER TABLE accounts ADD COLUMN last_seen TEXT;
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, phone TEXT NOT NULL, created_at TEXT, expires_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_phone ON sessions (phone);
CREATE TABLE IF NOT EXISTS auth_fail (k TEXT NOT NULL, hour TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (k, hour));
CREATE TABLE IF NOT EXISTS yt_videos (id TEXT PRIMARY KEY, title TEXT, published TEXT, playlists TEXT, short INTEGER, views INTEGER NOT NULL DEFAULT 0, likes INTEGER, thumb TEXT, checked_at TEXT);
CREATE TABLE IF NOT EXISTS yt_views (id TEXT NOT NULL, hour TEXT NOT NULL, views INTEGER NOT NULL, PRIMARY KEY (id, hour));
CREATE INDEX IF NOT EXISTS yt_views_hour ON yt_views (hour);
CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, details TEXT, assignee_id TEXT NOT NULL, assignee_name TEXT, due TEXT, priority TEXT NOT NULL DEFAULT 'normal', status TEXT NOT NULL DEFAULT 'open', created_by TEXT, created_at TEXT NOT NULL, done_at TEXT, done_note TEXT);
CREATE INDEX IF NOT EXISTS tasks_assignee ON tasks (assignee_id, status);
CREATE TABLE IF NOT EXISTS leaves (id INTEGER PRIMARY KEY AUTOINCREMENT, person_id TEXT NOT NULL, name TEXT, kind TEXT NOT NULL, from_day TEXT NOT NULL, to_day TEXT NOT NULL, half INTEGER NOT NULL DEFAULT 0, reason TEXT, status TEXT NOT NULL DEFAULT 'pending', decided_by TEXT, decided_at TEXT, decision_note TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS leaves_person ON leaves (person_id, from_day);
-- Ad sales tracker: advertisers, deals (amount before GST, stage, follow-up, payment due) and payments received.
CREATE TABLE IF NOT EXISTS ad_clients (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, contact TEXT, phone TEXT, email TEXT, city TEXT, gstin TEXT, notes TEXT, created_by TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS ad_deals (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL, title TEXT NOT NULL, medium TEXT NOT NULL, period TEXT, amount INTEGER NOT NULL DEFAULT 0, gst_pct REAL NOT NULL DEFAULT 18, stage TEXT NOT NULL DEFAULT 'lead', handled_by TEXT, next_date TEXT, next_action TEXT, invoice_no TEXT, due_day TEXT, notes TEXT, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ad_deals_client ON ad_deals (client_id);
CREATE TABLE IF NOT EXISTS ad_payments (id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER NOT NULL, day TEXT NOT NULL, amount INTEGER NOT NULL, mode TEXT, ref TEXT, note TEXT, by_name TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ad_payments_deal ON ad_payments (deal_id);
-- Weekly newsletter: subscribers (double opt-in), issues, who got each issue, and emails sent per day (daily cap).
CREATE TABLE IF NOT EXISTS news_subs (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, name TEXT, status TEXT NOT NULL, token TEXT NOT NULL, source TEXT, created_at TEXT NOT NULL, confirm_sent_at TEXT, confirmed_at TEXT, unsub_at TEXT);
CREATE INDEX IF NOT EXISTS news_subs_token ON news_subs (token);
CREATE TABLE IF NOT EXISTS news_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, week TEXT NOT NULL UNIQUE, subject TEXT NOT NULL, html TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL, sent_at TEXT, sent INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS news_sends (issue_id INTEGER NOT NULL, sub_id INTEGER NOT NULL, day TEXT NOT NULL, ok INTEGER NOT NULL, PRIMARY KEY (issue_id, sub_id));
CREATE TABLE IF NOT EXISTS news_mail (day TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind));
-- Team profiles: display title, photo (small data URL) or avatar.
CREATE TABLE IF NOT EXISTS profiles (person_id TEXT PRIMARY KEY, title TEXT, photo TEXT, avatar TEXT, updated_at TEXT);
-- Press release → story drafts (desk house style).
CREATE TABLE IF NOT EXISTS pr_drafts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, source TEXT, story TEXT NOT NULL, by_name TEXT, created_at TEXT NOT NULL);
