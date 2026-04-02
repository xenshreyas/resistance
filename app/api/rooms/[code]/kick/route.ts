import { jsonError, jsonOk, parseJson } from "@/lib/server/http";
import { getRoomCookieName, kickPlayer } from "@/lib/server/rooms";

export const runtime = "nodejs";

type KickPayload = {
  playerId: string;
};

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
  context: RouteContext<"/api/rooms/[code]/kick">,
) {
  try {
    const { code } = await context.params;
    const sessionToken = getSessionToken(request, code);
    if (!sessionToken) {
      throw new Error("No room session was found.");
    }

    const body = await parseJson<KickPayload>(request);
    await kickPlayer(code, sessionToken, body.playerId);
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
