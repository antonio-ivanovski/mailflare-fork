import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { requireSessionUser } from "@/lib/api/auth";
import { readJsonBody } from "@/lib/http/request";
import { passkeyRegistrationSchema } from "@/lib/validators";
import { getSessionTokenFromRequestHeaders } from "@/lib/auth/session";
import { consumeStepUpGrant } from "@/lib/auth/webauthn/grants";
import { clearCeremonyCookie, consumeWebAuthnChallenge, readCeremonyBinding } from "@/lib/auth/webauthn/challenges";
import { isRegistrationResponseJSON, verifyPasskeyRegistration } from "@/lib/auth/webauthn/service";
import { recordAuthActivity } from "@/lib/auth/activity";

export async function POST(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	const parsed = passkeyRegistrationSchema.safeParse(await readJsonBody(request, 64 * 1024).catch(() => null));
	if (!parsed.success || !parsed.data.stepUpToken || !isRegistrationResponseJSON(parsed.data.response)) {
		return NextResponse.json({ error: "Verify your identity before adding a passkey" }, { status: 400 });
	}
	const sessionToken = getSessionTokenFromRequestHeaders(request);
	const binding = readCeremonyBinding(request);
	if (!sessionToken || !binding) return NextResponse.json({ error: "This request expired. Start again." }, { status: 401 });
	if (!(await consumeStepUpGrant(env, { token: parsed.data.stepUpToken, userId: auth.user.id, sessionToken }))) {
		return NextResponse.json({ error: "Verify your identity before adding a passkey" }, { status: 401 });
	}
	const challenge = await consumeWebAuthnChallenge(env, {
		ceremonyToken: parsed.data.ceremonyToken,
		purpose: "register",
		binding,
	});
	if (!challenge || challenge.userId !== auth.user.id) {
		return NextResponse.json({ error: "This request expired. Start again." }, { status: 401 });
	}
	try {
		const { passkey } = await verifyPasskeyRegistration(env, request, parsed.data.response, challenge.challenge, auth.user, parsed.data.name);
		await recordAuthActivity(env, { action: "auth.passkey_added", userId: auth.user.id, request });
		const response = NextResponse.json({
			ok: true,
			passkey: { id: passkey.id, name: passkey.name, createdAt: passkey.createdAt.toISOString() },
		});
		clearCeremonyCookie(response.headers);
		return response;
	} catch (error) {
		const message = error instanceof Error ? error.message : "Passkey could not be verified";
		const status = /unique|duplicate/i.test(message) ? 409 : 400;
		const response = NextResponse.json({ error: status === 409 ? "This passkey is already registered" : message }, { status });
		clearCeremonyCookie(response.headers);
		return response;
	}
}
