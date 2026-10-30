import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = mkdtempSync(join(root, "node_modules", "step-up-grant-race-test-"));
const mocks = {
	"@/db": "export function getDb(){return globalThis.grantRace.db}",
	"@/lib/ids": "let seq=0; export function newId(prefix){return prefix+'-'+(++seq)}",
	"@/lib/auth/session": "export async function hashSessionToken(token){return 'hash-'+token}",
};
await build({
	entryPoints: [join(root, "src/lib/auth/webauthn/grants.ts")],
	outfile: join(temporary, "grants.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	packages: "external",
	alias: { "@": join(root, "src") },
	logLevel: "silent",
	plugins: [{ name: "step-up-grant-fixtures", setup(builder) {
		builder.onResolve({ filter: /.*/ }, ({ path }) => path in mocks ? { path, namespace: "mock" } : undefined);
		builder.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({ contents: mocks[path], loader: "js" }));
	} }],
});
const { bumpSecurityVersion, consumeStepUpGrant, createStepUpGrant, peekStepUpGrant, StaleStepUpProofError } = await import(
	pathToFileURL(join(temporary, "grants.mjs")).href
);
let sqlite;
after(() => { sqlite?.close(); delete globalThis.grantRace; rmSync(temporary, { recursive: true, force: true }); });

function setup() {
	sqlite?.close();
	sqlite = new DatabaseSync(":memory:");
	sqlite.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, security_version INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE auth_step_ups (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_hash TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, purpose TEXT NOT NULL, target_user_id TEXT, security_version INTEGER NOT NULL DEFAULT 0, actor_security_version INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, used_at INTEGER, created_at INTEGER NOT NULL);
		INSERT INTO users VALUES ('admin',0);
		INSERT INTO users VALUES ('target',0);`);
	let afterInsert = null;
	const db = drizzle(async (sql, params, method) => {
		const query = sqlite.prepare(sql);
		let rows;
		if (method === "run") {
			query.run(...params);
			rows = [];
		} else {
			query.setReturnArrays(true);
			rows = query.all(...params);
		}
		if (afterInsert && /insert\s+into\s+"?auth_step_ups"?/i.test(sql)) {
			afterInsert();
			afterInsert = null;
		}
		return { rows };
	});
	globalThis.grantRace = {
		db,
		sqlite,
		afterInsert: (hook) => { afterInsert = hook; },
	};
}

const adminGrant = (expectedActorSecurityVersion = 0) => createStepUpGrant({}, {
	userId: "admin",
	sessionToken: "session",
	action: "admin.password_reset",
	targetUserId: "target",
	expectedActorSecurityVersion,
});
const consume = (token) => consumeStepUpGrant({}, {
	token,
	userId: "admin",
	sessionToken: "session",
	action: "admin.password_reset",
	targetUserId: "target",
});
const peek = (token) => peekStepUpGrant({}, {
	token,
	userId: "admin",
	sessionToken: "session",
	action: "admin.password_reset",
	targetUserId: "target",
});
const grants = () => sqlite.prepare("SELECT * FROM auth_step_ups").all();

test("a step-up grant is single use", async () => {
	setup();
	const token = await adminGrant();
	assert.equal(await consume(token), true);
	assert.equal(await consume(token), false);
});

test("a targeted grant stops working when the actor's security state changes", async () => {
	setup();
	const token = await adminGrant();
	await bumpSecurityVersion(globalThis.grantRace.db, "admin");
	assert.equal(await consume(token), false);
	assert.equal(grants().length, 0);
});

test("a targeted grant stops working when the target's security state changes", async () => {
	setup();
	const token = await adminGrant();
	await bumpSecurityVersion(globalThis.grantRace.db, "target");
	assert.equal(await consume(token), false);
	assert.equal(grants().length, 0);
});

test("a failed grant cleanup cannot keep a grant after the actor's security changes", async () => {
	setup();
	const token = await adminGrant();
	sqlite.exec(`CREATE TRIGGER fail_step_up_delete BEFORE DELETE ON auth_step_ups
		BEGIN SELECT RAISE(ABORT, 'delete failed'); END;`);
	await assert.rejects(
		bumpSecurityVersion(globalThis.grantRace.db, "admin"),
		(error) => {
			for (let cause = error.cause; cause; cause = cause.cause) {
				if (String(cause.message ?? cause).includes("delete failed")) return true;
			}
			return false;
		},
	);
	// The version bump committed even though revoking the row failed.
	assert.equal(sqlite.prepare("SELECT security_version FROM users WHERE id='admin'").get().security_version, 1);
	assert.equal(grants().length, 1);
	assert.equal(await peek(token), false);
	assert.equal(await consume(token), false);
});

test("a stale proof snapshot cannot be exchanged for a grant after an actor security change", async () => {
	setup();
	await bumpSecurityVersion(globalThis.grantRace.db, "admin");
	await assert.rejects(adminGrant(0), (error) => error instanceof StaleStepUpProofError);
	assert.equal(grants().length, 0);
});

test("a security change between the insert and the post-insert check cannot leave a live grant", async () => {
	setup();
	globalThis.grantRace.afterInsert(() => {
		sqlite.exec("UPDATE users SET security_version=security_version+1 WHERE id='admin'");
	});
	await assert.rejects(adminGrant(), /security state changed/);
	assert.equal(grants().length, 0);
});

test("a target security change during grant creation is not returned as a usable token", async () => {
	setup();
	globalThis.grantRace.afterInsert(() => {
		sqlite.exec("UPDATE users SET security_version=security_version+1 WHERE id='target'");
	});
	await assert.rejects(adminGrant(), /security state changed/);
	assert.equal(grants().length, 0);
});
