import type { contacts } from "@/db/schema";
import type { ContactSource } from "@/lib/email/address-types";

export type ContactRow = typeof contacts.$inferSelect;

export type ContactInput = {
	userId: string;
	address: string;
	source: ContactSource;
};

export type BlockContactInput = {
	userId: string;
	mailboxId: string;
	domainId: string;
	address: string;
};

export type ContactDisplayName = {
	displayName: string;
	source: ContactSource;
};

export type MessageContactNames = {
	/** Resolved sender label: a manually named contact, otherwise the message's From name. */
	fromContactName: string | null;
	toContactName: string | null;
};
