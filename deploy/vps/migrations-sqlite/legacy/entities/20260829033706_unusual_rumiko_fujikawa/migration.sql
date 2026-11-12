ALTER TABLE `calendar_event_index` ADD `summary` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `calendar_event_index` ADD `status` text DEFAULT 'Confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE `calendar_event_index` ADD `transparency` text DEFAULT 'Opaque' NOT NULL;