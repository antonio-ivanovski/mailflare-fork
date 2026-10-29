ALTER TABLE "users" ADD COLUMN "security_version" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_step_ups" ADD COLUMN "target_user_id" text;--> statement-breakpoint
ALTER TABLE "auth_step_ups" ADD COLUMN "security_version" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "passkey_credentials" ADD COLUMN "aaguid" text;
--> statement-breakpoint
CREATE FUNCTION mailflare_require_second_factor_update() RETURNS trigger AS $$
BEGIN
	IF NEW.require_second_factor AND NEW.passkey_count = 0 AND NOT NEW.totp_enabled AND NEW.deleted_at IS NULL THEN
		RAISE EXCEPTION 'second-factor-unavailable';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER users_require_second_factor_update BEFORE UPDATE OF require_second_factor ON users
FOR EACH ROW EXECUTE FUNCTION mailflare_require_second_factor_update();
