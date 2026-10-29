import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { allowLoginAttempt } from "@/lib/auth/rate-limit";
import { readJsonBody } from "@/lib/http/request";
import { RequestBodyTooLargeError } from "@/lib/http/errors";
import { passkeyMfaVerifySchema } from "@/lib/validators";
import { consumeLoginChallenge, getLoginChallengeUserId } from "@/lib/auth/login-challenge";
import { clearCeremonyCookie, consumeWebAuthnChallenge, readCeremonyBinding } from "@/lib/auth/webauthn/challenges";
import { isAuthenticationResponseJSON, verifyPasskeyAuthentication } from "@/lib/auth/webauthn/service";
import { completeLogin } from "@/lib/auth/login-response";
import { recordAuthActivity } from "@/lib/auth/activity";

/** Finishes a password + passkey sign-in. */
export async function POST(request: Request) {
	const env = getEnv();
	let body: unknown;
	try {
		body = await readJsonBody(request, 64 * 1024);
	} catch (error) {
		const status = error instanceof RequestBodyTooLargeError ? 413 : 400;
		return NextResponse.json({ error: "Invalid passkey response" }, { status });
	}
	if (!(await allowLoginAttempt(env, request))) {
		return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429, headers: { "Retry-After": "60" } });
	}
	const parsed = passkeyMfaVerifySchema.safeParse(body);
	if (!parsed.success || !isAuthenticationResponseJSON(parsed.data.response)) {
		return NextResponse.json({ error: "Invalid passkey response" }, { status: 400 });
	}
	const binding = readCeremonyBinding(request);
	if (!binding || !binding.endsWith(`:${parsed.data.challengeToken}`)) {
		return NextResponse.json({ error: "This sign-in attempt has expired. Start again." }, { status: 401 });
	}
	const userId = await getLoginChallengeUserId(env, parsed.data.challengeToken);
	if (!userId) return NextResponse.json({ error: "This sign-in attempt has expired. Start again." }, { status: 401 });
	const [user] = await getDb(env).select().from(users).where(eq(users.id, userId)).limit(1);
	if (!user || user.disabled || user.deletedAt) return NextResponse.json({ error: "Account disabled" }, { status: 403 });

	const challenge = await consumeWebAuthnChallenge(env, {
		ceremonyToken: parsed.data.ceremonyToken,
		purpose: "mfa",
		binding,
	});
	if (!challenge || challenge.userId !== user.id) {
		return NextResponse.json({ error: "This sign-in attempt has expired. Start again." }, { status: 401 });
	}

	try {
		await verifyPasskeyAuthentication(env, request, parsed.data.response, challenge.challenge, { expectedUser: user });
		if (!(await consumeLoginChallenge(env, parsed.data.challengeToken))) {
			return NextResponse.json({ error: "This sign-in attempt has expired. Start again." }, { status: 401 });
		}
		const response = await completeLogin(env, request, user.id, { activity: "auth.passkey_verified", body: { method: "passkey" } });
		await recordAuthActivity(env, { action: "auth.mfa_verified", userId: user.id, request });
		clearCeremonyCookie(response.headers);
		return response;
	} catch (error) {
		const response = NextResponse.json({ error: error instanceof Error ? error.message : "Passkey could not be verified" }, { status: 401 });
		clearCeremonyCookie(response.headers);
		return response;
	}
}
