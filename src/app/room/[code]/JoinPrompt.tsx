"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { rememberName, useRememberedName } from "@/lib/client/useRememberedName";

/** Shown when someone opens a room link without a session for it. */
export function JoinPrompt({ code }: { code: string }) {
  const router = useRouter();
  const remembered = useRememberedName();
  // Null until the player types: lets the remembered name show through after
  // hydration without a setState inside an effect.
  const [typed, setTyped] = useState<string | null>(null);
  const name = typed ?? remembered;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch("/api/rooms/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, displayName: name.trim() }),
    });
    const body = (await response.json()) as { message?: string };

    if (!response.ok) {
      setError(body.message ?? "Could not join.");
      setBusy(false);
      return;
    }
    rememberName(name.trim());
    router.refresh();
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-950 px-6">
      <form onSubmit={submit} className="w-full max-w-sm">
        <p className="text-center text-sm uppercase tracking-widest text-stone-500">
          Joining room
        </p>
        <p className="mt-1 text-center font-mono text-4xl tracking-[0.3em] text-white">
          {code}
        </p>

        <input
          value={name}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Your name"
          aria-label="Your name"
          maxLength={24}
          className="mt-8 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-white placeholder:text-stone-500 focus:border-white/40 focus:outline-none"
        />
        <button
          type="submit"
          disabled={name.trim().length === 0 || busy}
          className="mt-3 w-full rounded-xl bg-white px-6 py-3.5 text-lg font-bold text-stone-900 disabled:opacity-40"
        >
          {busy ? "Joining…" : "Join"}
        </button>
        {error !== null && (
          <p role="alert" className="mt-3 text-center text-sm text-rose-300">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
