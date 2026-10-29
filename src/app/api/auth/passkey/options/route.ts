import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { allowLoginAttempt } from "@/lib/auth/rate-limit";
import { createAuthenticationOptions } from "@/lib/auth/webauthn/service";
import {
	createCeremonyBinding,
	createWebAuthnChallenge,
	readCeremonyBindings,
	setCeremonyCookie,
} from "@/lib/auth/webauthn/challenges";
import { authError } from "@/lib/http/auth-error";

/** Starts a discoverable passkey sign-in. The browser chooses the account. */
export async function POST(request: Request) {
	const env = getEnv();
	if (!(await allowLoginAttempt(env, request))) {
		return authError("rate_limited", 429, { "Retry-After": "60" });
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
		setCeremonyCookie(response.headers, binding, readCeremonyBindings(request));
		return response;
	} catch (error) {
		const origin = error instanceof Error && /HTTPS|APP_URL/i.test(error.message);
		return authError(origin ? "passkey_origin" : "passkey_unavailable", 503);
	}
}
