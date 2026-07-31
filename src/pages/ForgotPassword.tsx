/**
 * ForgotPassword — replaced with a simple notice.
 *
 * This app uses username-based authentication with an internal fake email
 * address (username@masjid.local). Password reset emails cannot be delivered
 * to that address, so the standard "forgot password" email flow is not available.
 *
 * This app uses username + password login and stores credentials locally in IndexedDB.
 */
import { Link } from "react-router-dom";
import { AuthLayout } from "./Login";
import { Button } from "@/components/ui/button";
import { Info } from "lucide-react";

export default function ForgotPassword() {
  return (
    <AuthLayout title="Forgot password?" subtitle="Password recovery information">
      <div className="space-y-5 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Info className="h-7 w-7" />
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          This app uses <strong>username + password</strong> login. Password reset emails are not available.
          <br /><br />
          If you've forgotten your password, please contact your administrator to reset it.
        </p>
        <Button asChild className="w-full">
          <Link to="/login">Back to sign in</Link>
        </Button>
      </div>
    </AuthLayout>
  );
}
