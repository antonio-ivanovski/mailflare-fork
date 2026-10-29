"use client";

import { useEffect, useState } from "react";
import { Copy, KeyRound, Plus, ShieldCheck, ShieldOff, Trash2 } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { SecurityStatus } from "./passkey-settings-types";
import {
	addPasskey,
	generateRecoveryCodes,
	loadSecurityStatus,
	removePasskey,
	setSecondFactorRequirement,
} from "./passkey-settings-utils";
import { StepUpDialog } from "./step-up-dialog";

type PendingAction =
	| { type: "add"; name: string }
	| { type: "remove"; id: string; name: string }
	| { type: "toggle"; enabled: boolean }
	| { type: "codes" };

export function PasskeySettings() {
	const { t } = useLanguage();
	const [status, setStatus] = useState<SecurityStatus | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [addOpen, setAddOpen] = useState(false);
	const [name, setName] = useState("Passkey");
	const [pending, setPending] = useState<PendingAction | null>(null);
	const [confirmRemove, setConfirmRemove] = useState<{ id: string; name: string } | null>(null);
	const [codes, setCodes] = useState<string[] | null>(null);
	const [copied, setCopied] = useState(false);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		const load = () => {
			loadSecurityStatus()
				.then(setStatus)
				.catch((err) => setLoadError(err instanceof Error ? err.message : t("passkey.loadFailed")));
		};
		load();
		window.addEventListener("mailflare:security-changed", load);
		return () => window.removeEventListener("mailflare:security-changed", load);
	}, [t]);

	async function refresh() {
		setStatus(await loadSecurityStatus());
	}

	async function authorized(token: string) {
		if (!pending) return;
		setBusy(true);
		setError(null);
		try {
			if (pending.type === "add") {
				await addPasskey(pending.name, token);
				setName("Passkey");
			} else if (pending.type === "remove") {
				await removePasskey(pending.id, token);
			} else if (pending.type === "toggle") {
				await setSecondFactorRequirement(pending.enabled, token);
			} else {
				setCodes(await generateRecoveryCodes(token));
				setCopied(false);
			}
			await refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : t("passkey.actionFailed"));
		} finally {
			setBusy(false);
			setPending(null);
		}
	}

	if (!status) return <p className="text-sm text-neutral-500">{loadError ?? t("mfa.loading")}</p>;

	return (
		<div className="space-y-5">
			<div className="flex items-center justify-between gap-4 rounded-2xl bg-neutral-50 p-4">
				<div className="flex items-start gap-3">
					{status.passkeys.length > 0 ? (
						<ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
					) : (
						<ShieldOff className="mt-0.5 h-5 w-5 shrink-0 text-neutral-400" />
					)}
					<div>
						<p className="text-sm font-medium text-neutral-900">
							{status.passkeys.length === 0
								? t("passkey.none")
								: t("passkey.count", { count: status.passkeys.length })}
						</p>
						<p className="mt-1 text-sm text-neutral-500">{t("passkey.description")}</p>
					</div>
				</div>
				<Button type="button" variant="outline" onClick={() => setAddOpen(true)} disabled={busy}>
					<Plus className="h-4 w-4" />
					{t("passkey.add")}
				</Button>
			</div>

			{status.passkeys.length > 0 && (
				<ul className="divide-y divide-neutral-100 rounded-2xl border border-neutral-100">
					{status.passkeys.map((passkey) => (
						<li key={passkey.id} className="flex items-center justify-between gap-4 px-4 py-3">
							<div className="flex min-w-0 items-start gap-3">
								<KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
								<div className="min-w-0">
									<p className="truncate text-sm font-medium text-neutral-900">{passkey.name}</p>
									<p className="mt-1 text-xs text-neutral-500">
										{passkey.lastUsedAt
											? t("passkey.lastUsed", { date: new Date(passkey.lastUsedAt).toLocaleString() })
											: t("passkey.neverUsed")}
									</p>
								</div>
							</div>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={busy}
								onClick={() => setConfirmRemove({ id: passkey.id, name: passkey.name })}
								aria-label={t("passkey.remove")}
							>
								<Trash2 className="h-4 w-4" />
							</Button>
						</li>
					))}
				</ul>
			)}

			<div className="flex items-start justify-between gap-4 rounded-2xl border border-neutral-100 p-4">
				<div>
					<Label htmlFor="require-second-factor">{t("passkey.requireSecondFactor")}</Label>
					<p className="mt-1 text-xs leading-5 text-neutral-500">{t("passkey.requireSecondFactorHint")}</p>
				</div>
				<Switch
					id="require-second-factor"
					checked={status.requireSecondFactor}
					disabled={busy || (status.passkeys.length === 0 && !status.totpEnabled)}
					onCheckedChange={(enabled) => setPending({ type: "toggle", enabled })}
				/>
			</div>

			<div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-100 p-4">
				<div>
					<p className="text-sm font-medium text-neutral-900">{t("passkey.recoveryCodes")}</p>
					<p className="mt-1 text-xs leading-5 text-neutral-500">
						{t("passkey.recoveryCodesLeft", { count: status.recoveryCodesLeft })}
					</p>
				</div>
				<Button type="button" variant="outline" onClick={() => setPending({ type: "codes" })} disabled={busy || (status.passkeys.length === 0 && !status.totpEnabled)}>
					{t("passkey.newRecoveryCodes")}
				</Button>
			</div>

			{error && <p role="alert" className="text-sm text-red-600">{error}</p>}

			<Dialog open={addOpen} onOpenChange={setAddOpen}>
				<DialogContent className="sm:max-w-[440px]">
					<form
						className="space-y-4"
						onSubmit={(event) => {
							event.preventDefault();
							setAddOpen(false);
							setPending({ type: "add", name });
						}}
					>
						<DialogHeader>
							<DialogTitle>{t("passkey.addTitle")}</DialogTitle>
							<DialogDescription>{t("passkey.addDescription")}</DialogDescription>
						</DialogHeader>
						<div className="space-y-2">
							<Label htmlFor="new-passkey-name">{t("passkey.name")}</Label>
							<Input id="new-passkey-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required autoFocus />
						</div>
						<Button type="submit">{t("common.continue")}</Button>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog open={!!confirmRemove} onOpenChange={(open) => !open && setConfirmRemove(null)}>
				<DialogContent className="sm:max-w-[440px]">
					<DialogHeader>
						<DialogTitle>{t("passkey.removeTitle")}</DialogTitle>
						<DialogDescription>{t("passkey.removeDescription", { name: confirmRemove?.name ?? "" })}</DialogDescription>
					</DialogHeader>
					<Button
						variant="destructive"
						onClick={() => {
							if (!confirmRemove) return;
							const action = confirmRemove;
							setConfirmRemove(null);
							setPending({ type: "remove", ...action });
						}}
					>
						{t("passkey.remove")}
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
