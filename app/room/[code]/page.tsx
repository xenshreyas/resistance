import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { RoomShell } from "@/app/_components/room-shell";
import { getRoomCookieName, getViewerRoomState } from "@/lib/server/rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RoomPageProps = {
  params: Promise<{
    code: string;
  }>;
};

export default async function RoomPage({ params }: RoomPageProps) {
  const { code } = await params;
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(getRoomCookieName(code))?.value ?? null;
  const state = await getViewerRoomState(code, sessionToken);

  if (!state) {
    notFound();
  }

  return <RoomShell code={code.toUpperCase()} initialState={state} />;
}
