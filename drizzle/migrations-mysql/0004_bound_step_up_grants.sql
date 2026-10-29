ALTER TABLE `users` ADD `security_version` bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `auth_step_ups` ADD `target_user_id` varchar(191);--> statement-breakpoint
ALTER TABLE `auth_step_ups` ADD `security_version` bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `passkey_credentials` ADD `aaguid` longtext;
--> statement-breakpoint
CREATE TRIGGER `users_require_second_factor_update` BEFORE UPDATE ON `users` FOR EACH ROW
BEGIN
	IF OLD.`require_second_factor` = 0
		AND NEW.`require_second_factor` = 1
		AND NEW.`passkey_count` = 0
		AND NEW.`totp_enabled` = 0
		AND NEW.`deleted_at` IS NULL THEN
		SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'second-factor-unavailable';
	END IF;
END;
