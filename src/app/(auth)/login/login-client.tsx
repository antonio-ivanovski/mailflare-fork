"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { KeyRound, Mail, ShieldCheck } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TurnstileField } from "@/components/auth/turnstile";
import { submitLogin, submitMfaCode, submitPasskeyLogin, submitPasskeyMfa } from "./utils";

export function LoginClient({ adding = false }: { adding?: boolean }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [turnstileReset, setTurnstileReset] = useState(0);
  // Set once the password is accepted for an account with a second factor.
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [methods, setMethods] = useState<string[]>([]);
  const [code, setCode] = useState("");

  function finish(redirect?: string) {
    router.replace(redirect ?? "/inbox");
    router.refresh();
  }

  async function onPasskey() {
    if (!browserSupportsWebAuthn()) {
      setError(t("passkey.browserUnsupported"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { ok, data } = await submitPasskeyLogin();
      if (!ok) throw new Error(data.error ?? t("passkey.loginFailed"));
      finish(data.redirect);
    } catch (err) {
      // A cancelled browser prompt is not an error worth alarming the user about.
      if (!(err instanceof DOMException && err.name === "NotAllowedError")) {
        setError(err instanceof Error ? err.message : t("passkey.loginFailed"));
      }
    } finally {
      setLoading(false);
    }
  }

  async function onPasskeyMfa() {
    if (!challengeToken) return;
    setLoading(true);
    setError(null);
    try {
      const { ok, data } = await submitPasskeyMfa(challengeToken);
      if (!ok) throw new Error(data.error ?? t("passkey.loginFailed"));
      finish(data.redirect);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "NotAllowedError")) {
        setError(err instanceof Error ? err.message : t("passkey.loginFailed"));
      }
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { ok, data } = await submitLogin(new FormData(e.currentTarget));
      if (!ok) {
        setError(data.error ?? t("auth.loginFailed"));
        setTurnstileReset((value) => value + 1);
        return;
      }
      if (data.mfaRequired && data.challengeToken) {
        setChallengeToken(data.challengeToken);
        setMethods(data.methods ?? []);
        return;
      }
      finish(data.redirect);
    } catch (error) {
      setError(
        error instanceof DOMException && error.name === "TimeoutError"
          ? t("auth.loginTimeout")
          : t("auth.loginUnreachable"),
      );
      setTurnstileReset((value) => value + 1);
    } finally {
      setLoading(false);
    }
  }

  async function onSubmitCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!challengeToken) return;
    setLoading(true);
    setError(null);
    try {
      const { ok, data } = await submitMfaCode(challengeToken, code);
      if (!ok) {
        setError(data.error ?? t("auth.codeMismatch"));
        // An expired challenge sends the user back to the password step.
        if (data.error?.includes("expired")) {
          setChallengeToken(null);
          setCode("");
        }
        return;
      }
      finish(data.redirect);
    } catch {
      setError(t("auth.loginUnreachable"));
    } finally {
      setLoading(false);
    }
  }

  if (challengeToken) {
    const hasCodeMethods = methods.length === 0 || methods.includes("totp") || methods.includes("recovery");
    return (
      <AuthShell
        icon={ShieldCheck}
        title={t("auth.mfaTitle")}
        description={t("auth.mfaDescription")}
      >
        <form onSubmit={onSubmitCode} className="space-y-5">
          {methods.includes("passkey") && (
            <div className="space-y-4">
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full rounded-full"
                disabled={loading}
                onClick={() => void onPasskeyMfa()}
              >
                <KeyRound className="h-4 w-4" />
                {t("passkey.usePasskey")}
              </Button>
              {(methods.includes("totp") || methods.includes("recovery")) && (
                <p className="text-center text-xs uppercase tracking-wide text-neutral-400">{t("passkey.orCode")}</p>
              )}
            </div>
          )}
          {hasCodeMethods && (
            <>
              <div className="space-y-2">
                <Label htmlFor="code">{t("auth.code")}</Label>
                <Input
                  id="code"
                  name="code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  placeholder="123 456"
                  required={hasCodeMethods}
                />
              </div>
              <Button type="submit" className="h-11 w-full rounded-full px-6 active:scale-[0.98]" disabled={loading}>
                {loading ? t("auth.verifying") : t("auth.verify")}
              </Button>
            </>
          )}
          {error && (
            <p role="alert" className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </p>
          )}
          <button
            type="button"
            className="w-full text-center text-sm text-neutral-500 hover:text-neutral-800"
            onClick={() => {
              setChallengeToken(null);
              setCode("");
              setError(null);
            }}
          >
            {t("auth.backToSignIn")}
          </button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      icon={Mail}
      title={adding ? t("auth.addAnother") : t("auth.signIn")}
      description={
        adding
          ? t("auth.addDescription")
          : t("auth.signInDescription")
      }
    >
      <form method="post" onSubmit={onSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="email">{t("auth.email")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "login-error" : undefined}
            required
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">{t("auth.password")}</Label>
            <Link href="/forgot-password" className="text-xs font-medium text-blue-600 hover:underline">
              {t("auth.forgotPassword")}
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "login-error" : undefined}
            required
          />
        </div>
        {error && (
          <p id="login-error" role="alert" className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </p>
        )}
        <TurnstileField resetSignal={turnstileReset} />
        <Button
          type="submit"
          className="h-11 w-full rounded-full px-6 active:scale-[0.98]"
          disabled={loading}
        >
          {loading ? t("auth.signingIn") : t("auth.signIn")}
        </Button>
        <p className="text-center text-xs uppercase tracking-wide text-neutral-400">{t("passkey.or")}</p>
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full rounded-full"
          disabled={loading}
          onClick={() => void onPasskey()}
        >
          <KeyRound className="h-4 w-4" />
          {t("passkey.signIn")}
        </Button>
        <Link href="/recover" className="block w-full text-center text-sm text-neutral-500 hover:text-neutral-800">
          {t("passkey.useRecoveryCode")}
        </Link>
      </form>
    </AuthShell>
  );
}
