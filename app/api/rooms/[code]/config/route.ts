import { jsonError, jsonOk, parseJson } from "@/lib/server/http";
import { getRoomCookieName, updateRoomConfig } from "@/lib/server/rooms";
import type { RoomConfig } from "@/lib/types";

export const runtime = "nodejs";

function getSessionToken(request: Request, roomCode: string) {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${getRoomCookieName(roomCode)}=`))
    ?.split("=")[1] ?? null;
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/rooms/[code]/config">,
) {
  try {
    const { code } = await context.params;
    const sessionToken = getSessionToken(request, code);
    if (!sessionToken) {
      throw new Error("No room session was found.");
    }
    const config = await parseJson<RoomConfig>(request);
    await updateRoomConfig(code, sessionToken, config);
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
