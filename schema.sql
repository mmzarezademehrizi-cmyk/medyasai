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

-- ماژول ایتا (کانال‌ها، زمان‌بندی، ایجنت‌ها)
CREATE TABLE IF NOT EXISTS ea_users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  eitaa_token_enc TEXT NOT NULL DEFAULT '',
  eitaa_account TEXT NOT NULL DEFAULT '',
  expires_at INTEGER,
  banned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ea_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  chat_id TEXT NOT NULL,
  title TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'eitaa',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_channels_user ON ea_channels(user_id);

CREATE TABLE IF NOT EXISTS ea_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  channel_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  file_id TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  silent INTEGER NOT NULL DEFAULT 0,
  pin INTEGER NOT NULL DEFAULT 0,
  view_delete INTEGER NOT NULL DEFAULT 0,
  run_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT NOT NULL DEFAULT '',
  eitaa_message_id TEXT NOT NULL DEFAULT '',
  claimed_at INTEGER,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  src_url TEXT NOT NULL DEFAULT '',
  job_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_posts_due ON ea_posts(status, run_at);

CREATE INDEX IF NOT EXISTS idx_posts_user ON ea_posts(user_id, status);

CREATE TABLE IF NOT EXISTS ea_sessions (
  user_id INTEGER PRIMARY KEY,
  state TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  channel_id INTEGER NOT NULL,            
  name TEXT NOT NULL DEFAULT '',
  instruction TEXT NOT NULL,              
  times TEXT NOT NULL DEFAULT '[]',       
  days TEXT,                              
  once_at INTEGER,                        
  footer TEXT NOT NULL DEFAULT '',        
  approve INTEGER NOT NULL DEFAULT 0,     
  enabled INTEGER NOT NULL DEFAULT 1,
  run_now INTEGER NOT NULL DEFAULT 0,     
  last_key TEXT NOT NULL DEFAULT '',      
  retry_at INTEGER,                       
  attempts INTEGER NOT NULL DEFAULT 0,
  last_info TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_user ON agent_jobs(user_id);

CREATE TABLE IF NOT EXISTS agent_seen (
  job_id INTEGER NOT NULL,
  k TEXT NOT NULL,                        
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (job_id, k)
);
