import { and, eq, ne } from "drizzle-orm";
import type { getDb } from "@/db";
import { mailboxes, users } from "@/db/schema";
import { hasPasswordHash, hashPassword } from "@/lib/auth/password";
import { bumpSecurityVersion } from "@/lib/auth/webauthn/grants";

export class PasskeyOnlyPasswordError extends Error {
	constructor() {
		super("passkey-only-password");
		this.name = "PasskeyOnlyPasswordError";
	}
}

type Db = ReturnType<typeof getDb>;

export async function selectAccountById(db: Db, id: string) {
	const [account] = await db.select().from(users).where(eq(users.id, id)).limit(1);
	return account ?? null;
}

export async function emailBelongsToAnotherAccount(db: Db, accountId: string, email: string) {
	const [account] = await db
		.select({ id: users.id })
		.from(users)
		.where(and(eq(users.email, email), ne(users.id, accountId)))
		.limit(1);
	return !!account;
}

export async function updateAccountCredentials(
	db: Db,
	id: string,
	input: { email?: string; name: string; password: string | null; disabled?: boolean },
) {
	if (input.password) {
		const [target] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, id)).limit(1);
		if (!target) throw new Error("account-not-found");
		// Passwordless accounts must be recovered through a passkey enrolment
		// link, never by silently adding a password that bypasses that policy.
		if (!hasPasswordHash(target.passwordHash)) throw new PasskeyOnlyPasswordError();
	}
	await db
		.update(users)
		.set({
			...(input.email ? { email: input.email.trim().toLowerCase() } : {}),
			name: input.name,
			...(typeof input.disabled === "boolean" ? { disabled: input.disabled } : {}),
			...(input.password ? { passwordHash: hashPassword(input.password) } : {}),
		})
		.where(eq(users.id, id));
	if (input.password) await bumpSecurityVersion(db, id);

	await db
		.update(mailboxes)
		.set({ displayName: input.name })
		.where(and(eq(mailboxes.userId, id), eq(mailboxes.type, "personal")));
}
