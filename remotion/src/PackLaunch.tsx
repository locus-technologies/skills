import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';
import type React from 'react';
import { AbsoluteFill, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { LaunchProps } from './schema';

const { fontFamily: sans } = loadInter();
const { fontFamily: mono } = loadMono();

const C = {
  bg: '#0d0e0c',
  panel: '#171815',
  line: '#30312d',
  text: '#f4f4ee',
  muted: '#85857d',
  lime: '#ccff33',
  red: '#ff6b7f',
  green: '#5fd38a',
};

export const SCENES = { hook: 75, price: 135, replay: 420, summary: 120, end: 150 };
export const TOTAL_FRAMES = Object.values(SCENES).reduce((a, b) => a + b, 0);

function useIn(delay = 0) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping: 200 } });
}

const Fade: React.FC<{ delay?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({
  delay = 0,
  children,
  style,
}) => {
  const p = useIn(delay);
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * 24}px)`, ...style }}>{children}</div>;
};

const Hook: React.FC<{ text: string }> = ({ text }) => (
  <AbsoluteFill style={{ justifyContent: 'center', padding: 96 }}>
    <Fade>
      <div style={{ fontFamily: mono, color: C.lime, fontSize: 30, letterSpacing: 4, marginBottom: 32 }}>
        LOCUS SKILL PACKS
      </div>
    </Fade>
    <Fade delay={6}>
      <div style={{ fontFamily: sans, color: C.text, fontSize: 84, fontWeight: 700, lineHeight: 1.08 }}>{text}</div>
    </Fade>
  </AbsoluteFill>
);

const Price: React.FC<Pick<LaunchProps, 'incumbent' | 'ours'>> = ({ incumbent, ours }) => {
  const frame = useCurrentFrame();
  const strike = interpolate(frame, [45, 65], [0, 100], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: 96, gap: 56 }}>
      <Fade>
        <div style={{ fontFamily: sans, color: C.muted, fontSize: 36 }}>{incumbent.name}</div>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <span style={{ fontFamily: sans, color: C.text, fontSize: 120, fontWeight: 700 }}>{incumbent.price}</span>
          <span style={{ fontFamily: sans, color: C.muted, fontSize: 40 }}> {incumbent.unit}</span>
          <div
            style={{ position: 'absolute', left: 0, top: '55%', height: 10, width: `${strike}%`, background: C.red }}
          />
        </div>
      </Fade>
      <Fade delay={70}>
        <div style={{ fontFamily: sans, color: C.muted, fontSize: 36 }}>Your agent + this skill pack</div>
        <span style={{ fontFamily: sans, color: C.lime, fontSize: 120, fontWeight: 700 }}>{ours.cost}</span>
        <span style={{ fontFamily: sans, color: C.muted, fontSize: 40 }}> {ours.unit}</span>
      </Fade>
    </AbsoluteFill>
  );
};

const Replay: React.FC<Pick<LaunchProps, 'prompt' | 'steps' | 'columns' | 'rows'>> = ({
  prompt,
  steps,
  columns,
  rows,
}) => {
  const frame = useCurrentFrame();
  const typed = Math.floor(interpolate(frame, [0, 60], [0, prompt.length], { extrapolateRight: 'clamp' }));
  const stepEvery = Math.max(8, Math.floor(170 / Math.max(steps.length, 1)));
  const stepsShown = Math.max(0, Math.floor((frame - 70) / stepEvery) + 1);
  const rowsStart = 70 + steps.length * stepEvery + 10;
  const rowsShown = Math.max(0, Math.floor((frame - rowsStart) / 12) + 1);
  let spent = 0;
  for (const s of steps.slice(0, stepsShown)) spent += s.credits ?? 0;
  return (
    <AbsoluteFill style={{ padding: 64 }}>
      <div
        style={{
          flex: 1,
          background: C.panel,
          border: `2px solid ${C.line}`,
          borderRadius: 24,
          padding: 40,
          fontFamily: mono,
          color: C.text,
          fontSize: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          overflow: 'hidden',
        }}
      >
        <div style={{ color: C.lime, fontSize: 26, marginBottom: 8 }}>
          {'> '}
          {prompt.slice(0, typed)}
          {typed < prompt.length && <span style={{ background: C.lime }}>&nbsp;</span>}
        </div>
        {steps.slice(0, stepsShown).map((s) => (
          <div key={`${s.tool}-${s.detail}`} style={{ display: 'flex', gap: 16 }}>
            <span style={{ color: C.green }}>✓</span>
            <span style={{ color: C.muted, width: 300, flexShrink: 0 }}>{s.tool}</span>
            <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {s.detail}
            </span>
            {s.credits ? <span style={{ color: C.muted, flexShrink: 0 }}>{s.credits} cr</span> : null}
          </div>
        ))}
        {rowsShown > 0 && (
          <div style={{ marginTop: 16, borderTop: `2px solid ${C.line}`, paddingTop: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr 1.2fr', color: C.muted, marginBottom: 8 }}>
              {columns.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
            {rows.slice(0, rowsShown).map((r) => (
              <div
                key={r.join('|')}
                style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr 1.2fr', padding: '4px 0' }}
              >
                {r.map((cell, i) => (
                  <span
                    key={columns[i]}
                    style={{
                      color: i === 2 && cell ? C.lime : C.text,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {cell || '—'}
                  </span>
                ))}
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: 'auto', color: C.muted, display: 'flex', justifyContent: 'space-between' }}>
          <span>live run · stage</span>
          <span>
            spent <span style={{ color: C.lime }}>${(spent / 1000).toFixed(3)}</span>
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Summary: React.FC<Pick<LaunchProps, 'summary'>> = ({ summary }) => (
  <AbsoluteFill style={{ justifyContent: 'center', padding: 96, gap: 40 }}>
    {summary.map((s, i) => (
      <Fade key={s.label} delay={i * 10}>
        <span style={{ fontFamily: sans, color: C.lime, fontSize: 96, fontWeight: 700 }}>{s.value}</span>
        <span style={{ fontFamily: sans, color: C.text, fontSize: 44 }}> {s.label}</span>
      </Fade>
    ))}
  </AbsoluteFill>
);

const End: React.FC<Pick<LaunchProps, 'install' | 'repo'>> = ({ install, repo }) => (
  <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: 72, gap: 48 }}>
    <Fade>
      <div style={{ fontFamily: sans, color: C.text, fontSize: 60, fontWeight: 700, textAlign: 'center' }}>
        Install it in one line
      </div>
    </Fade>
    <Fade delay={8}>
      <div
        style={{
          fontFamily: mono,
          color: C.lime,
          fontSize: 25,
          whiteSpace: 'nowrap',
          background: C.panel,
          border: `2px solid ${C.line}`,
          borderRadius: 18,
          padding: '28px 36px',
        }}
      >
        {install}
      </div>
    </Fade>
    <Fade delay={16}>
      <div style={{ fontFamily: mono, color: C.muted, fontSize: 30 }}>{repo}</div>
    </Fade>
  </AbsoluteFill>
);

export const PackLaunch: React.FC<LaunchProps> = (p) => {
  let at = 0;
  const seq = (frames: number, node: React.ReactNode) => {
    const from = at;
    at += frames;
    return (
      <Sequence from={from} durationInFrames={frames}>
        {node}
      </Sequence>
    );
  };
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {seq(SCENES.hook, <Hook text={p.hook} />)}
      {seq(SCENES.price, <Price incumbent={p.incumbent} ours={p.ours} />)}
      {seq(SCENES.replay, <Replay prompt={p.prompt} steps={p.steps} columns={p.columns} rows={p.rows} />)}
      {seq(SCENES.summary, <Summary summary={p.summary} />)}
      {seq(SCENES.end, <End install={p.install} repo={p.repo} />)}
    </AbsoluteFill>
  );
};
