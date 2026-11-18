"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, Trash2 } from "lucide-react";
import { api } from "../lib/client";
import { Button } from "./UI";
import { Field } from "./RecordForms";

/**
 * Export and deletion, wired to the endpoints the privacy policy promises.
 *
 * Both actions are irreversible or hard to undo, so neither is a single click:
 * export is a plain download, deletion needs the password typed again plus the word
 * DELETE. The server enforces the same rules; this is not the security boundary.
 */
export function AccountData({ isDemo, toast }: { isDemo: boolean; toast: (message: string) => void }) {
  const router = useRouter();
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    setExporting(true); setError("");
    try {
      const response = await fetch("/api/account/export", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Export failed.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `opspilot-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast("Your export has been downloaded.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally { setExporting(false); }
  }

  async function remove(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const result = await api<{ ok: boolean; deletedWorkspace: boolean }>("/api/account", "DELETE", { password, confirm: "DELETE" });
      toast(result.deletedWorkspace ? "Account and workspace deleted." : "Your account was deleted.");
      router.replace("/login");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete the account.");
    } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 18 }}>
      <h3 className="settings-label">Your data</h3>
      <div className="settings-row">
        <div>
          <h3>Download everything we hold</h3>
          <p>Account, workspace, records, documents (as a list), notifications and audit history, as one JSON file.</p>
        </div>
        <Button variant="secondary" busy={exporting} onClick={() => void download()}>
          <Download size={15}/>Download my data
        </Button>
      </div>

      <div className="settings-row">
        <div>
          <h3>Delete my account</h3>
          <p>
            Removes your account, its sessions and memberships immediately. If you are the only member of this
            workspace, the workspace and everything in it is deleted too. If teammates remain, deletion is refused
            until you remove them.
          </p>
        </div>
        <Button variant="danger" onClick={() => { setOpen(true); setError(""); }}>
          <Trash2 size={15}/>Delete my account
        </Button>
      </div>

      {isDemo && <div className="settings-notice" role="note"><p>This is a demo workspace: the account has no personal email or password, so deletion is not available here.</p></div>}

      {error && <div className="form-error" role="alert">{error}</div>}

      {open && (
        <form onSubmit={remove} style={{ marginTop: 14, border: "1px solid var(--border, #e5e7eb)", borderRadius: 12, padding: 16 }}>
          <h3>Confirm deletion</h3>
          <p style={{ opacity: 0.8 }}>This cannot be undone. Type DELETE and enter your password.</p>
          <Field label="Type DELETE to confirm">
            <input value={confirmText} onChange={(event) => setConfirmText(event.target.value)} required placeholder="DELETE" autoComplete="off" />
          </Field>
          <Field label="Your password">
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" />
          </Field>
          <div className="settings-footer" style={{ display: "flex", gap: 10 }}>
            <Button type="submit" variant="danger" busy={busy} disabled={confirmText !== "DELETE" || !password || isDemo}>
              {busy ? <Loader2 size={15}/> : <Trash2 size={15}/>}Delete permanently
            </Button>
            <Button type="button" variant="secondary" onClick={() => { setOpen(false); setPassword(""); setConfirmText(""); setError(""); }}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
