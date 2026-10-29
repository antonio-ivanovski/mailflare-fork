import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { requireSessionUser } from "@/lib/api/auth";
import { readJsonBody } from "@/lib/http/request";
import { passkeyStepUpSchema } from "@/lib/validators";
import { verifyPassword } from "@/lib/auth/password";
import { allowLoginAttempt } from "@/lib/auth/rate-limit";
import { getSessionTokenFromRequestHeaders } from "@/lib/auth/session";
import { createStepUpGrant } from "@/lib/auth/webauthn/grants";
import { verifySecondFactor } from "@/lib/auth/mfa";

/** Re-authenticates the current session with its password for one sensitive change. */
export async function POST(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	if (!(await allowLoginAttempt(env, request))) {
		return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429, headers: { "Retry-After": "60" } });
	}
	const parsed = passkeyStepUpSchema.safeParse(await readJsonBody(request, 16 * 1024).catch(() => null));
	if (!parsed.success) return NextResponse.json({ error: "Enter your password" }, { status: 400 });
	if (!verifyPassword(parsed.data.password, auth.user.passwordHash)) {
		return NextResponse.json({ error: "Password is incorrect" }, { status: 400 });
	}
	// A password alone is not enough when password sign-ins require a second
	// factor: this grant can add or remove credentials, so it must clear the
	// same bar. Passkey step-up is handled by the separate assertion route.
	if (auth.user.requireSecondFactor) {
		if (!parsed.data.code) {
			return NextResponse.json({ error: "Enter your authenticator code or confirm with a passkey" }, { status: 401 });
		}
		if (!(await verifySecondFactor(env, auth.user, parsed.data.code))) {
			return NextResponse.json({ error: "That code did not match" }, { status: 401 });
		}
	}
	const token = getSessionTokenFromRequestHeaders(request);
	if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	return NextResponse.json({ stepUpToken: await createStepUpGrant(env, auth.user.id, token) }, { headers: { "Cache-Control": "no-store" } });
}
