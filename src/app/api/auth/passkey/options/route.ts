import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { allowLoginAttempt } from "@/lib/auth/rate-limit";
import { createAuthenticationOptions } from "@/lib/auth/webauthn/service";
import { createCeremonyBinding, createWebAuthnChallenge, setCeremonyCookie } from "@/lib/auth/webauthn/challenges";

/** Starts a discoverable passkey sign-in. The browser chooses the account. */
export async function POST(request: Request) {
	const env = getEnv();
	if (!(await allowLoginAttempt(env, request))) {
		return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429, headers: { "Retry-After": "60" } });
	}
	try {
		const { options } = await createAuthenticationOptions(env, request, null, { discoverable: true });
		const binding = createCeremonyBinding();
		const { ceremonyToken } = await createWebAuthnChallenge(env, {
			challenge: options.challenge,
			purpose: "login",
			binding,
		});
		const response = NextResponse.json({ options, ceremonyToken });
		response.headers.set("Cache-Control", "no-store");
		setCeremonyCookie(response.headers, binding);
		return response;
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Passkey sign-in is unavailable" },
			{ status: 500 },
		);
	}
}
