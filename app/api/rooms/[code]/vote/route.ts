import { jsonError, jsonOk, parseJson } from "@/lib/server/http";
import { getRoomCookieName, submitTeamVote } from "@/lib/server/rooms";
import type { VoteChoice } from "@/lib/types";

export const runtime = "nodejs";

type VotePayload = {
  vote: VoteChoice;
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
  context: RouteContext<"/api/rooms/[code]/vote">,
) {
  try {
    const { code } = await context.params;
    const sessionToken = getSessionToken(request, code);
    if (!sessionToken) {
      throw new Error("No room session was found.");
    }
    const body = await parseJson<VotePayload>(request);
    await submitTeamVote(code, sessionToken, body.vote);
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
