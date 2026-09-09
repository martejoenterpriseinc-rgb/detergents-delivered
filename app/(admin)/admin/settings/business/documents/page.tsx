import { requireAuth } from "@/lib/authz";
import { getBusinessSetup } from "@/lib/business/service";
import { listBusinessDocuments } from "@/lib/business/documents";
import { DocumentManager } from "@/components/business/document-manager";
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
        Private business documents are available to the owner and explicitly authorized
        administrators.
      </p>
    );
  return <DocumentManager initial={data[1]} setup={data[0]} />;
}
