CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  plan TEXT DEFAULT 'free',
  plan_until INTEGER DEFAULT 0,
  banned INTEGER DEFAULT 0,
  day TEXT DEFAULT '',
  msgs_today INTEGER DEFAULT 0,
  imgs_today INTEGER DEFAULT 0,
  total_msgs INTEGER DEFAULT 0,
  last_update INTEGER DEFAULT 0,
  created_at INTEGER,
  last_seen INTEGER
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER,
  role TEXT,
  content TEXT,
  ts INTEGER
);

CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, id);

CREATE TABLE IF NOT EXISTS summaries (
  chat_id INTEGER PRIMARY KEY,
  summary TEXT,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  fact TEXT,
  ts INTEGER
);

CREATE INDEX IF NOT EXISTS idx_facts_user ON facts(user_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
