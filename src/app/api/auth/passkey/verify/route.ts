import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { allowLoginAttempt } from "@/lib/auth/rate-limit";
import { readJsonBody } from "@/lib/http/request";
import { RequestBodyTooLargeError } from "@/lib/http/errors";
import { passkeyCeremonySchema } from "@/lib/validators";
import {
	clearCeremonyCookie,
	consumeWebAuthnChallenge,
	readCeremonyBinding,
} from "@/lib/auth/webauthn/challenges";
import { isAuthenticationResponseJSON, verifyPasskeyAuthentication } from "@/lib/auth/webauthn/service";
import { completeLogin } from "@/lib/auth/login-response";
import { recordAuthActivity } from "@/lib/auth/activity";

/** Completes a discoverable passkey sign-in. */
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
	const parsed = passkeyCeremonySchema.safeParse(body);
	if (!parsed.success || !isAuthenticationResponseJSON(parsed.data.response)) {
		return NextResponse.json({ error: "Invalid passkey response" }, { status: 400 });
	}
	const binding = readCeremonyBinding(request);
	if (!binding) return NextResponse.json({ error: "This sign-in attempt has expired. Start again." }, { status: 401 });

	const challenge = await consumeWebAuthnChallenge(env, {
		ceremonyToken: parsed.data.ceremonyToken,
		purpose: "login",
		binding,
	});
	if (!challenge) return NextResponse.json({ error: "This sign-in attempt has expired. Start again." }, { status: 401 });

	try {
		const { passkey } = await verifyPasskeyAuthentication(env, request, parsed.data.response, challenge.challenge, { requireUserHandle: true });
		const response = await completeLogin(env, request, passkey.userId, { activity: "auth.passkey_verified", body: { method: "passkey" } });
		await recordAuthActivity(env, { action: "auth.login", userId: passkey.userId, request });
		clearCeremonyCookie(response.headers);
		return response;
	} catch (error) {
		const response = NextResponse.json(
			{ error: error instanceof Error ? error.message : "Passkey could not be verified" },
			{ status: 401 },
		);
		clearCeremonyCookie(response.headers);
		return response;
	}
}
