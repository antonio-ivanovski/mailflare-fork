import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { requireSessionUser } from "@/lib/api/auth";
import { readJsonBody } from "@/lib/http/request";
import { disableMfa, verifySecondFactor } from "@/lib/auth/mfa";
import { mfaDisableSchema } from "@/lib/validators";
import { getSessionTokenFromRequestHeaders } from "@/lib/auth/session";
import { authorizeSecurityChange } from "@/lib/auth/webauthn/authorize";

/** Turning MFA off needs both factors, so a stolen session alone cannot do it. */
export async function POST(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	const parsed = mfaDisableSchema.safeParse(await readJsonBody(request, 16 * 1024).catch(() => null));
	if (!parsed.success) return NextResponse.json({ error: "Verify your identity and a code" }, { status: 400 });
	if (!(await authorizeSecurityChange(env, auth.user, getSessionTokenFromRequestHeaders(request), parsed.data))) {
		return NextResponse.json({ error: "Verification failed" }, { status: 400 });
	}
	// On the password path with a required second factor, the helper already
	// checked (and possibly consumed) this code. Do not consume it twice.
	const codeAlreadyChecked = !!parsed.data.password && auth.user.requireSecondFactor;
	if (!codeAlreadyChecked && !(await verifySecondFactor(env, auth.user, parsed.data.code))) {
		return NextResponse.json({ error: "That code did not match" }, { status: 400 });
	}
	await disableMfa(env, auth.user.id);
	return NextResponse.json({ ok: true });
}
