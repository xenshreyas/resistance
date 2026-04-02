"use client";

import { useState, useTransition } from "react";

async function postJson<TResponse>(url: string, body: unknown): Promise<TResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as TResponse & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Request failed.");
  return payload;
}

// Pentagon of 5 player nodes — 3 resistance, 2 hidden spies
// Rendered as pure SVG, animated with SVG animate elements
const NODES = [
  { x: 140, y: 32,  spy: false }, // top
  { x: 237, y: 103, spy: false }, // top-right
  { x: 200, y: 218, spy: true  }, // bottom-right  (spy)
  { x: 80,  y: 218, spy: true  }, // bottom-left   (spy)
  { x: 43,  y: 103, spy: false }, // top-left
] as const;

// All 10 edges of a complete graph on 5 nodes
const EDGES: [number, number][] = [
  [0,1],[0,2],[0,3],[0,4],
  [1,2],[1,3],[1,4],
  [2,3],[2,4],
  [3,4],
];

function NetworkGraph() {
  return (
    <svg
      viewBox="0 0 280 260"
      aria-hidden
      className="w-full max-w-[280px] drop-shadow-[0_0_40px_rgba(34,211,238,0.06)]"
    >
      <defs>
        <radialGradient id="spy-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(239,68,68,0.18)" />
          <stop offset="100%" stopColor="rgba(239,68,68,0)" />
        </radialGradient>
        <radialGradient id="res-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(34,211,238,0.10)" />
          <stop offset="100%" stopColor="rgba(34,211,238,0)" />
        </radialGradient>
      </defs>

      {/* Connection lines */}
      {EDGES.map(([a, b]) => {
        const spySpy = NODES[a].spy && NODES[b].spy;
        return (
          <line
            key={`${a}-${b}`}
            x1={NODES[a].x} y1={NODES[a].y}
            x2={NODES[b].x} y2={NODES[b].y}
            stroke={spySpy ? "rgba(239,68,68,0.22)" : "rgba(255,255,255,0.055)"}
            strokeWidth={spySpy ? 1.5 : 1}
            strokeDasharray={spySpy ? "none" : "none"}
          />
        );
      })}

      {/* Nodes */}
      {NODES.map((node, i) => (
        <g key={i}>
          {/* Outer halo — pulses for spies */}
          <circle
            cx={node.x}
            cy={node.y}
            r={18}
            fill={node.spy ? "url(#spy-halo)" : "url(#res-halo)"}
            opacity={0}
          >
            <animate
              attributeName="r"
              values="10;26;10"
              dur={node.spy ? "2.8s" : "4s"}
              begin={`${i * 0.6}s`}
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="0.5;0;0.5"
              dur={node.spy ? "2.8s" : "4s"}
              begin={`${i * 0.6}s`}
              repeatCount="indefinite"
            />
          </circle>

          {/* Node circle */}
          <circle
            cx={node.x}
            cy={node.y}
            r={11}
            fill="#080e14"
            stroke={node.spy ? "rgba(239,68,68,0.55)" : "rgba(255,255,255,0.18)"}
            strokeWidth={1.5}
          />

          {/* Inner dot */}
          <circle
            cx={node.x}
            cy={node.y}
            r={3}
            fill={node.spy ? "rgba(239,68,68,0.6)" : "rgba(255,255,255,0.25)"}
          >
            {node.spy ? (
              <animate
                attributeName="opacity"
                values="0.4;1;0.4"
                dur="2s"
                begin={`${i * 0.4}s`}
                repeatCount="indefinite"
              />
            ) : null}
          </circle>

          {/* Seat label below node */}
          <text
            x={node.x}
            y={node.y + 22}
            textAnchor="middle"
            fontSize="8"
            fill={node.spy ? "rgba(239,68,68,0.45)" : "rgba(255,255,255,0.2)"}
            fontFamily="monospace"
          >
            {node.spy ? "???" : `OP-${i + 1}`}
          </text>
        </g>
      ))}

      {/* Subtle "scanning" ring around the whole graph */}
      <circle
        cx={140}
        cy={130}
        r={115}
        fill="none"
        stroke="rgba(34,211,238,0.04)"
        strokeWidth={1}
        strokeDasharray="6 10"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 140 130"
          to="360 140 130"
          dur="30s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  );
}

export function LandingShell() {
  const [createName, setCreateName] = useState("");
  const [joinName, setJoinName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [isCreating, startCreate] = useTransition();
  const [isJoining, startJoin] = useTransition();

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden">
      {/* Tactical grid background */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px)",
          backgroundSize: "52px 52px",
          animation: "scanline-drift 8s linear infinite",
        }}
        aria-hidden
      />

      {/* Radial center glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 38% 50%, rgba(34,211,238,0.04) 0%, transparent 70%)",
        }}
        aria-hidden
      />

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-14 lg:px-10">
        <div className="grid gap-12 lg:grid-cols-[1fr_380px] lg:items-center lg:gap-16">

          {/* LEFT — copy + network graphic */}
          <div className="flex flex-col gap-8">
            {/* Wordmark */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-600">
                4–6 players · hidden roles · secret votes
              </p>
              <h1 className="mt-4 text-5xl font-bold tracking-[-0.04em] text-white sm:text-6xl lg:text-7xl">
                Trust<br />no one.
              </h1>
            </div>

            {/* Network graphic */}
            <div className="flex justify-center lg:justify-start">
              <div className="relative">
                <NetworkGraph />
                {/* Legend */}
                <div className="mt-2 flex items-center justify-center gap-5 lg:justify-start">
                  <span className="flex items-center gap-1.5 text-[10px] text-slate-600">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-white/25" />
                    Resistance
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px] text-slate-600">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-400/60" />
                    Infiltrator
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px] text-slate-600">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-400/25" />
                    Unknown
                  </span>
                </div>
              </div>
            </div>

            {/* Flavour copy */}
            <p className="max-w-md text-sm leading-7 text-slate-500">
              Spies have infiltrated the resistance. Complete three missions to win — but every vote is anonymous, every traitor is invisible, and everyone claims to be loyal.
            </p>
          </div>

          {/* RIGHT — create + join forms */}
          <div className="flex flex-col gap-4">

            {/* Create */}
            <section className="rounded-2xl border border-white/8 bg-[#0c1118] p-5">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.24em] text-slate-600">
                New room
              </p>
              <p className="mb-4 text-xs text-slate-600">Start a private session. Share the code with your team.</p>
              <form
                className="grid gap-2.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  setCreateError(null);
                  startCreate(async () => {
                    try {
                      const payload = await postJson<{ roomCode: string }>(
                        "/api/rooms",
                        { displayName: createName },
                      );
                      window.location.assign(`/room/${payload.roomCode}`);
                    } catch (err) {
                      setCreateError(
                        err instanceof Error ? err.message : "Unable to create room.",
                      );
                    }
                  });
                }}
              >
                <input
                  className="rounded-xl border border-white/8 bg-[#080d12] px-4 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-400/25"
                  placeholder="Your name"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  maxLength={32}
                  required
                />
                <button
                  type="submit"
                  className="rounded-xl bg-cyan-400 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-50"
                  disabled={isCreating}
                >
                  {isCreating ? "Creating…" : "Create room"}
                </button>
                {createError ? (
                  <p className="text-xs text-rose-400">{createError}</p>
                ) : null}
              </form>
            </section>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-white/6" />
              <span className="text-[10px] uppercase tracking-widest text-slate-700">or</span>
              <div className="h-px flex-1 bg-white/6" />
            </div>

            {/* Join */}
            <section className="rounded-2xl border border-white/8 bg-[#0c1118] p-5">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.24em] text-slate-600">
                Join room
              </p>
              <p className="mb-4 text-xs text-slate-600">Enter the room code your host shared with you.</p>
              <form
                className="grid gap-2.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  setJoinError(null);
                  startJoin(async () => {
                    try {
                      const payload = await postJson<{ roomCode: string }>(
                        `/api/rooms/${joinCode.trim().toUpperCase()}/join`,
                        { displayName: joinName },
                      );
                      window.location.assign(`/room/${payload.roomCode}`);
                    } catch (err) {
                      setJoinError(
                        err instanceof Error ? err.message : "Unable to join room.",
                      );
                    }
                  });
                }}
              >
                <input
                  className="rounded-xl border border-white/8 bg-[#080d12] px-4 py-2.5 font-mono text-sm uppercase tracking-[0.2em] text-white outline-none placeholder:text-slate-600 placeholder:normal-case placeholder:tracking-normal focus:border-cyan-400/25"
                  placeholder="Room code"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  maxLength={6}
                  required
                />
                <input
                  className="rounded-xl border border-white/8 bg-[#080d12] px-4 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-400/25"
                  placeholder="Your name"
                  value={joinName}
                  onChange={(e) => setJoinName(e.target.value)}
                  maxLength={32}
                  required
                />
                <button
                  type="submit"
                  className="rounded-xl border border-white/8 bg-white/6 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-50"
                  disabled={isJoining}
                >
                  {isJoining ? "Joining…" : "Join room"}
                </button>
                {joinError ? (
                  <p className="text-xs text-rose-400">{joinError}</p>
                ) : null}
              </form>
            </section>

          </div>
        </div>
      </div>
    </main>
  );
}
