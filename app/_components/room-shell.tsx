"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import type { MissionCard, ViewerRoomState, VoteChoice } from "@/lib/types";

type RoomShellProps = {
  code: string;
  initialState: ViewerRoomState;
};

async function postJson<TResponse>(
  url: string,
  body?: unknown,
): Promise<TResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = (await response.json()) as TResponse & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed.");
  }

  return payload;
}

function formatCountdown(deadline: string | null, serverTime: string) {
  if (!deadline) {
    return null;
  }

  const diffMs =
    new Date(deadline).getTime() - new Date(serverTime).getTime();
  if (diffMs <= 0) {
    return "resetting now";
  }

  const minutes = Math.floor(diffMs / 60000);
  const seconds = Math.floor((diffMs % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, "0")} left`;
}

export function RoomShell({ code, initialState }: RoomShellProps) {
  const [state, setState] = useState(initialState);
  const [joinName, setJoinName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [missionConfig, setMissionConfig] = useState(
    initialState.room.config.missionSizes.join(", "),
  );
  const [missionCount, setMissionCount] = useState(
    String(initialState.room.config.missionCount),
  );
  const [proposalSelection, setProposalSelection] = useState<string[]>(
    initialState.proposalTeam,
  );
  const [shareUrl, setShareUrl] = useState(`/room/${code}`);
  const [connectionState, setConnectionState] = useState<
    "live" | "reconnecting"
  >("live");
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const eventSource = new EventSource(`/api/rooms/${code}/events`);
    eventSourceRef.current = eventSource;

    const onState = (event: Event) => {
      const messageEvent = event as MessageEvent<string>;
      setState(JSON.parse(messageEvent.data) as ViewerRoomState);
      setConnectionState("live");
    };

    const onError = () => {
      setConnectionState("reconnecting");
    };

    eventSource.addEventListener("state", onState);
    eventSource.addEventListener("heartbeat", onState);
    eventSource.onerror = onError;

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [code]);

  useEffect(() => {
    setShareUrl(`${window.location.origin}/room/${code}`);
  }, [code]);

  useEffect(() => {
    let cancelled = false;

    async function markActive() {
      if (!state.viewer.playerId) {
        return;
      }

      try {
        await postJson(`/api/rooms/${code}/presence`, { presence: "active" });
      } catch {
        if (!cancelled) {
          setConnectionState("reconnecting");
        }
      }
    }

    void markActive();
    const interval = window.setInterval(() => {
      void markActive();
    }, 20000);

    const onUnload = () => {
      if (!state.viewer.playerId) {
        return;
      }

      navigator.sendBeacon(
        `/api/rooms/${code}/presence`,
        new Blob([JSON.stringify({ presence: "disconnect" })], {
          type: "application/json",
        }),
      );
    };

    window.addEventListener("beforeunload", onUnload);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [code, state.viewer.playerId]);

  const isHost = state.viewer.isHost;
  const playerRoster = state.players.filter((player) => player.seatIndex !== null);
  const spectators = state.players.filter((player) => player.seatIndex === null);
  const canClaimSeat =
    state.viewer.playerId !== null &&
    state.viewer.isSpectator &&
    state.room.status === "lobby" &&
    state.seatedCount < 6;
  const reveal = state.game?.reveal ?? null;
  const countdown = formatCountdown(
    state.room.disconnectDeadline,
    state.serverTime,
  );

  function runAction(action: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
      } catch (actionError) {
        setError(
          actionError instanceof Error
            ? actionError.message
            : "Action failed.",
        );
      }
    });
  }

  return (
    <main className="mx-auto flex w-full max-w-[1580px] flex-1 flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8 xl:px-10 xl:py-8">
      <header className="grid gap-4 rounded-[1.9rem] border border-white/10 bg-[linear-gradient(135deg,rgba(13,20,25,0.96),rgba(7,11,15,0.98))] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.36)] xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.9fr)] xl:items-start">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs uppercase tracking-[0.24em] text-cyan-100/80">
              Room {code}
            </span>
            <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs uppercase tracking-[0.18em] text-slate-300">
              {connectionState === "live" ? "Live" : "Reconnecting"}
            </span>
            <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs uppercase tracking-[0.18em] text-slate-300">
              {state.room.status.replace("_", " ")}
            </span>
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.04em] text-stone-50 sm:text-4xl">
              Resistance Command Board
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-300/72 sm:text-base">
              Mission approvals stay secret, mission cards stay anonymous, and
              only the aggregate result is revealed.
            </p>
          </div>
        </div>

        <div className="grid gap-3 rounded-[1.6rem] border border-white/10 bg-white/5 p-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
              Share link
            </p>
            <p className="mt-1 break-all text-sm text-slate-200">
              {shareUrl}
            </p>
          </div>
          <button
            type="button"
            className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/16"
            onClick={() => {
              void navigator.clipboard.writeText(shareUrl);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? "Copied" : "Copy room link"}
          </button>
        </div>
      </header>

      {state.room.paused ? (
        <section className="rounded-[1.5rem] border border-amber-300/24 bg-amber-400/10 px-5 py-4 text-sm text-amber-100">
          A seated player is disconnected. The game is paused softly while they
          reconnect{countdown ? `, ${countdown}` : ""}.
        </section>
      ) : null}

      {error ? (
        <section className="rounded-[1.5rem] border border-rose-300/25 bg-rose-400/10 px-5 py-4 text-sm text-rose-100">
          {error}
        </section>
      ) : null}

      {state.viewer.playerId === null ? (
        <section className="grid gap-4 rounded-[1.75rem] border border-white/10 bg-white/6 p-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold tracking-[-0.03em] text-white">
              Enter the room
            </h2>
            <p className="text-sm leading-7 text-slate-300/72">
              Join with a name. If the game has already started, you will enter
              as a spectator automatically.
            </p>
          </div>
          <form
            className="grid gap-3 sm:min-w-[320px]"
            onSubmit={(event) => {
              event.preventDefault();
              runAction(async () => {
                await postJson(`/api/rooms/${code}/join`, {
                  displayName: joinName,
                });
                window.location.reload();
              });
            }}
          >
            <input
              className="rounded-2xl border border-white/10 bg-[#081015] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
              placeholder="Your name"
              value={joinName}
              onChange={(event) => setJoinName(event.target.value)}
              maxLength={32}
            />
            <button
              type="submit"
              className="rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:bg-cyan-500/50"
              disabled={isPending}
            >
              {isPending ? "Joining..." : "Join room"}
            </button>
          </form>
        </section>
      ) : (
        <section className="grid gap-6 xl:grid-cols-[280px_minmax(720px,1fr)_280px] 2xl:grid-cols-[300px_minmax(820px,1fr)_300px]">
          <aside className="grid gap-6">
            <section className="rounded-[1.75rem] border border-white/10 bg-white/6 p-5 xl:min-h-[320px]">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                    Your role
                  </p>
                  <p className="mt-2 text-xl font-semibold text-white">
                    {state.viewer.role
                      ? state.viewer.role === "spy"
                        ? "Spy"
                        : "Resistance"
                      : state.viewer.isSpectator
                        ? "Spectator"
                        : "Awaiting start"}
                  </p>
                </div>
                {state.viewer.role === "spy" ? (
                  <span className="rounded-full border border-rose-300/20 bg-rose-400/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-rose-100">
                    Hidden intel
                  </span>
                ) : null}
              </div>
              <p className="mt-3 text-sm leading-7 text-slate-300/72">
                {state.viewer.role === "spy"
                  ? "You can see the full spy roster. Blend in and push bad teams through."
                  : state.viewer.role === "resistance"
                    ? "You only know yourself. Read the room and force better mission teams."
                    : "Spectators can track the board, but secret roles stay hidden."}
              </p>
              {state.viewer.role === "spy" ? (
                <div className="mt-4 grid gap-2">
                  {state.players
                    .filter((player) => player.isKnownSpy)
                    .map((player) => (
                      <div
                        key={player.id}
                        className="rounded-2xl border border-rose-300/18 bg-rose-400/10 px-3 py-2 text-sm text-rose-100"
                      >
                        {player.displayName}
                      </div>
                    ))}
                </div>
              ) : null}
            </section>

            <section className="rounded-[1.75rem] border border-white/10 bg-white/6 p-5">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                  Players
                </p>
                <p className="text-xs text-slate-400">
                  {state.seatedCount}/6 seated
                </p>
              </div>
              <div className="mt-4 grid gap-3">
                {playerRoster.map((player) => (
                  <div
                    key={player.id}
                    className="rounded-2xl border border-white/10 bg-[#0a1217] px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-white">
                          Seat {(player.seatIndex ?? 0) + 1} · {player.displayName}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          {player.status === "disconnected"
                            ? "Disconnected"
                            : player.isMissionMember
                              ? "On mission"
                              : "Waiting"}
                        </p>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2 text-[11px] uppercase tracking-[0.16em]">
                        {player.isHost ? (
                          <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-cyan-100">
                            Host
                          </span>
                        ) : null}
                        {player.isLeader ? (
                          <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-1 text-amber-100">
                            Leader
                          </span>
                        ) : null}
                        {player.isViewer ? (
                          <span className="rounded-full border border-white/10 bg-white/8 px-2 py-1 text-slate-200">
                            You
                          </span>
                        ) : null}
                        {player.isKnownSpy ? (
                          <span className="rounded-full border border-rose-300/20 bg-rose-400/10 px-2 py-1 text-rose-100">
                            Spy
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {isHost && !player.isHost ? (
                      <button
                        type="button"
                        className="mt-3 rounded-xl border border-rose-300/18 bg-rose-400/8 px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] text-rose-100 transition hover:bg-rose-400/14"
                        onClick={() =>
                          runAction(async () => {
                            await postJson(`/api/rooms/${code}/kick`, {
                              playerId: player.id,
                            });
                          })
                        }
                      >
                        Remove player
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="mt-5 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                    Spectators
                  </p>
                  <p className="text-xs text-slate-400">{spectators.length}</p>
                </div>
                <div className="grid gap-2">
                  {spectators.length ? (
                    spectators.map((player) => (
                      <div
                        key={player.id}
                        className="rounded-2xl border border-white/8 bg-[#091116] px-3 py-3 text-sm text-slate-300"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span>{player.displayName}</span>
                          {isHost ? (
                            <button
                              type="button"
                              className="rounded-xl border border-rose-300/18 bg-rose-400/8 px-2 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-rose-100 transition hover:bg-rose-400/14"
                              onClick={() =>
                                runAction(async () => {
                                  await postJson(`/api/rooms/${code}/kick`, {
                                    playerId: player.id,
                                  });
                                })
                              }
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-slate-500">No spectators yet.</p>
                  )}
                </div>
                {canClaimSeat ? (
                  <button
                    type="button"
                    className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/16"
                    onClick={() =>
                      runAction(async () => {
                        await postJson(`/api/rooms/${code}/seat`);
                      })
                    }
                  >
                    Take open seat
                  </button>
                ) : null}
              </div>
            </section>
          </aside>

          <section className="grid gap-6">
            <section className="rounded-[1.75rem] border border-white/10 bg-white/6 p-6 xl:min-h-[548px]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                    Mission board
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-white xl:text-[2rem]">
                    {state.room.status === "lobby"
                      ? "Lobby setup"
                      : state.room.status === "finished"
                        ? "Game complete"
                        : `Mission ${(state.game?.missionIndex ?? 0) + 1}`}
                  </h2>
                </div>
                <div className="flex gap-3">
                  <div className="rounded-2xl border border-emerald-300/18 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
                    Resistance {state.game?.resistanceWins ?? 0}
                  </div>
                  <div className="rounded-2xl border border-rose-300/18 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                    Spies {state.game?.spyWins ?? 0}
                  </div>
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {state.room.config.missionSizes.map((size, index) => {
                  const result = state.game?.missionHistory[index];
                  return (
                    <div
                      key={`${size}-${index}`}
                      className="flex min-h-[148px] flex-col justify-between rounded-[1.4rem] border border-white/10 bg-[#091116] p-4 xl:min-h-[184px] xl:px-5 xl:py-5"
                    >
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                        Mission {index + 1}
                      </p>
                      <p className="mt-3 text-3xl font-semibold text-white xl:text-4xl">
                        {size}
                      </p>
                      <p className="mt-1 text-sm text-slate-400 xl:text-[15px]">
                        operatives
                      </p>
                      {result ? (
                        <p
                          className={`mt-5 text-sm font-medium xl:text-[15px] ${
                            result.success
                              ? "text-emerald-200"
                              : "text-rose-200"
                          }`}
                        >
                          {result.success ? "Succeeded" : "Failed"} ·{" "}
                          {result.passes}/{result.fails}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-3">
                <div className="rounded-[1.4rem] border border-white/10 bg-[#091116] p-4 xl:min-h-[132px]">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                    Current phase
                  </p>
                  <p className="mt-4 text-lg font-semibold text-white xl:text-[1.35rem]">
                    {state.game?.phase
                      ? state.game.phase.replace("_", " ")
                      : "lobby"}
                  </p>
                </div>
                <div className="rounded-[1.4rem] border border-white/10 bg-[#091116] p-4 xl:min-h-[132px]">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                    Proposal streak
                  </p>
                  <p className="mt-4 text-lg font-semibold text-white xl:text-[1.35rem]">
                    {state.game?.rejectionStreak ?? 0}/5
                  </p>
                </div>
                <div className="rounded-[1.4rem] border border-white/10 bg-[#091116] p-4 xl:min-h-[132px]">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                    Team size
                  </p>
                  <p className="mt-4 text-lg font-semibold text-white xl:text-[1.35rem]">
                    {state.missionTeamSize ?? "—"}
                  </p>
                </div>
              </div>
            </section>

            {reveal && state.room.status !== "lobby" ? (
              <section className="rounded-[1.75rem] border border-white/10 bg-[linear-gradient(135deg,rgba(22,33,37,0.98),rgba(9,14,16,0.98))] p-6">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                  Mission reveal
                </p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h3
                      className={`text-2xl font-semibold ${
                        reveal.success ? "text-emerald-100" : "text-rose-100"
                      }`}
                    >
                      Mission {reveal.missionIndex + 1}{" "}
                      {reveal.success ? "Succeeded" : "Failed"}
                    </h3>
                    <p className="mt-2 text-sm text-slate-300/75">
                      {reveal.passes} pass, {reveal.fails} fail. Individual
                      cards remain hidden.
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <span className="rounded-2xl border border-emerald-300/18 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
                      Pass {reveal.passes}
                    </span>
                    <span className="rounded-2xl border border-rose-300/18 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                      Fail {reveal.fails}
                    </span>
                  </div>
                </div>
              </section>
            ) : null}
          </section>

          <aside className="grid gap-6">
            <section className="rounded-[1.75rem] border border-white/10 bg-white/6 p-5 xl:min-h-[320px]">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                Actions
              </p>

              {state.room.status === "lobby" ? (
                <div className="mt-4 grid gap-4">
                  {isHost ? (
                    <>
                      <label className="grid gap-2">
                        <span className="text-sm text-slate-300">
                          Mission count
                        </span>
                        <input
                          className="rounded-2xl border border-white/10 bg-[#081015] px-4 py-3 text-sm text-white outline-none"
                          value={missionCount}
                          onChange={(event) => setMissionCount(event.target.value)}
                        />
                      </label>
                      <label className="grid gap-2">
                        <span className="text-sm text-slate-300">
                          Mission sizes
                        </span>
                        <input
                          className="rounded-2xl border border-white/10 bg-[#081015] px-4 py-3 text-sm text-white outline-none"
                          value={missionConfig}
                          onChange={(event) =>
                            setMissionConfig(event.target.value)
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/16"
                        onClick={() =>
                          runAction(async () => {
                            const missionSizes = missionConfig
                              .split(",")
                              .map((part) => Number(part.trim()))
                              .filter((value) => !Number.isNaN(value));

                            await postJson(`/api/rooms/${code}/config`, {
                              missionCount: Number(missionCount),
                              missionSizes,
                            });
                            setMissionConfig(missionSizes.join(", "));
                            setMissionCount(String(Number(missionCount)));
                          })
                        }
                      >
                        Save lobby settings
                      </button>
                      <button
                        type="button"
                        className="rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:bg-cyan-500/50"
                        onClick={() =>
                          runAction(async () => {
                            await postJson(`/api/rooms/${code}/start`);
                          })
                        }
                        disabled={isPending || state.seatedCount < 4}
                      >
                        Start game
                      </button>
                    </>
                  ) : (
                    <p className="mt-4 text-sm leading-7 text-slate-300/72">
                      Waiting for the host to finalize mission settings and start
                      the game.
                    </p>
                  )}
                </div>
              ) : state.room.status === "finished" ? (
                <div className="mt-4 grid gap-4">
                  <p className="text-sm leading-7 text-slate-300/72">
                    {state.room.winner === "resistance"
                      ? "Resistance secured enough missions."
                      : "The spies forced the room into collapse."}
                  </p>
                  {isHost ? (
                    <button
                      type="button"
                      className="rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950"
                      onClick={() =>
                        runAction(async () => {
                          await postJson(`/api/rooms/${code}/restart`);
                        })
                      }
                    >
                      Return to lobby
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="mt-4 grid gap-4">
                  {state.game?.phase === "team_proposal" &&
                  state.viewer.seatIndex === state.game.leaderSeat ? (
                    <>
                      <p className="text-sm leading-7 text-slate-300/72">
                        Select {state.missionTeamSize} operatives for the next
                        mission.
                      </p>
                      <div className="grid gap-2">
                        {playerRoster.map((player) => {
                          const selected = proposalSelection.includes(player.id);
                          return (
                            <button
                              key={player.id}
                              type="button"
                              className={`rounded-2xl border px-3 py-3 text-left text-sm transition ${
                                selected
                                  ? "border-cyan-300/30 bg-cyan-300/12 text-cyan-50"
                                  : "border-white/10 bg-[#081015] text-slate-200 hover:bg-white/8"
                              }`}
                              onClick={() => {
                                setProposalSelection((current) => {
                                  if (selected) {
                                    return current.filter((id) => id !== player.id);
                                  }

                                  if (
                                    state.missionTeamSize &&
                                    current.length >= state.missionTeamSize
                                  ) {
                                    return current;
                                  }

                                  return [...current, player.id];
                                });
                              }}
                            >
                              {player.displayName}
                            </button>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        className="rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950"
                        onClick={() =>
                          runAction(async () => {
                            await postJson(`/api/rooms/${code}/proposal`, {
                              proposal: proposalSelection,
                            });
                            setProposalSelection([]);
                          })
                        }
                      >
                        Submit mission team
                      </button>
                    </>
                  ) : null}

                  {state.game?.phase === "team_vote" &&
                  !state.viewer.isSpectator ? (
                    <>
                      <p className="text-sm leading-7 text-slate-300/72">
                        Vote on the proposed team. Only the final totals will be
                        revealed.
                      </p>
                      <div className="rounded-2xl border border-white/10 bg-[#081015] p-4 text-sm text-slate-300">
                        Team:{" "}
                        {state.players
                          .filter((player) => state.proposalTeam.includes(player.id))
                          .map((player) => player.displayName)
                          .join(", ")}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {(["approve", "reject"] as VoteChoice[]).map((vote) => (
                          <button
                            key={vote}
                            type="button"
                            className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-medium capitalize text-white transition hover:bg-white/16"
                            onClick={() =>
                              runAction(async () => {
                                await postJson(`/api/rooms/${code}/vote`, {
                                  vote,
                                });
                              })
                            }
                            disabled={state.viewer.hasApprovalVoted}
                          >
                            {state.viewer.hasApprovalVoted
                              ? "Vote locked"
                              : vote}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                        {state.approvalTotals.submitted}/
                        {state.approvalTotals.totalEligible} votes submitted
                      </p>
                    </>
                  ) : null}

                  {state.game?.phase === "mission_action" &&
                  state.players.some(
                    (player) =>
                      player.id === state.viewer.playerId &&
                      player.isMissionMember,
                  ) ? (
                    <>
                      <p className="text-sm leading-7 text-slate-300/72">
                        Choose one card. The interface is identical for everyone
                        on the mission.
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        {(["pass", "fail"] as MissionCard[]).map((card) => (
                          <button
                            key={card}
                            type="button"
                            className="rounded-2xl border border-white/10 bg-white/10 px-4 py-4 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-white/16"
                            onClick={() =>
                              runAction(async () => {
                                await postJson(`/api/rooms/${code}/mission`, {
                                  card,
                                });
                              })
                            }
                            disabled={state.viewer.hasMissionCardSubmitted}
                          >
                            {state.viewer.hasMissionCardSubmitted
                              ? "Submitted"
                              : card}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                        {state.missionTotals.submitted}/
                        {state.missionTotals.totalEligible} cards submitted
                      </p>
                    </>
                  ) : null}

                  {state.game?.phase === "mission_reveal" ? (
                    <>
                      <p className="text-sm leading-7 text-slate-300/72">
                        Review the reveal. The next leader can move the room to
                        the next proposal when ready.
                      </p>
                      {state.viewer.seatIndex === state.game.leaderSeat ? (
                        <button
                          type="button"
                          className="rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950"
                          onClick={() =>
                            runAction(async () => {
                              await postJson(`/api/rooms/${code}/advance`);
                            })
                          }
                        >
                          Continue to next proposal
                        </button>
                      ) : null}
                    </>
                  ) : null}

                  {!isHost &&
                  state.game?.phase !== "team_vote" &&
                  state.game?.phase !== "mission_action" &&
                  !(
                    state.game?.phase === "team_proposal" &&
                    state.viewer.seatIndex === state.game.leaderSeat
                  ) ? (
                    <p className="text-sm leading-7 text-slate-300/72">
                      No action is required from you right now.
                    </p>
                  ) : null}
                </div>
              )}
            </section>

            <section className="rounded-[1.75rem] border border-white/10 bg-white/6 p-5 xl:min-h-[200px]">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                Room log
              </p>
              <div className="mt-4 grid gap-3">
                {state.eventLog.length ? (
                  state.eventLog.map((event) => (
                    <div
                      key={event.id}
                      className="rounded-2xl border border-white/10 bg-[#091116] px-4 py-3"
                    >
                      <p className="text-sm text-slate-200">{event.message}</p>
                      <p className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500">
                        {new Date(event.createdAt).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">No events yet.</p>
                )}
              </div>
            </section>
          </aside>
        </section>
      )}
    </main>
  );
}
