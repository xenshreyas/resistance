import { jsonError, jsonOk, parseJson } from "@/lib/server/http";
import { getRoomCookieName, markPresence } from "@/lib/server/rooms";

export const runtime = "nodejs";

type PresencePayload = {
  presence: "active" | "disconnect";
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
  context: RouteContext<"/api/rooms/[code]/presence">,
) {
  try {
    const { code } = await context.params;
    const sessionToken = getSessionToken(request, code);
    if (!sessionToken) {
      return jsonOk({ ok: true });
    }

    const body = await parseJson<PresencePayload>(request);
    await markPresence(code, sessionToken, body.presence);
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
