import { AuthGuard } from "@/components/auth/auth-guard";
import { PasskeySetupClient } from "./passkey-setup-client";

export const dynamic = "force-dynamic";

export default async function PasskeySetupPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
	const { token } = await searchParams;
	return (
		<AuthGuard mode="public">
			<PasskeySetupClient token={token ?? ""} />
		</AuthGuard>
	);
}
