import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "mailflare-message-details-test-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	stdin: {
		contents: [
			`export { getOriginalSender, getReplyToEntries, hasSenderNameAddressMismatch, isReplyToDifferent } from "./src/components/messages/message-details-utils";`,
		].join("\n"),
		resolveDir: root,
		loader: "ts",
	},
	outfile: join(outDir, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	logLevel: "silent",
	alias: { "@": join(root, "src") },
});

const details = await import(pathToFileURL(join(outDir, "entry.mjs")).href);

test("the original sender keeps the name and address from the message header", () => {
	assert.deepEqual(details.getOriginalSender('"Ashby Recruiting" <no-reply@ashbyhq.com>'), {
		name: "Ashby Recruiting",
		address: "no-reply@ashbyhq.com",
		label: "Ashby Recruiting <no-reply@ashbyhq.com>",
	});
	assert.deepEqual(details.getOriginalSender("no-reply@ashbyhq.com"), {
		name: null,
		address: "no-reply@ashbyhq.com",
		label: "no-reply@ashbyhq.com",
	});
});

test("a Reply-To on another domain is called out", () => {
	assert.equal(details.isReplyToDifferent({ fromAddr: "Support <help@example.com>", replyTo: "help@example.com" }), false);
	assert.equal(details.isReplyToDifferent({ fromAddr: "Support <help@example.com>", replyTo: "HELP@example.com" }), false);
	assert.equal(details.isReplyToDifferent({ fromAddr: "Support <help@example.com>", replyTo: "billing@example.com" }), false);
	assert.equal(details.isReplyToDifferent({ fromAddr: "Support <help@example.com>", replyTo: "billing@mail.example.com" }), false);
	assert.equal(details.isReplyToDifferent({ fromAddr: "Support <help@example.com>", replyTo: "billing@example.net" }), true);
	// Two registrations under a shared two-label suffix are different owners.
	assert.equal(details.isReplyToDifferent({ fromAddr: "Support <help@victim.co.ke>", replyTo: "billing@attacker.co.ke" }), true);
	assert.equal(details.isReplyToDifferent({ fromAddr: "Support <help@example.com>", replyTo: null }), false);
	assert.equal(details.isReplyToDifferent({ fromAddr: "Support <help@example.com>", replyTo: "" }), false);
});

test("a display name carrying another email address raises a warning", () => {
	assert.equal(details.hasSenderNameAddressMismatch({ fromAddr: '"support@paypal.com" <attacker@example.net>' }), true);
	assert.equal(details.hasSenderNameAddressMismatch({ fromAddr: '"PayPal support@paypal.com" <help@paypal.com>' }), true);
	assert.equal(details.hasSenderNameAddressMismatch({ fromAddr: '"PayPal Support" <support@paypal.com>' }), false);
	assert.equal(details.hasSenderNameAddressMismatch({ fromAddr: "support@paypal.com" }), false);
});

test("Reply-To entries keep display names intact", () => {
	assert.deepEqual(
		details.getReplyToEntries('"Replies, Inc." <replies@example.com>, other@example.net'),
		['"Replies, Inc." <replies@example.com>', "other@example.net"],
	);
});
