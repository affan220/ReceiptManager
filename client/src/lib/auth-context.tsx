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
    let alive = true;

    const refresh = async () => {
      if (alive) {
        setLoading(true);
      }
      try {
        const current = await getCurrentUser();
        if (alive) {
          setUser(current);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(message || "Could not initialize authentication.");
        if (alive) {
          setUser(null);
        }
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    };

    refresh();

    const handleAuthChange = () => {
      void refresh();
    };

    window.addEventListener("auth-change", handleAuthChange);

    return () => {
      alive = false;
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
