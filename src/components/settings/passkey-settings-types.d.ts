export type PasskeySummary = {
	id: string;
	name: string;
	createdAt: string;
	lastUsedAt: string | null;
	backedUp: boolean;
	deviceType: string;
};

export type SecurityStatus = {
	passwordSet: boolean;
	requireSecondFactor: boolean;
	totpEnabled: boolean;
	recoveryCodesLeft: number;
	passkeys: PasskeySummary[];
	error?: unknown;
};

export type StepUpResponse = {
	stepUpToken?: string;
	error?: string;
};

export type PasskeyOptionsResponse = {
	options?: unknown;
	ceremonyToken?: string;
	error?: string;
};

export type PasskeyAddResponse = {
	ok?: boolean;
	passkey?: { id: string; name: string; createdAt: string };
	error?: string;
};

export type RemovePasswordResponse = {
	ok?: boolean;
	recoveryCodes?: string[];
	error?: string;
};
