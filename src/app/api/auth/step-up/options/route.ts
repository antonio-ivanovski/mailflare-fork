import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { requireSessionUser } from "@/lib/api/auth";
import { allowLoginAttempt } from "@/lib/auth/rate-limit";
import { listPasskeys } from "@/lib/auth/webauthn/credentials";
import { createAuthenticationOptions } from "@/lib/auth/webauthn/service";
import { createCeremonyBinding, createWebAuthnChallenge, setCeremonyCookie } from "@/lib/auth/webauthn/challenges";

/** Starts a passkey re-authentication for an account that has no password. */
export async function POST(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	if (!(await allowLoginAttempt(env, request))) {
		return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429, headers: { "Retry-After": "60" } });
	}
	const passkeys = await listPasskeys(env, auth.user.id);
	if (passkeys.length === 0) return NextResponse.json({ error: "This account has no passkeys" }, { status: 400 });
	try {
		const { options } = await createAuthenticationOptions(env, request, passkeys);
		const binding = createCeremonyBinding();
		const { ceremonyToken } = await createWebAuthnChallenge(env, { challenge: options.challenge, purpose: "step_up", userId: auth.user.id, binding });
		const response = NextResponse.json({ options, ceremonyToken });
		response.headers.set("Cache-Control", "no-store");
		setCeremonyCookie(response.headers, binding);
		return response;
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : "Passkey verification is unavailable" }, { status: 500 });
	}
}
