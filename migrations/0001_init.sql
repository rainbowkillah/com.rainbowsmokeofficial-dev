-- Contacts table to store submissions from the contact form
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  mobile TEXT,
  discord TEXT,
  interests TEXT NOT NULL,
  message TEXT,
  nsfw_access INTEGER NOT NULL DEFAULT 0,
  access_code_hash TEXT,
  access_code_last_four TEXT
);

CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_created_at ON contacts(created_at);
