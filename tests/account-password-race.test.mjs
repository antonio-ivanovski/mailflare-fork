import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = mkdtempSync(join(root, "node_modules", "account-password-race-test-"));
const mocks = {
	"@/lib/auth/password": "export function hasPasswordHash(value){return !!value && value!=='!passkey-only'} export function hashPassword(value){return 'hashed-'+value}",
	"@/lib/auth/webauthn/grants": "export async function bumpSecurityVersion(){globalThis.accountPasswordRace.sqlite.exec('UPDATE users SET security_version=security_version+1')}",
};
await build({
	entryPoints: [join(root, "src/app/api/accounts/[id]/utils.ts")],
	outfile: join(temporary, "accounts.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	packages: "external",
	alias: { "@": join(root, "src") },
	logLevel: "silent",
	plugins: [{ name: "account-password-fixtures", setup(builder) {
		builder.onResolve({ filter: /.*/ }, ({ path }) => path in mocks ? { path, namespace: "mock" } : undefined);
		builder.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({ contents: mocks[path], loader: "js" }));
	} }],
});
const { AccountSecurityChangedError, PasskeyOnlyPasswordError, updateAccountCredentials } = await import(
	pathToFileURL(join(temporary, "accounts.mjs")).href
);
let sqlite;
after(() => { sqlite?.close(); delete globalThis.accountPasswordRace; rmSync(temporary, { recursive: true, force: true }); });

function setup({ concurrent = "", passwordHash = "$2b$12$old" } = {}) {
	sqlite?.close();
	sqlite = new DatabaseSync(":memory:");
	sqlite.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, name TEXT NOT NULL, password_hash TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, security_version INTEGER NOT NULL DEFAULT 0, totp_enabled INTEGER NOT NULL DEFAULT 0, require_second_factor INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE mailboxes (user_id TEXT NOT NULL, type TEXT NOT NULL, display_name TEXT);
		INSERT INTO users VALUES ('target','old@example.test','Old Name','${passwordHash}',0,4,0,1);
		INSERT INTO mailboxes VALUES ('target','personal','Old Name');`);
	let pending = concurrent;
	const db = drizzle(async (sql, params, method) => {
		if (pending && /update\s+"?users"?/i.test(sql) && /password_hash/i.test(sql)) {
			sqlite.exec(pending);
			pending = "";
		}
		const query = sqlite.prepare(sql);
		if (method === "run") { query.run(...params); return { rows: [] }; }
		query.setReturnArrays(true);
		return { rows: query.all(...params) };
	});
	globalThis.accountPasswordRace = { db, sqlite };
}

const update = (db) => updateAccountCredentials(db, "target", {
	name: "New Name",
	email: "new@example.test",
	password: "new-password",
	disabled: true,
});
const row = () => sqlite.prepare("SELECT * FROM users WHERE id='target'").get();

test("an administrator password reset writes the account fields together", async () => {
	setup();
	await update(globalThis.accountPasswordRace.db);
	assert.equal(row().password_hash, "hashed-new-password");
	assert.equal(row().email, "new@example.test");
	assert.equal(row().name, "New Name");
	assert.equal(row().disabled, 1);
	assert.equal(row().security_version, 5);
	assert.equal(sqlite.prepare("SELECT display_name FROM mailboxes WHERE user_id='target'").get().display_name, "New Name");
});

test("a concurrent passkey-only conversion keeps its existing error and password", async () => {
	setup({ concurrent: "UPDATE users SET password_hash='!passkey-only' WHERE id='target'" });
	await assert.rejects(update(globalThis.accountPasswordRace.db), (error) => error instanceof PasskeyOnlyPasswordError);
	assert.equal(row().password_hash, "!passkey-only");
	assert.equal(row().name, "Old Name");
	assert.equal(row().security_version, 4);
});

test("a concurrent security-version bump rejects the stale administrator snapshot", async () => {
	setup({ concurrent: "UPDATE users SET security_version=security_version+1 WHERE id='target'" });
	await assert.rejects(update(globalThis.accountPasswordRace.db), (error) => error instanceof AccountSecurityChangedError);
	assert.equal(row().password_hash, "$2b$12$old");
	assert.equal(row().name, "Old Name");
});

test("a concurrent password change is not overwritten by an administrator reset", async () => {
	setup({ concurrent: "UPDATE users SET password_hash='$2b$12$other', security_version=security_version+1 WHERE id='target'" });
	await assert.rejects(update(globalThis.accountPasswordRace.db), (error) => error instanceof AccountSecurityChangedError);
	assert.equal(row().password_hash, "$2b$12$other");
	assert.equal(row().name, "Old Name");
});

test("a passkey-only account is rejected before the write", async () => {
	setup({ passwordHash: "!passkey-only" });
	await assert.rejects(update(globalThis.accountPasswordRace.db), (error) => error instanceof PasskeyOnlyPasswordError);
	assert.equal(row().password_hash, "!passkey-only");
});
