"use client";

import { ChevronDown, ShieldAlert } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/lib/i18n/types";
import { getSenderWarning, type SenderWarningReason } from "./message-details-utils";
import { useMessageAuthentication } from "./use-message-authentication";
import type { SenderCheckBadgeProps, SenderCheckNoticeProps } from "./sender-check-types";

const reasonKeys: Record<SenderWarningReason, TranslationKey> = {
	authentication: "message.senderCheckAuthenticationFailed",
	senderName: "message.detailsSenderWarning",
	domain: "message.detailsDomainMismatch",
	replyTo: "message.detailsReplyToWarning",
};

/** Compact warning for a collapsed thread card. */
export function SenderCheckBadge({ message, className }: SenderCheckBadgeProps) {
	const { t } = useLanguage();
	const { authentication } = useMessageAuthentication(message.id, message.direction);
	const warning = getSenderWarning(message, authentication);
	if (!warning) return null;
	return (
		<span
			title={warning.reasons.map((reason) => t(reasonKeys[reason])).join(" ")}
			className={cn("mt-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800", className)}
		>
			<ShieldAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
			{t("message.senderCheckShort")}
		</span>
	);
}

/** Message-level warning shown without opening Details. */
export function SenderCheckNotice({
	message,
	detailsOpen = false,
	onViewDetails,
	announce = false,
	className,
}: SenderCheckNoticeProps) {
	const { t } = useLanguage();
	const { authentication } = useMessageAuthentication(message.id, message.direction);
	const warning = getSenderWarning(message, authentication);
	if (!warning) return null;

	const mentionsAuthentication = warning.reasons.includes("authentication");
	return (
		<section
			role={announce ? "status" : undefined}
			aria-label={t("message.senderCheckTitle")}
			className={cn(
				"rounded-xl border border-amber-200/80 bg-amber-50/70 px-3.5 py-3 text-amber-950 sm:px-4",
				className,
			)}
		>
			<div className="flex items-start gap-2.5">
				<span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
					<ShieldAlert className="h-4 w-4" aria-hidden="true" />
				</span>
				<div className="min-w-0 flex-1">
					<h2 className="text-[13px] font-semibold leading-snug">{t("message.senderCheckTitle")}</h2>
					<ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[13px] leading-snug marker:text-amber-400">
						{warning.reasons.map((reason) => (
							<li key={reason}>{t(reasonKeys[reason])}</li>
						))}
					</ul>
					{mentionsAuthentication && (
						<p className="mt-2 text-xs leading-snug text-amber-800">{t("message.senderCheckCaution")}</p>
					)}
					{!detailsOpen && onViewDetails && (
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="mt-3 h-auto max-w-full whitespace-normal border-amber-300/80 bg-white/70 py-1.5 text-left text-amber-900 hover:bg-white hover:text-amber-950"
							onClick={onViewDetails}
						>
							{t("message.senderCheckViewDetails")}
							<ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
						</Button>
					)}
				</div>
			</div>
		</section>
	);
}
