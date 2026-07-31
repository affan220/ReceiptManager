import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { getCurrentUser, logout } from "./DatabaseService";
import { toast } from "sonner";

interface AuthCtx {
  user: { id: string; username: string; createdAt: string; user_metadata: { username: string } } | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthCtx["user"]>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const current = await getCurrentUser();
        setUser(current);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(message || "Could not initialize authentication.");
      } finally {
        setLoading(false);
      }
    };

    const handleAuthChange = async () => {
      try {
        const current = await getCurrentUser();
        setUser(current);
      } catch {
        setUser(null);
      }
    };

    load();
    window.addEventListener("storage", handleAuthChange);
    window.addEventListener("auth-change", handleAuthChange);

    return () => {
      window.removeEventListener("storage", handleAuthChange);
      window.removeEventListener("auth-change", handleAuthChange);
    };
  }, []);

  const signOut = async () => {
    await logout();
    setUser(null);
  };

  return <Ctx.Provider value={{ user, loading, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
