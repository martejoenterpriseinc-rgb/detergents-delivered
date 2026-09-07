import type { ReactNode } from "react";
import { requireAuth } from "@/lib/authz";

export const dynamic = "force-dynamic";

export default async function AccountLayout({ children }: { children: ReactNode }) {
  await requireAuth();
  return children;
}
