import { AuthGuard } from "@/components/auth/auth-guard";
import { RecoverClient } from "./recover-client";

export default function RecoverPage() {
	return (
		<AuthGuard mode="public">
			<RecoverClient />
		</AuthGuard>
	);
}
