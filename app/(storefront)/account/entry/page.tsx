import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/authz";
import { loginDestination } from "@/lib/domain/login-destination";
import { CHANGE_CREDENTIALS_PATH } from "@/lib/domain/credentials";
export default async function Page() {
  const session = await requireAuth();
  if (session.user.mustChangeCredentials) redirect(CHANGE_CREDENTIALS_PATH);
  redirect(loginDestination(session.user.roles));
}
