CREATE TABLE `hwp_deletions` (
	`owner` text NOT NULL,
	`document_id` text NOT NULL,
	`request_id` text NOT NULL,
	`expected_version` text NOT NULL,
	`phase` text NOT NULL,
	`version_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	PRIMARY KEY(`owner`, `document_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_hwp_deletions_owner_request` ON `hwp_deletions` (`owner`,`request_id`);