import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth-context";
import { Loader2 } from "lucide-react";

export default function AuthCallback() {
  const { loading } = useAuth();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (loading) {
        setError("Authentication is taking too long. Please try again.");
      }
    }, 10000);

    return () => clearTimeout(timer);
  }, [loading]);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-destructive mb-4">{error}</p>
          <a href="/login" className="text-primary hover:underline">Return to login</a>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Completing sign in...</p>
        </div>
      </div>
    );
  }

  const from = (location.state as { from?: { pathname?: string } })?.from?.pathname || "/";
  return <Navigate to={from} replace />;
}