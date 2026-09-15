"use client";

import { useCallback, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { normalizeKindleEmail } from "@/lib/kindle-settings";

interface ReadingSettingsProps {
  kindleEmail: string | null;
  kindleAutoSend: boolean;
  senderAddress: string;
  newsletterAddress: string | undefined;
}

export function ReadingSettings({
  kindleEmail: initial,
  kindleAutoSend: initialAutoSend,
  senderAddress,
  newsletterAddress,
}: ReadingSettingsProps) {
  const [kindleEmail, setKindleEmail] = useState(initial || "");
  const [savedEmail, setSavedEmail] = useState(initial || "");
  const [kindleAutoSend, setKindleAutoSend] = useState(initialAutoSend);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string>("");
  const [testing, setTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const normalized = normalizeKindleEmail(kindleEmail);
  const normalizedEmail = normalized.ok ? (normalized.value ?? "") : kindleEmail.trim();
  const emailMatchesSaved =
    savedEmail.length > 0 && normalizedEmail === savedEmail;

  const handleSaveEmail = useCallback(async () => {
    setSaving(true);
    setSaveStatus("");
    try {
      const res = await fetch("/api/settings/reading", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kindleEmail: kindleEmail.trim() || null }),
      });
      const data = (await res.json().catch(() => null)) as {
        kindleEmail?: string | null;
        error?: string;
      } | null;
      if (!res.ok) {
        setSaveStatus(data?.error || "Error saving email");
      } else {
        const saved = data?.kindleEmail ?? "";
        setKindleEmail(saved);
        setSavedEmail(saved);
        setSaveStatus("Saved");
        setTimeout(() => setSaveStatus(""), 3000);
      }
    } catch {
      setSaveStatus("Network error");
    } finally {
      setSaving(false);
    }
  }, [kindleEmail]);

  const handleAutoSendChange = useCallback(async (checked: boolean) => {
    const previous = kindleAutoSend;
    setKindleAutoSend(checked);
    try {
      const res = await fetch("/api/settings/reading", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kindleAutoSend: checked }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error || "Error saving auto-send setting");
      }
    } catch (error) {
      setKindleAutoSend(previous);
      setSaveStatus(
        error instanceof Error ? error.message : "Network error",
      );
    }
  }, [kindleAutoSend]);

  const handleTest = useCallback(async () => {
    if (!emailMatchesSaved) return;
    setTesting(true);
    setTestStatus("");
    try {
      const res = await fetch("/api/settings/reading/test", { method: "POST" });
      if (res.ok) {
        setTestStatus("Test sent — check your Kindle in a minute");
        setTimeout(() => setTestStatus(""), 5000);
      } else {
        const data = await res.json();
        setTestStatus(data.error || "Error sending test");
      }
    } catch {
      setTestStatus("Network error");
    } finally {
      setTesting(false);
    }
  }, [emailMatchesSaved]);

  const handleCopyNewsletter = useCallback(() => {
    if (newsletterAddress) {
      navigator.clipboard.writeText(newsletterAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [newsletterAddress]);

  return (
    <div className="space-y-5">
      <div>
        <label className="mb-2 block text-sm font-medium" htmlFor="kindleEmail">
          Kindle email
        </label>
        <div className="flex gap-2">
          <input
            id="kindleEmail"
            type="email"
            placeholder="name@kindle.com"
            value={kindleEmail}
            onChange={(e) => {
              setKindleEmail(e.target.value);
              setSaveStatus("");
              setTestStatus("");
            }}
            className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm focus:border-[var(--color-ring)] focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void handleSaveEmail()}
            disabled={saving}
            className="rounded-md bg-[var(--color-foreground)] px-4 py-2 text-sm font-medium text-[var(--color-background)] transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        {saveStatus ? <p className="mt-1 text-xs">{saveStatus}</p> : null}
        {!emailMatchesSaved && kindleEmail.trim() ? (
          <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
            Save your Kindle email first
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="autoSend"
          checked={kindleAutoSend}
          onChange={(e) => void handleAutoSendChange(e.target.checked)}
          className="size-4 accent-[var(--color-foreground)]"
        />
        <label htmlFor="autoSend" className="text-sm">
          Send new saves to Kindle automatically
        </label>
      </div>

      <button
        type="button"
        onClick={() => void handleTest()}
        disabled={!emailMatchesSaved || testing}
        className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm transition hover:bg-[var(--color-accent)] disabled:opacity-50"
      >
        {testing ? (
          <Loader2 className="mr-2 inline size-4 animate-spin" />
        ) : null}
        Send test
      </button>
      {testStatus ? <p className="text-xs">{testStatus}</p> : null}

      <div className="mt-4 space-y-3 border-t border-[var(--color-border)] pt-4">
        <div>
          <p className="mb-1 text-xs font-medium">Kindle sender approval</p>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            Amazon only accepts documents from approved senders. Add{" "}
            <strong>{senderAddress}</strong> in{" "}
            <a
              href="https://www.amazon.com/mycd"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-[var(--color-foreground)]"
            >
              Amazon → Manage Your Content and Devices → Preferences → Personal Document Settings
            </a>
            .
          </p>
        </div>

        {newsletterAddress ? (
          <div>
            <p className="mb-1 text-xs font-medium">Newsletter address</p>
            <div className="flex items-center gap-2 rounded-md bg-[var(--color-accent)] p-2 font-mono text-xs">
              <span className="min-w-0 break-all">{newsletterAddress}</span>
              <button
                type="button"
                onClick={handleCopyNewsletter}
                className="ml-auto shrink-0 rounded p-1 hover:bg-[var(--color-fill)]"
                aria-label="Copy newsletter address"
              >
                {copied ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Newsletter address: Not set up yet
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
