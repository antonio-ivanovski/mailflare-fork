"use client";

import { useState } from "react";
import { KeyRound, ShieldCheck } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { stepUpWithPasskey, stepUpWithPassword } from "./passkey-settings-utils";

/**
 * One reusable "prove it is still you" dialog. It respects the account's
 * second-factor policy: passkey when available, otherwise a password plus a
 * code when password sign-ins require one.
 */
export function StepUpDialog({
	open,
	hasPassword,
	hasPasskey = false,
	requireSecondFactor = false,
	totpEnabled = false,
	onOpenChange,
	onAuthorized,
}: {
	open: boolean;
	hasPassword: boolean;
	hasPasskey?: boolean;
	requireSecondFactor?: boolean;
	totpEnabled?: boolean;
	onOpenChange: (open: boolean) => void;
	onAuthorized: (stepUpToken: string) => void | Promise<void>;
}) {
	const { t } = useLanguage();
	const [password, setPassword] = useState("");
	const [code, setCode] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const passwordPathAllowed = hasPassword && (!requireSecondFactor || totpEnabled);
	const needsCode = hasPassword && requireSecondFactor && totpEnabled;

	function close(next: boolean) {
		onOpenChange(next);
		if (!next) {
			setPassword("");
			setCode("");
			setError(null);
		}
	}

	async function submitPassword(event: React.FormEvent) {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			await onAuthorized(await stepUpWithPassword(password, needsCode ? code : undefined));
			close(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : t("passkey.verifyFailed"));
		} finally {
			setBusy(false);
		}
	}

	async function submitPasskey() {
		setBusy(true);
		setError(null);
		try {
			await onAuthorized(await stepUpWithPasskey());
			close(false);
		} catch (err) {
			if (!(err instanceof DOMException && err.name === "NotAllowedError")) {
				setError(err instanceof Error ? err.message : t("passkey.verifyFailed"));
			}
		} finally {
			setBusy(false);
		}
	}

	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogContent className="sm:max-w-[440px]">
				<DialogHeader>
					<DialogTitle>{t("passkey.verifyTitle")}</DialogTitle>
					<DialogDescription>{t("passkey.verifyDescription")}</DialogDescription>
				</DialogHeader>
				{passwordPathAllowed ? (
					<form onSubmit={submitPassword} className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="step-up-password">{t("common.password")}</Label>
							<Input
								id="step-up-password"
								type="password"
								autoComplete="current-password"
								value={password}
								onChange={(event) => setPassword(event.target.value)}
								autoFocus
								required
							/>
						</div>
						{needsCode && (
							<div className="space-y-2">
								<Label htmlFor="step-up-code">{t("mfa.sixDigitCode")}</Label>
								<Input
									id="step-up-code"
									inputMode="numeric"
									autoComplete="one-time-code"
									value={code}
									onChange={(event) => setCode(event.target.value)}
									placeholder="123 456"
									required
								/>
							</div>
						)}
						{error && <p role="alert" className="text-sm text-red-600">{error}</p>}
						<Button type="submit" disabled={busy}>
							{busy ? t("common.pleaseWait") : t("common.continue")}
						</Button>
						{hasPasskey && (
							<>
								<p className="text-center text-xs uppercase tracking-wide text-neutral-400">{t("passkey.or")}</p>
								<Button type="button" variant="outline" className="w-full" onClick={() => void submitPasskey()} disabled={busy}>
									<KeyRound className="h-4 w-4" />
									{t("passkey.verifyWithPasskey")}
								</Button>
							</>
						)}
					</form>
				) : hasPasskey ? (
					<div className="space-y-4">
						<Button type="button" onClick={() => void submitPasskey()} disabled={busy}>
							<KeyRound className="h-4 w-4" />
							{busy ? t("passkey.waiting") : t("passkey.verifyWithPasskey")}
						</Button>
						{error && <p role="alert" className="text-sm text-red-600">{error}</p>}
						<p className="flex items-start gap-2 text-xs leading-5 text-neutral-500">
							<ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
							{t("passkey.verifyHint")}
						</p>
					</div>
				) : (
					<p role="alert" className="text-sm text-red-600">{t("passkey.verifyUnavailable")}</p>
				)}
			</DialogContent>
		</Dialog>
	);
}
