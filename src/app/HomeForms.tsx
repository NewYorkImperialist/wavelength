"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { rememberName, useRememberedName } from "@/lib/client/useRememberedName";

type Mode = "create" | "join";

export function HomeForms() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("create");
  const remembered = useRememberedName();
  const [typed, setTyped] = useState<string | null>(null);
  const name = typed ?? remembered;
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const displayName = name.trim();
      rememberName(displayName);

      const response = await fetch(mode === "create" ? "/api/rooms" : "/api/rooms/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "create" ? { displayName } : { displayName, code: code.trim().toUpperCase() },
        ),
      });

      const body = (await response.json()) as { code?: string; message?: string };
      if (!response.ok) {
        setError(body.message ?? "Something went wrong.");
        return;
      }
      router.push(`/room/${body.code}`);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    name.trim().length > 0 && (mode === "create" || code.trim().length === 6) && !busy;

  return (
    <form onSubmit={submit} className="mt-10 flex flex-col gap-3">
      <div className="flex overflow-hidden rounded-xl border border-white/15">
        {(["create", "join"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            aria-pressed={mode === value}
            className={`flex-1 px-4 py-2.5 text-sm font-semibold transition-colors ${
              mode === value ? "bg-white text-stone-900" : "text-stone-400 hover:text-white"
            }`}
          >
            {value === "create" ? "Create game" : "Join game"}
          </button>
        ))}
      </div>

      <input
        value={name}
        onChange={(e) => setTyped(e.target.value)}
        placeholder="Your name"
        aria-label="Your name"
        maxLength={24}
        autoComplete="nickname"
        className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-white placeholder:text-stone-500 focus:border-white/40 focus:outline-none"
      />

      {mode === "join" && (
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
          placeholder="ROOM CODE"
          aria-label="Room code"
          autoCapitalize="characters"
          autoComplete="off"
          className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-center font-mono text-2xl tracking-[0.3em] text-white placeholder:tracking-normal placeholder:text-stone-500 focus:border-white/40 focus:outline-none"
        />
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="rounded-xl bg-white px-6 py-3.5 text-lg font-bold text-stone-900 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "One moment…" : mode === "create" ? "Create game" : "Join game"}
      </button>

      {error !== null && (
        <p role="alert" className="text-center text-sm text-rose-300">
          {error}
        </p>
      )}
    </form>
  );
}
