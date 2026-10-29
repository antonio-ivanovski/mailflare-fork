import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { requireSessionUser } from "@/lib/api/auth";
import { readJsonBody } from "@/lib/http/request";
import { beginMfaEnrollment } from "@/lib/auth/mfa";
import { mfaEnrollSchema } from "@/lib/validators";
import { getSessionTokenFromRequestHeaders } from "@/lib/auth/session";
import { authorizeSecurityChange } from "@/lib/auth/webauthn/authorize";

/** Re-checks the password or a passkey step-up, then returns a new secret with its QR code. */
export async function POST(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	const parsed = mfaEnrollSchema.safeParse(await readJsonBody(request, 16 * 1024).catch(() => null));
	if (!parsed.success) return NextResponse.json({ error: "Verify your identity first" }, { status: 400 });
	if (!(await authorizeSecurityChange(env, auth.user, getSessionTokenFromRequestHeaders(request), parsed.data))) {
		return NextResponse.json({ error: "Verification failed" }, { status: 400 });
	}
	if (auth.user.totpEnabled) {
		return NextResponse.json({ error: "Two-factor authentication is already on" }, { status: 400 });
	}
	return NextResponse.json(await beginMfaEnrollment(env, auth.user), { headers: { "Cache-Control": "no-store" } });
}
