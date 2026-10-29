import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { allowLoginAttempt } from "@/lib/auth/rate-limit";
import { verifyTurnstileToken } from "@/lib/auth/turnstile";
import { readJsonBody } from "@/lib/http/request";
import { recoveryStartSchema } from "@/lib/validators";
import { consumeRecoveryCode } from "@/lib/auth/recovery-codes";
import { createEnrollmentGrant } from "@/lib/auth/webauthn/grants";
import { recordAuthActivity } from "@/lib/auth/activity";

/**
 * A recovery code buys an enrolment grant, never a session. The person must
 * still prove the new credential before the account opens.
 */
export async function POST(request: Request) {
	const env = getEnv();
	const body = await readJsonBody(request, 16 * 1024).catch(() => null);
	const parsed = recoveryStartSchema.safeParse(body);
	if (!parsed.success) return NextResponse.json({ error: "Enter your email and a recovery code" }, { status: 400 });
	if (!(await allowLoginAttempt(env, request))) {
		return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429, headers: { "Retry-After": "60" } });
	}
	if (!(await verifyTurnstileToken(env, request, (body as Record<string, unknown>)?.turnstileToken))) {
		return NextResponse.json({ error: "Verification failed. Please try again." }, { status: 400 });
	}

	const [user] = await getDb(env).select().from(users).where(eq(users.email, parsed.data.email.trim().toLowerCase())).limit(1);
	if (!user || user.disabled || user.deletedAt || !(await consumeRecoveryCode(env, user.id, parsed.data.code))) {
		return NextResponse.json({ error: "That email and recovery code did not match" }, { status: 401 });
	}

	const token = await createEnrollmentGrant(env, { userId: user.id, kind: "recovery" });
	await recordAuthActivity(env, { action: "auth.recovery_started", userId: user.id, request });
	return NextResponse.json({ ok: true, token }, { headers: { "Cache-Control": "no-store" } });
}
