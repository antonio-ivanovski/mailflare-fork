import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { authStepUps, passkeyEnrollmentGrants, users } from "@/db/schema";
import { newId } from "@/lib/ids";
import { hashSessionToken } from "@/lib/auth/session";
import type { StepUpAction } from "./step-up-types";

const ENROLLMENT_MINUTES: Record<EnrollmentGrantKind, number> = {
	// A first-run administrator may need to come back later in the same browser
	// (for example after a password-manager prompt), so this outlives a normal
	// settings change.
	setup: 24 * 60,
	recovery: 30,
	admin: 30,
};
const STEP_UP_MINUTES = 10;

export type EnrollmentGrantKind = "setup" | "recovery" | "admin";

/** First-run setup token, kept in an HttpOnly cookie instead of the URL. */
export const SETUP_COOKIE = "ep_setup";

export type EnrollmentGrant = {
	id: string;
	userId: string;
	kind: EnrollmentGrantKind;
	expiresAt: Date;
};

export async function createEnrollmentGrant(
	env: CloudflareEnv,
	input: { userId: string; kind: EnrollmentGrantKind; createdByUserId?: string | null },
): Promise<string> {
	const db = getDb(env);
	const token = newId("peg");
	// Only one live enrolment link per account: a new one revokes the old one.
	await db
		.update(passkeyEnrollmentGrants)
		.set({ usedAt: new Date() })
		.where(and(eq(passkeyEnrollmentGrants.userId, input.userId), isNull(passkeyEnrollmentGrants.usedAt)));
	await db.insert(passkeyEnrollmentGrants).values({
		id: newId(),
		userId: input.userId,
		tokenHash: await hashSessionToken(token),
		kind: input.kind,
		createdByUserId: input.createdByUserId ?? null,
		expiresAt: new Date(Date.now() + ENROLLMENT_MINUTES[input.kind] * 60 * 1000),
	});
	return token;
}

export async function getEnrollmentGrant(env: CloudflareEnv, token: string): Promise<EnrollmentGrant | null> {
	const db = getDb(env);
	const [row] = await db
		.select()
		.from(passkeyEnrollmentGrants)
		.where(
			and(
				eq(passkeyEnrollmentGrants.tokenHash, await hashSessionToken(token)),
				isNull(passkeyEnrollmentGrants.usedAt),
				gt(passkeyEnrollmentGrants.expiresAt, new Date()),
			),
		)
		.limit(1);
	return row ? { id: row.id, userId: row.userId, kind: row.kind, expiresAt: row.expiresAt } : null;
}

/** Burn a grant after the new credential was verified and stored. */
export async function consumeEnrollmentGrant(env: CloudflareEnv, id: string): Promise<boolean> {
	const db = getDb(env);
	const rows = await db
		.update(passkeyEnrollmentGrants)
		.set({ usedAt: new Date() })
		.where(and(eq(passkeyEnrollmentGrants.id, id), isNull(passkeyEnrollmentGrants.usedAt)))
		.returning({ id: passkeyEnrollmentGrants.id });
	return rows.length > 0;
}

async function currentSecurityVersion(env: CloudflareEnv, userId: string): Promise<number | null> {
	const [row] = await getDb(env).select({ securityVersion: users.securityVersion }).from(users).where(eq(users.id, userId)).limit(1);
	return row?.securityVersion ?? null;
}

export async function createStepUpGrant(
	env: CloudflareEnv,
	input: { userId: string; sessionToken: string; action: StepUpAction; targetUserId?: string | null },
): Promise<string> {
	const db = getDb(env);
	const targetUserId = input.targetUserId ?? null;
	const version = await currentSecurityVersion(env, targetUserId ?? input.userId);
	if (version === null) throw new Error("The account no longer exists");
	const token = newId("sup");
	await db.insert(authStepUps).values({
		id: newId(),
		userId: input.userId,
		sessionHash: await hashSessionToken(input.sessionToken),
		tokenHash: await hashSessionToken(token),
		purpose: input.action,
		targetUserId,
		securityVersion: version,
		expiresAt: new Date(Date.now() + STEP_UP_MINUTES * 60 * 1000),
	});
	// Expired grants can never be consumed; dropping them keeps the table small.
	await db.delete(authStepUps).where(lt(authStepUps.expiresAt, new Date()));
	return token;
}

async function grantConditions(input: {
	userId: string;
	sessionToken: string;
	action: StepUpAction;
	targetUserId?: string | null;
}) {
	const targetUserId = input.targetUserId ?? null;
	const target = targetUserId ?? input.userId;
	return and(
		eq(authStepUps.userId, input.userId),
		eq(authStepUps.sessionHash, await hashSessionToken(input.sessionToken)),
		eq(authStepUps.purpose, input.action),
		targetUserId ? eq(authStepUps.targetUserId, targetUserId) : isNull(authStepUps.targetUserId),
		eq(authStepUps.securityVersion, sql`(select ${users.securityVersion} from ${users} where ${users.id} = ${target})`),
	);
}

/**
 * Non-consuming check used before opening a browser ceremony. Completion must
 * still consume the grant atomically.
 */
export async function peekStepUpGrant(
	env: CloudflareEnv,
	input: { token: string; userId: string; sessionToken: string; action: StepUpAction; targetUserId?: string | null },
): Promise<boolean> {
	const [row] = await getDb(env)
		.select({ id: authStepUps.id })
		.from(authStepUps)
		.where(
			and(
				await grantConditions(input),
				eq(authStepUps.tokenHash, await hashSessionToken(input.token)),
				isNull(authStepUps.usedAt),
				gt(authStepUps.expiresAt, new Date()),
			),
		)
		.limit(1);
	return !!row;
}

/**
 * Spends a grant for exactly the action and target it was minted for, and only
 * while the target's security configuration is unchanged. The conditional
 * UPDATE keeps this single-use under concurrency.
 */
export async function consumeStepUpGrant(
	env: CloudflareEnv,
	input: { token: string; userId: string; sessionToken: string; action: StepUpAction; targetUserId?: string | null },
): Promise<boolean> {
	const rows = await getDb(env)
		.update(authStepUps)
		.set({ usedAt: new Date() })
		.where(
			and(
				await grantConditions(input),
				eq(authStepUps.tokenHash, await hashSessionToken(input.token)),
				isNull(authStepUps.usedAt),
				gt(authStepUps.expiresAt, new Date()),
			),
		)
		.returning({ id: authStepUps.id });
	return rows.length > 0;
}

/** Invalidates every outstanding grant once sign-in methods change. */
export async function bumpSecurityVersion(db: ReturnType<typeof getDb>, userId: string): Promise<void> {
	await db
		.update(users)
		.set({ securityVersion: sql`${users.securityVersion} + 1` })
		.where(eq(users.id, userId));
}
