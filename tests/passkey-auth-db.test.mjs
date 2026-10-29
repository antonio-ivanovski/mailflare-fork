import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";

const { migrations } = JSON.parse(readFileSync(new URL("../src/lib/migrations/bundle.json", import.meta.url), "utf8"));

function database() {
	const db = new Database(":memory:");
	db.pragma("foreign_keys = OFF");
	for (const migration of migrations) for (const statement of migration.statements) db.exec(statement);
	return db;
}

function addUser(db, { id, passwordHash, requireSecondFactor = 0, totpEnabled = 0 }) {
	db.prepare(
		`INSERT INTO users (
			id, email, password_hash, name, role, is_primary_admin, disabled, can_manage_mailboxes,
			can_manage_domains, can_manage_users, keyboard_shortcuts_enabled, spam_protection_enabled,
			show_full_recipient_addresses, remote_content_mode, require_second_factor, totp_enabled, created_at
		) VALUES (?, ?, ?, 'User', 'user', 0, 0, 0, 0, 0, 1, 1, 0, 'allow', ?, ?, 1)`,
	).run(id, `${id}@example.test`, passwordHash, requireSecondFactor, totpEnabled);
}

function addPasskey(db, { id, userId }) {
	db.prepare(
		`INSERT INTO passkey_credentials (
			id, user_id, credential_id, credential_hash, public_key, counter, device_type, backed_up, name, created_at
		) VALUES (?, ?, ?, ?, 'key', 0, 'singleDevice', 0, 'Test', 1)`,
	).run(id, userId, id, `hash-${id}`);
}

test("deleting credentials keeps passkey_count in step", () => {
	const db = database();
	addUser(db, { id: "u1", passwordHash: "$2b$12$hash" });
	addPasskey(db, { id: "p1", userId: "u1" });
	addPasskey(db, { id: "p2", userId: "u1" });
	assert.equal(db.prepare("SELECT passkey_count FROM users WHERE id = 'u1'").get().passkey_count, 2);
	db.prepare("DELETE FROM passkey_credentials WHERE id = 'p1'").run();
	assert.equal(db.prepare("SELECT passkey_count FROM users WHERE id = 'u1'").get().passkey_count, 1);
});

test("a passwordless account cannot lose its last passkey", () => {
	const db = database();
	addUser(db, { id: "u1", passwordHash: "!passkey-only" });
	addPasskey(db, { id: "p1", userId: "u1" });
	assert.throws(() => db.prepare("DELETE FROM passkey_credentials WHERE id = 'p1'").run(), /last-auth-method/);
	assert.equal(db.prepare("SELECT passkey_count FROM users WHERE id = 'u1'").get().passkey_count, 1);
});

test("removing the password is rejected when no passkey remains", () => {
	const db = database();
	addUser(db, { id: "u1", passwordHash: "$2b$12$hash" });
	addPasskey(db, { id: "p1", userId: "u1" });
	db.prepare("DELETE FROM passkey_credentials WHERE id = 'p1'").run();
	assert.throws(
		() => db.prepare("UPDATE users SET password_hash = '!passkey-only' WHERE id = 'u1'").run(),
		/last-auth-method/,
	);
});

test("a required second factor keeps the last passkey when TOTP is off", () => {
	const db = database();
	addUser(db, { id: "u1", passwordHash: "$2b$12$hash", requireSecondFactor: 1 });
	addPasskey(db, { id: "p1", userId: "u1" });
	assert.throws(() => db.prepare("DELETE FROM passkey_credentials WHERE id = 'p1'").run(), /last-auth-method/);
});

test("purging a deleted account can remove its last passkey", () => {
	const db = database();
	addUser(db, { id: "u1", passwordHash: "!passkey-only" });
	addPasskey(db, { id: "p1", userId: "u1" });
	db.prepare("UPDATE users SET deleted_at = 1 WHERE id = 'u1'").run();
	db.prepare("DELETE FROM users WHERE id = 'u1'").run();
	// Restore deletes users before the credential table; with foreign keys off
	// the credentials remain and must not trip the guard once their owner is gone.
	db.prepare("DELETE FROM passkey_credentials").run();
	assert.equal(db.prepare("SELECT COUNT(*) AS count FROM users").get().count, 0);
	assert.equal(db.prepare("SELECT COUNT(*) AS count FROM passkey_credentials").get().count, 0);
});

test("requiring a second step needs an enrolled factor", () => {
	const db = database();
	addUser(db, { id: "u1", passwordHash: "$2b$12$hash" });
	assert.throws(
		() => db.prepare("UPDATE users SET require_second_factor = 1 WHERE id = 'u1'").run(),
		/second-factor-unavailable/,
	);
	addPasskey(db, { id: "p1", userId: "u1" });
	db.prepare("UPDATE users SET require_second_factor = 1 WHERE id = 'u1'").run();
	assert.equal(db.prepare("SELECT require_second_factor FROM users WHERE id = 'u1'").get().require_second_factor, 1);
});

test("PostgreSQL and MySQL ship the passkey triggers and bound-grant columns", () => {
	for (const directory of ["drizzle/migrations-pg", "drizzle/migrations-mysql"]) {
		const sql = ["0003_passkeys.sql", "0004_bound_step_up_grants.sql"]
			.map((name) => readFileSync(new URL(`../${directory}/${name}`, import.meta.url), "utf8"))
			.join("\n");
		for (const needle of ["passkey_count", "last-auth-method", "second-factor-unavailable", "security_version", "target_user_id"]) {
			assert.ok(sql.includes(needle), `${directory} lacks ${needle}`);
		}
	}
});

test("a normal password-only fallback allows the last passkey to go", () => {
	const db = database();
	addUser(db, { id: "u1", passwordHash: "$2b$12$hash" });
	addPasskey(db, { id: "p1", userId: "u1" });
	db.prepare("DELETE FROM passkey_credentials WHERE id = 'p1'").run();
	assert.equal(db.prepare("SELECT passkey_count FROM users WHERE id = 'u1'").get().passkey_count, 0);
});
