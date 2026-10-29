"use client";

import { useEffect, useState } from "react";
import { Copy, KeyRound } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updatePassword } from "./utils";
import type { SecurityStatus } from "./passkey-settings-types";
import { loadSecurityStatus, removePassword, setPassword } from "./passkey-settings-utils";
import { StepUpDialog } from "./step-up-dialog";

/**
 * Password controls that understand passkey-only accounts: set one, change it,
 * or remove it once another sign-in method exists.
 */
export function PasswordSettings() {
	const { t } = useLanguage();
	const [status, setStatus] = useState<SecurityStatus | null>(null);
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [pending, setPending] = useState<"set" | "remove" | null>(null);
	const [confirmRemove, setConfirmRemove] = useState(false);
	const [codes, setCodes] = useState<string[] | null>(null);
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		loadSecurityStatus()
			.then(setStatus)
			.catch((err) => setError(err instanceof Error ? err.message : t("settings.password.failed")));
	}, [t]);

	async function refresh() {
		setStatus(await loadSecurityStatus());
	}

	async function change(event: React.FormEvent) {
		event.preventDefault();
		setMessage(null);
		setError(null);
		if (newPassword !== confirmPassword) {
			setError(t("settings.password.mismatch"));
			return;
		}
		setBusy(true);
		try {
			await updatePassword(currentPassword, newPassword);
			setCurrentPassword("");
			setNewPassword("");
			setConfirmPassword("");
			setMessage(t("settings.password.changed"));
		} catch (err) {
			setError(err instanceof Error ? err.message : t("settings.password.failed"));
		} finally {
			setBusy(false);
		}
	}

	async function authorized(token: string) {
		setError(null);
		setBusy(true);
		try {
			if (pending === "set") {
				await setPassword(newPassword, token);
				setNewPassword("");
				setConfirmPassword("");
				setMessage(t("passkey.passwordSet"));
			} else {
				const result = await removePassword(token);
				setMessage(t("passkey.passwordRemoved"));
				if (result.recoveryCodes?.length) setCodes(result.recoveryCodes);
			}
			await refresh();
			window.dispatchEvent(new Event("mailflare:security-changed"));
		} catch (err) {
			setError(err instanceof Error ? err.message : t("passkey.actionFailed"));
		} finally {
			setBusy(false);
			setPending(null);
		}
	}

	if (!status) return <p className="text-sm text-neutral-500">{t("mfa.loading")}</p>;

	return (
		<div className="space-y-4">
			{status.passwordSet ? (
				<form onSubmit={change} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="currentPassword">{t("settings.password.current")}</Label>
						<Input id="currentPassword" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
					</div>
					<div className="space-y-2">
						<Label htmlFor="newPassword">{t("settings.password.new")}</Label>
						<Input id="newPassword" type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
					</div>
					<div className="space-y-2">
						<Label htmlFor="confirmPassword">{t("settings.password.confirm")}</Label>
						<Input id="confirmPassword" type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
					</div>
					<div className="flex flex-wrap items-center gap-3">
						<Button type="submit" disabled={busy}>{busy ? t("settings.password.changing") : t("settings.password.change")}</Button>
						<Button type="button" variant="outline" onClick={() => setConfirmRemove(true)} disabled={busy}>
							{t("passkey.removePassword")}
						</Button>
					</div>
				</form>
			) : (
				<form
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						setError(null);
						if (newPassword !== confirmPassword) {
							setError(t("settings.password.mismatch"));
							return;
						}
						setPending("set");
					}}
				>
					<p className="text-sm text-neutral-500">{t("passkey.noPassword")}</p>
					<div className="space-y-2">
						<Label htmlFor="setPassword">{t("settings.password.new")}</Label>
						<Input id="setPassword" type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
					</div>
					<div className="space-y-2">
						<Label htmlFor="setPasswordConfirm">{t("settings.password.confirm")}</Label>
						<Input id="setPasswordConfirm" type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
					</div>
					<Button type="submit" disabled={busy}>
						<KeyRound className="h-4 w-4" />
						{t("passkey.setPassword")}
					</Button>
				</form>
			)}

			{message && <p role="status" className="text-sm text-neutral-500">{message}</p>}
			{error && <p role="alert" className="text-sm text-red-600">{error}</p>}

			<Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
				<DialogContent className="sm:max-w-[440px]">
					<DialogHeader>
						<DialogTitle>{t("passkey.removePasswordTitle")}</DialogTitle>
						<DialogDescription>{t("passkey.removePasswordDescription")}</DialogDescription>
					</DialogHeader>
					<Button
						variant="destructive"
						onClick={() => {
							setConfirmRemove(false);
							setPending("remove");
						}}
					>
						{t("passkey.removePassword")}
					</Button>
				</DialogContent>
			</Dialog>

			<StepUpDialog
				open={!!pending}
				hasPassword={status.passwordSet}
				hasPasskey={status.passkeys.length > 0}
				requireSecondFactor={status.requireSecondFactor}
				totpEnabled={status.totpEnabled}
				onOpenChange={(open) => !open && setPending(null)}
				onAuthorized={authorized}
			/>

			<Dialog open={!!codes} onOpenChange={(open) => !open && setCodes(null)}>
				<DialogContent className="sm:max-w-[480px]">
					<DialogHeader>
						<DialogTitle>{t("passkey.codesTitle")}</DialogTitle>
						<DialogDescription>{t("passkey.codesDescription")}</DialogDescription>
					</DialogHeader>
					<ul className="grid grid-cols-2 gap-2 rounded-xl bg-neutral-50 p-4 font-mono text-sm text-neutral-800">
						{(codes ?? []).map((code) => <li key={code}>{code}</li>)}
					</ul>
					<div className="flex items-center gap-3">
						<Button
							type="button"
							variant="outline"
							onClick={() => {
								if (!codes) return;
								void navigator.clipboard.writeText(codes.join("\n")).then(() => setCopied(true));
							}}
						>
							<Copy className="h-4 w-4" />
							{copied ? t("common.copied") : t("mfa.copyCodes")}
						</Button>
						<Button type="button" onClick={() => setCodes(null)}>{t("common.done")}</Button>
					</div>
					<p className="text-xs leading-5 text-neutral-500">{t("passkey.codesHint")}</p>
				</DialogContent>
			</Dialog>
		</div>
	);
}
