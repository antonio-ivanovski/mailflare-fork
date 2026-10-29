"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRound, ShieldCheck } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { finishPasskeySetup, startPasskeySetup } from "./utils";

export function PasskeySetupClient({ token }: { token: string }) {
	const { t } = useLanguage();
	const router = useRouter();
	const [name, setName] = useState("Passkey");
	const [codes, setCodes] = useState<string[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [email, setEmail] = useState<string | null>(null);

	async function createPasskey(event: React.FormEvent) {
		event.preventDefault();
		setLoading(true);
		setError(null);
		try {
			if (!browserSupportsWebAuthn()) throw new Error(t("passkey.browserUnsupported"));
			const started = await startPasskeySetup(token);
			if (!started.options || !started.ceremonyToken) throw new Error(started.error ?? t("passkey.setupLinkInvalid"));
			setEmail(started.email ?? null);
			const response = await startRegistration({ optionsJSON: started.options as Parameters<typeof startRegistration>[0]["optionsJSON"] });
			const result = await finishPasskeySetup({ token, ceremonyToken: started.ceremonyToken, response, name });
			if (!result.ok) throw new Error(result.data.error ?? t("passkey.setupFailed"));
			setCodes(result.data.recoveryCodes ?? []);
		} catch (err) {
			setError(err instanceof Error ? err.message : t("passkey.setupFailed"));
		} finally {
			setLoading(false);
		}
	}

	if (codes) {
		return (
			<AuthShell icon={ShieldCheck} title={t("passkey.codesTitle")} description={t("passkey.codesDescription")}>
				<div className="space-y-5">
					<ul className="grid grid-cols-2 gap-2 rounded-xl bg-neutral-50 p-4 font-mono text-sm text-neutral-800">
						{codes.map((code) => (
							<li key={code}>{code}</li>
						))}
					</ul>
					<p className="text-xs leading-5 text-neutral-500">{t("passkey.codesHint")}</p>
					<Button className="h-11 w-full rounded-full" onClick={() => router.replace("/inbox")}>
						{t("common.done")}
					</Button>
				</div>
			</AuthShell>
		);
	}

	return (
		<AuthShell icon={KeyRound} title={t("passkey.setupTitle")} description={email ? t("passkey.setupFor", { email }) : t("passkey.setupDescription")}>
			{!token ? (
				<p role="alert" className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
					{t("passkey.setupLinkInvalid")}
				</p>
			) : (
				<form onSubmit={createPasskey} className="space-y-5">
					<div className="space-y-2">
						<Label htmlFor="passkey-name">{t("passkey.name")}</Label>
						<Input id="passkey-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required autoFocus />
						<p className="text-xs leading-5 text-neutral-500">{t("passkey.nameHint")}</p>
					</div>
					{error && (
						<p role="alert" className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
							{error}
						</p>
					)}
					<Button type="submit" className="h-11 w-full rounded-full px-6 active:scale-[0.98]" disabled={loading}>
						{loading ? t("passkey.waiting") : t("passkey.create")}
					</Button>
				</form>
			)}
		</AuthShell>
	);
}
