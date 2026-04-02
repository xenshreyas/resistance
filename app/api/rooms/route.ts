import { NextResponse } from "next/server";

import { jsonError, parseJson } from "@/lib/server/http";
import { createRoom, getRoomCookieName } from "@/lib/server/rooms";

export const runtime = "nodejs";

type CreateRoomPayload = {
  displayName: string;
};

export async function POST(request: Request) {
  try {
    const body = await parseJson<CreateRoomPayload>(request);
    const { roomCode, sessionToken } = await createRoom(body.displayName);
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
