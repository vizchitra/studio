/**
 * Studio Domain Model — TypeScript types.
 *
 * Source of truth: /architecture/Studio Data Model.md
 * Do not add fields here that aren't in that document — update the doc first.
 */

export type EntityStatus = "draft" | "review" | "approved" | "published" | "archived";

export interface EntityBase {
  id: string; // ULID
  type: string; // discriminator, matches table name
  slug?: string;
  status: EntityStatus;
  created_at: string; // ISO timestamp
  updated_at: string;
  created_by: string; // Person id
  updated_by: string; // Person id
}

export interface Person extends EntityBase {
  type: "person";
  name: string;
  email?: string;
  bio?: string;
  roles: PersonRole[];
}

export type PersonRole =
  | "speaker"
  | "contributor"
  | "reviewer"
  | "volunteer"
  | "organiser"
  | "photographer"
  | "sponsor_contact";

export interface Organisation extends EntityBase {
  type: "organisation";
  name: string;
  kind: "sponsor" | "partner" | "venue" | "employer" | "media";
}

export interface Event extends EntityBase {
  type: "event";
  name: string;
  starts_at?: string;
  ends_at?: string;
}

export interface Session extends EntityBase {
  type: "session";
  event_id: string;
  title: string;
  kind: "talk" | "workshop" | "dialogue" | "exhibition" | "panel";
  starts_at?: string;
  ends_at?: string;
}

export interface Content extends EntityBase {
  type: "content";
  kind: "article" | "guide" | "announcement" | "page" | "newsletter";
  title: string;
  body: string;
  author_id?: string; // Person id
  event_id?: string;
}

export interface Asset extends EntityBase {
  type: "asset";
  kind: "photo" | "video" | "audio" | "pdf" | "logo" | "transcript" | "brand";
  title?: string;
  perceptual_hash?: string;
}

export type AssetVersionKind = "original" | "review" | "edited" | "web" | "social" | "thumbnail";

export interface AssetVersion {
  id: string;
  asset_id: string;
  kind: AssetVersionKind;
  mime_type: string;
  r2_key: string;
  size_bytes: number;
  width?: number;
  height?: number;
  duration_seconds?: number;
  checksum: string;
  exif?: Record<string, unknown>;
  created_at: string;
}

export interface Collection extends EntityBase {
  type: "collection";
  name: string;
}

export interface Publication {
  id: string;
  entity_id: string;
  entity_type: string;
  version: string;
  published_url: string;
  published_at: string;
}

export interface Tag {
  id: string;
  name: string;
  slug: string;
}

export type RelationshipKind =
  | "presents"
  | "authored"
  | "illustrates"
  | "sponsors"
  | "member_of"
  | "reviews";

export interface Relationship {
  id: string;
  from_id: string;
  from_type: string;
  to_id: string;
  to_type: string;
  kind: RelationshipKind;
  created_at: string;
}

export interface Task {
  id: string;
  entity_id: string;
  entity_type: string;
  assignee_id: string; // Person id
  title: string;
  status: "open" | "in_progress" | "done";
  due_at?: string;
  created_at: string;
}

export interface Note {
  id: string;
  entity_id: string;
  entity_type: string;
  author_id: string; // Person id
  body: string;
  created_at: string;
}

export interface Activity {
  id: string;
  entity_id: string;
  entity_type: string;
  actor_id: string; // Person id
  action: string;
  payload?: Record<string, unknown>;
  created_at: string;
}
