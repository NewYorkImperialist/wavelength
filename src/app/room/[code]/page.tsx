import { notFound } from "next/navigation";

import { serviceClient } from "@/lib/server/db";
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
