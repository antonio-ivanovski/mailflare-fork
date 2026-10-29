"use client";

import { AlertTriangle, Info, KeyRound, ShieldCheck } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type PasskeyPolicyChoice = "passkey-only" | "password-and-passkey" | "keep";

type Option = {
	id: PasskeyPolicyChoice;
	title: string;
	hint: string;
	notes?: string[];
	icon: typeof KeyRound;
	iconClass: string;
};

/**
 * Asks what should happen to password sign-in right after the first passkey
 * is enrolled. The options depend on whether an authenticator app is set up.
 */
export function PasskeyFirstChoice({
	open,
	totpEnabled,
	onOpenChange,
	onChoose,
}: {
	open: boolean;
	totpEnabled: boolean;
	onOpenChange: (open: boolean) => void;
	onChoose: (choice: PasskeyPolicyChoice) => void;
}) {
	const { t } = useLanguage();

	const options: Option[] = totpEnabled
		? [
			{
				id: "passkey-only",
				title: t("passkey.choicePasskeyOnly"),
				hint: t("passkey.choiceRemovesPasswordAndCodes"),
				notes: [t("passkey.choiceTwoSteps"), t("passkey.choiceRecoveryNote")],
				icon: KeyRound,
				iconClass: "text-neutral-500",
			},
			{
				id: "keep",
				title: t("passkey.choiceKeepCurrent"),
				hint: t("passkey.choiceKeepCurrentHint"),
				icon: ShieldCheck,
				iconClass: "text-green-600",
			},
		]
		: [
			{
				id: "passkey-only",
				title: t("passkey.choicePasskeyOnly"),
				hint: t("passkey.choiceRemovesPassword"),
				notes: [t("passkey.choiceRecoveryNote")],
				icon: KeyRound,
				iconClass: "text-neutral-500",
			},
			{
				id: "password-and-passkey",
				title: t("passkey.choicePasswordAndPasskey"),
				hint: t("passkey.choicePasswordAndPasskeyHint"),
				notes: [t("passkey.choiceRecoveryNote")],
				icon: ShieldCheck,
				iconClass: "text-green-600",
			},
			{
				id: "keep",
				title: t("passkey.choiceKeepPasswordOnly"),
				hint: t("passkey.choiceKeepPasswordOnlyHint"),
				icon: AlertTriangle,
				iconClass: "text-amber-500",
			},
		];

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[480px]">
				<DialogHeader>
					<DialogTitle>{t("passkey.firstChoiceTitle")}</DialogTitle>
					<DialogDescription>{t("passkey.firstChoiceDescription")}</DialogDescription>
				</DialogHeader>
				<div className="space-y-2">
					{options.map((option) => (
						<button
							key={option.id}
							type="button"
							onClick={() => onChoose(option.id)}
							className="flex w-full items-start gap-3 rounded-2xl border border-neutral-200 p-3 text-left transition-colors hover:border-neutral-300 hover:bg-neutral-50"
						>
							<option.icon className={`mt-0.5 h-4 w-4 shrink-0 ${option.iconClass}`} />
							<span className="min-w-0">
								<span className="block text-sm font-medium text-neutral-900">{option.title}</span>
								<span className="mt-0.5 block text-sm leading-5 text-neutral-500">{option.hint}</span>
								{option.notes?.map((note) => (
									<span key={note} className="mt-1 flex items-start gap-1.5 text-xs leading-5 text-neutral-400">
										<Info className="mt-0.5 h-3 w-3 shrink-0" />
										{note}
									</span>
								))}
							</span>
						</button>
					))}
				</div>
				<Button type="button" variant="ghost" className="w-full" onClick={() => onOpenChange(false)}>
					{t("passkey.firstChoiceLater")}
				</Button>
			</DialogContent>
		</Dialog>
	);
}
