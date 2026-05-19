/**
 * Emergency login: mint a magic-link token for the founder and print the URL.
 * Use this when email delivery is unavailable.
 *
 *   pnpm tsx scripts/magic-link-now.ts
 *
 * The printed URL is single-use and expires in 15 minutes.
 */
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

const EMAIL = (process.env.FOUNDER_EMAIL ?? "emcohen@me.com").toLowerCase();
const BASE = process.argv[2] ?? "https://internal.eddiecohen.com";

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: {},
    create: { email: EMAIL },
  });

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await prisma.magicLinkToken.create({
    data: { token, email: EMAIL, expiresAt },
  });

  console.log("");
  console.log(`User: ${user.email} (${user.id})`);
  console.log(`Expires: ${expiresAt.toISOString()}`);
  console.log("");
  console.log(`Open this URL in the browser you want to sign in on:`);
  console.log("");
  console.log(`  ${BASE}/api/auth/verify?token=${token}`);
  console.log("");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
