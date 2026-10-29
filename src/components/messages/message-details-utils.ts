import { authFetch } from "@/lib/auth/client";
import { getEmailAddress, normalizeEmailAddress, parseEmailAddressParts, splitEmailAddressList } from "@/lib/email/address";
import { isSameOrSubdomain } from "@/lib/email/domain-match";
import type { MessageAuthenticationResponse } from "@/lib/email/authentication-types";
import type { MessageDetailsMessage } from "./message-details-types";

export type OriginalSender = {
	/** Display name exactly as it appeared in the message's From header. */
	name: string | null;
	address: string;
	/** Name and address joined for display, or just the address. */
	label: string;
};

/** The sender the message itself claims, not the locally saved contact name. */
export function getOriginalSender(fromAddr: string): OriginalSender {
	const parts = parseEmailAddressParts(fromAddr);
	const address = parts.address || fromAddr.trim();
	const name = parts.name?.trim() || null;
	return {
		name,
		address,
		label: name ? `${name} <${address}>` : address,
	};
}

export function getReplyToEntries(replyTo: string | null | undefined): string[] {
	return splitEmailAddressList(replyTo);
}

/**
 * True when replies leave the From address's domain. Mailings lists often use
 * another mailbox on the same domain, so only a different domain is called out;
 * the details panel still shows every Reply-To address.
 */
export function isReplyToDifferent(message: Pick<MessageDetailsMessage, "fromAddr" | "replyTo">): boolean {
	const entries = getReplyToEntries(message.replyTo);
	if (entries.length === 0) return false;
	const fromDomain = getEmailAddress(message.fromAddr).split("@").pop() ?? "";
	if (!fromDomain) return false;
	return entries.some((entry) => {
		const replyDomain = getEmailAddress(entry).split("@").pop() ?? "";
		return !isSameOrSubdomain(replyDomain, fromDomain);
	});
}

/**
 * True when the display name carries an email address that is not the actual
 * From address. `"support@paypal.com" <attacker@example.net>` is the shape this
 * catches; a brand name without an address does not trigger a warning.
 */
export function hasSenderNameAddressMismatch(message: Pick<MessageDetailsMessage, "fromAddr">): boolean {
	const { name, address } = getOriginalSender(message.fromAddr);
	if (!name) return false;
	const from = normalizeEmailAddress(address);
	const addresses = name.match(/[^\s<>()"']+@[^\s<>()"']+\.[^\s<>()"']+/g) ?? [];
	return addresses.some((candidate) => normalizeEmailAddress(candidate) !== from);
}

export async function fetchMessageAuthentication(
	messageId: string,
	signal: AbortSignal,
): Promise<MessageAuthenticationResponse> {
	const response = await authFetch(`/api/messages/${encodeURIComponent(messageId)}/authentication`, {
		signal,
		cache: "no-store",
		redirectOnUnauthorized: false,
	});
	if (!response.ok) throw new Error("Unable to load authentication results");
	return (await response.json()) as MessageAuthenticationResponse;
}
