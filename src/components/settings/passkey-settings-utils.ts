import { authFetch } from "@/lib/auth/client";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type {
	PasskeyAddResponse,
	PasskeyOptionsResponse,
	RemovePasswordResponse,
	SecurityStatus,
	StepUpResponse,
} from "./passkey-settings-types";

export async function loadSecurityStatus(): Promise<SecurityStatus> {
	const res = await authFetch("/api/settings/security");
	const data = (await res.json()) as SecurityStatus;
	if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not load security settings");
	return data;
}

export async function stepUpWithPassword(password: string, code?: string): Promise<string> {
	const res = await authFetch("/api/auth/step-up", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ password, code }),
	});
	const data = (await res.json()) as StepUpResponse;
	if (!res.ok || !data.stepUpToken) throw new Error(data.error ?? "Verification failed");
	return data.stepUpToken;
}

export async function stepUpWithPasskey(): Promise<string> {
	const optionsRes = await authFetch("/api/auth/step-up/options", { method: "POST" });
	const options = (await optionsRes.json()) as PasskeyOptionsResponse;
	if (!optionsRes.ok || !options.options || !options.ceremonyToken) throw new Error(options.error ?? "Passkey verification is unavailable");
	const response = await startAuthentication({ optionsJSON: options.options as Parameters<typeof startAuthentication>[0]["optionsJSON"] });
	const res = await authFetch("/api/auth/step-up/verify", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ceremonyToken: options.ceremonyToken, response }),
	});
	const data = (await res.json()) as StepUpResponse;
	if (!res.ok || !data.stepUpToken) throw new Error(data.error ?? "Passkey verification failed");
	return data.stepUpToken;
}

export async function addPasskey(name: string, stepUpToken: string): Promise<void> {
	const optionsRes = await authFetch("/api/settings/passkeys/options", { method: "POST" });
	const options = (await optionsRes.json()) as PasskeyOptionsResponse;
	if (!optionsRes.ok || !options.options || !options.ceremonyToken) throw new Error(options.error ?? "Could not start passkey setup");
	const response = await startRegistration({ optionsJSON: options.options as Parameters<typeof startRegistration>[0]["optionsJSON"] });
	const res = await authFetch("/api/settings/passkeys", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ceremonyToken: options.ceremonyToken, response, name, stepUpToken }),
	});
	const data = (await res.json()) as PasskeyAddResponse;
	if (!res.ok) throw new Error(data.error ?? "Could not add the passkey");
}

export async function removePasskey(id: string, stepUpToken: string): Promise<void> {
	const res = await authFetch(`/api/settings/passkeys/${encodeURIComponent(id)}`, {
		method: "DELETE",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ stepUpToken }),
	});
	const data = (await res.json()) as { error?: string };
	if (!res.ok) throw new Error(data.error ?? "Could not remove the passkey");
}

export async function setSecondFactorRequirement(enabled: boolean, stepUpToken: string): Promise<void> {
	const res = await authFetch("/api/settings/second-factor", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ enabled, stepUpToken }),
	});
	const data = (await res.json()) as { error?: string };
	if (!res.ok) throw new Error(data.error ?? "Could not update the second-factor setting");
}

export async function generateRecoveryCodes(stepUpToken: string): Promise<string[]> {
	const res = await authFetch("/api/settings/mfa/recovery-codes", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ stepUpToken }),
	});
	const data = (await res.json()) as { recoveryCodes?: string[]; error?: string };
	if (!res.ok || !data.recoveryCodes) throw new Error(data.error ?? "Could not generate recovery codes");
	return data.recoveryCodes;
}

export async function setPassword(newPassword: string, stepUpToken: string): Promise<void> {
	const res = await authFetch("/api/settings/password", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ newPassword, stepUpToken }),
	});
	const data = (await res.json()) as { error?: string };
	if (!res.ok) throw new Error(data.error ?? "Could not set a password");
}

export async function removePassword(stepUpToken: string): Promise<RemovePasswordResponse> {
	const res = await authFetch("/api/settings/password", {
		method: "DELETE",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ stepUpToken }),
	});
	const data = (await res.json()) as RemovePasswordResponse;
	if (!res.ok) throw new Error(data.error ?? "Could not remove the password");
	return data;
}
