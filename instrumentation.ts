export async function register() {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }

  const { validateRuntimeConfig } = await import("./lib/runtime-config");
  validateRuntimeConfig(process.env);

  try {
    const { ensureDemoCatalogOnBoot } = await import("./lib/demo-boot");
    const result = await ensureDemoCatalogOnBoot();
    if (result.seeded) {
      console.log("DEMO_MODE seeded an empty household catalog on boot.");
    }
  } catch (error) {
    console.error("Demo catalog boot seed skipped:", error);
  }
}
