"use client";

import { useState, useTransition } from "react";

type ActionState = {
  error: string | null;
};

async function postJson<TResponse>(
  url: string,
  body: unknown,
): Promise<TResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json()) as TResponse & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed.");
  }

  return payload;
}

export function LandingShell() {
  const [createName, setCreateName] = useState("");
  const [joinName, setJoinName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [createState, setCreateState] = useState<ActionState>({ error: null });
  const [joinState, setJoinState] = useState<ActionState>({ error: null });
  const [isCreating, startCreate] = useTransition();
  const [isJoining, startJoin] = useTransition();

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-6 py-10 lg:px-10 lg:py-14">
      <section className="grid gap-6 rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(137,155,167,0.18),transparent_35%),linear-gradient(135deg,rgba(19,30,37,0.95),rgba(8,14,18,0.96))] p-8 shadow-[0_30px_80px_rgba(0,0,0,0.35)] lg:grid-cols-[1.35fr_0.9fr]">
        <div className="space-y-6">
          <span className="inline-flex rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-cyan-100/80">
            Tactical social deduction
          </span>
          <div className="space-y-4">
            <h1 className="max-w-3xl text-4xl font-semibold tracking-[-0.04em] text-stone-50 sm:text-5xl lg:text-6xl">
              Run a full Resistance game from one live room.
            </h1>
            <p className="max-w-2xl text-base leading-8 text-slate-300/78 sm:text-lg">
              Create a private room, seat 4 to 6 players, bring in spectators,
              and resolve hidden votes and missions in real time without
              exposing any secret information.
            </p>
          </div>
          <div className="grid gap-4 text-sm text-slate-300/72 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
              Hidden spy identities
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
              Rejoin-safe seats
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
              Railway-ready backend
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          <section className="rounded-[1.75rem] border border-white/10 bg-white/6 p-5 backdrop-blur">
            <p className="mb-4 text-sm uppercase tracking-[0.22em] text-slate-400">
              Create Room
            </p>
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                setCreateState({ error: null });
                startCreate(async () => {
                  try {
                    const payload = await postJson<{ roomCode: string }>(
                      "/api/rooms",
                      { displayName: createName },
                    );
                    window.location.assign(`/room/${payload.roomCode}`);
                  } catch (error) {
                    setCreateState({
                      error:
                        error instanceof Error
                          ? error.message
                          : "Unable to create room.",
                    });
                  }
                });
              }}
            >
              <input
                className="rounded-2xl border border-white/10 bg-[#081015] px-4 py-3 text-sm text-white outline-none ring-0 placeholder:text-slate-500"
                placeholder="Your name"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                maxLength={32}
              />
              <button
                type="submit"
                className="rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-cyan-500/50"
                disabled={isCreating}
              >
                {isCreating ? "Creating..." : "Create private room"}
              </button>
              {createState.error ? (
                <p className="text-sm text-rose-300">{createState.error}</p>
              ) : null}
            </form>
          </section>

          <section className="rounded-[1.75rem] border border-white/10 bg-white/6 p-5 backdrop-blur">
            <p className="mb-4 text-sm uppercase tracking-[0.22em] text-slate-400">
              Join Room
            </p>
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                setJoinState({ error: null });
                startJoin(async () => {
                  try {
                    const payload = await postJson<{ roomCode: string }>(
                      `/api/rooms/${joinCode.trim().toUpperCase()}/join`,
                      {
                        displayName: joinName,
                      },
                    );
                    window.location.assign(`/room/${payload.roomCode}`);
                  } catch (error) {
                    setJoinState({
                      error:
                        error instanceof Error
                          ? error.message
                          : "Unable to join room.",
                    });
                  }
                });
              }}
            >
              <input
                className="rounded-2xl border border-white/10 bg-[#081015] px-4 py-3 text-sm uppercase tracking-[0.24em] text-white outline-none placeholder:text-slate-500"
                placeholder="Room code"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value)}
                maxLength={6}
              />
              <input
                className="rounded-2xl border border-white/10 bg-[#081015] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
                placeholder="Your name"
                value={joinName}
                onChange={(event) => setJoinName(event.target.value)}
                maxLength={32}
              />
              <button
                type="submit"
                className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/16 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isJoining}
              >
                {isJoining ? "Joining..." : "Join room"}
              </button>
              {joinState.error ? (
                <p className="text-sm text-rose-300">{joinState.error}</p>
              ) : null}
            </form>
          </section>
        </div>
      </section>
    </main>
  );
}
