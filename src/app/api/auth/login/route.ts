import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { loginSchema } from "@/lib/validators";
import { allowLoginAttempt } from "@/lib/auth/rate-limit";
import { verifyTurnstileToken } from "@/lib/auth/turnstile";
import { readJsonBody } from "@/lib/http/request";
import { RequestBodyTooLargeError } from "@/lib/http/errors";
import { createLoginChallenge } from "@/lib/auth/login-challenge";
import { completeLogin } from "@/lib/auth/login-response";
import { countPasskeys } from "@/lib/auth/webauthn/credentials";
import { countUnusedRecoveryCodes } from "@/lib/auth/recovery-codes";

export async function POST(request: Request) {
	const env = getEnv();
	let body: unknown;
	try {
		body = await readJsonBody(request, 16 * 1024);
	} catch (error) {
		const status = error instanceof RequestBodyTooLargeError ? 413 : 400;
		return NextResponse.json({ error: "Invalid login request" }, { status });
	}
	const parsed = loginSchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
	}
	if (!(await allowLoginAttempt(env, request))) {
		return NextResponse.json(
			{ error: "Too many login attempts. Try again shortly." },
			{ status: 429, headers: { "Retry-After": "60" } },
		);
	}
	if (!(await verifyTurnstileToken(env, request, (body as Record<string, unknown>).turnstileToken))) {
		return NextResponse.json({ error: "Verification failed. Please try again." }, { status: 400 });
	}

	const db = getDb(env);
	const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email)).limit(1);
	// A passwordless account has no usable password; it still takes the same
	// generic error so the response cannot be used to enumerate accounts.
	if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
		return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
	}
	if (user.disabled || user.deletedAt) {
		return NextResponse.json({ error: "Account disabled" }, { status: 403 });
	}

	// The password is right but this account requires a second factor: hand
	// back a short-lived challenge instead of a session.
	if (user.requireSecondFactor) {
		const [passkeys, recoveryCodes] = await Promise.all([
			countPasskeys(env, user.id),
			countUnusedRecoveryCodes(env, user.id),
		]);
		const methods = [...(passkeys > 0 ? ["passkey"] : []), ...(user.totpEnabled && user.totpSecret ? ["totp"] : []), ...(recoveryCodes > 0 ? ["recovery"] : [])];
		if (methods.length === 0) {
			return NextResponse.json({ error: "This account requires a second factor but has none configured. Contact an administrator." }, { status: 403 });
		}
		const challengeToken = await createLoginChallenge(env, user.id);
		const pending = NextResponse.json({ ok: true, mfaRequired: true, challengeToken, methods });
		pending.headers.set("Cache-Control", "no-store");
		return pending;
	}

	return completeLogin(env, request, user.id);
}
