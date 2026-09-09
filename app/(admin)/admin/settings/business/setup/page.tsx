import { requireAuth } from "@/lib/authz";
import { getBusinessSetup } from "@/lib/business/service";
import { listBusinessDocuments } from "@/lib/business/documents";
import { SetupWizard } from "@/components/business/setup-wizard";
import { AccountError } from "@/lib/domain/account";
export default async function Page() {
  const session = await requireAuth();
  const data = await Promise.all([
    getBusinessSetup(session.user.id),
    listBusinessDocuments(session.user.id),
  ]).catch((e) => {
    if (e instanceof AccountError && e.status === 403) return null;
    throw e;
  });
  if (!data)
    return (
      <p>
        Business setup is available to the owner and explicitly authorized administrators.
      </p>
    );
  return <SetupWizard initial={data[0]} documents={data[1]} />;
}
