-- Cross-cutting tables shared by every module.
-- Source of truth: architecture/Studio Data Model.md

CREATE TABLE activity (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES person(id),
  action TEXT NOT NULL,
  payload TEXT, -- JSON
  created_at TEXT NOT NULL
);
CREATE INDEX idx_activity_entity ON activity(entity_type, entity_id);

CREATE TABLE comment (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES person(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_comment_entity ON comment(entity_type, entity_id);

-- Internal editorial note. Never published — see Studio Domain Model.md.
CREATE TABLE note (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES person(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_note_entity ON note(entity_type, entity_id);

CREATE TABLE task (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  assignee_id TEXT NOT NULL REFERENCES person(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open|in_progress|done
  due_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_task_entity ON task(entity_type, entity_id);
CREATE INDEX idx_task_assignee ON task(assignee_id);

CREATE TABLE notification (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES person(id),
  type TEXT NOT NULL,
  payload TEXT, -- JSON
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_notification_recipient ON notification(recipient_id);

-- Entity-level permission override on top of the role-based model
-- (roles: administrator, editor, reviewer, photographer, volunteer, viewer).
CREATE TABLE permission (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES person(id),
  role TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_permission_entity ON permission(entity_type, entity_id);
CREATE INDEX idx_permission_person ON permission(person_id);

-- Minimal placeholder. Replace with a D1 FTS5 virtual table (or an external
-- search index) once query patterns are known — see services/search/README.md.
CREATE TABLE search_index (
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  title TEXT,
  body TEXT,
  tags TEXT, -- JSON array
  updated_at TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);
