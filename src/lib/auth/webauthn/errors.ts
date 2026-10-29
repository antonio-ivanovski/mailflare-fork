import type { AuthErrorCode } from "@/lib/auth/error-codes";

/** A verification failure the route can map to a stable code and status. */
export class PasskeyVerificationError extends Error {
	constructor(
		readonly code: Extract<AuthErrorCode, "passkey_invalid" | "passkey_not_found" | "account_disabled" | "passkey_counter_stale">,
		message = "Passkey could not be verified",
	) {
		super(message);
		this.name = "PasskeyVerificationError";
	}
}
