import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth-context";
import { createUser } from "@/lib/DatabaseService";
import { normalizeUsername, validateUsername } from "@/lib/auth";
import { AuthLayout } from "./Login";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, UserPlus } from "lucide-react";

export default function Register() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const usernameError = validateUsername(username);
    if (usernameError) { toast.error(usernameError); return; }
    if (password.length < 8) { toast.error("Password must be at least 8 characters."); return; }
    if (password !== confirmPassword) { toast.error("Passwords do not match."); return; }

    const normalizedUsername = normalizeUsername(username);

    setBusy(true);
    try {
      await createUser(normalizedUsername, password);
      toast.success("Account created! Welcome.");
      navigate("/", { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create account. Please try again.";
      if (message.toLowerCase().includes("already taken")) {
        toast.error("Username already taken. Please choose another.");
      } else {
        toast.error(message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Create account" subtitle="Get started with Masjid Receipt Manager">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-2">
          <Label htmlFor="reg-username">Username</Label>
          <Input
            id="reg-username"
            required
            autoComplete="username"
            placeholder="e.g. ahmed_admin"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            Letters, numbers, underscore or dot · 3–30 characters
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="reg-password">Password</Label>
          <Input
            id="reg-password"
            type="password"
            required
            autoComplete="new-password"
            placeholder="Min. 8 characters"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="reg-confirm">Confirm password</Label>
          <Input
            id="reg-confirm"
            type="password"
            required
            autoComplete="new-password"
            placeholder="Re-enter your password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
          Create account
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-primary hover:underline">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
