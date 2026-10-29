import { persistAuthSession } from "@/lib/auth/client";
import type { PasskeySetupOptionsResponse, PasskeySetupResult } from "./types";

export async function startPasskeySetup(token: string): Promise<PasskeySetupOptionsResponse> {
	const res = await fetch("/api/auth/passkey/setup/options", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ token }),
	});
	return (await res.json()) as PasskeySetupOptionsResponse;
}

export async function finishPasskeySetup(input: {
	token: string;
	ceremonyToken: string;
	response: unknown;
	name: string;
}): Promise<{ ok: boolean; data: PasskeySetupResult }> {
	const res = await fetch("/api/auth/passkey/setup/verify", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	return { ok: res.ok, data: (await persistAuthSession(res)) as PasskeySetupResult };
}
