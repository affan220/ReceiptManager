import prisma from "../utils/prisma.js";
import { memoryStore } from "./memoryDb.js";

export interface UpdateSettingsInput {
  masjidName?: string;
  logo?: string | null;
  receiptPrefix?: string;
  currency?: string;
  theme?: string;
  name?: string;
  logoDataUrl?: string | null;
}

export async function getSettingsForUser(userId: number) {
  try {
    let settings = await prisma.settings.findUnique({
      where: { userId },
    });

    if (!settings) {
      settings = await prisma.settings.create({
        data: {
          userId,
          masjidName: "My Masjid",
          receiptPrefix: "RCPT",
          currency: "₹",
          theme: "light",
        },
      });
    }

    return settings;
  } catch {
    let settings = memoryStore.settings.find((s) => s.userId === userId);
    if (!settings) {
      settings = {
        id: memoryStore.settingsIdSeq++,
        userId,
        masjidName: "My Masjid",
        logo: null,
        receiptPrefix: "RCPT",
        currency: "₹",
        theme: "light",
        createdAt: new Date(),
      };
      memoryStore.settings.push(settings);
    }
    return settings;
  }
}

export async function updateSettingsForUser(userId: number, input: UpdateSettingsInput) {
  const masjidName = input.masjidName ?? input.name;
  const logo = input.logo !== undefined ? input.logo : input.logoDataUrl;

  try {
    return await prisma.settings.upsert({
      where: { userId },
      create: {
        userId,
        masjidName: masjidName || "My Masjid",
        logo: logo || null,
        receiptPrefix: input.receiptPrefix || "RCPT",
        currency: input.currency || "₹",
        theme: input.theme || "light",
      },
      update: {
        ...(masjidName !== undefined && { masjidName }),
        ...(logo !== undefined && { logo }),
        ...(input.receiptPrefix !== undefined && { receiptPrefix: input.receiptPrefix }),
        ...(input.currency !== undefined && { currency: input.currency }),
        ...(input.theme !== undefined && { theme: input.theme }),
      },
    });
  } catch {
    let settings = memoryStore.settings.find((s) => s.userId === userId);
    if (!settings) {
      settings = {
        id: memoryStore.settingsIdSeq++,
        userId,
        masjidName: masjidName || "My Masjid",
        logo: logo || null,
        receiptPrefix: input.receiptPrefix || "RCPT",
        currency: input.currency || "₹",
        theme: input.theme || "light",
        createdAt: new Date(),
      };
      memoryStore.settings.push(settings);
    } else {
      if (masjidName !== undefined) settings.masjidName = masjidName;
      if (logo !== undefined) settings.logo = logo;
      if (input.receiptPrefix !== undefined) settings.receiptPrefix = input.receiptPrefix;
      if (input.currency !== undefined) settings.currency = input.currency;
      if (input.theme !== undefined) settings.theme = input.theme;
    }
    return settings;
  }
}
