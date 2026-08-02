import prisma from "../utils/prisma.js";
import { hashPassword, comparePassword } from "../utils/password.js";
import { generateToken } from "../utils/jwt.js";
import { memoryStore } from "./memoryDb.js";

export async function registerUser(usernameRaw: string, passwordRaw: string) {
  const username = usernameRaw.trim().toLowerCase();
  if (!username) {
    throw new Error("Username is required.");
  }
  if (!passwordRaw) {
    throw new Error("Password is required.");
  }

  const passwordHash = await hashPassword(passwordRaw);

  try {
    const existing = await prisma.user.findUnique({
      where: { username },
    });

    if (existing) {
      throw new Error("Username already taken.");
    }

    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        settings: {
          create: {
            masjidName: "My Masjid",
            receiptPrefix: "RCPT",
            currency: "₹",
            theme: "light",
          },
        },
      },
      select: {
        id: true,
        username: true,
        createdAt: true,
      },
    });

    const token = generateToken({ id: user.id, username: user.username });
    return { token, user };
  } catch (error) {
    if (error instanceof Error && error.message === "Username already taken.") {
      throw error;
    }
    // Fallback to memoryStore if DB connection fails
    const existingMem = memoryStore.users.find((u) => u.username === username);
    if (existingMem) {
      throw new Error("Username already taken.");
    }

    const newUser = {
      id: memoryStore.userIdSeq++,
      username,
      passwordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memoryStore.users.push(newUser);

    memoryStore.settings.push({
      id: memoryStore.settingsIdSeq++,
      userId: newUser.id,
      masjidName: "My Masjid",
      logo: null,
      receiptPrefix: "RCPT",
      currency: "₹",
      theme: "light",
      createdAt: new Date(),
    });

    const token = generateToken({ id: newUser.id, username: newUser.username });
    return {
      token,
      user: {
        id: newUser.id,
        username: newUser.username,
        createdAt: newUser.createdAt,
      },
    };
  }
}

export async function loginUser(usernameRaw: string, passwordRaw: string) {
  const username = usernameRaw.trim().toLowerCase();
  if (!username || !passwordRaw) {
    throw new Error("Username and password are required.");
  }

  try {
    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (user) {
      const isValidPassword = await comparePassword(passwordRaw, user.passwordHash);
      if (!isValidPassword) {
        throw new Error("Invalid username or password.");
      }

      const token = generateToken({ id: user.id, username: user.username });
      return {
        token,
        user: {
          id: user.id,
          username: user.username,
          createdAt: user.createdAt,
        },
      };
    }
    throw new Error("Invalid username or password.");
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid username or password.") {
      throw error;
    }
    // Fallback to memoryStore
    const memUser = memoryStore.users.find((u) => u.username === username);
    if (!memUser) {
      throw new Error("Invalid username or password.");
    }

    const isValid = await comparePassword(passwordRaw, memUser.passwordHash);
    if (!isValid) {
      throw new Error("Invalid username or password.");
    }

    const token = generateToken({ id: memUser.id, username: memUser.username });
    return {
      token,
      user: {
        id: memUser.id,
        username: memUser.username,
        createdAt: memUser.createdAt,
      },
    };
  }
}

export async function getUserById(userId: number) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        createdAt: true,
      },
    });

    if (user) return user;
  } catch {/* fallback below */}

  const memUser = memoryStore.users.find((u) => u.id === userId);
  if (!memUser) {
    throw new Error("User not found.");
  }

  return {
    id: memUser.id,
    username: memUser.username,
    createdAt: memUser.createdAt,
  };
}
