CREATE TABLE `push_history` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`passage_id` text NOT NULL,
	`sent_at` integer NOT NULL,
	`read_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`passage_id`) REFERENCES `passages`(`id`) ON UPDATE no action ON DELETE no action
);
