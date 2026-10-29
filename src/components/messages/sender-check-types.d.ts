import type { MessageDetailsMessage } from "./message-details-types";

export type SenderCheckProps = {
	message: MessageDetailsMessage;
};

export type SenderCheckBadgeProps = SenderCheckProps & {
	className?: string;
};

export type SenderCheckNoticeProps = SenderCheckProps & {
	/** Hides the action once the details panel is already open. */
	detailsOpen?: boolean;
	onViewDetails?: () => void;
	/** Announce the warning when it appears after authentication loads. */
	announce?: boolean;
	className?: string;
};
