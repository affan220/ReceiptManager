import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApp } from "@/lib/app-context";
import { parseDelimited } from "@/lib/store";
import { Upload, FileUp, Sparkles } from "lucide-react";
import { toast } from "sonner";

const SAMPLE = `name,phone,amount,status,month,year,months_pending
Abdullah Rahman,+91 90000 12345,500,paid,6,2026,0
Khalid Mansoor,+91 90000 67890,750,unpaid,6,2026,2
Tariq Saeed,+91 90000 11223,1000,pending,6,2026,1`;

export default function Import() {
  const { addMembers } = useApp();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ReturnType<typeof parseDelimited>>([]);

  const onFile = async (file?: File) => {
    if (!file) return;
    const content = await file.text();
    setText(content);
    setPreview(parseDelimited(content));
    toast.success(`Loaded ${file.name}`);
  };

  const refreshPreview = () => setPreview(parseDelimited(text));

  const doImport = async () => {
    const rows = preview.length ? preview : parseDelimited(text);
    if (!rows.length) {
      toast.error("Nothing to import");
      return;
    }
    const n = await addMembers(rows);
    toast.success(`Imported ${n} member${n !== 1 ? "s" : ""}`);
    setText("");
    setPreview([]);
  };

  return (
    <AppShell title="Import CSV / TXT" subtitle="Bulk import members from a CSV or tab-delimited file">
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="card-surface p-5 lg:col-span-3 flex flex-col gap-4">
          <div>
            <Label className="mb-2 block">Upload file</Label>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-8 text-center hover:border-primary/50 hover:bg-muted/30 transition-colors">
              <FileUp className="h-8 w-8 text-muted-foreground" />
              <p className="font-medium">Click to upload CSV or TXT</p>
              <p className="text-xs text-muted-foreground">Tab or comma delimited</p>
              <Input type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Or paste data</Label>
              <Button variant="ghost" size="sm" onClick={() => { setText(SAMPLE); setPreview(parseDelimited(SAMPLE)); }}>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Use sample
              </Button>
            </div>
            <Textarea
              rows={10}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={refreshPreview}
              placeholder="name,phone,amount,status,month,year,months_pending"
              className="font-mono text-xs"
            />
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={refreshPreview}>Preview</Button>
            <Button onClick={doImport} className="flex-1">
              <Upload className="mr-1.5 h-4 w-4" /> Import {preview.length || ""} members
            </Button>
          </div>
        </div>

        <div className="card-surface p-5 lg:col-span-2">
          <h3 className="font-display font-semibold mb-3">Preview ({preview.length})</h3>
          {preview.length === 0 ? (
            <p className="text-sm text-muted-foreground">Upload or paste data to preview here.</p>
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {preview.slice(0, 30).map((r, i) => (
                <div key={i} className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium truncate">{r.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{r.status}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{r.phone} · {r.amount} · {r.month}/{r.year}</p>
                </div>
              ))}
              {preview.length > 30 && (
                <p className="text-xs text-muted-foreground text-center pt-2">+ {preview.length - 30} more</p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="card-surface p-5 mt-6">
        <h3 className="font-display font-semibold mb-2">Expected format</h3>
        <pre className="rounded-lg bg-muted p-3 text-xs overflow-x-auto"><code>{`name,phone,amount,status,month,year,months_pending
Ahmed Khan,+91 98000 11111,500,paid,6,2026,0`}</code></pre>
        <p className="text-xs text-muted-foreground mt-2">
          Status values: <code>paid</code>, <code>unpaid</code>, <code>pending</code>. Month is 1–12.
        </p>
      </div>
    </AppShell>
  );
}
