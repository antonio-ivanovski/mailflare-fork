"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, LoaderCircle, ShieldCheck } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { splitEmailAddressList } from "@/lib/email/address";
import { formatRecipientAddressList } from "@/lib/email/recipient-display";
import type { MessageAuthenticationMethod, MessageAuthenticationResponse } from "@/lib/email/authentication-types";
import { formatUserDate } from "@/lib/time/utils";
import { cn } from "@/lib/utils";
import { MessageSourceDialog } from "./message-source-dialog";
import type { MessageDetailsPanelProps } from "./message-details-types";
import {
	fetchMessageAuthentication,
	getOriginalSender,
	getReplyToEntries,
	hasSenderNameAddressMismatch,
	isReplyToDifferent,
} from "./message-details-utils";

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="grid gap-0.5 sm:grid-cols-[130px_minmax(0,1fr)] sm:gap-3">
			<dt className="text-neutral-500">{label}</dt>
			<dd className="min-w-0 break-words text-neutral-900">{children}</dd>
		</div>
	);
}

function statusTone(status: string | null): string {
	if (status === "PASS") return "text-green-700";
	if (status === "FAIL" || status === "SOFTFAIL" || status === "PERMERROR") return "text-red-700";
	if (status === "TEMPERROR" || status === "NEUTRAL" || status === "NONE") return "text-amber-700";
	return "text-neutral-800";
}

function AuthenticationRow({
	method,
	result,
	detail,
	noResult,
}: {
	method: string;
	result: MessageAuthenticationMethod | null;
	detail: string | null;
	noResult: string;
}) {
	const status = result?.status ?? null;
	const Icon = status === "PASS" ? CheckCircle2 : status === "FAIL" || status === "SOFTFAIL" || status === "PERMERROR" ? AlertTriangle : null;
	return (
		<div className="grid gap-0.5 sm:grid-cols-[130px_minmax(0,1fr)] sm:gap-3">
			<dt className="font-medium text-neutral-700">{method}</dt>
			<dd className="min-w-0 break-words">
				<span className={cn("inline-flex items-center gap-1.5 font-medium", statusTone(status))}>
					{Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
					{status ?? noResult}
				</span>
				{result && detail && <span className="block text-neutral-500">{detail}</span>}
			</dd>
		</div>
	);
}

type AuthenticationState = {
	messageId: string;
	result: MessageAuthenticationResponse | null;
	failed: boolean;
};

export function MessageDetailsPanel({ message, className }: MessageDetailsPanelProps) {
	const { t } = useLanguage();
	const [authenticationState, setAuthenticationState] = useState<AuthenticationState | null>(null);
	const [sourceOpen, setSourceOpen] = useState(false);
	const authentication = authenticationState?.messageId === message.id ? authenticationState.result : null;
	const authenticationFailed = authenticationState?.messageId === message.id ? authenticationState.failed : false;
	const original = getOriginalSender(message.fromAddr);
	const contactName = message.fromContactName?.trim();
	const showContactName = message.direction === "inbound" && !!contactName && contactName !== original.name;
	const replyToEntries = getReplyToEntries(message.replyTo);
	const replyToWarning = isReplyToDifferent(message);
	const senderNameWarning = hasSenderNameAddressMismatch(message);

	useEffect(() => {
		// Sent mail has no receiving provider to record authentication results.
		if (message.direction !== "inbound") return;
		const controller = new AbortController();
		fetchMessageAuthentication(message.id, controller.signal)
			.then((result) => {
				if (!controller.signal.aborted) setAuthenticationState({ messageId: message.id, result, failed: false });
			})
			.catch(() => {
				if (!controller.signal.aborted) setAuthenticationState({ messageId: message.id, result: null, failed: true });
			});
		return () => controller.abort();
	}, [message.id, message.direction]);

	const spfDetail = authentication?.available
		? authentication.mailedBy
			? `mailed by ${authentication.mailedBy}${authentication.spf?.detail ? ` · ${authentication.spf.detail}` : ""}`
			: authentication.spf?.detail ?? null
		: null;

	return (
		<section aria-label={t("message.details")} className={cn("rounded-lg border border-neutral-200 bg-neutral-50/70 p-3 text-xs", className)}>
			<dl className="space-y-1.5">
				<DetailRow label={t("message.detailsFrom")}>
					{original.name ? (
						<>
							<span className="font-medium">{original.name}</span>{" "}
							<span className="text-neutral-500">&lt;{original.address}&gt;</span>
						</>
					) : original.address}
				</DetailRow>
				{showContactName && <DetailRow label={t("message.detailsContact")}>{contactName}</DetailRow>}
				{replyToEntries.length > 0 && (
					<DetailRow label={t("message.detailsReplyTo")}>
						{formatRecipientAddressList(message.replyTo, "full")}
					</DetailRow>
				)}
				<DetailRow label={t("source.to")}>{formatRecipientAddressList(message.toAddr, "full") || "—"}</DetailRow>
				{splitEmailAddressList(message.ccAddr).length > 0 && (
					<DetailRow label={t("message.cc")}>{formatRecipientAddressList(message.ccAddr, "full")}</DetailRow>
				)}
				{splitEmailAddressList(message.bccAddr).length > 0 && (
					<DetailRow label={t("message.bcc")}>{formatRecipientAddressList(message.bccAddr, "full")}</DetailRow>
				)}
				<DetailRow label={t("message.date")}>
					{formatUserDate(message.createdAt, { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
				</DetailRow>
				<DetailRow label={t("source.subject")}>{message.subject?.trim() || t("list.noSubject")}</DetailRow>
			</dl>

			{replyToWarning && (
				<p className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-amber-900">
					<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
					<span>{t("message.detailsReplyToWarning")}</span>
				</p>
			)}
			{senderNameWarning && (
				<p className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-amber-900">
					<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
					<span>{t("message.detailsSenderWarning")}</span>
				</p>
			)}

			{message.direction === "inbound" && (
				<div className="mt-3 border-t border-neutral-200 pt-3">
					<div className="flex items-center gap-1.5 font-medium text-neutral-700">
						<ShieldCheck className="h-4 w-4 text-neutral-500" aria-hidden="true" />
						{t("message.detailsAuthentication")}
					</div>
					{authenticationFailed ? (
						<p className="mt-1.5 text-neutral-500">{t("message.detailsAuthenticationError")}</p>
					) : !authentication ? (
						<p className="mt-1.5 flex items-center gap-1.5 text-neutral-500">
							<LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
							{t("message.detailsChecking")}
						</p>
					) : !authentication.available ? (
						<p className="mt-1.5 text-neutral-500">{t("message.detailsAuthenticationUnavailable")}</p>
					) : (
						<>
							<dl className="mt-1.5 space-y-1.5">
								<AuthenticationRow method="SPF" result={authentication.spf} detail={spfDetail} noResult={t("source.noResult")} />
								<AuthenticationRow method="DKIM" result={authentication.dkim} detail={authentication.dkim?.detail ?? null} noResult={t("source.noResult")} />
								<AuthenticationRow method="DMARC" result={authentication.dmarc} detail={authentication.dmarc?.detail ?? null} noResult={t("source.noResult")} />
								{authentication.encryption && (
									<DetailRow label={t("message.detailsEncryption")}>{authentication.encryption}</DetailRow>
								)}
							</dl>
							{authentication.aligned === false && (
								<p className="mt-2 flex items-start gap-1.5 text-amber-800">
									<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
									<span>{t("message.detailsDomainMismatch")}</span>
								</p>
							)}
							<p className="mt-2 text-[11px] leading-snug text-neutral-500">{t("message.detailsAuthenticationNote")}</p>
						</>
					)}
				</div>
			)}

			<div className="mt-2 flex justify-end">
				<Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-blue-600 hover:text-blue-700" onClick={() => setSourceOpen(true)}>
					<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
					{t("message.showOriginal")}
				</Button>
			</div>
			<MessageSourceDialog messageId={message.id} open={sourceOpen} onOpenChange={setSourceOpen} />
		</section>
	);
}
