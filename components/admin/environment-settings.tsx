import { apiEditorData } from "@/lib/integrations/vault";
import { ApiConnections } from "./api-connections";
export async function EnvironmentSettings() {
  return <ApiConnections initial={await apiEditorData()} />;
}
