import { NextResponse } from "next/server";

import { jsonError, parseJson } from "@/lib/server/http";
import { getRoomCookieName, joinRoom } from "@/lib/server/rooms";

export const runtime = "nodejs";

type JoinRoomPayload = {
  displayName: string;
  spectator?: boolean;
};

export async function POST(
  request: Request,
  context: RouteContext<"/api/rooms/[code]/join">,
) {
  try {
    const { code } = await context.params;
    const body = await parseJson<JoinRoomPayload>(request);
    const { roomCode, sessionToken } = await joinRoom(
      code,
      body.displayName,
      body.spectator,
    );

    const response = NextResponse.json({ roomCode });
    response.cookies.set(getRoomCookieName(roomCode), sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 30,
    });

    return response;
  } catch (error) {
    return jsonError(error);
  }
}
