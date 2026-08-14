import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { ensureActiveSession, getValidatedCurrentUser, logout, SessionEndedError } from "./DatabaseService";
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

  const clearRevokedSession = useCallback(async () => {
    try { await logout(); } catch { /* The session has already been revoked remotely. */ }
    setUser(null);
    toast.error("Your session ended because this account was signed in on another device.");
  }, []);

  useEffect(() => {
    let alive = true;

    const refresh = async () => {
      if (alive) setLoading(true);
      try {
        const current = await getValidatedCurrentUser();
        if (alive) setUser(current);
      } catch (error) {
        if (alive) {
          setUser(null);
          if (error instanceof SessionEndedError) {
            await clearRevokedSession();
          } else {
            toast.error(error instanceof Error ? error.message : "Could not initialize authentication.");
          }
        }
      } finally {
        if (alive) setLoading(false);
      }
    };

    void refresh();
    const handleAuthChange = () => { void refresh(); };
    const handleSessionEnded = () => { void clearRevokedSession(); };
    window.addEventListener("auth-change", handleAuthChange);
    window.addEventListener("session-ended", handleSessionEnded);
    return () => {
      alive = false;
      window.removeEventListener("auth-change", handleAuthChange);
      window.removeEventListener("session-ended", handleSessionEnded);
    };
  }, [clearRevokedSession]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const heartbeat = async () => {
      try {
        await ensureActiveSession();
      } catch {
        if (active) await clearRevokedSession();
      }
    };
    const timer = window.setInterval(() => { void heartbeat(); }, 180000);
    const onFocus = () => { void heartbeat(); };
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [user, clearRevokedSession]);

  const signOut = async () => {
    await logout();
    setUser(null);
  };

  return <Ctx.Provider value={{ user, loading, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const value = useContext(Ctx);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
