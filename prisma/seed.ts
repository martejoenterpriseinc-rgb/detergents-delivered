import { PrismaClient, RoleCode } from "@prisma/client";
import bcrypt from "bcryptjs";
import { seedDemoCatalog } from "./demo-catalog";

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
];

async function main() {
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

  if (process.env.APP_ENV !== "development") {
    console.log("Skipping SUPER_ADMIN seed outside development.");
    return;
  }

  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log(
      "SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — roles seeded, no admin user created.",
    );
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, deletedAt: null },
    create: {
      email,
      name: "Detergents Delivered Admin",
      passwordHash,
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

  if (process.env.SEED_DEMO_CATALOG === "true") {
    await seedDemoCatalog(prisma, user.id);
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
