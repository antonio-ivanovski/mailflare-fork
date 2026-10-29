import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/auth/cookies";
import { deleteUserSessions, getSessionTokenFromRequestHeaders } from "@/lib/auth/session";
import { hasPasswordHash, hashPassword, PASSWORDLESS_PASSWORD_HASH, verifyPassword } from "@/lib/auth/password";
import { getEnv } from "@/lib/cloudflare";
import { readJsonBody } from "@/lib/http/request";
import { passwordSetSchema, stepUpTokenSchema } from "@/lib/validators";
import { consumeStepUpGrant } from "@/lib/auth/webauthn/grants";
import { countPasskeys } from "@/lib/auth/webauthn/credentials";
import { countUnusedRecoveryCodes, issueRecoveryCodes } from "@/lib/auth/recovery-codes";
import { recordAuthActivity } from "@/lib/auth/activity";
import type { ChangePasswordInput } from "./types";
import { parseChangePasswordRequest } from "./utils";

export async function PATCH(request: Request) {
	const env = getEnv();
	const user = await requireUser(env, request);
	let parsed: ChangePasswordInput;

	try {
		parsed = await parseChangePasswordRequest(request);
	} catch (err) {
		if (err instanceof ZodError) {
			return NextResponse.json({ error: err.flatten() }, { status: 400 });
		}
		return NextResponse.json({ error: "Invalid request" }, { status: 400 });
	}

	if (!hasPasswordHash(user.passwordHash)) {
		return NextResponse.json({ error: "This account has no password yet. Set one first." }, { status: 400 });
	}
	if (!verifyPassword(parsed.currentPassword, user.passwordHash)) {
		return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
	}

	if (verifyPassword(parsed.newPassword, user.passwordHash)) {
		return NextResponse.json({ error: "New password must be different from the current password" }, { status: 400 });
	}

	const db = getDb(env);
	await db
		.update(users)
		.set({ passwordHash: hashPassword(parsed.newPassword) })
		.where(eq(users.id, user.id));
	// Anyone else holding a session for this account is signed out; this one stays.
	await deleteUserSessions(env, user.id, getSessionTokenFromRequestHeaders(request));

	return NextResponse.json({ ok: true });
}

/** Gives a passkey-only account a password, after re-authenticating. */
export async function POST(request: Request) {
	const env = getEnv();
	const user = await requireUser(env, request);
	if (hasPasswordHash(user.passwordHash)) {
		return NextResponse.json({ error: "This account already has a password" }, { status: 409 });
	}
	const parsed = passwordSetSchema.safeParse(await readJsonBody(request, 16 * 1024).catch(() => null));
	const sessionToken = getSessionTokenFromRequestHeaders(request);
	if (!parsed.success || !sessionToken) return NextResponse.json({ error: "Verify your identity first" }, { status: 400 });
	if (!(await consumeStepUpGrant(env, { token: parsed.data.stepUpToken, userId: user.id, sessionToken }))) {
		return NextResponse.json({ error: "Verify your identity first" }, { status: 401 });
	}
	await getDb(env).update(users).set({ passwordHash: hashPassword(parsed.data.newPassword) }).where(eq(users.id, user.id));
	await deleteUserSessions(env, user.id, sessionToken);
	await recordAuthActivity(env, { action: "auth.password_set", userId: user.id, request });
	return NextResponse.json({ ok: true });
}

/**
 * Removing the password is only allowed while another sign-in method remains.
 * A passkey-only account gets a recovery-code set if it has none, because the
 * codes are its only fallback when every passkey is lost.
 */
export async function DELETE(request: Request) {
	const env = getEnv();
	const user = await requireUser(env, request);
	const parsed = stepUpTokenSchema.safeParse(await readJsonBody(request, 16 * 1024).catch(() => null));
	const sessionToken = getSessionTokenFromRequestHeaders(request);
	if (!parsed.success || !sessionToken) return NextResponse.json({ error: "Verify your identity first" }, { status: 400 });
	if (!(await consumeStepUpGrant(env, { token: parsed.data.stepUpToken, userId: user.id, sessionToken }))) {
		return NextResponse.json({ error: "Verify your identity first" }, { status: 401 });
	}
	if ((await countPasskeys(env, user.id)) === 0) {
		return NextResponse.json({ error: "Add a passkey before removing your password" }, { status: 409 });
	}
	try {
		await getDb(env)
			.update(users)
			.set({
				passwordHash: PASSWORDLESS_PASSWORD_HASH,
				...(user.totpEnabled ? {} : { requireSecondFactor: false }),
			})
			.where(eq(users.id, user.id));
	} catch (error) {
		// The users trigger rejects this when a concurrent passkey removal won.
		if (String(error).includes("last-auth-method")) {
			return NextResponse.json({ error: "Add a passkey before removing your password" }, { status: 409 });
		}
		throw error;
	}
	const recoveryCodes = (await countUnusedRecoveryCodes(env, user.id)) === 0 ? await issueRecoveryCodes(env, user.id) : undefined;
	await deleteUserSessions(env, user.id, sessionToken);
	await recordAuthActivity(env, { action: "auth.password_removed", userId: user.id, request });
	return NextResponse.json({ ok: true, recoveryCodes }, { headers: { "Cache-Control": "no-store" } });
}
