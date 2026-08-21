import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";

const MIN_SPLASH_MS = 400;
const EXIT_MS = 180;

export function StartupSplash() {
  const { loading } = useAuth();
  const [minElapsed, setMinElapsed] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setMinElapsed(true), MIN_SPLASH_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!visible || !minElapsed || loading) return;

    setExiting(true);
    const timer = window.setTimeout(() => setVisible(false), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [loading, minElapsed, visible]);

  if (!visible) return null;

  return (
    <div className={`startup-splash ${exiting ? "startup-splash--exit" : ""}`} aria-hidden="true">
      <div className="startup-splash__halo" />
      <div className="startup-splash__ring" />
      <div className="startup-splash__frame">
        <img
          src="/receipt-manager-logo.png"
          alt="Masjid Receipt Manager"
          className="startup-splash__logo"
          draggable={false}
        />
        <p className="startup-splash__caption">Masjid Receipt Manager</p>
      </div>
    </div>
  );
}
