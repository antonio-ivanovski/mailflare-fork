import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { requireSessionUser } from "@/lib/api/auth";
import { listPasskeys } from "@/lib/auth/webauthn/credentials";
import { createRegistrationOptions } from "@/lib/auth/webauthn/service";
import { createCeremonyBinding, createWebAuthnChallenge, setCeremonyCookie } from "@/lib/auth/webauthn/challenges";

/** Options for adding a passkey to the signed-in account. Completion needs a step-up grant. */
export async function POST(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	try {
		const existing = await listPasskeys(env, auth.user.id);
		const { options } = await createRegistrationOptions(env, request, auth.user, existing);
		const binding = createCeremonyBinding();
		const { ceremonyToken } = await createWebAuthnChallenge(env, {
			challenge: options.challenge,
			purpose: "register",
			userId: auth.user.id,
			binding,
		});
		const response = NextResponse.json({ options, ceremonyToken });
		response.headers.set("Cache-Control", "no-store");
		setCeremonyCookie(response.headers, binding);
		return response;
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : "Passkeys are unavailable" }, { status: 500 });
	}
}
