import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { allowLoginAttempt } from "@/lib/auth/rate-limit";
import { readJsonBody } from "@/lib/http/request";
import { passkeyMfaOptionsSchema } from "@/lib/validators";
import { getLoginChallengeUserId } from "@/lib/auth/login-challenge";
import { listPasskeys } from "@/lib/auth/webauthn/credentials";
import { createAuthenticationOptions } from "@/lib/auth/webauthn/service";
import { createCeremonyBinding, createWebAuthnChallenge, setCeremonyCookie } from "@/lib/auth/webauthn/challenges";

/** Starts the passkey alternative to a TOTP prompt after a password sign-in. */
export async function POST(request: Request) {
	const env = getEnv();
	if (!(await allowLoginAttempt(env, request))) {
		return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429, headers: { "Retry-After": "60" } });
	}
	const parsed = passkeyMfaOptionsSchema.safeParse(await readJsonBody(request, 16 * 1024).catch(() => null));
	if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

	const userId = await getLoginChallengeUserId(env, parsed.data.challengeToken);
	if (!userId) return NextResponse.json({ error: "This sign-in attempt has expired. Start again." }, { status: 401 });
	const [user] = await getDb(env).select().from(users).where(eq(users.id, userId)).limit(1);
	if (!user || user.disabled || user.deletedAt) return NextResponse.json({ error: "Account disabled" }, { status: 403 });
	const passkeys = await listPasskeys(env, user.id);
	if (passkeys.length === 0) return NextResponse.json({ error: "This account has no passkeys" }, { status: 400 });

	try {
		const { options } = await createAuthenticationOptions(env, request, passkeys);
		const binding = `${createCeremonyBinding()}:${parsed.data.challengeToken}`;
		const { ceremonyToken } = await createWebAuthnChallenge(env, {
			challenge: options.challenge,
			purpose: "mfa",
			userId: user.id,
			binding,
		});
		const response = NextResponse.json({ options, ceremonyToken });
		response.headers.set("Cache-Control", "no-store");
		setCeremonyCookie(response.headers, binding);
		return response;
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : "Passkey sign-in is unavailable" }, { status: 500 });
	}
}
