export type LoginResult = {
	token?: string;
	redirect?: string;
	error?: string;
	/** Password accepted; a second factor is still needed. */
	mfaRequired?: boolean;
	challengeToken?: string;
	/** Factors this account can finish the challenge with. */
	methods?: string[];
	method?: string;
};
