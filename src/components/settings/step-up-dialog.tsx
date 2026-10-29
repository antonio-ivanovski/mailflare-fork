"use client";

import { useState } from "react";
import { KeyRound, ShieldCheck } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authErrorText } from "@/lib/auth/error-messages";
import { isPasskeyCancellation } from "@/lib/auth/webauthn/browser-errors";
import { ClientRequestError } from "@/lib/http/client-error";
import { stepUpWithPasskey, stepUpWithPassword } from "./passkey-settings-utils";

/**
 * One reusable "prove it is still you" dialog. Passkeys are the primary
 * choice when available; the password path remains available where the
 * account policy allows it.
 */
export function StepUpDialog({
	open,
	hasPassword,
	hasPasskey = false,
	requireSecondFactor = false,
	totpEnabled = false,
	action,
	targetUserId,
	onOpenChange,
	onAuthorized,
}: {
	open: boolean;
	hasPassword: boolean;
	hasPasskey?: boolean;
	requireSecondFactor?: boolean;
	totpEnabled?: boolean;
	action: string;
	targetUserId?: string;
	onOpenChange: (open: boolean) => void;
	onAuthorized: (stepUpToken: string) => void | Promise<void>;
}) {
	const { t } = useLanguage();
	const [password, setPassword] = useState("");
	const [code, setCode] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const passwordPathAllowed = hasPassword && (!requireSecondFactor || totpEnabled);
	const needsCode = hasPassword && totpEnabled && (requireSecondFactor || action === "mfa.disable");
	const showPasswordForm = !hasPasskey || showPassword || !passwordPathAllowed;
	const canUsePasskey = hasPasskey;

	function close(next: boolean) {
		onOpenChange(next);
		if (!next) {
			setPassword("");
			setCode("");
			setShowPassword(false);
			setError(null);
		}
	}

	async function submitPassword(event: React.FormEvent) {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			await onAuthorized(await stepUpWithPassword(password, needsCode ? code : undefined, action, targetUserId));
			close(false);
		} catch (err) {
			setError(authErrorText(err instanceof ClientRequestError ? err.code : undefined, t, "passkey.verifyFailed"));
		} finally {
			setBusy(false);
		}
	}

	async function submitPasskey() {
		setBusy(true);
		setError(null);
		try {
			await onAuthorized(await stepUpWithPasskey(action, targetUserId));
			close(false);
		} catch (err) {
			setError(isPasskeyCancellation(err) ? t("authError.passkeyCancelled") : authErrorText(err instanceof ClientRequestError ? err.code : undefined, t, "passkey.verifyFailed"));
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
				{canUsePasskey && (
					<div className="space-y-3">
						<Button type="button" className="w-full" onClick={() => void submitPasskey()} disabled={busy}>
							<KeyRound className="h-4 w-4" />
							{busy ? t("passkey.waiting") : t("passkey.verifyWithPasskey")}
						</Button>
						<p className="flex items-start gap-2 text-xs leading-5 text-neutral-500">
							<ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
							{t("passkey.verifyHint")}
						</p>
						{passwordPathAllowed && (
							<p className="text-center text-xs uppercase tracking-wide text-neutral-400">{t("passkey.or")}</p>
						)}
					</div>
				)}
				{showPasswordForm && passwordPathAllowed && (
					<form onSubmit={submitPassword} className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="step-up-password">{t("common.password")}</Label>
							<Input
								id="step-up-password"
								type="password"
								autoComplete="current-password"
								value={password}
								onChange={(event) => setPassword(event.target.value)}
								autoFocus={!canUsePasskey}
								required
							/>
						</div>
						{needsCode && (
							<div className="space-y-2">
								<Label htmlFor="step-up-code">{t("mfa.code")}</Label>
								<Input
									id="step-up-code"
									inputMode="text"
									autoComplete="one-time-code"
									autoCapitalize="none"
									autoCorrect="off"
									spellCheck={false}
									value={code}
									onChange={(event) => setCode(event.target.value)}
									placeholder={t("auth.codePlaceholder")}
									required
								/>
							</div>
						)}
						<Button type="submit" variant={canUsePasskey ? "outline" : "default"} disabled={busy}>
							{busy ? t("common.pleaseWait") : t("common.continue")}
						</Button>
					</form>
				)}
				{!canUsePasskey && !passwordPathAllowed && (
					<p role="alert" className="text-sm text-red-600">{t("passkey.verifyUnavailable")}</p>
				)}
				{canUsePasskey && passwordPathAllowed && !showPassword && (
					<button type="button" className="w-full text-center text-sm text-neutral-500 hover:text-neutral-800" onClick={() => setShowPassword(true)}>
						{t("passkey.usePasswordInstead")}
					</button>
				)}
				{error && <p role="alert" className="text-sm text-red-600">{error}</p>}
			</DialogContent>
		</Dialog>
	);
}
