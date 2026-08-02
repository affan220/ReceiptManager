import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  log: ["error"],
});

// Helper to check if PostgreSQL connection is alive
export async function checkDbConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export default prisma;
