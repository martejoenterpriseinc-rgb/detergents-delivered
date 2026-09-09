import { integrationStatus } from "@/lib/services/integration-status";
import { apiEditorData, readManagedEnvironment } from "./vault";
export async function getIntegrationStatus() {
  const [env, editor] = await Promise.all([readManagedEnvironment(), apiEditorData()]);
  if (editor.active && editor.targetOrigin)
    env[editor.active === "sandbox" ? "DD_LIVE_APP_URL" : "DD_SANDBOX_APP_URL"] =
      editor.targetOrigin;
  return integrationStatus(env);
}
