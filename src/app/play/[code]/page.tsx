'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { MemeStage } from '@/components/meme/MemeStage';
import { MemeMedia } from '@/components/meme/MemeMedia';
import { useRoom } from '@/lib/realtime/client';
import { th } from '@/lib/i18n/th';
import type { GuessCard, MemeReady, MemeStage as Stage, RevealPayload, ScoreRow } from '@/lib/realtime/events';
import type { Verdict } from '@/lib/meme/vocab';

const VERDICT_LABEL: Record<Verdict, string> = {
  correct: th.verdictCorrect,
  partial: th.verdictPartial,
  misconception: th.verdictMisconception,
  off_topic: th.verdictOffTopic,
};

const VERDICT_CLASS: Record<Verdict, string> = {
  correct: 'bg-mint',
  partial: 'bg-sun',
  misconception: 'bg-pop text-white',
  off_topic: 'bg-white',
};

const STAGE_LABEL: Record<Stage, string> = {
  analyzing: th.stageAnalyzing,
  composing: th.stageComposing,
  encoding: th.stageEncoding,
  ai_rendering: th.stageAiRendering,
};

export default function PlayPage() {
  const params = useParams<{ code: string }>();
  const code = (params.code ?? '').toUpperCase();

  const [nickname, setNickname] = useState('');
  const { socket, state, connected, playerId, error, join } = useRoom(code, {
    role: 'player',
    nickname: nickname || undefined,
  });

  const [answer, setAnswer] = useState('');
  const [sending, setSending] = useState(false);
  const [sentAnswerId, setSentAnswerId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [mine, setMine] = useState<MemeReady | null>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [encodeProgress, setEncodeProgress] = useState(0);
  const [card, setCard] = useState<GuessCard | null>(null);
  const [guessed, setGuessed] = useState<{ choice: string; correct: boolean; points: number } | null>(null);
  const [reveal, setReveal] = useState<RevealPayload | null>(null);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const uploadedRef = useRef<string | null>(null);
  const questionRef = useRef<string | null>(null);

  const phase = state?.phase ?? 'LOBBY';

  // recall the nickname typed on the landing page
  useEffect(() => {
    const stored = localStorage.getItem('memeback:nickname');
    if (stored) setNickname(stored);
  }, []);

  useEffect(() => {
    if (nickname && !playerId && connected) void join(nickname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nickname, connected]);

  useEffect(() => {
    const onMine = (p: MemeReady) => {
      setMine(p);
      setStage(p.verdict === 'off_topic' ? null : 'composing');
    };
    const onProgress = (p: { answerId: string; stage: Stage | null }) => setStage(p.stage);
    const onOwnAnswer = (p: { answerId: string; rawText: string }) => {
      setAnswer(p.rawText);
      setSentAnswerId(p.answerId);
      setEditing(false);
    };
    const onCard = (c: GuessCard | null) => {
      setCard(c);
      setGuessed(null);
      setReveal(null);
    };
    const onReveal = (r: RevealPayload) => setReveal(r);
    const onScores = (p: { rows: ScoreRow[] }) => setScores(p.rows);

    socket.on('meme:mine', onMine);
    socket.on('answer:mine', onOwnAnswer);
    socket.on('meme:progress', onProgress);
    socket.on('guess:card', onCard);
    socket.on('reveal:answer', onReveal);
    socket.on('scoreboard', onScores);
    return () => {
      socket.off('meme:mine', onMine);
      socket.off('answer:mine', onOwnAnswer);
      socket.off('meme:progress', onProgress);
      socket.off('guess:card', onCard);
      socket.off('reveal:answer', onReveal);
      socket.off('scoreboard', onScores);
    };
  }, [socket]);

  useEffect(() => {
    if (phase !== 'CLASS_GUESS') return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [phase]);

  // Reset only when the teacher actually asks a *new* question. Keying this off
  // the phase alone wiped the meme of a student who reconnected while the room
  // was still in ANSWERING.
  useEffect(() => {
    const id = state?.question?.id;
    if (!id) return;
    if (questionRef.current === id) return;
    const first = questionRef.current === null;
    questionRef.current = id;
    if (first) return;
    setMine(null);
    setStage(null);
    setEncodeProgress(0);
    setAnswer('');
    setSentAnswerId(null);
    setEditing(false);
    uploadedRef.current = null;
  }, [state?.question?.id]);

  const myRank = useMemo(
    () => scores.find((r) => r.playerId === playerId) ?? null,
    [scores, playerId],
  );

  const secondsLeft = card
    ? Math.max(0, Math.ceil((card.openedAt + card.durationMs - now) / 1000))
    : 0;

  async function submitAnswer() {
    const questionId = state?.question?.id;
    if (!questionId || !answer.trim() || sending) return;
    setSending(true);
    socket.emit('answer:submit', { questionId, text: answer.trim() }, (res) => {
      setSending(false);
      if (res.ok) {
        setSentAnswerId(res.answerId);
        setEditing(false);
      }
    });
  }

  function sendGuess(choice: string) {
    if (!card || guessed) return;
    socket.emit('guess:submit', { answerId: card.answerId, choice }, (res) => {
      if (res.ok) setGuessed({ choice, correct: res.correct, points: res.points });
    });
  }

  function handleEncoded(result: { bytes: ArrayBuffer; mime: string } | null) {
    if (!mine || uploadedRef.current === mine.answerId) return;
    uploadedRef.current = mine.answerId;
    if (!result) {
      // blew the deadline — the projector will play the scene live instead
      setStage(null);
      return;
    }
    setStage('encoding');
    socket.emit(
      'meme:upload',
      { answerId: mine.answerId, mime: result.mime, bytes: result.bytes },
      () => setStage(null),
    );
  }

  // ---- gates -------------------------------------------------------------

  if (error && error !== 'no-teacher-key') {
    return (
      <Shell>
        <div className="chunk bg-berry p-6 text-center font-black text-white">{error}</div>
      </Shell>
    );
  }

  if (!nickname) {
    return (
      <Shell>
        <NicknameGate
          onSubmit={(n) => {
            localStorage.setItem('memeback:nickname', n);
            setNickname(n);
          }}
        />
      </Shell>
    );
  }

  if (!state) {
    return (
      <Shell>
        <p className="text-center font-black">{connected ? th.loading : th.connecting}</p>
      </Shell>
    );
  }

  // ---- phases ------------------------------------------------------------

  // Telling a student their answer is off topic and to write it again, then
  // giving them nowhere to type, was a dead end. The server keeps `answer:submit`
  // open for exactly this case, so the retry is a real input in both the phase
  // where the verdict lands (GENERATING) and the one where they read it.
  const offTopicRetry =
    mine?.verdict === 'off_topic' ? (
      <Card className="bg-white">
        <span className={`tag ${VERDICT_CLASS.off_topic}`}>{VERDICT_LABEL.off_topic}</span>
        <h2 className="mt-3 text-2xl">{th.tryAgain}</h2>
        <p className="mt-2 font-bold text-ink/70">{mine.conceptNote || th.offTopicHint}</p>
        {stage === 'analyzing' ? (
          <p className="mt-4 font-black text-ink/60">{th.stageAnalyzing}…</p>
        ) : (
          <>
            <textarea
              className="field mt-4 min-h-32 resize-none"
              value={answer}
              onChange={(e) => setAnswer(e.target.value.slice(0, 600))}
              placeholder={th.answerPlaceholder}
            />
            <button
              className="btn btn-pop mt-3 w-full"
              onClick={submitAnswer}
              disabled={!answer.trim() || sending}
            >
              {sending ? th.submitting : th.submitAnswer}
            </button>
          </>
        )}
      </Card>
    ) : null;

  return (
    <Shell>
      <TopBar code={code} nickname={nickname} rank={myRank?.rank ?? null} score={myRank?.score} />

      {phase === 'LOBBY' && (
        <Card>
          <h2 className="text-2xl">{th.waitingForTeacher}</h2>
          <p className="mt-2 font-bold text-ink/60">
            {th.players}: {state.playerCount}
          </p>
        </Card>
      )}

      {phase === 'ANSWERING' && state.question && (
        <>
          <Card className="bg-sun">
            <p className="text-xs font-black uppercase tracking-widest">คำถาม</p>
            <h2 className="mt-1 text-xl leading-snug">{state.question.prompt}</h2>
          </Card>

          {sentAnswerId && !editing ? (
            <Card>
              <p className="text-lg font-black">{th.answerSent}</p>
              <p className="mt-2 rounded-lg bg-paper-2 p-3 font-bold">{answer}</p>
              <button className="btn btn-ghost mt-4 w-full" onClick={() => setEditing(true)}>
                {th.editAnswer}
              </button>
            </Card>
          ) : (
            <Card>
              <label className="text-sm font-black uppercase tracking-wide">{th.yourAnswer}</label>
              <textarea
                className="field mt-2 min-h-36 resize-none"
                value={answer}
                onChange={(e) => setAnswer(e.target.value.slice(0, 600))}
                placeholder={th.answerPlaceholder}
              />
              <button
                className="btn btn-pop mt-4 w-full"
                onClick={submitAnswer}
                disabled={!answer.trim() || sending}
              >
                {sending ? th.submitting : th.submitAnswer}
              </button>
            </Card>
          )}
        </>
      )}

      {phase === 'GENERATING' && offTopicRetry}

      {phase === 'GENERATING' && !offTopicRetry && (
        <Card className="text-center">
          <div className="pulse-ring mx-auto grid size-20 place-items-center rounded-full border-4 border-ink bg-sun text-3xl">
            🎬
          </div>
          <h2 className="mt-5 text-2xl">{th.buildingMeme}</h2>
          <p className="mt-2 font-black text-ink/60">
            {stage ? STAGE_LABEL[stage] : th.loading}
            {stage === 'encoding' && encodeProgress > 0
              ? ` · ${Math.round(encodeProgress * 100)}%`
              : ''}
          </p>
        </Card>
      )}

      {phase === 'PERSONAL_REVEAL' && mine && (
        <>
          {mine.verdict === 'off_topic' ? (
            offTopicRetry
          ) : (
            <>
              <Card className="p-3">
                <MemeMedia memeUrl={mine.memeUrl} scene={mine.scene} />
              </Card>
              {stage === 'ai_rendering' && (
                <Card className="bg-grape/10 text-center">
                  <p className="text-lg font-black">{th.aiMemeWaitTitle}</p>
                  <p className="mt-1 font-bold text-ink/60">{th.aiMemeWaitBody}</p>
                </Card>
              )}
              <Card>
                <span className={`tag ${VERDICT_CLASS[mine.verdict]}`}>
                  {VERDICT_LABEL[mine.verdict]}
                </span>
                <p className="mt-3 font-bold leading-relaxed">{mine.conceptNote}</p>
                {mine.misconception && (
                  <p className="chunk-sm mt-3 bg-paper-2 p-3 text-sm font-bold">
                    {mine.misconception}
                  </p>
                )}
              </Card>
            </>
          )}
        </>
      )}

      {phase === 'PERSONAL_REVEAL' && !mine && (
        <Card className="text-center">
          <p className="font-black">{th.waitingForTeacher}</p>
        </Card>
      )}

      {phase === 'CLASS_GUESS' && card && (
        <>
          <Card className="flex items-center justify-between bg-sky text-white">
            <span className="font-black">
              {card.index + 1} / {card.total}
            </span>
            <span className="text-2xl font-black tabular-nums">
              {secondsLeft} {th.seconds}
            </span>
          </Card>

          {card.authorPlayerId === playerId ? (
            <Card className="text-center">
              <p className="text-lg font-black">{th.ownMemeNoGuess}</p>
            </Card>
          ) : (
            <Card>
              <h2 className="text-xl">{th.guessPrompt}</h2>
              <div className="mt-4 grid gap-3">
                {card.choices.map((choice) => {
                  const picked = guessed?.choice === choice;
                  return (
                    <button
                      key={choice}
                      className={`btn w-full ${picked ? (guessed!.correct ? 'btn-mint' : 'btn-pop') : 'bg-white'}`}
                      onClick={() => sendGuess(choice)}
                      disabled={guessed !== null}
                    >
                      {choice}
                    </button>
                  );
                })}
              </div>
              {guessed && (
                <p className="mt-4 text-center text-lg font-black">
                  {guessed.correct
                    ? `${th.guessCorrect} ${th.pointsEarned(guessed.points)}`
                    : th.guessWrong}
                </p>
              )}
            </Card>
          )}
        </>
      )}

      {phase === 'REVEAL' && reveal && (
        <>
          <Card className="bg-mint">
            <p className="text-xs font-black uppercase tracking-widest">{th.theAnswerWas}</p>
            <h2 className="mt-1 text-2xl">{reveal.correctChoice}</h2>
          </Card>
          <Card>
            <p className="text-xs font-black uppercase tracking-widest text-ink/50">
              {th.originalAnswer} · {th.by} {reveal.author}
            </p>
            <p className="mt-2 font-bold leading-relaxed">{reveal.rawText}</p>
            <span className={`tag mt-3 ${VERDICT_CLASS[reveal.verdict]}`}>
              {VERDICT_LABEL[reveal.verdict]}
            </span>
            {reveal.conceptNote && (
              <p className="mt-3 font-bold text-ink/70">{reveal.conceptNote}</p>
            )}
          </Card>
        </>
      )}

      {phase === 'SCOREBOARD' && (
        <Card>
          <h2 className="text-2xl">{th.yourRank}</h2>
          <p className="mt-2 text-5xl font-black text-pop">
            #{myRank?.rank ?? '-'}
            <span className="ml-3 text-2xl text-ink">{myRank?.score ?? 0}</span>
          </p>
          <ol className="mt-5 grid gap-2">
            {scores.slice(0, 10).map((row) => (
              <li
                key={row.playerId}
                className={`chunk-sm flex items-center justify-between px-3 py-2 font-black ${
                  row.playerId === playerId ? 'bg-sun' : 'bg-white'
                }`}
              >
                <span>
                  {row.rank}. {row.nickname}
                </span>
                <span className="tabular-nums">{row.score}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {/* Kept mounted from the moment the storyboard lands so the encode starts
          immediately; only visible once the teacher opens PERSONAL_REVEAL. */}
      {mine && mine.verdict !== 'off_topic' && !mine.memeUrl && (
        <div className="pointer-events-none fixed -left-[9999px] top-0 w-[480px] opacity-0">
          <MemeStage
            scene={mine.scene}
            encode
            onEncoded={handleEncoded}
            onProgress={setEncodeProgress}
          />
        </div>
      )}

      {!connected && (
        <p className="chunk-sm bg-berry p-3 text-center font-black text-white">{th.disconnected}</p>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 py-5">
      {children}
    </main>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={`chunk p-5 ${className ?? ''}`}>{children}</section>;
}

function TopBar({
  code,
  nickname,
  rank,
  score,
}: {
  code: string;
  nickname: string;
  rank: number | null;
  score?: number;
}) {
  return (
    <div className="chunk-sm flex items-center justify-between bg-white px-4 py-2.5">
      <span className="tag bg-sun">{code}</span>
      <span className="text-sm font-black">
        {nickname}
        {rank ? ` · #${rank} · ${score}` : ''}
      </span>
    </div>
  );
}

function NicknameGate({ onSubmit }: { onSubmit: (n: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <form
      className="chunk mt-20 flex flex-col gap-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit(value.trim().slice(0, 20));
      }}
    >
      <h2 className="text-2xl">{th.nickname}</h2>
      <input
        className="field"
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, 20))}
        placeholder={th.nicknamePlaceholder}
        autoFocus
      />
      <button className="btn btn-pop" type="submit" disabled={!value.trim()}>
        {th.join}
      </button>
    </form>
  );
}
