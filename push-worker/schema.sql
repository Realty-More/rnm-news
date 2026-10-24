-- Anonymous usage counts. No user ids, IPs or cookies.
CREATE TABLE IF NOT EXISTS opens (day TEXT NOT NULL, post_id INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, post_id));
CREATE TABLE IF NOT EXISTS pages (day TEXT NOT NULL, page TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, page));
