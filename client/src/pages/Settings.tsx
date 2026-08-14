import { useState, useRef, useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { useApp } from "@/lib/app-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Theme, useTheme } from "@/hooks/use-theme";
import { OrgSettings, initialsOf } from "@/lib/store";
import { toast } from "sonner";
import { Save, Upload, Trash2, Moon, Sun, Sparkles } from "lucide-react";

export default function Settings() {
  const { settings, updateSettings } = useApp();
  const { theme, setTheme } = useTheme();
  const [form, setForm] = useState<OrgSettings>(settings);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setForm(settings), [settings]);

  const set = <K extends keyof OrgSettings>(k: K, v: OrgSettings[K]) => setForm((f) => ({ ...f, [k]: v }));

  const onLogo = (file?: File) => {
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) { toast.error("Logo must be under 1.5MB"); return; }
    const r = new FileReader();
    r.onload = () => set("logoDataUrl", String(r.result));
    r.readAsDataURL(file);
  };

  const save = () => {
    updateSettings(form);
    toast.success("Settings saved");
  };

  const changeTheme = (nextTheme: Theme) => {
    void setTheme(nextTheme)
      .then(() => toast.success("Appearance saved"))
      .catch((error) => toast.error(error instanceof Error ? error.message : "Could not save appearance."));
  };

  return (
    <AppShell title="Settings" subtitle="Organization profile, branding and preferences">
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card-surface p-6 lg:col-span-2 space-y-5">
          <h2 className="font-display text-lg font-semibold">Organization profile</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2 sm:col-span-2">
              <Label>Organization name</Label>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label>Tagline</Label>
              <Input value={form.tagline} onChange={(e) => set("tagline", e.target.value)} />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label>Address</Label>
              <Textarea rows={2} value={form.address} onChange={(e) => set("address", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Receipt prefix</Label>
              <Input value={form.receiptPrefix} onChange={(e) => set("receiptPrefix", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Currency symbol</Label>
              <Input value={form.currency} onChange={(e) => set("currency", e.target.value)} />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label>Signature label</Label>
              <Input value={form.signatureLabel} onChange={(e) => set("signatureLabel", e.target.value)} />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button onClick={save}><Save className="mr-1.5 h-4 w-4" /> Save changes</Button>
          </div>
        </div>

        <div className="space-y-6">
          <div className="card-surface p-6">
            <h2 className="font-display text-lg font-semibold mb-4">Logo</h2>
            <div className="flex items-center gap-4">
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-primary text-primary-foreground font-display text-xl font-bold overflow-hidden shadow-glow">
                {form.logoDataUrl ? <img src={form.logoDataUrl} alt="Logo" className="h-full w-full object-cover" /> : initialsOf(form.name)}
              </div>
              <div className="flex flex-col gap-2 flex-1">
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  <Upload className="mr-1.5 h-3.5 w-3.5" /> Upload logo
                </Button>
                {form.logoDataUrl && (
                  <Button variant="ghost" size="sm" onClick={() => set("logoDataUrl", null)}>
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove
                  </Button>
                )}
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onLogo(e.target.files?.[0])} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3">Square PNG/JPG works best. Max 1.5MB.</p>
          </div>

          <div className="card-surface p-6">
            <h2 className="font-display text-lg font-semibold mb-1">Appearance</h2>
            <p className="text-xs text-muted-foreground mb-4">Your choice is securely saved to this account and follows you across devices.</p>
            <div className="grid gap-2">
              {([
                ["light", "Light", "Clean, bright workspace", Sun],
                ["dark", "Dark", "Reduced eye strain at night", Moon],
                ["liquid_glass", "Liquid Glass", "Frosted, layered glass finish", Sparkles],
              ] as const).map(([value, label, description, Icon]) => (
                <button
                  type="button"
                  key={value}
                  onClick={() => changeTheme(value)}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all ${theme === value ? "border-primary bg-primary/10 shadow-sm" : "border-border bg-muted/30 hover:-translate-y-0.5 hover:bg-muted/50"}`}
                >
                  <Icon className="h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="block text-xs text-muted-foreground">{description}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
