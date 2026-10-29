ALTER TABLE `users` ADD `security_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `auth_step_ups` ADD `target_user_id` text;--> statement-breakpoint
ALTER TABLE `auth_step_ups` ADD `security_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `passkey_credentials` ADD `aaguid` text;
--> statement-breakpoint
CREATE TRIGGER `users_require_second_factor_update` BEFORE UPDATE OF `require_second_factor` ON `users`
WHEN NEW.`require_second_factor` = 1 AND NEW.`passkey_count` = 0 AND NEW.`totp_enabled` = 0 AND NEW.`deleted_at` IS NULL
BEGIN
	SELECT RAISE(ABORT, 'second-factor-unavailable');
END;
