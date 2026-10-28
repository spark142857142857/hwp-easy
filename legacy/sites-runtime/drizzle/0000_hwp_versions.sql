CREATE TABLE `hwp_documents` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`current_version` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE TABLE `hwp_requests` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`document_id` text NOT NULL,
	`version_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE TABLE `hwp_versions` (
	`owner` text NOT NULL,
	`document_id` text NOT NULL,
	`id` text NOT NULL,
	`sha256` text NOT NULL,
	`blob_key` text NOT NULL,
	`byte_size` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner`, `document_id`, `id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_hwp_versions_blob_key` ON `hwp_versions` (`blob_key`);