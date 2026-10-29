import { expect, test, type Page } from "@playwright/test";

const EMAIL = "admin@example.com";
const PASSWORD = "demo-password-change-me";
let authenticatorId = "";

async function enableVirtualAuthenticator(page: Page): Promise<string> {
	const client = await page.context().newCDPSession(page);
	await client.send("WebAuthn.enable");
	const result = await client.send("WebAuthn.addVirtualAuthenticator", {
		options: {
			protocol: "ctap2",
			transport: "internal",
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true,
		},
	});
	authenticatorId = result.authenticatorId;
	return authenticatorId;
}

/** Conditional UI must not auto-complete a password sign-in in the test. */
async function setPresence(page: Page, enabled: boolean) {
	const client = await page.context().newCDPSession(page);
	await client.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId, enabled });
}

async function loginWithPassword(page: Page) {
	await setPresence(page, false);
	await page.goto("/login");
	await page.waitForLoadState("networkidle");
	await page.getByLabel("Email").fill(EMAIL);
	await page.getByLabel("Password").fill(PASSWORD);
	await page.getByRole("button", { name: "Sign in", exact: true }).click();
	await page.waitForURL("**/inbox", { timeout: 30_000 });
}

async function logout(page: Page) {
	await page.context().clearCookies();
	await page.evaluate(() => localStorage.clear());
	await page.goto("/login");
}

// Leave the documented demo password usable after the lifecycle test removes it.
test.afterEach(async ({ request }) => {
	await request.post("/api/seed?reset=1");
});

async function completeStepUp(page: Page) {
	const dialog = page.getByRole("dialog");
	await expect(dialog.getByText("Confirm it is you")).toBeVisible();
	const passkey = dialog.getByRole("button", { name: "Confirm with a passkey" });
	if (await passkey.count()) {
		await setPresence(page, false);
		await passkey.click();
		await setPresence(page, true);
		await expect(dialog).toBeHidden({ timeout: 30_000 });
		await setPresence(page, false);
		return;
	}
	await dialog.getByLabel("Password").fill(PASSWORD);
	await dialog.getByRole("button", { name: "Continue" }).click();
}

test("passkey lifecycle: add, rename, sign in, second step, password removal", async ({ page, request }) => {
	test.setTimeout(180_000);
	await request.post("/api/seed?reset=1");
	await enableVirtualAuthenticator(page);
	await setPresence(page, false);

	await loginWithPassword(page);
	await page.goto("/settings/security");

	// Add a passkey, re-authenticating with the password first.
	await page.getByRole("button", { name: "Add a passkey" }).click();
	await page.getByLabel("Passkey name (optional)").fill("Playwright passkey");
	await setPresence(page, true);
	await page.getByRole("button", { name: "Continue" }).click();
	await completeStepUp(page);
	await expect(page.getByText("Playwright passkey")).toBeVisible({ timeout: 30_000 });
	await setPresence(page, false);

	// Rename the credential without another browser ceremony.
	await page.getByRole("button", { name: "Rename Playwright passkey" }).click();
	await page.getByLabel("Passkey name", { exact: true }).fill("Renamed passkey");
	await page.getByRole("button", { name: "Save" }).click();
	await expect(page.getByText("Renamed passkey")).toBeVisible({ timeout: 30_000 });

	// Independent passkey sign-in.
	await logout(page);
	await setPresence(page, false);
	await page.getByRole("button", { name: "Sign in with a passkey" }).click();
	await setPresence(page, true);
	await page.waitForURL("**/inbox", { timeout: 30_000 });
	await setPresence(page, false);

	// Password plus a passkey as the second step.
	await page.goto("/settings/security");
	await page.getByRole("switch", { name: "Require a second step after password sign-in" }).click();
	await completeStepUp(page);
	await expect(page.getByRole("switch", { name: "Require a second step after password sign-in" })).toHaveAttribute("aria-checked", "true");

	// A password alone cannot mint a step-up grant once a second step is required.
	const sessionToken = await page.evaluate(() => localStorage.getItem("mailflare-session-token"));
	const passwordOnlyStepUp = await request.post("/api/auth/step-up", {
		headers: { Authorization: `Bearer ${sessionToken}` },
		data: { password: PASSWORD, action: "passkey.add" },
	});
	expect(passwordOnlyStepUp.status()).toBe(401);

	await logout(page);
	await page.getByLabel("Email").fill(EMAIL);
	await page.getByLabel("Password").fill(PASSWORD);
	await page.getByRole("button", { name: "Sign in", exact: true }).click();
	await expect(page.getByRole("button", { name: "Use a passkey" })).toBeVisible({ timeout: 30_000 });
	await setPresence(page, false);
	await page.getByRole("button", { name: "Use a passkey" }).click();
	await setPresence(page, true);
	await page.waitForURL("**/inbox", { timeout: 30_000 });
	await setPresence(page, false);

	// Removing the password leaves the passkey as the only way in.
	await page.goto("/settings/security");
	await page.getByRole("button", { name: "Remove password" }).click();
	await page.getByRole("dialog").getByRole("button", { name: "Remove password" }).click();
	await completeStepUp(page);
	await expect(page.getByText("Password removed.", { exact: false })).toBeVisible({ timeout: 30_000 });

	// The last passkey is protected without a second confirmation.
	await expect(page.getByRole("button", { name: "Remove Renamed passkey" })).toBeDisabled();

	// Password sign-in no longer works; the passkey still does.
	await logout(page);
	await page.getByLabel("Email").fill(EMAIL);
	await page.getByLabel("Password").fill(PASSWORD);
	await page.getByRole("button", { name: "Sign in", exact: true }).click();
	await expect(page.getByText("Invalid email or password.")).toBeVisible({ timeout: 30_000 });
	await setPresence(page, false);
	await page.getByRole("button", { name: "Sign in with a passkey" }).click();
	await setPresence(page, true);
	await page.waitForURL("**/inbox", { timeout: 30_000 });
	await setPresence(page, false);
});
