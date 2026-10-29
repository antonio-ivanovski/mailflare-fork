import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { requireSessionUser } from "@/lib/api/auth";
import { readJsonBody } from "@/lib/http/request";
import { issueRecoveryCodes } from "@/lib/auth/recovery-codes";
import { mfaEnrollSchema } from "@/lib/validators";
import { getSessionTokenFromRequestHeaders } from "@/lib/auth/session";
import { authorizeSecurityChange } from "@/lib/auth/webauthn/authorize";
import { countPasskeys } from "@/lib/auth/webauthn/credentials";

/** Replace the recovery codes; the old ones stop working immediately. */
export async function POST(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	const parsed = mfaEnrollSchema.safeParse(await readJsonBody(request, 16 * 1024).catch(() => null));
	if (!parsed.success) return NextResponse.json({ error: "Verify your identity first" }, { status: 400 });
	if (!(await authorizeSecurityChange(env, auth.user, getSessionTokenFromRequestHeaders(request), parsed.data))) {
		return NextResponse.json({ error: "Verification failed" }, { status: 400 });
	}
	// Codes protect every account with a second factor or a passkey, not just TOTP.
	if (!auth.user.totpEnabled && (await countPasskeys(env, auth.user.id)) === 0) {
		return NextResponse.json({ error: "Add a passkey or authenticator app first" }, { status: 400 });
	}
	return NextResponse.json({ recoveryCodes: await issueRecoveryCodes(env, auth.user.id) }, { headers: { "Cache-Control": "no-store" } });
}
