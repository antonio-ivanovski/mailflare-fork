export async function startRecovery(form: FormData): Promise<{ ok: boolean; data: { token?: string; error?: string } }> {
	const res = await fetch("/api/auth/recovery/start", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			email: form.get("email"),
			code: form.get("code"),
			turnstileToken: form.get("turnstileToken") ?? undefined,
		}),
	});
	return { ok: res.ok, data: (await res.json()) as { token?: string; error?: string } };
}
