import { getRoomCookieName, getViewerRoomState } from "@/lib/server/rooms";
import { subscribeToRoom } from "@/lib/server/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function getSessionToken(request: Request, roomCode: string) {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${getRoomCookieName(roomCode)}=`))
    ?.split("=")[1] ?? null;
}

export async function GET(
  request: Request,
  context: RouteContext<"/api/rooms/[code]/events">,
) {
  const { code } = await context.params;
  const roomCode = code.toUpperCase();
  const sessionToken = getSessionToken(request, roomCode);

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let cleanedUp = false;

      function cleanup() {
        if (cleanedUp) {
          return;
        }

        cleanedUp = true;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();

        try {
          controller.close();
        } catch {
          // Ignore races where the stream is already closed during refresh/reconnect.
        }
      }

      function safeEnqueue(payload: string) {
        if (closed) {
          return;
        }

        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          cleanup();
        }
      }

      async function pushState(event = "state") {
        if (closed) {
          return;
        }

        const state = await getViewerRoomState(roomCode, sessionToken);
        if (closed) {
          return;
        }

        if (!state) {
          safeEnqueue(
            `event: error\ndata: ${JSON.stringify({ error: "Room not found." })}\n\n`,
          );
          return;
        }

        safeEnqueue(
          `event: ${event}\ndata: ${JSON.stringify(state)}\n\n`,
        );
      }

      await pushState();

      const unsubscribe = subscribeToRoom(roomCode, () => {
        void pushState();
      });

      const heartbeat = setInterval(() => {
        void pushState("heartbeat");
      }, 15000);

      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    },
  });
}
