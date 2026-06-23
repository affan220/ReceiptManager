import { useState, useRef, useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { useApp } from "@/lib/app-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/hooks/use-theme";
import { OrgSettings, initialsOf } from "@/lib/store";
import { toast } from "sonner";
import { Save, Upload, Trash2, Moon, Sun } from "lucide-react";

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
            <h2 className="font-display text-lg font-semibold mb-4">Appearance</h2>
            <div className="flex items-center justify-between rounded-xl border border-border bg-muted/30 px-4 py-3">
              <div className="flex items-center gap-3">
                {theme === "dark" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
                <div>
                  <p className="font-medium">Dark mode</p>
                  <p className="text-xs text-muted-foreground">Easier on the eyes at night</p>
                </div>
              </div>
              <Switch checked={theme === "dark"} onCheckedChange={(v) => setTheme(v ? "dark" : "light")} />
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
