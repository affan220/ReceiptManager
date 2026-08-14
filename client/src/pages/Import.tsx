import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApp } from "@/lib/app-context";
import { BulkImportResult } from "@/lib/DatabaseService";
import { parseDelimited } from "@/lib/store";
import { FileUp, Loader2, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";

const SAMPLE = `name,phone,amount,status,payment_mode,month,year,months_pending,payment_date,voucher_number
Abdullah Rahman,+91 90000 12345,500,paid,cash,6,2026,0,2026-06-14,VCH-000125
Khalid Mansoor,+91 90000 67890,750,unpaid,cash,6,2026,2,,
Tariq Saeed,+91 90000 11223,1000,pending,account,6,2026,1,,`;

export default function Import() {
  const { addMembers } = useApp();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ReturnType<typeof parseDelimited>>([]);
  const [result, setResult] = useState<BulkImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshPreview = () => {
    setPreview(parseDelimited(text));
    setResult(null);
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    const content = await file.text();
    setText(content);
    setPreview(parseDelimited(content));
    setResult(null);
    toast.success(`Loaded ${file.name}`);
  };

  const doImport = async () => {
    const rows = preview.length ? preview : parseDelimited(text);
    if (!rows.length) {
      toast.error("Add a header row and at least one member row before importing.");
      return;
    }

    setBusy(true);
    try {
      const importResult = await addMembers(rows);
      setResult(importResult);
      if (importResult.failedCount > 0) {
        toast.error(`Import completed: ${importResult.importedCount} imported, ${importResult.failedCount} rejected.`);
      } else {
        toast.success(`Import completed: ${importResult.importedCount} members imported.`);
        setText("");
        setPreview([]);
      }
    } catch {
      // The shared application provider already shows the specific backend error.
    } finally {
      setBusy(false);
    }
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
              <p className="text-xs text-muted-foreground">Tab or comma delimited. Maximum 1,000 rows per import.</p>
              <Input type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={(event) => void onFile(event.target.files?.[0])} />
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Or paste data</Label>
              <Button variant="ghost" size="sm" onClick={() => { setText(SAMPLE); setPreview(parseDelimited(SAMPLE)); setResult(null); }}>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Use sample
              </Button>
            </div>
            <Textarea
              rows={10}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onBlur={refreshPreview}
              placeholder="name,phone,amount,status,payment_mode,month,year,months_pending,payment_date,voucher_number"
              className="font-mono text-xs"
            />
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={refreshPreview} disabled={busy}>Preview</Button>
            <Button onClick={() => void doImport()} className="flex-1" disabled={busy}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
              Import {preview.length || ""} members
            </Button>
          </div>
        </div>

        <div className="card-surface p-5 lg:col-span-2">
          <h3 className="font-display font-semibold mb-3">Preview ({preview.length})</h3>
          {preview.length === 0 ? (
            <p className="text-sm text-muted-foreground">Upload or paste data to preview here.</p>
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {preview.slice(0, 30).map((row) => (
                <div key={row.rowNumber} className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium truncate">{row.name || "Missing name"}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{row.status || "unpaid"}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {row.phone || "Missing phone"} · {row.amount || "Missing amount"} · {row.payment_mode || "cash"} · {row.month}/{row.year}
                  </p>
                  {(row.payment_date || row.voucher_number) && (
                    <p className="text-xs text-muted-foreground truncate">{row.payment_date || "No payment date"} · {row.voucher_number || "Auto voucher"}</p>
                  )}
                </div>
              ))}
              {preview.length > 30 && <p className="text-xs text-muted-foreground text-center pt-2">+ {preview.length - 30} more</p>}
            </div>
          )}
        </div>
      </div>

      {result && (
        <div className="card-surface p-5 mt-6">
          <h3 className="font-display font-semibold">Import result</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Successfully imported: <strong className="text-foreground">{result.importedCount}</strong> · Rejected: <strong className="text-foreground">{result.failedCount}</strong>
          </p>
          {result.errors.length > 0 && (
            <div className="mt-4 max-h-56 space-y-2 overflow-y-auto pr-1">
              {result.errors.map((failure) => (
                <div key={failure.row} className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
                  <p className="font-medium">Row {failure.row}</p>
                  <p className="text-xs text-muted-foreground">{failure.errors.join(" ")}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card-surface p-5 mt-6">
        <h3 className="font-display font-semibold mb-2">Expected format</h3>
        <pre className="rounded-lg bg-muted p-3 text-xs overflow-x-auto"><code>{`name,phone,amount,status,payment_mode,month,year,months_pending,payment_date,voucher_number
Ahmed Khan,+91 98000 11111,500,paid,cash,6,2026,0,2026-06-14,VCH-000125`}</code></pre>
        <p className="text-xs text-muted-foreground mt-2">
          Status values: <code>paid</code>, <code>unpaid</code>, <code>pending</code>. Payment mode: <code>cash</code>, <code>account</code>. Use dates such as <code>2026-06-14</code> or <code>14-06-2026</code>. Invalid rows are rejected and shown above; valid rows import in one database batch.
        </p>
      </div>
    </AppShell>
  );
}
