import { PrismaClient, RoleCode } from "@prisma/client";
import bcrypt from "bcryptjs";
import { seedDemoCatalog } from "./demo-catalog";
import { canSeedDemoCatalog } from "../lib/demo-mode";
import { ensureDeliverySettingsSeeded } from "../lib/services/delivery-settings";
import {
  BOOTSTRAP_ADMIN_EMAIL,
  parseSeedFlag,
  resolveBootstrapPassword,
} from "../lib/domain/bootstrap-admin";
import { ensureBootstrapAdmin } from "../lib/services/bootstrap-admin";
import { ensureDefaultSiteContent } from "../lib/services/site-content";

const prisma = new PrismaClient();

const ROLES: Array<{ code: RoleCode; name: string; description: string }> = [
  {
    code: "CUSTOMER",
    name: "Customer",
    description: "Shopper account for the storefront and household account area.",
  },
  {
    code: "ADMIN",
    name: "Admin",
    description: "Day-to-day operations across orders, catalog, and delivery.",
  },
  {
    code: "INVENTORY",
    name: "Inventory",
    description: "Receiving, counts, purchase orders, and stock adjustments.",
  },
  {
    code: "DRIVER",
    name: "Driver",
    description: "Route execution, delivery attempts, and mileage.",
  },
  {
    code: "CPA",
    name: "CPA",
    description: "Read-focused financial and tax review.",
  },
  {
    code: "SUPER_ADMIN",
    name: "Super admin",
    description: "Full platform access, including roles and integrations.",
  },
];

const PERMISSIONS = [
  { code: "catalog.read", name: "Read catalog" },
  { code: "catalog.write", name: "Write catalog" },
  { code: "orders.read", name: "Read orders" },
  { code: "orders.write", name: "Write orders" },
  { code: "inventory.read", name: "Read inventory" },
  { code: "inventory.write", name: "Write inventory" },
  { code: "routes.read", name: "Read routes" },
  { code: "routes.write", name: "Write routes" },
  { code: "finance.read", name: "Read finance" },
  { code: "settings.write", name: "Write settings" },
  { code: "website.read", name: "Read website builder" },
  { code: "website.write", name: "Publish website builder" },
];

async function seedRoles() {
  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: { name: role.name, description: role.description },
      create: role,
    });
  }

  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: permission.code },
      update: { name: permission.name },
      create: permission,
    });
  }
}

async function seedDevelopmentAdmin() {
  if (process.env.APP_ENV !== "development") {
    console.log("Skipping custom SEED_ADMIN_* user outside development.");
    return undefined;
  }

  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log(
      "SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — custom dev admin skipped.",
    );
    return undefined;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const isBootstrap = email === BOOTSTRAP_ADMIN_EMAIL;
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      deletedAt: null,
      ...(isBootstrap ? { mustChangeCredentials: true } : {}),
    },
    create: {
      email,
      name: isBootstrap ? "Bootstrap Super Admin" : "Detergents Delivered Admin",
      passwordHash,
      mustChangeCredentials: isBootstrap,
    },
  });

  const superAdmin = await prisma.role.findUniqueOrThrow({
    where: { code: "SUPER_ADMIN" },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: { userId: user.id, roleId: superAdmin.id },
    },
    update: {},
    create: { userId: user.id, roleId: superAdmin.id },
  });

  console.log(`Seeded SUPER_ADMIN for ${email}`);
  return user.id;
}

async function seedBootstrapAdmin() {
  const { password: bootstrapPassword, source } = resolveBootstrapPassword(
    process.env.SEED_BOOTSTRAP_ADMIN_PASSWORD,
  );
  const bootstrapResult = await ensureBootstrapAdmin(prisma, {
    appEnv: process.env.APP_ENV ?? "development",
    seedBootstrapFlag: parseSeedFlag(process.env.SEED_BOOTSTRAP_ADMIN),
    password: bootstrapPassword,
  });

  if (bootstrapResult === "created") {
    console.log(
      `Seeded bootstrap SUPER_ADMIN ${BOOTSTRAP_ADMIN_EMAIL} (mustChangeCredentials=true). Password source: ${source}. See docs/DEPLOYMENT.md.`,
    );
  } else if (bootstrapResult === "ensured") {
    console.log(`Ensured bootstrap SUPER_ADMIN ${BOOTSTRAP_ADMIN_EMAIL}.`);
  } else {
    console.log("Bootstrap SUPER_ADMIN seed skipped.");
  }
}

async function main() {
  await seedRoles();
  await ensureDeliverySettingsSeeded();
  await ensureDefaultSiteContent(prisma);
  console.log("Seeded default home page sections.");
  await seedDevelopmentAdmin();
  await seedBootstrapAdmin();

  if (canSeedDemoCatalog()) {
    const actor = await prisma.user.findFirst({
      where: {
        deletedAt: null,
        userRoles: { some: { role: { code: "SUPER_ADMIN" } } },
      },
      orderBy: { createdAt: "asc" },
    });
    await seedDemoCatalog(prisma, actor?.id);
  } else if (process.env.SEED_DEMO_CATALOG === "true") {
    console.log("Refusing demo catalog seed in production.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
