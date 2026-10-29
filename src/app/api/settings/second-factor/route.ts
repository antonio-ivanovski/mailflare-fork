import { and, eq, gt, isNotNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getEnv } from "@/lib/cloudflare";
import { requireSessionUser } from "@/lib/api/auth";
import { readJsonBody } from "@/lib/http/request";
import { requireSecondFactorSchema } from "@/lib/validators";
import { getSessionTokenFromRequestHeaders } from "@/lib/auth/session";
import { consumeStepUpGrant } from "@/lib/auth/webauthn/grants";

/** Controls whether a password sign-in needs a passkey or a code. Passkeys themselves never do. */
export async function POST(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	const parsed = requireSecondFactorSchema.safeParse(await readJsonBody(request, 16 * 1024).catch(() => null));
	const sessionToken = getSessionTokenFromRequestHeaders(request);
	if (!parsed.success || !sessionToken) return NextResponse.json({ error: "Verify your identity first" }, { status: 400 });
	if (!(await consumeStepUpGrant(env, { token: parsed.data.stepUpToken, userId: auth.user.id, sessionToken }))) {
		return NextResponse.json({ error: "Verify your identity first" }, { status: 401 });
	}
	const db = getDb(env);
	if (parsed.data.enabled) {
		// The factor check and the write are one statement, so a passkey deleted
		// by another request cannot slip between them.
		const enabled = await db
			.update(users)
			.set({ requireSecondFactor: true })
			.where(
				and(
					eq(users.id, auth.user.id),
					or(
						and(eq(users.totpEnabled, true), isNotNull(users.totpSecret)),
						gt(users.passkeyCount, 0),
					),
				),
			)
			.returning({ id: users.id });
		if (!enabled.length) {
			return NextResponse.json({ error: "Add a passkey or authenticator app before requiring a second factor" }, { status: 409 });
		}
	} else {
		await db.update(users).set({ requireSecondFactor: false }).where(eq(users.id, auth.user.id));
	}
	return NextResponse.json({ ok: true, requireSecondFactor: parsed.data.enabled });
}
