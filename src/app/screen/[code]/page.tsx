'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { MemeMedia } from '@/components/meme/MemeMedia';
import { useRoom } from '@/lib/realtime/client';
import { th } from '@/lib/i18n/th';
import type { GuessCard, RevealPayload, ScoreRow } from '@/lib/realtime/events';
import type { Verdict } from '@/lib/meme/vocab';

const VERDICT_LABEL: Record<Verdict, string> = {
  correct: th.verdictCorrect,
  partial: th.verdictPartial,
  misconception: th.verdictMisconception,
  off_topic: th.verdictOffTopic,
};

export default function ScreenPage() {
  const params = useParams<{ code: string }>();
  const code = (params.code ?? '').toUpperCase();
  const { socket, state } = useRoom(code, { role: 'screen' });

  const [qr, setQr] = useState<string | null>(null);
  const [joinUrl, setJoinUrl] = useState<string | null>(null);
  const [card, setCard] = useState<GuessCard | null>(null);
  const [tally, setTally] = useState<{ counts: Record<string, number>; voted: number }>({
    counts: {},
    voted: 0,
  });
  const [reveal, setReveal] = useState<RevealPayload | null>(null);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const phase = state?.phase ?? 'LOBBY';

  // The projector is the teacher's laptop, so its own origin is `localhost` and
  // a QR built from it sends every phone to its own loopback. Ask the server for
  // the address the classroom wifi can reach, and fall back to the current
  // origin only when it cannot find one.
  useEffect(() => {
    let cancelled = false;

    async function resolveJoinUrl(): Promise<string> {
      try {
        const res = await fetch('/api/join-url');
        const data: { origin?: string | null } = await res.json();
        if (data.origin) return `${data.origin}/play/${code}`;
      } catch {
        // offline or the route is unavailable — the current origin still works
        // for anyone browsing from the projector machine itself
      }
      return `${window.location.origin}/play/${code}`;
    }

    void resolveJoinUrl().then(async (url) => {
      if (cancelled) return;
      setJoinUrl(url);
      try {
        const qrcode = await import('qrcode');
        const data = await qrcode.toDataURL(url, {
          width: 420,
          margin: 1,
          color: { dark: '#111318', light: '#FFFFFF' },
        });
        if (!cancelled) setQr(data);
      } catch {
        if (!cancelled) setQr(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [code]);

  useEffect(() => {
    const onCard = (c: GuessCard | null) => {
      setCard(c);
      setTally({ counts: {}, voted: 0 });
      if (c) setReveal(null);
    };
    const onTally = (p: { answerId: string; counts: Record<string, number>; voted: number }) =>
      setTally({ counts: p.counts, voted: p.voted });
    const onReveal = (r: RevealPayload) => setReveal(r);
    const onScores = (p: { rows: ScoreRow[] }) => setScores(p.rows);

    socket.on('guess:card', onCard);
    socket.on('guess:tally', onTally);
    socket.on('reveal:answer', onReveal);
    socket.on('scoreboard', onScores);
    return () => {
      socket.off('guess:card', onCard);
      socket.off('guess:tally', onTally);
      socket.off('reveal:answer', onReveal);
      socket.off('scoreboard', onScores);
    };
  }, [socket]);

  useEffect(() => {
    if (phase !== 'CLASS_GUESS') return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [phase]);

  const secondsLeft = card
    ? Math.max(0, Math.ceil((card.openedAt + card.durationMs - now) / 1000))
    : 0;

  const generatingPct = useMemo(() => {
    if (!state || state.answeredCount === 0) return 0;
    const done = Math.min(state.analyzedCount, state.answeredCount);
    return Math.round((done / state.answeredCount) * 100);
  }, [state]);

  return (
    <main className="screen-root flex min-h-dvh flex-col items-center justify-center gap-8 p-10">
      {phase === 'LOBBY' && (
        <>
          <div className="join-card w-full max-w-4xl">
            <p className="join-card-header">
              <span className="join-card-dot" aria-hidden="true">
                ·
              </span>
              {th.scanToJoin}
              <span className="join-card-dot" aria-hidden="true">
                ·
              </span>
            </p>

            <div className="join-card-grid">
              <div className="join-card-invite">
                <span className="join-card-avatar" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
                    />
                  </svg>
                </span>
                <span className="join-card-rule" aria-hidden="true" />
                <span className="join-card-invite-label">{th.joinWithFriends}</span>
              </div>

              <p className="join-card-code">{code}</p>

              {qr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qr} alt="QR" className="join-card-qr" />
              ) : (
                <div className="join-card-qr join-card-qr--empty" />
              )}
            </div>

            {joinUrl && (
              <p className="join-card-footer">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
                  />
                </svg>
                {th.openThisUrl}{' '}
                <span className="join-card-url">{joinUrl.replace(/^https?:\/\//, '')}</span>
              </p>
            )}
          </div>

          <div className="flex max-w-5xl flex-wrap justify-center gap-3">
            {state?.players.map((p) => (
              <span
                key={p.id}
                className="rounded-full border-4 border-ink bg-sun px-5 py-2 text-2xl font-black text-ink"
              >
                {p.nickname}
              </span>
            ))}
            {(state?.players.length ?? 0) === 0 && (
              <p className="text-3xl font-black text-white/50">{th.waitingForPlayers}</p>
            )}
          </div>
        </>
      )}

      {phase === 'ANSWERING' && (
        <>
          <h1 className="max-w-5xl text-center text-6xl leading-tight">
            {state?.question?.prompt ?? th.loading}
          </h1>
          <p className="text-5xl font-black text-sun">
            {th.submittedCount(state?.answeredCount ?? 0, state?.playerCount ?? 0)}
          </p>
        </>
      )}

      {phase === 'GENERATING' && (
        <>
          <h1 className="text-6xl">{th.phaseGenerating}</h1>
          <div className="h-10 w-4/5 overflow-hidden rounded-full border-4 border-white/70">
            <div
              className="h-full bg-sun transition-all duration-500"
              style={{ width: `${generatingPct}%` }}
            />
          </div>
          <p className="text-3xl font-black text-white/70">
            {th.analyzedCount(state?.analyzedCount ?? 0, state?.answeredCount ?? 0)}
          </p>
        </>
      )}

      {phase === 'PERSONAL_REVEAL' && (
        <>
          <p className="text-8xl">📱</p>
          <h1 className="text-center text-7xl">{th.lookAtYourDevice}</h1>
        </>
      )}

      {phase === 'CLASS_GUESS' && card && (
        <div className="grid w-full max-w-7xl gap-8 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <MemeMedia
              memeUrl={card.memeUrl}
              scene={card.scene}
              className="w-full rounded-2xl border-8 border-white/15"
            />
            <p className="mt-4 text-center text-3xl font-black text-sun">
              {card.index + 1} / {card.total} · {secondsLeft} {th.seconds}
            </p>
          </div>
          <div className="flex flex-col justify-center gap-4">
            <h2 className="text-4xl">{th.whatPrinciple}</h2>
            {card.choices.map((choice) => {
              const n = tally.counts[choice] ?? 0;
              const pct = tally.voted ? Math.round((n / tally.voted) * 100) : 0;
              return (
                <div
                  key={choice}
                  className="relative overflow-hidden rounded-xl border-4 border-white/25 px-5 py-4"
                >
                  <div
                    className="absolute inset-y-0 left-0 bg-white/15 transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                  <div className="relative flex items-center justify-between gap-4">
                    <span className="text-2xl font-black">{choice}</span>
                    <span className="text-2xl font-black text-sun tabular-nums">{n}</span>
                  </div>
                </div>
              );
            })}
            <p className="text-xl font-black text-white/50">
              {tally.voted} {th.votes}
            </p>
          </div>
        </div>
      )}

      {phase === 'REVEAL' && reveal && (
        <div className="grid w-full max-w-7xl items-center gap-8 lg:grid-cols-[1.2fr_1fr]">
          {card && (
            <MemeMedia
              memeUrl={card.memeUrl}
              scene={card.scene}
              className="w-full rounded-2xl border-8 border-white/15"
            />
          )}
          <div className="flex flex-col gap-5">
            <div>
              <p className="text-xl font-black uppercase tracking-widest text-white/50">
                {th.theAnswerWas}
              </p>
              <h2 className="text-5xl text-sun">{reveal.correctChoice}</h2>
            </div>
            <div className="rounded-2xl border-4 border-white/25 p-5">
              <p className="text-lg font-black uppercase tracking-widest text-white/50">
                {th.originalAnswer} · {th.by} {reveal.author}
              </p>
              <p className="mt-2 text-3xl font-bold leading-snug">{reveal.rawText}</p>
              <span className="mt-4 inline-block rounded-full border-4 border-white/40 px-4 py-1 text-xl font-black">
                {VERDICT_LABEL[reveal.verdict]}
              </span>
            </div>
          </div>
        </div>
      )}

      {phase === 'SCOREBOARD' && (
        <div className="w-full max-w-3xl">
          <h1 className="mb-6 text-center text-6xl text-sun">{th.top10}</h1>
          <ol className="grid gap-3">
            {scores.slice(0, 10).map((r) => (
              <li
                key={r.playerId}
                className="flex items-center justify-between rounded-xl border-4 border-white/25 px-6 py-3 text-4xl font-black"
              >
                <span>
                  {r.rank}. {r.nickname}
                </span>
                <span className="text-sun tabular-nums">{r.score}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </main>
  );
}
