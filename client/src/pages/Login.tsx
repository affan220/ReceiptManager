import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth-context";
import { ActiveSessionError, login } from "@/lib/DatabaseService";
import { normalizeUsername } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Loader2, LogIn } from "lucide-react";

export default function Login() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } })?.from?.pathname || "/";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeSessionDevice, setActiveSessionDevice] = useState<string | null>(null);

  if (!loading && user) return <Navigate to={from} replace />;

  const attemptLogin = async (takeOver = false) => {
    const normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername) {
      toast.error("Please enter your username.");
      return;
    }
    if (!password) {
      toast.error("Please enter your password.");
      return;
    }

    setBusy(true);
    try {
      await login(normalizedUsername, password, takeOver);
      setActiveSessionDevice(null);
      toast.success(takeOver ? "Previous session has been logged out. You are now signed in on this device." : "Welcome back!");
      navigate(from, { replace: true });
    } catch (error) {
      if (error instanceof ActiveSessionError) {
        setActiveSessionDevice(error.deviceLabel ?? "another device");
      } else {
        toast.error(error instanceof Error ? error.message : "Invalid username or password.");
      }
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await attemptLogin(false);
  };

  return (
    <AuthLayout title="Masjid Receipt Manager" subtitle="Sign in to your account">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-2">
          <Label htmlFor="username">Username</Label>
          <Input
            id="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            placeholder="Enter your username"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="Enter your password"
          />
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Don't have an account?{" "}
        <Link to="/register" className="font-medium text-primary hover:underline">
          Create one
        </Link>
      </p>

      <AlertDialog open={activeSessionDevice !== null} onOpenChange={(open) => { if (!open) setActiveSessionDevice(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Account already active</AlertDialogTitle>
            <AlertDialogDescription>
              This account is already logged in on another device{activeSessionDevice ? ` (${activeSessionDevice})` : ""}. You can cancel and remain logged out, or end the previous device session and continue here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => { void attemptLogin(true); }}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Log Out Previous Device & Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AuthLayout>
  );
}

export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/40 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-slate-950/90 p-1.5 shadow-glow ring-1 ring-white/10">
            <img src="/receipt-manager-logo.png" alt="Masjid Receipt Manager" className="h-full w-full object-contain" />
          </div>
          <h1 className="font-display text-2xl font-bold">{title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
        </div>
        <div className="card-surface p-6 sm:p-8">{children}</div>
        <p className="text-center text-xs text-muted-foreground mt-6">
          Masjid Receipt Manager · v1.0.0
        </p>
      </div>
    </div>
  );
}
