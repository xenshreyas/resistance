"use client";

import { useCallback, useRef } from "react";

export type SoundEngine = {
  unlock: () => void;
  playWhoosh: (intensity?: "soft" | "hard") => void;
  playSuccess: () => void;
  playFailure: () => void;
  playTick: () => void;
  playLaunch: () => void;
  startTension: () => () => void;
};

export function useSoundEngine(): SoundEngine {
  const ctxRef = useRef<AudioContext | null>(null);

  function getCtx(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!ctxRef.current) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      ctxRef.current = new Ctor();
    }
    if (ctxRef.current.state === "suspended") void ctxRef.current.resume();
    return ctxRef.current;
  }

  const unlock = useCallback(() => {
    getCtx();
  }, []);

  const playWhoosh = useCallback((intensity: "soft" | "hard" = "soft") => {
    const ac = getCtx();
    if (!ac) return;
    const t = ac.currentTime;
    const dur = intensity === "hard" ? 1.1 : 0.65;

    // White noise burst filtered to a wind sweep
    const bufLen = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, bufLen, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

    const src = ac.createBufferSource();
    src.buffer = buf;

    const bpf = ac.createBiquadFilter();
    bpf.type = "bandpass";
    bpf.frequency.setValueAtTime(intensity === "hard" ? 1400 : 700, t);
    bpf.frequency.exponentialRampToValueAtTime(120, t + dur * 0.85);
    bpf.Q.value = 0.7;

    const gain = ac.createGain();
    const peak = intensity === "hard" ? 0.55 : 0.28;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + dur * 0.12);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    src.connect(bpf);
    bpf.connect(gain);
    gain.connect(ac.destination);
    src.start(t);
    src.stop(t + dur + 0.05);
  }, []);

  const playSuccess = useCallback(() => {
    const ac = getCtx();
    if (!ac) return;
    const t = ac.currentTime;
    // Ascending major arpeggio — G4, C5, E5, G5
    [392, 523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ac.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const g = ac.createGain();
      const s = t + i * 0.11;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.22, s + 0.04);
      g.gain.exponentialRampToValueAtTime(0.001, s + 1.1);
      osc.connect(g);
      g.connect(ac.destination);
      osc.start(s);
      osc.stop(s + 1.2);
    });
  }, []);

  const playFailure = useCallback(() => {
    const ac = getCtx();
    if (!ac) return;
    const t = ac.currentTime;
    // Descending dissonant tones
    [260, 218, 183].forEach((freq, i) => {
      const osc = ac.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, t + i * 0.18);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.52, t + i * 0.18 + 1.0);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.15, t + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.18 + 1.1);
      osc.connect(g);
      g.connect(ac.destination);
      osc.start(t + i * 0.18);
      osc.stop(t + i * 0.18 + 1.3);
    });
  }, []);

  const playTick = useCallback(() => {
    const ac = getCtx();
    if (!ac) return;
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 880;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    osc.connect(g);
    g.connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.08);
  }, []);

  const playLaunch = useCallback(() => {
    const ac = getCtx();
    if (!ac) return;
    playWhoosh("hard");
    const t = ac.currentTime;
    // Rising sustain tone on top of whoosh
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(60, t + 0.2);
    osc.frequency.exponentialRampToValueAtTime(240, t + 1.1);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t + 0.1);
    g.gain.linearRampToValueAtTime(0.18, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
    osc.connect(g);
    g.connect(ac.destination);
    osc.start(t + 0.1);
    osc.stop(t + 1.6);
  }, [playWhoosh]);

  const startTension = useCallback((): (() => void) => {
    const ac = getCtx();
    if (!ac) return () => {};
    const t = ac.currentTime;

    // Low sine drone with LFO tremolo
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 52;

    const lfo = ac.createOscillator();
    lfo.frequency.value = 3.8;
    const lfoG = ac.createGain();
    lfoG.gain.value = 0.04;

    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.1, t + 2.5);

    lfo.connect(lfoG);
    lfoG.connect(gain.gain);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t);
    lfo.start(t);

    return () => {
      try {
        const now = ac.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.5);
        osc.stop(now + 0.6);
        lfo.stop(now + 0.6);
      } catch {
        // node already stopped
      }
    };
  }, []);

  return {
    unlock,
    playWhoosh,
    playSuccess,
    playFailure,
    playTick,
    playLaunch,
    startTension,
  };
}
