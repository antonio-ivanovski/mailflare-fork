import { expect, test, type Page } from "@playwright/test";

const EMAIL = "admin@example.com";
const PASSWORD = "demo-password-change-me";

async function enableVirtualAuthenticator(page: Page): Promise<string> {
	const client = await page.context().newCDPSession(page);
	await client.send("WebAuthn.enable");
	const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", {
		options: {
			protocol: "ctap2",
			transport: "internal",
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true,
		},
	});
	return authenticatorId;
}

async function loginWithPassword(page: Page) {
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

async function completeStepUp(page: Page) {
	const dialog = page.getByRole("dialog");
	await expect(dialog.getByText("Confirm it is you")).toBeVisible();
	if (await dialog.getByLabel("Password").count()) {
		await dialog.getByLabel("Password").fill(PASSWORD);
		await dialog.getByRole("button", { name: "Continue" }).click();
	} else {
		await dialog.getByRole("button", { name: "Confirm with a passkey" }).click();
	}
}

test("passkey lifecycle: add, sign in, password second factor, password removal, recovery", async ({ page, request }) => {
	test.setTimeout(180_000);
	await request.post("/api/seed?reset=1");
	await enableVirtualAuthenticator(page);

	await loginWithPassword(page);
	await page.goto("/settings/security");

	// Add a passkey, re-authenticating with the password.
	await page.getByRole("button", { name: "Add a passkey" }).click();
	await page.getByLabel("Passkey name").fill("Playwright passkey");
	await page.getByRole("button", { name: "Continue" }).click();
	await completeStepUp(page);
	await expect(page.getByText("Playwright passkey")).toBeVisible({ timeout: 30_000 });

	// Independent passkey sign-in.
	await logout(page);
	await page.getByRole("button", { name: "Sign in with a passkey" }).click();
	await page.waitForURL("**/inbox", { timeout: 30_000 });

	// Password + passkey as the second factor.
	await page.goto("/settings/security");
	await page.getByRole("switch", { name: "Require a second factor when signing in with a password" }).click();
	await completeStepUp(page);
	await expect(page.getByRole("switch", { name: "Require a second factor when signing in with a password" })).toHaveAttribute("aria-checked", "true");

	// A password alone cannot mint a step-up grant once a second factor is required.
	const sessionToken = await page.evaluate(() => localStorage.getItem("mailflare-session-token"));
	const passwordOnlyStepUp = await request.post("/api/auth/step-up", {
		headers: { Authorization: `Bearer ${sessionToken}` },
		data: { password: PASSWORD },
	});
	expect(passwordOnlyStepUp.status()).toBe(401);

	await logout(page);
	await page.getByLabel("Email").fill(EMAIL);
	await page.getByLabel("Password").fill(PASSWORD);
	await page.getByRole("button", { name: "Sign in", exact: true }).click();
	await expect(page.getByRole("button", { name: "Use a passkey" })).toBeVisible({ timeout: 30_000 });
	await page.getByRole("button", { name: "Use a passkey" }).click();
	await page.waitForURL("**/inbox", { timeout: 30_000 });

	// Removing the password leaves the passkey as the only sign-in method and
	// produces recovery codes.
	await page.goto("/settings/security");
	await page.getByRole("button", { name: "Remove password" }).click();
	const removePasswordDialog = page.getByRole("dialog");
	await removePasswordDialog.getByRole("button", { name: "Remove password" }).click();
	await completeStepUp(page);
	await expect(page.getByText("Password removed.", { exact: false })).toBeVisible({ timeout: 30_000 });
	const codesDialog = page.getByRole("dialog").filter({ hasText: "Save your recovery codes" });
	await expect(codesDialog).toBeVisible();
	const recoveryCode = (await codesDialog.locator("li").first().textContent())?.trim() ?? "";
	expect(recoveryCode).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/);
	await codesDialog.getByRole("button", { name: "Done" }).click();

	// The last passkey cannot be removed from a passwordless account.
	await page.getByRole("button", { name: "Remove" }).click();
	const removePasskeyDialog = page.getByRole("dialog");
	await removePasskeyDialog.getByRole("button", { name: "Remove" }).click();
	await completeStepUp(page);
	await expect(page.getByText("This is your only way to sign in", { exact: false })).toBeVisible({ timeout: 30_000 });

	// Password sign-in no longer works; the passkey still does.
	await logout(page);
	await page.getByLabel("Email").fill(EMAIL);
	await page.getByLabel("Password").fill(PASSWORD);
	await page.getByRole("button", { name: "Sign in", exact: true }).click();
	await expect(page.getByText("Invalid credentials")).toBeVisible({ timeout: 30_000 });

	// A recovery code can replace every passkey with a new one.
	await page.goto("/recover");
	await page.getByLabel("Email").fill(EMAIL);
	await page.getByLabel("Recovery code").fill(recoveryCode);
	await page.getByRole("button", { name: "Continue" }).click();
	await page.waitForURL("**/setup/passkey?token=**", { timeout: 30_000 });
	await page.getByLabel("Passkey name").fill("Recovered passkey");
	await page.getByRole("button", { name: "Create passkey" }).click();
	await expect(page.getByText("Save your recovery codes")).toBeVisible({ timeout: 30_000 });
	await page.getByRole("button", { name: "Done" }).click();
	await page.waitForURL("**/inbox", { timeout: 30_000 });
});
