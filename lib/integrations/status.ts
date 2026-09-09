import { integrationStatus } from "@/lib/services/integration-status";
import { apiEditorData, readManagedEnvironment } from "./vault";
import { jobStatus } from "@/lib/operations/jobs";
import { operationalMediaStatus } from "@/lib/operations/media";
export async function getIntegrationStatus() {
  const [env, editor] = await Promise.all([readManagedEnvironment(), apiEditorData()]);
  if (editor.active && editor.targetOrigin)
    env[editor.active === "sandbox" ? "DD_LIVE_APP_URL" : "DD_SANDBOX_APP_URL"] =
      editor.targetOrigin;
  const [jobs, media] = await Promise.all([jobStatus(), operationalMediaStatus()]);
  return { ...integrationStatus(env), operations: { jobs, media } };
}
