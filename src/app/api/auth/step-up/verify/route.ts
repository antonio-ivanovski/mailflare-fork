import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { requireSessionUser } from "@/lib/api/auth";
import { readJsonBody } from "@/lib/http/request";
import { passkeyCeremonySchema } from "@/lib/validators";
import { allowLoginAttempt } from "@/lib/auth/rate-limit";
import { getSessionTokenFromRequestHeaders } from "@/lib/auth/session";
import { clearCeremonyCookie, consumeWebAuthnChallenge, readCeremonyBinding } from "@/lib/auth/webauthn/challenges";
import { isAuthenticationResponseJSON, verifyPasskeyAuthentication } from "@/lib/auth/webauthn/service";
import { createStepUpGrant } from "@/lib/auth/webauthn/grants";

export async function POST(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	if (!(await allowLoginAttempt(env, request))) {
		return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429, headers: { "Retry-After": "60" } });
	}
	const parsed = passkeyCeremonySchema.safeParse(await readJsonBody(request, 64 * 1024).catch(() => null));
	if (!parsed.success || !isAuthenticationResponseJSON(parsed.data.response)) {
		return NextResponse.json({ error: "Invalid passkey response" }, { status: 400 });
	}
	const binding = readCeremonyBinding(request);
	const sessionToken = getSessionTokenFromRequestHeaders(request);
	if (!binding || !sessionToken) return NextResponse.json({ error: "This verification expired. Start again." }, { status: 401 });
	const challenge = await consumeWebAuthnChallenge(env, { ceremonyToken: parsed.data.ceremonyToken, purpose: "step_up", binding });
	if (!challenge || challenge.userId !== auth.user.id) {
		return NextResponse.json({ error: "This verification expired. Start again." }, { status: 401 });
	}
	try {
		await verifyPasskeyAuthentication(env, request, parsed.data.response, challenge.challenge, { expectedUser: auth.user });
		const response = NextResponse.json({ stepUpToken: await createStepUpGrant(env, auth.user.id, sessionToken) }, { headers: { "Cache-Control": "no-store" } });
		clearCeremonyCookie(response.headers);
		return response;
	} catch (error) {
		const response = NextResponse.json({ error: error instanceof Error ? error.message : "Passkey could not be verified" }, { status: 401 });
		clearCeremonyCookie(response.headers);
		return response;
	}
}
