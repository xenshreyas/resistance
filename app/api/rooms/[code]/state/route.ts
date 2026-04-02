import { jsonError, jsonOk } from "@/lib/server/http";
import { getRoomCookieName, getViewerRoomState } from "@/lib/server/rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: RouteContext<"/api/rooms/[code]/state">,
) {
  try {
    const { code } = await context.params;
    const sessionToken = request.headers
      .get("cookie")
      ?.split(";")
      .map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith(`${getRoomCookieName(code)}=`))
      ?.split("=")[1] ?? null;
    const state = await getViewerRoomState(code, sessionToken);

    if (!state) {
      return jsonError(new Error("Room not found."), 404);
    }

    return jsonOk(state, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
