import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { requireSessionUser } from "@/lib/api/auth";
import { readJsonBody } from "@/lib/http/request";
import { passkeyRenameSchema, stepUpTokenSchema } from "@/lib/validators";
import { hasPasswordHash } from "@/lib/auth/password";
import { getSessionTokenFromRequestHeaders } from "@/lib/auth/session";
import { consumeStepUpGrant } from "@/lib/auth/webauthn/grants";
import { countPasskeys, deletePasskey, renamePasskey } from "@/lib/auth/webauthn/credentials";
import { recordAuthActivity } from "@/lib/auth/activity";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	const parsed = passkeyRenameSchema.safeParse(await readJsonBody(request, 16 * 1024).catch(() => null));
	if (!parsed.success) return NextResponse.json({ error: "Enter a name" }, { status: 400 });
	const { id } = await params;
	if (!(await renamePasskey(env, auth.user.id, id, parsed.data.name))) {
		return NextResponse.json({ error: "Passkey not found" }, { status: 404 });
	}
	await recordAuthActivity(env, { action: "auth.passkey_renamed", userId: auth.user.id, request });
	return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, { params }: Params) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	const parsed = stepUpTokenSchema.safeParse(await readJsonBody(request, 16 * 1024).catch(() => null));
	const sessionToken = getSessionTokenFromRequestHeaders(request);
	if (!parsed.success || !sessionToken) {
		return NextResponse.json({ error: "Verify your identity before removing a passkey" }, { status: 400 });
	}
	if (!(await consumeStepUpGrant(env, { token: parsed.data.stepUpToken, userId: auth.user.id, sessionToken }))) {
		return NextResponse.json({ error: "Verify your identity before removing a passkey" }, { status: 401 });
	}
	const count = await countPasskeys(env, auth.user.id);
	const passwordless = !hasPasswordHash(auth.user.passwordHash);
	const lastFactorRequired = auth.user.requireSecondFactor && !auth.user.totpEnabled;
	if (count <= 1 && passwordless) {
		return NextResponse.json({ error: "This is your only way to sign in. Add another passkey first." }, { status: 409 });
	}
	if (count <= 1 && lastFactorRequired) {
		return NextResponse.json({ error: "Turn off the second-factor requirement before removing your last passkey." }, { status: 409 });
	}
	const { id } = await params;
	try {
		if (!(await deletePasskey(env, auth.user.id, id))) {
			return NextResponse.json({ error: "Passkey not found" }, { status: 404 });
		}
	} catch (error) {
		// The passkey delete trigger rejects the final method atomically.
		if (String(error).includes("last-auth-method")) {
			return NextResponse.json({ error: passwordless ? "This is your only way to sign in. Add another passkey first." : "Turn off the second-factor requirement before removing your last passkey." }, { status: 409 });
		}
		throw error;
	}
	await recordAuthActivity(env, { action: "auth.passkey_removed", userId: auth.user.id, request });
	return NextResponse.json({ ok: true });
}
