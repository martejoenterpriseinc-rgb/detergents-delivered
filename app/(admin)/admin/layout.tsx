import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { requireRole } from "@/lib/authz";
import { ADMIN_SHELL_ROLES } from "@/lib/domain/authz";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireRole(...ADMIN_SHELL_ROLES);
  return (
    <AdminShell email={session.user.email} roles={session.user.roles}>
      {children}
    </AdminShell>
  );
}
