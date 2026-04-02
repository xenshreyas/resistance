import { jsonError, jsonOk } from "@/lib/server/http";
import { claimSeat, getRoomCookieName } from "@/lib/server/rooms";

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
  context: RouteContext<"/api/rooms/[code]/seat">,
) {
  try {
    const { code } = await context.params;
    const sessionToken = getSessionToken(request, code);
    if (!sessionToken) {
      throw new Error("No room session was found.");
    }
    await claimSeat(code, sessionToken);
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
