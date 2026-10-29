import { verifyPassword } from "@/lib/auth/password";
import { verifySecondFactor } from "@/lib/auth/mfa";
import { consumeStepUpGrant } from "./grants";

/**
 * A sensitive settings change may prove the password, or (for passkey-only
 * accounts) present a fresh passkey step-up grant. When password sign-ins
 * require a second factor, the password path must also present a valid code;
 * a password alone must never mint recovery codes, enrolment links, or a new
 * credential.
 */
export async function authorizeSecurityChange(
	env: CloudflareEnv,
	user: { id: string; passwordHash: string; requireSecondFactor: boolean; totpSecret: string | null; totpEnabled: boolean },
	sessionToken: string | undefined,
	input: { password?: string; stepUpToken?: string; code?: string },
): Promise<boolean> {
	if (input.stepUpToken) {
		if (!sessionToken) return false;
		return consumeStepUpGrant(env, { token: input.stepUpToken, userId: user.id, sessionToken });
	}
	if (!input.password || !verifyPassword(input.password, user.passwordHash)) return false;
	if (!user.requireSecondFactor) return true;
	return !!input.code && !!(await verifySecondFactor(env, user, input.code));
}
