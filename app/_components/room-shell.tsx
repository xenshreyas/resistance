"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import type { MissionCard, ViewerRoomState, VoteChoice } from "@/lib/types";
import { useSoundEngine } from "./use-sound-engine";

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
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json()) as TResponse & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Request failed.");
  return payload;
}

function formatCountdown(deadline: string | null, serverTime: string) {
  if (!deadline) return null;
  const diffMs = new Date(deadline).getTime() - new Date(serverTime).getTime();
  if (diffMs <= 0) return "resetting now";
  const minutes = Math.floor(diffMs / 60000);
  const seconds = Math.floor((diffMs % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, "0")} left`;
}

// Hardcoded particle positions — different speeds, drifts, delays
const PARTICLES = [
  { left: "7%",  delay: "0s",    dur: "14s", drift: "18px"  },
  { left: "18%", delay: "2.4s",  dur: "11s", drift: "-14px" },
  { left: "29%", delay: "5.2s",  dur: "16s", drift: "22px"  },
  { left: "41%", delay: "1.5s",  dur: "13s", drift: "-18px" },
  { left: "53%", delay: "7.1s",  dur: "15s", drift: "12px"  },
  { left: "64%", delay: "3.9s",  dur: "12s", drift: "-10px" },
  { left: "75%", delay: "0.8s",  dur: "17s", drift: "20px"  },
  { left: "86%", delay: "4.7s",  dur: "14s", drift: "-16px" },
  { left: "93%", delay: "6.4s",  dur: "11s", drift: "8px"   },
  { left: "46%", delay: "9.0s",  dur: "16s", drift: "-22px" },
] as const;

function ParticleField() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      {PARTICLES.map((p, i) => (
        <div
          key={i}
          className="absolute bottom-0 h-[3px] w-[3px] rounded-full bg-cyan-400/50"
          style={{
            left: p.left,
            animation: `particle-rise ${p.dur} ${p.delay} linear infinite`,
            "--px-drift": p.drift,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
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
  const [connectionState, setConnectionState] = useState<"live" | "reconnecting">("live");

  // Animation state
  const [sweepKey, setSweepKey] = useState<number | null>(null);
  // Reveal suspense: start shown=true if reveal already exists on load (page refresh)
  const [revealShown, setRevealShown] = useState(
    initialState.game?.reveal != null,
  );

  // Refs for tracking transitions
  const prevPhaseRef = useRef<string | null>(initialState.game?.phase ?? null);
  const stopTensionRef = useRef<(() => void) | null>(null);
  const revealSeenRef = useRef<string | null>(
    initialState.game?.reveal != null
      ? String(initialState.game.reveal.missionIndex)
      : null,
  );
  const eventSourceRef = useRef<EventSource | null>(null);

  const sounds = useSoundEngine();

  function triggerSweep() {
    setSweepKey(Date.now());
  }

  // ── SSE connection ──
  useEffect(() => {
    const eventSource = new EventSource(`/api/rooms/${code}/events`);
    eventSourceRef.current = eventSource;
    const onState = (event: Event) => {
      const messageEvent = event as MessageEvent<string>;
      setState(JSON.parse(messageEvent.data) as ViewerRoomState);
      setConnectionState("live");
    };
    const onError = () => { setConnectionState("reconnecting"); };
    eventSource.addEventListener("state", onState);
    eventSource.addEventListener("heartbeat", onState);
    eventSource.onerror = onError;
    return () => { eventSource.close(); eventSourceRef.current = null; };
  }, [code]);

  useEffect(() => {
    setShareUrl(`${window.location.origin}/room/${code}`);
  }, [code]);

  // ── Presence heartbeat ──
  useEffect(() => {
    let cancelled = false;
    async function markActive() {
      if (!state.viewer.playerId) return;
      try {
        await postJson(`/api/rooms/${code}/presence`, { presence: "active" });
      } catch {
        if (!cancelled) setConnectionState("reconnecting");
      }
    }
    void markActive();
    const interval = window.setInterval(() => { void markActive(); }, 20000);
    const onUnload = () => {
      if (!state.viewer.playerId) return;
      navigator.sendBeacon(
        `/api/rooms/${code}/presence`,
        new Blob([JSON.stringify({ presence: "disconnect" })], { type: "application/json" }),
      );
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [code, state.viewer.playerId]);

  // ── Phase change → sounds + sweep ──
  useEffect(() => {
    const prevPhase = prevPhaseRef.current;
    const currPhase = state.game?.phase ?? null;
    if (prevPhase === currPhase) return;
    prevPhaseRef.current = currPhase;

    if (currPhase === "team_vote") {
      sounds.playWhoosh("soft");
      stopTensionRef.current?.();
      stopTensionRef.current = sounds.startTension();
    } else if (currPhase === "mission_action") {
      stopTensionRef.current?.();
      stopTensionRef.current = null;
      sounds.playLaunch();
      triggerSweep();
    } else if (currPhase === "team_proposal") {
      stopTensionRef.current?.();
      stopTensionRef.current = null;
      sounds.playWhoosh("soft");
    } else if (currPhase === null) {
      stopTensionRef.current?.();
      stopTensionRef.current = null;
    }
  // sounds functions are stable useCallback refs — safe to omit from deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.game?.phase]);

  // ── Reveal suspense: hold result for 2.5 s then play outcome sound ──
  const revealKey = state.game?.reveal != null
    ? String(state.game.reveal.missionIndex)
    : null;

  useEffect(() => {
    if (!revealKey || !state.game?.reveal) {
      setRevealShown(false);
      return;
    }
    if (revealKey === revealSeenRef.current) return; // already processed
    revealSeenRef.current = revealKey;

    setRevealShown(false);
    sounds.playWhoosh("soft"); // ambiguity sound while calculating
    const success = state.game.reveal.success;

    const timer = setTimeout(() => {
      setRevealShown(true);
      if (success) sounds.playSuccess();
      else sounds.playFailure();
    }, 2500);

    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealKey]);

  // ── Stop tension drone on unmount ──
  useEffect(() => {
    return () => { stopTensionRef.current?.(); };
  }, []);

  const isHost = state.viewer.isHost;
  const playerRoster = state.players.filter((p) => p.seatIndex !== null);
  const spectators = state.players.filter((p) => p.seatIndex === null);
  const canClaimSeat =
    state.viewer.playerId !== null &&
    state.viewer.isSpectator &&
    state.room.status === "lobby" &&
    state.seatedCount < 6;
  const reveal = state.game?.reveal ?? null;
  const countdown = formatCountdown(state.room.disconnectDeadline, state.serverTime);

  // Modal trigger conditions
  const needsTeamProposal =
    state.game?.phase === "team_proposal" &&
    state.viewer.seatIndex === state.game.leaderSeat;
  const needsVote =
    state.game?.phase === "team_vote" &&
    !state.viewer.isSpectator &&
    !state.viewer.hasApprovalVoted;
  const needsMissionCard =
    state.game?.phase === "mission_action" &&
    state.players.some((p) => p.id === state.viewer.playerId && p.isMissionMember) &&
    !state.viewer.hasMissionCardSubmitted;
  const showActionModal = needsTeamProposal || needsVote || needsMissionCard;
  const needsAdvance =
    state.game?.phase === "mission_reveal" &&
    state.viewer.seatIndex === state.game.leaderSeat;

  function runAction(action: () => Promise<void>) {
    sounds.unlock(); // ensure AudioContext is active on first interaction
    setError(null);
    startTransition(async () => {
      try {
        await action();
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : "Action failed.");
      }
    });
  }

  return (
    // onClick unlock: any page click primes audio for non-interacting players
    <main
      className="mx-auto flex w-full max-w-[1580px] flex-1 flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8"
      onClick={sounds.unlock}
    >
      <ParticleField />

      {/* Header */}
      <header className="relative z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/8 bg-[#0c1118] px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full border border-cyan-400/25 bg-cyan-400/8 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-cyan-300">
            {code}
          </span>
          <h1 className="text-base font-semibold tracking-tight text-white">Resistance</h1>
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
              connectionState === "live"
                ? "bg-emerald-400/10 text-emerald-400"
                : "bg-amber-400/10 text-amber-400"
            }`}
          >
            {connectionState === "live" ? "● Live" : "○ Reconnecting"}
          </span>
          <span className="text-xs capitalize text-slate-600">
            {state.room.status.replace("_", " ")}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden max-w-xs truncate text-xs text-slate-600 sm:block">{shareUrl}</span>
          <button
            type="button"
            className="rounded-lg border border-white/8 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10"
            onClick={() => {
              void navigator.clipboard.writeText(shareUrl);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
      </header>

      {state.room.paused ? (
        <div className="relative z-10 rounded-xl border border-amber-400/20 bg-amber-400/8 px-4 py-3 text-sm text-amber-200">
          A player disconnected. Game paused{countdown ? ` — ${countdown}` : ""}.
        </div>
      ) : null}

      {error ? (
        <div className="relative z-10 rounded-xl border border-rose-400/20 bg-rose-400/8 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      {state.viewer.playerId === null ? (
        /* ── Join form ── */
        <section className="relative z-10 rounded-2xl border border-white/8 bg-[#0c1118] p-6 lg:grid lg:grid-cols-[1fr_auto] lg:items-end lg:gap-8">
          <div>
            <h2 className="text-xl font-semibold text-white">Enter the room</h2>
            <p className="mt-1 text-sm text-slate-500">
              Join with a name. If the game has started, you'll enter as a spectator.
            </p>
          </div>
          <form
            className="mt-4 flex gap-2 lg:mt-0 lg:min-w-[300px]"
            onSubmit={(e) => {
              e.preventDefault();
              runAction(async () => {
                await postJson(`/api/rooms/${code}/join`, { displayName: joinName });
                window.location.reload();
              });
            }}
          >
            <input
              className="flex-1 rounded-xl border border-white/8 bg-[#080d12] px-4 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-400/30"
              placeholder="Your name"
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              maxLength={32}
            />
            <button
              type="submit"
              className="rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-50"
              disabled={isPending}
            >
              {isPending ? "Joining…" : "Join"}
            </button>
          </form>
        </section>
      ) : (
        /* ── Main game layout ── */
        <div className="relative z-10 grid gap-4 xl:grid-cols-[220px_1fr_288px]">

          {/* LEFT RAIL — role + roster */}
          <aside className="flex flex-col gap-4">

            {/* Your role */}
            <section className="rounded-2xl border border-white/8 bg-[#0c1118] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Your role</p>
              <p className="mt-2 text-lg font-semibold text-white">
                {state.viewer.role === "spy"
                  ? "Spy"
                  : state.viewer.role === "resistance"
                    ? "Resistance"
                    : state.viewer.isSpectator
                      ? "Spectator"
                      : "Awaiting start"}
              </p>
              {state.viewer.role === "spy" ? (
                <span className="mt-1.5 inline-block rounded-full border border-rose-400/20 bg-rose-400/8 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-rose-300">
                  Hidden intel
                </span>
              ) : null}
              <p className="mt-2 text-xs leading-relaxed text-slate-600">
                {state.viewer.role === "spy"
                  ? "You can see the full spy roster. Blend in and push bad teams through."
                  : state.viewer.role === "resistance"
                    ? "You only know yourself. Read the room and force better mission teams."
                    : "Spectators can track the board, but secret roles stay hidden."}
              </p>
              {state.viewer.role === "spy" ? (
                <div className="mt-3 flex flex-col gap-1.5">
                  {state.players
                    .filter((p) => p.isKnownSpy)
                    .map((p) => (
                      <div
                        key={p.id}
                        className="rounded-lg border border-rose-400/15 bg-rose-400/8 px-3 py-1.5 text-xs text-rose-200"
                      >
                        {p.displayName}
                      </div>
                    ))}
                </div>
              ) : null}
            </section>

            {/* Players */}
            <section className="rounded-2xl border border-white/8 bg-[#0c1118] p-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Players</p>
                <p className="text-[10px] text-slate-600">{state.seatedCount}/6</p>
              </div>
              <div className="mt-3 flex flex-col gap-2">
                {playerRoster.map((player) => (
                  <div
                    key={player.id}
                    className="relative rounded-xl border border-white/8 bg-[#090e13] px-3 py-2.5"
                  >
                    {isHost && !player.isHost ? (
                      <button
                        type="button"
                        title="Remove player"
                        className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full border border-white/8 bg-white/5 text-[11px] leading-none text-slate-500 transition hover:border-rose-400/30 hover:bg-rose-400/10 hover:text-rose-300"
                        onClick={() =>
                          runAction(async () => {
                            await postJson(`/api/rooms/${code}/kick`, { playerId: player.id });
                          })
                        }
                      >
                        ×
                      </button>
                    ) : null}
                    <div className="flex flex-wrap gap-1 pr-6">
                      {player.isHost ? (
                        <span className="rounded-full border border-cyan-400/20 bg-cyan-400/8 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan-300">Host</span>
                      ) : null}
                      {player.isLeader ? (
                        <span className="rounded-full border border-amber-400/20 bg-amber-400/8 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">Leader</span>
                      ) : null}
                      {player.isViewer ? (
                        <span className="rounded-full border border-white/12 bg-white/6 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-300">You</span>
                      ) : null}
                      {player.isKnownSpy ? (
                        <span className="rounded-full border border-rose-400/20 bg-rose-400/8 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-rose-300">Spy</span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm font-medium text-white">{player.displayName}</p>
                    <p className="text-[10px] text-slate-600">
                      {player.status === "disconnected"
                        ? "Disconnected"
                        : player.isMissionMember
                          ? "On mission"
                          : "Waiting"}
                    </p>
                  </div>
                ))}
              </div>

              {spectators.length > 0 ? (
                <div className="mt-4">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Spectators</p>
                    <p className="text-[10px] text-slate-600">{spectators.length}</p>
                  </div>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {spectators.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between rounded-lg border border-white/6 bg-[#080c10] px-3 py-2"
                      >
                        <span className="text-xs text-slate-400">{p.displayName}</span>
                        {isHost ? (
                          <button
                            type="button"
                            title="Remove"
                            className="flex h-4 w-4 items-center justify-center rounded-full border border-white/8 text-[10px] text-slate-500 transition hover:border-rose-400/30 hover:text-rose-300"
                            onClick={() =>
                              runAction(async () => {
                                await postJson(`/api/rooms/${code}/kick`, { playerId: p.id });
                              })
                            }
                          >×</button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-xs text-slate-600">No spectators.</p>
              )}

              {canClaimSeat ? (
                <button
                  type="button"
                  className="mt-3 w-full rounded-xl border border-white/8 bg-white/6 py-2 text-xs font-medium text-white transition hover:bg-white/10"
                  onClick={() => runAction(async () => { await postJson(`/api/rooms/${code}/seat`); })}
                >
                  Take open seat
                </button>
              ) : null}
            </section>
          </aside>

          {/* CENTER — mission board + actions */}
          <section className="flex flex-col gap-4">

            {/* Mission board */}
            <section className="rounded-2xl border border-white/8 bg-[#0c1118] p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Mission board</p>
                  <h2 className="mt-1 text-xl font-semibold tracking-tight text-white">
                    {state.room.status === "lobby"
                      ? "Lobby"
                      : state.room.status === "finished"
                        ? "Game over"
                        : `Mission ${(state.game?.missionIndex ?? 0) + 1}`}
                  </h2>
                </div>
                {state.game ? (
                  <div className="flex gap-2">
                    <span className="rounded-xl border border-emerald-400/20 bg-emerald-400/8 px-3 py-1.5 text-sm font-bold text-emerald-300">
                      R {state.game.resistanceWins}
                    </span>
                    <span className="rounded-xl border border-rose-400/20 bg-rose-400/8 px-3 py-1.5 text-sm font-bold text-rose-300">
                      S {state.game.spyWins}
                    </span>
                  </div>
                ) : null}
              </div>

              {/* Mission cards */}
              <div className="mt-4 grid grid-cols-5 gap-2">
                {state.room.config.missionSizes.map((size, index) => {
                  const result = state.game?.missionHistory[index];
                  const isCurrent =
                    state.game && !result && state.game.missionIndex === index;
                  return (
                    <div
                      key={`${size}-${index}`}
                      className={`flex flex-col rounded-xl border px-3 py-3 transition ${
                        result?.success
                          ? "border-emerald-400/25 bg-emerald-400/6"
                          : result
                            ? "border-rose-400/25 bg-rose-400/6"
                            : isCurrent
                              ? "border-cyan-400/30 bg-cyan-400/5"
                              : "border-white/6 bg-[#090e13]"
                      }`}
                      style={
                        isCurrent
                          ? { animation: "card-glow 2.5s ease-in-out infinite" }
                          : undefined
                      }
                    >
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-600">
                        M{index + 1}
                      </p>
                      <p
                        className={`mt-2 text-3xl font-bold leading-none ${
                          result?.success
                            ? "text-emerald-300"
                            : result
                              ? "text-rose-300"
                              : isCurrent
                                ? "text-cyan-200"
                                : "text-white"
                        }`}
                      >
                        {size}
                      </p>
                      <p className="mt-0.5 text-[9px] text-slate-600">ops</p>
                      {result ? (
                        <p
                          className={`mt-3 text-[10px] font-bold ${
                            result.success ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {result.success ? "✓" : "✗"} {result.passes}/{result.fails}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {/* Status pills */}
              {state.game ? (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div className="rounded-xl border border-white/6 bg-[#090e13] px-3 py-2.5">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600">Phase</p>
                    <p className="mt-1 text-sm font-semibold capitalize text-white">
                      {state.game.phase.replace("_", " ")}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/6 bg-[#090e13] px-3 py-2.5">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600">Streak</p>
                    <p className="mt-1 text-sm font-semibold text-white">{state.game.rejectionStreak}/5</p>
                  </div>
                  <div className="rounded-xl border border-white/6 bg-[#090e13] px-3 py-2.5">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600">Team size</p>
                    <p className="mt-1 text-sm font-semibold text-white">{state.missionTeamSize ?? "—"}</p>
                  </div>
                </div>
              ) : null}
            </section>

            {/* ── Mission reveal (with suspense delay) ── */}
            {reveal && state.room.status !== "lobby" ? (
              revealShown ? (
                /* Actual result — animates in after the suspense delay */
                <section
                  className={`rounded-2xl border p-5 ${
                    reveal.success
                      ? "border-emerald-400/20 bg-emerald-400/6"
                      : "border-rose-400/20 bg-rose-400/6"
                  }`}
                  style={{ animation: "reveal-in 0.55s cubic-bezier(0.22, 1, 0.36, 1) both" }}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                    Mission reveal
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-4">
                    <h3
                      className={`text-xl font-semibold ${
                        reveal.success ? "text-emerald-200" : "text-rose-200"
                      }`}
                    >
                      Mission {reveal.missionIndex + 1}{" "}
                      {reveal.success ? "Succeeded" : "Failed"}
                    </h3>
                    <div className="flex gap-2">
                      <span className="rounded-lg border border-emerald-400/20 bg-emerald-400/8 px-3 py-1 text-sm font-semibold text-emerald-300">
                        {reveal.passes} pass
                      </span>
                      <span className="rounded-lg border border-rose-400/20 bg-rose-400/8 px-3 py-1 text-sm font-semibold text-rose-300">
                        {reveal.fails} fail
                      </span>
                    </div>
                  </div>
                </section>
              ) : (
                /* Suspense placeholder — pulsing while we wait */
                <section
                  className="rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-5"
                  style={{ animation: "card-glow 1.2s ease-in-out infinite" }}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                    Mission reveal
                  </p>
                  <div className="mt-3 flex items-center gap-3">
                    <h3 className="text-xl font-semibold text-white">
                      Mission {reveal.missionIndex + 1}
                    </h3>
                    <span className="text-sm text-slate-500">Calculating</span>
                    <span className="inline-flex gap-1">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-400"
                          style={{
                            animation: `dot-blink 1.2s ease-in-out ${i * 0.22}s infinite`,
                          }}
                        />
                      ))}
                    </span>
                  </div>
                </section>
              )
            ) : null}

            {/* Lobby actions */}
            {state.room.status === "lobby" ? (
              <section className="rounded-2xl border border-white/8 bg-[#0c1118] p-5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Lobby setup</p>
                {isHost ? (
                  <div className="mt-3 grid gap-3">
                    <label className="grid gap-1.5">
                      <span className="text-xs text-slate-400">Mission count</span>
                      <input
                        className="rounded-xl border border-white/8 bg-[#080d12] px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/30"
                        value={missionCount}
                        onChange={(e) => setMissionCount(e.target.value)}
                      />
                    </label>
                    <label className="grid gap-1.5">
                      <span className="text-xs text-slate-400">Mission sizes (comma-separated)</span>
                      <input
                        className="rounded-xl border border-white/8 bg-[#080d12] px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/30"
                        value={missionConfig}
                        onChange={(e) => setMissionConfig(e.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="rounded-xl border border-white/8 bg-white/6 py-2 text-sm font-medium text-white transition hover:bg-white/10"
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
                      Save settings
                    </button>
                    <button
                      type="button"
                      className="rounded-xl bg-cyan-400 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-50"
                      disabled={isPending || state.seatedCount < 4}
                      onClick={() =>
                        runAction(async () => { await postJson(`/api/rooms/${code}/start`); })
                      }
                    >
                      Start game
                    </button>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-slate-500">
                    Waiting for the host to configure and start the game.
                  </p>
                )}
              </section>
            ) : null}

            {/* Finished */}
            {state.room.status === "finished" ? (
              <section className="rounded-2xl border border-white/8 bg-[#0c1118] p-5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Game over</p>
                <p className="mt-2 text-sm text-slate-400">
                  {state.room.winner === "resistance"
                    ? "Resistance secured enough missions."
                    : "The spies forced the room into collapse."}
                </p>
                {isHost ? (
                  <button
                    type="button"
                    className="mt-4 w-full rounded-xl bg-cyan-400 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
                    onClick={() =>
                      runAction(async () => { await postJson(`/api/rooms/${code}/restart`); })
                    }
                  >
                    Return to lobby
                  </button>
                ) : null}
              </section>
            ) : null}

            {/* In-rail game status / advance */}
            {state.room.status !== "lobby" && state.room.status !== "finished" ? (
              <section className="rounded-2xl border border-white/8 bg-[#0c1118] p-5">
                {needsAdvance ? (
                  <>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan-400">Your turn</p>
                    <p className="mt-2 text-sm text-slate-400">
                      Review the mission result. Advance when everyone is ready.
                    </p>
                    <button
                      type="button"
                      className="mt-4 w-full rounded-xl bg-cyan-400 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
                      onClick={() =>
                        runAction(async () => { await postJson(`/api/rooms/${code}/advance`); })
                      }
                    >
                      Continue to next proposal
                    </button>
                  </>
                ) : showActionModal ? (
                  <>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan-400">Your turn</p>
                    <p className="mt-2 text-sm text-slate-400">An action is required. Check the popup.</p>
                  </>
                ) : (
                  <>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Status</p>
                    <p className="mt-2 text-sm text-slate-500">
                      {state.game?.phase === "team_proposal"
                        ? `Waiting for ${state.players.find((p) => p.seatIndex === state.game?.leaderSeat)?.displayName ?? "the leader"} to propose a team.`
                        : state.game?.phase === "team_vote"
                          ? "Waiting for all votes to come in."
                          : state.game?.phase === "mission_action"
                            ? "Mission in progress — waiting for all cards."
                            : state.game?.phase === "mission_reveal"
                              ? "Reviewing the mission result."
                              : "Waiting…"}
                    </p>
                    {state.game?.phase === "team_vote" ? (
                      <p className="mt-2 text-xs text-slate-600">
                        {state.approvalTotals.submitted}/{state.approvalTotals.totalEligible} votes submitted
                      </p>
                    ) : null}
                    {state.game?.phase === "mission_action" ? (
                      <p className="mt-2 text-xs text-slate-600">
                        {state.missionTotals.submitted}/{state.missionTotals.totalEligible} cards submitted
                      </p>
                    ) : null}
                  </>
                )}
              </section>
            ) : null}
          </section>

          {/* RIGHT RAIL — room log */}
          <aside>
            <section className="rounded-2xl border border-white/8 bg-[#0c1118] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Room log</p>
              {/* flex-col-reverse: newest event is first in DOM = visual bottom; no scroll needed for latest */}
              <div className="mt-3 flex max-h-[calc(100vh-200px)] flex-col-reverse gap-2 overflow-y-auto">
                {state.eventLog.length ? (
                  state.eventLog
                    .slice()
                    .reverse()
                    .map((event) => (
                      <div
                        key={event.id}
                        className="rounded-xl border border-white/6 bg-[#090e13] px-3 py-2.5"
                      >
                        <p className="text-xs text-slate-300">{event.message}</p>
                        <p className="mt-1 text-[10px] text-slate-600">
                          {new Date(event.createdAt).toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    ))
                ) : (
                  <p className="text-xs text-slate-600">No events yet.</p>
                )}
              </div>
            </section>
          </aside>
        </div>
      )}

      {/* ── Phase sweep overlay ── */}
      {sweepKey !== null ? (
        <div
          key={sweepKey}
          className="pointer-events-none fixed inset-0 z-40 overflow-hidden"
          aria-hidden
          onAnimationEnd={() => setSweepKey(null)}
        >
          <div
            className="absolute inset-y-0 left-0 w-72 bg-gradient-to-r from-transparent via-cyan-400/20 to-transparent"
            style={{ animation: "phase-sweep 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards" }}
          />
        </div>
      ) : null}

      {/* ── Action modal ── */}
      {showActionModal ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
          <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" />
          <div className="relative w-full max-w-sm rounded-2xl border border-cyan-400/20 bg-[#0d1520] p-6 shadow-[0_0_80px_rgba(34,211,238,0.06)]">
            <div className="mb-4 flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-400">Your turn</p>
            </div>

            {/* Team proposal */}
            {needsTeamProposal ? (
              <>
                <h3 className="text-lg font-semibold text-white">
                  Select {state.missionTeamSize} operative{state.missionTeamSize === 1 ? "" : "s"}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Mission {(state.game?.missionIndex ?? 0) + 1} team proposal.
                </p>
                <div className="mt-4 flex flex-col gap-2">
                  {playerRoster.map((player) => {
                    const selected = proposalSelection.includes(player.id);
                    return (
                      <button
                        key={player.id}
                        type="button"
                        className={`rounded-xl border px-4 py-2.5 text-left text-sm font-medium transition ${
                          selected
                            ? "border-cyan-400/35 bg-cyan-400/12 text-cyan-100"
                            : "border-white/8 bg-white/4 text-slate-300 hover:bg-white/8"
                        }`}
                        onClick={() => {
                          setProposalSelection((current) => {
                            if (selected) return current.filter((id) => id !== player.id);
                            if (state.missionTeamSize && current.length >= state.missionTeamSize)
                              return current;
                            return [...current, player.id];
                          });
                        }}
                      >
                        {player.displayName}
                        {selected ? <span className="ml-2 text-[10px] text-cyan-400">✓</span> : null}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="mt-4 w-full rounded-xl bg-cyan-400 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-40"
                  disabled={proposalSelection.length !== state.missionTeamSize || isPending}
                  onClick={() =>
                    runAction(async () => {
                      await postJson(`/api/rooms/${code}/proposal`, { proposal: proposalSelection });
                      setProposalSelection([]);
                    })
                  }
                >
                  Submit team ({proposalSelection.length}/{state.missionTeamSize})
                </button>
              </>
            ) : null}

            {/* Team vote */}
            {needsVote ? (
              <>
                <h3 className="text-lg font-semibold text-white">Vote on the team</h3>
                <div className="mt-3 rounded-xl border border-white/8 bg-white/4 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Proposed</p>
                  <p className="mt-1 text-sm text-slate-200">
                    {state.players
                      .filter((p) => state.proposalTeam.includes(p.id))
                      .map((p) => p.displayName)
                      .join(", ")}
                  </p>
                </div>
                <p className="mt-2 text-xs text-slate-600">
                  {state.approvalTotals.submitted}/{state.approvalTotals.totalEligible} votes submitted
                </p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 py-3.5 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-400/18 disabled:opacity-50"
                    onClick={() =>
                      runAction(async () => {
                        await postJson(`/api/rooms/${code}/vote`, { vote: "approve" as VoteChoice });
                      })
                    }
                    disabled={state.viewer.hasApprovalVoted || isPending}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="rounded-xl border border-rose-400/25 bg-rose-400/10 py-3.5 text-sm font-semibold text-rose-200 transition hover:bg-rose-400/18 disabled:opacity-50"
                    onClick={() =>
                      runAction(async () => {
                        await postJson(`/api/rooms/${code}/vote`, { vote: "reject" as VoteChoice });
                      })
                    }
                    disabled={state.viewer.hasApprovalVoted || isPending}
                  >
                    Reject
                  </button>
                </div>
              </>
            ) : null}

            {/* Mission card */}
            {needsMissionCard ? (
              <>
                <h3 className="text-lg font-semibold text-white">Play your card</h3>
                <p className="mt-1 text-sm text-slate-500">
                  You're on the mission. Cards are anonymous.
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {state.missionTotals.submitted}/{state.missionTotals.totalEligible} cards submitted
                </p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  {(["pass", "fail"] as MissionCard[]).map((card) => (
                    <button
                      key={card}
                      type="button"
                      className={`rounded-xl border py-5 text-sm font-bold uppercase tracking-widest transition disabled:opacity-50 ${
                        card === "pass"
                          ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/18"
                          : "border-rose-400/25 bg-rose-400/10 text-rose-200 hover:bg-rose-400/18"
                      }`}
                      onClick={() =>
                        runAction(async () => {
                          await postJson(`/api/rooms/${code}/mission`, { card });
                        })
                      }
                      disabled={state.viewer.hasMissionCardSubmitted || isPending}
                    >
                      {state.viewer.hasMissionCardSubmitted ? "Submitted" : card}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}
