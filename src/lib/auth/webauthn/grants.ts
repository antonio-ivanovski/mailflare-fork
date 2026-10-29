import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { authStepUps, passkeyEnrollmentGrants } from "@/db/schema";
import { newId } from "@/lib/ids";
import { hashSessionToken } from "@/lib/auth/session";

const ENROLLMENT_MINUTES = 30;
const STEP_UP_MINUTES = 5;

export type EnrollmentGrantKind = "setup" | "recovery" | "admin";

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
		expiresAt: new Date(Date.now() + ENROLLMENT_MINUTES * 60 * 1000),
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

export async function createStepUpGrant(env: CloudflareEnv, userId: string, sessionToken: string): Promise<string> {
	const db = getDb(env);
	const token = newId("sup");
	const sessionHash = await hashSessionToken(sessionToken);
	await db.insert(authStepUps).values({
		id: newId(),
		userId,
		sessionHash,
		tokenHash: await hashSessionToken(token),
		purpose: "security",
		expiresAt: new Date(Date.now() + STEP_UP_MINUTES * 60 * 1000),
	});
	return token;
}

/**
 * Single-use proof for one sensitive change, bound to the session that
 * requested it. Purpose is checked so a future use cannot borrow this grant.
 */
export async function consumeStepUpGrant(
	env: CloudflareEnv,
	input: { token: string; userId: string; sessionToken: string; purpose?: string },
): Promise<boolean> {
	const db = getDb(env);
	const [row] = await db
		.select({ id: authStepUps.id })
		.from(authStepUps)
		.where(
			and(
				eq(authStepUps.tokenHash, await hashSessionToken(input.token)),
				eq(authStepUps.userId, input.userId),
				eq(authStepUps.sessionHash, await hashSessionToken(input.sessionToken)),
				eq(authStepUps.purpose, input.purpose ?? "security"),
				isNull(authStepUps.usedAt),
				gt(authStepUps.expiresAt, new Date()),
			),
		)
		.limit(1);
	if (!row) return false;
	const rows = await db
		.update(authStepUps)
		.set({ usedAt: new Date() })
		.where(and(eq(authStepUps.id, row.id), isNull(authStepUps.usedAt)))
		.returning({ id: authStepUps.id });
	return rows.length > 0;
}
