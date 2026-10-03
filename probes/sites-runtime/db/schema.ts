import { integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const documents = sqliteTable('hwp_documents', {
  owner: text('owner').notNull(), id: text('id').notNull(),
  currentVersion: text('current_version').notNull(),
  revision: integer('revision').notNull(), createdAt: integer('created_at').notNull(),
}, (t) => [primaryKey({ columns: [t.owner, t.id] })]);

export const versions = sqliteTable('hwp_versions', {
  owner: text('owner').notNull(), documentId: text('document_id').notNull(),
  id: text('id').notNull(), sha256: text('sha256').notNull(),
  blobKey: text('blob_key').notNull(), byteSize: integer('byte_size').notNull(),
  createdAt: integer('created_at').notNull(),
}, (t) => [primaryKey({ columns: [t.owner, t.documentId, t.id] }),
  uniqueIndex('idx_hwp_versions_blob_key').on(t.blobKey)]);

export const requests = sqliteTable('hwp_requests', {
  owner: text('owner').notNull(), id: text('id').notNull(),
  fingerprint: text('fingerprint').notNull(), documentId: text('document_id').notNull(),
  versionId: text('version_id').notNull(), createdAt: integer('created_at').notNull(),
}, (t) => [primaryKey({ columns: [t.owner, t.id] })]);

export const deletions = sqliteTable('hwp_deletions', {
  owner: text('owner').notNull(), documentId: text('document_id').notNull(),
  requestId: text('request_id').notNull(), expectedVersion: text('expected_version').notNull(),
  phase: text('phase').notNull(), versionCount: integer('version_count').notNull(),
  createdAt: integer('created_at').notNull(), completedAt: integer('completed_at'),
}, (t) => [primaryKey({ columns: [t.owner, t.documentId] }),
  uniqueIndex('idx_hwp_deletions_owner_request').on(t.owner, t.requestId)]);
