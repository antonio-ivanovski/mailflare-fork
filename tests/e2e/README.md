# Passkey browser tests

Install Chromium once with `npx playwright install chromium`, then run:

```sh
npm run test:e2e -- tests/e2e/passkeys.spec.ts
```

By default, Playwright starts the development server on port 3000 and refuses
to reuse an existing server. To explicitly select a running test instance:

```sh
PLAYWRIGHT_BASE_URL=http://localhost:3001 npm run test:e2e -- tests/e2e/passkeys.spec.ts
```

Use a disposable local instance: the tests reset `admin@example.com` before and
after each scenario, deleting its passkeys, sessions, and other account data.
They leave the demo password `demo-password-change-me` usable afterward. Do not
point them at an installation containing data you want to keep. Avoid concurrent
runs against the same instance or test-output directory.

The tests use Chromium's virtual authenticator; no physical security key is
needed. They cover desktop and mobile web, not native mobile applications.
