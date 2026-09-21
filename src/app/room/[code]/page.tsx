import { notFound } from "next/navigation";

import { serviceClient } from "@/lib/server/db";
import { isSupabaseConfigured } from "@/lib/server/env";
import { loadRoomState } from "@/lib/server/roomState";
import { requireActor } from "@/lib/server/session";

import { JoinPrompt } from "./JoinPrompt";
import { RoomClient } from "./RoomClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-rendered bootstrap for a room.
 *
 * Note what this does NOT do: fetch the target. RSC output is serialised into
 * the page HTML, so fetching the secret here would embed it in the document —
 * readable by anyone who views source, including the Psychic's own screen
 * being glanced at. The Psychic's client component fetches it after hydration
 * instead.
 */
export default async function RoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const normalised = code.toUpperCase();

  if (!isSupabaseConfigured()) return <NotConfigured />;

  const { data: room } = await serviceClient()
    .from("rooms")
    .select("id")
    .eq("code", normalised)
    .neq("status", "finished")
    .maybeSingle<{ id: string }>();

  if (room === null) notFound();

  // Only the data fetch is guarded: JSX must be constructed outside, because
  // React renders it later and a try/catch here would not see render errors.
  let initial: Awaited<ReturnType<typeof loadRoomState>> | null = null;
  try {
    initial = await loadRoomState(await requireActor(room.id));
  } catch {
    // No session for this room yet — they followed a link, or their cookie
    // lapsed.
    initial = null;
  }

  if (initial === null) return <JoinPrompt code={normalised} />;
  return <RoomClient initial={initial} />;
}

function NotConfigured() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-950 px-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold text-white">Online play isn&apos;t set up</h1>
        <p className="mt-3 text-stone-400">
          This deployment has no database configured. Copy{" "}
          <code className="rounded bg-white/10 px-1.5 py-0.5 text-stone-200">.env.example</code>{" "}
          to{" "}
          <code className="rounded bg-white/10 px-1.5 py-0.5 text-stone-200">.env.local</code>{" "}
          and fill in the Supabase values.
        </p>
        <a
          href="/local"
          className="mt-6 inline-block rounded-xl bg-white px-6 py-3 font-bold text-stone-900"
        >
          Play on one device instead
        </a>
      </div>
    </main>
  );
}
