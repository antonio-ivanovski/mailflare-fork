"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRound } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TurnstileField } from "@/components/auth/turnstile";
import { startRecovery } from "./utils";

export function RecoverClient() {
	const { t } = useLanguage();
	const router = useRouter();
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [turnstileReset, setTurnstileReset] = useState(0);

	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setLoading(true);
		setError(null);
		try {
			const { ok, data } = await startRecovery(new FormData(event.currentTarget));
			if (!ok || !data.token) {
				setError(data.error ?? t("passkey.recoveryFailed"));
				setTurnstileReset((value) => value + 1);
				return;
			}
			router.push(`/setup/passkey?token=${encodeURIComponent(data.token)}`);
		} catch {
			setError(t("auth.loginUnreachable"));
			setTurnstileReset((value) => value + 1);
		} finally {
			setLoading(false);
		}
	}

	return (
		<AuthShell icon={KeyRound} title={t("passkey.recoverTitle")} description={t("passkey.recoverDescription")}>
			<form onSubmit={submit} className="space-y-5">
				<div className="space-y-2">
					<Label htmlFor="recovery-email">{t("auth.email")}</Label>
					<Input id="recovery-email" name="email" type="email" autoComplete="email" required autoFocus />
				</div>
				<div className="space-y-2">
					<Label htmlFor="recovery-code">{t("passkey.recoveryCode")}</Label>
					<Input id="recovery-code" name="code" autoComplete="one-time-code" placeholder="abcde-fghjk" required />
				</div>
				{error && (
					<p role="alert" className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
						{error}
					</p>
				)}
				<TurnstileField resetSignal={turnstileReset} />
				<Button type="submit" className="h-11 w-full rounded-full px-6 active:scale-[0.98]" disabled={loading}>
					{loading ? t("passkey.checking") : t("passkey.continueRecovery")}
				</Button>
				<Link href="/login" className="block w-full text-center text-sm text-neutral-500 hover:text-neutral-800">
					{t("auth.backToSignIn")}
				</Link>
			</form>
		</AuthShell>
	);
}
