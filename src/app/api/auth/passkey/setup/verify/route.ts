import { NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { passkeyCredentials, users } from "@/db/schema";
import { readJsonBody } from "@/lib/http/request";
import { RequestBodyTooLargeError } from "@/lib/http/errors";
import { passkeySetupSchema } from "@/lib/validators";
import { consumeEnrollmentGrant, getEnrollmentGrant } from "@/lib/auth/webauthn/grants";
import { buildPasskeyRow, deletePasskey } from "@/lib/auth/webauthn/credentials";
import { clearCeremonyCookie, consumeWebAuthnChallenge, readCeremonyBinding } from "@/lib/auth/webauthn/challenges";
import { isRegistrationResponseJSON, savePasskeyRegistration, verifyPasskeyRegistrationResponse } from "@/lib/auth/webauthn/service";
import { PASSWORDLESS_PASSWORD_HASH } from "@/lib/auth/password";
import { issueRecoveryCodes } from "@/lib/auth/recovery-codes";
import { deleteUserSessions } from "@/lib/auth/session";
import { completeLogin } from "@/lib/auth/login-response";
import { recordAuthActivity } from "@/lib/auth/activity";

/**
 * Completes first-run setup or recovery by enrolling a new passkey. A recovery
 * grant is not a session: until this succeeds it can only reach these routes.
 */
export async function POST(request: Request) {
	const env = getEnv();
	let body: unknown;
	try {
		body = await readJsonBody(request, 64 * 1024);
	} catch (error) {
		const status = error instanceof RequestBodyTooLargeError ? 413 : 400;
		return NextResponse.json({ error: "Invalid passkey response" }, { status });
	}
	const parsed = passkeySetupSchema.safeParse(body);
	if (!parsed.success || !isRegistrationResponseJSON(parsed.data.response)) {
		return NextResponse.json({ error: "Invalid passkey response" }, { status: 400 });
	}
	const grant = await getEnrollmentGrant(env, parsed.data.token);
	if (!grant) return NextResponse.json({ error: "This setup link is invalid or has expired" }, { status: 401 });
	const [user] = await getDb(env).select().from(users).where(eq(users.id, grant.userId)).limit(1);
	if (!user || user.disabled || user.deletedAt) return NextResponse.json({ error: "Account disabled" }, { status: 403 });
	const binding = readCeremonyBinding(request);
	if (!binding) return NextResponse.json({ error: "This setup link is invalid or has expired" }, { status: 401 });
	const challenge = await consumeWebAuthnChallenge(env, {
		ceremonyToken: parsed.data.ceremonyToken,
		purpose: grant.kind === "setup" ? "enroll" : "recovery",
		binding,
	});
	if (!challenge || challenge.userId !== user.id) {
		return NextResponse.json({ error: "This setup link is invalid or has expired" }, { status: 401 });
	}

	try {
		// Verify before touching any existing credential. A bad response must
		// never remove the account's current way in.
		const verified = await verifyPasskeyRegistrationResponse(env, request, parsed.data.response, challenge.challenge);
		if (grant.kind === "setup") {
			const passkey = await savePasskeyRegistration(env, user.id, verified, parsed.data.name);
			if (!(await consumeEnrollmentGrant(env, grant.id))) {
				await deletePasskey(env, user.id, passkey.id);
				return NextResponse.json({ error: "This setup link is invalid or has expired" }, { status: 401 });
			}
		} else {
			// Claim the grant before replacing state, so concurrent requests
			// cannot both replace credentials.
			if (!(await consumeEnrollmentGrant(env, grant.id))) {
				return NextResponse.json({ error: "This setup link is invalid or has expired" }, { status: 401 });
			}
			const db = getDb(env);
			const row = await buildPasskeyRow(env, {
				userId: user.id,
				credentialId: verified.credentialId,
				publicKey: verified.publicKey,
				counter: verified.counter,
				deviceType: verified.deviceType,
				backedUp: verified.backedUp,
				transports: verified.transports,
				name: parsed.data.name,
			});
			// Create the replacement first. Doing this before any delete keeps a
			// failed insert from removing the account's remaining way in, even on
			// drivers without transactions (Neon HTTP).
			const [sameCredential] = await db
				.select({ id: passkeyCredentials.id })
				.from(passkeyCredentials)
				.where(and(eq(passkeyCredentials.userId, user.id), eq(passkeyCredentials.credentialHash, row.credentialHash)))
				.limit(1);
			let newPasskeyId: string;
			if (sameCredential) {
				newPasskeyId = sameCredential.id;
				await db
					.update(passkeyCredentials)
					.set({
						publicKey: row.publicKey,
						counter: row.counter,
						transports: row.transports,
						deviceType: row.deviceType,
						backedUp: row.backedUp,
						name: row.name,
						lastUsedAt: null,
					})
					.where(eq(passkeyCredentials.id, sameCredential.id));
			} else {
				newPasskeyId = row.id;
				await db.insert(passkeyCredentials).values(row);
			}
			// Now remove every other credential and invalidate the old password,
			// TOTP, and second-factor requirement. If this fails, do not report a
			// completed recovery: the new passkey exists, but old methods may still
			// be usable and the user must review them after signing in with it.
			try {
				await db.batch([
					db.delete(passkeyCredentials).where(and(eq(passkeyCredentials.userId, user.id), ne(passkeyCredentials.id, newPasskeyId))),
					db
						.update(users)
						.set({
							passwordHash: PASSWORDLESS_PASSWORD_HASH,
							totpSecret: null,
							totpEnabled: false,
							totpConfirmedAt: null,
							requireSecondFactor: false,
						})
						.where(eq(users.id, user.id)),
				]);
			} catch {
				throw new Error("The new passkey was created, but the old sign-in methods could not be removed. Sign in with the new passkey, then review Security settings.");
			}
		}
		if (grant.kind !== "setup") {
			await deleteUserSessions(env, user.id);
		}
		const recoveryCodes = await issueRecoveryCodes(env, user.id);
		const response = await completeLogin(env, request, user.id, {
			activity: "auth.passkey_verified",
			body: { recoveryCodes, setup: grant.kind === "setup" ? "passkey" : "recovery" },
		});
		await recordAuthActivity(env, {
			action: grant.kind === "setup" ? "auth.passkey_setup" : "auth.recovery_completed",
			userId: user.id,
			request,
		});
		clearCeremonyCookie(response.headers);
		return response;
	} catch (error) {
		const response = NextResponse.json(
			{ error: error instanceof Error ? error.message : "Passkey could not be verified" },
			{ status: 400 },
		);
		clearCeremonyCookie(response.headers);
		return response;
	}
}
