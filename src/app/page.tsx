'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { rememberTeacherKey } from '@/lib/realtime/client';
import { th } from '@/lib/i18n/th';

export default function LandingPage() {
  const router = useRouter();
  const [tab, setTab] = useState<'join' | 'create'>('join');
  const [code, setCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState<'join' | 'create' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [roomMode, setRoomMode] = useState<'PHONE' | 'SOLO'>('PHONE');

  const joinable = code.trim().length >= 4 && nickname.trim().length >= 1;

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!joinable || busy) return;
    setBusy('join');
    setError(null);
    const clean = code.trim().toUpperCase();
    try {
      const res = await fetch(`/api/rooms/${clean}`);
      if (!res.ok) {
        setError(th.roomNotFound);
        setBusy(null);
        return;
      }
      localStorage.setItem('memeback:nickname', nickname.trim().slice(0, 20));
      goTo(`/play/${clean}`);
    } catch {
      setError(th.error);
      setBusy(null);
    }
  }

  /**
   * Client-side routing can silently do nothing — a stale dev tab, a failed RSC
   * fetch — and the button then sits on its loading label forever even though
   * the room already exists. Fall back to a full page load if we haven't moved.
   */
  function goTo(path: string) {
    router.push(path);
    setTimeout(() => {
      if (window.location.pathname !== path) window.location.assign(path);
    }, 1500);
  }

  async function handleCreate() {
    if (busy) return;
    setBusy('create');
    setError(null);
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: roomMode }),
      });
      const data = (await res.json()) as { code?: string; teacherKey?: string; error?: string };
      if (!res.ok || !data.code || !data.teacherKey) {
        setError(data.error ?? th.error);
        setBusy(null);
        return;
      }
      rememberTeacherKey(data.code, data.teacherKey);
      setCreatedCode(data.code);
      goTo(`/host/${data.code}`);
    } catch {
      setError(th.error);
      setBusy(null);
    }
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-paper">
      {/* atmosphere: a handful of soft drifting color blobs, no purple in sight */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="drift absolute -left-24 -top-20 size-72 rounded-full bg-mint/35 blur-3xl sm:size-96" />
        <div className="drift-slow absolute -right-16 top-10 size-64 rounded-full bg-sun/50 blur-3xl sm:size-80" />
        <div className="drift-slow absolute -bottom-24 -left-10 size-72 rounded-full bg-sky/25 blur-3xl sm:size-96" />
        <div className="drift absolute -bottom-16 -right-20 size-64 rounded-full bg-pop/25 blur-3xl sm:size-80" />
      </div>

      <main className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-7 px-5 py-10">
        <header className="text-center">
          <h1 className="wiggle text-4xl font-black text-pop sm:text-5xl">{th.appName}</h1>
          <p className="mt-2 text-sm font-bold text-ink/60">{th.tagline}</p>
        </header>

        <div className="chunk w-full bg-white p-6">
          <div className="tab-switch" role="tablist">
            <button
              type="button"
              role="tab"
              data-active={tab === 'join'}
              aria-selected={tab === 'join'}
              onClick={() => setTab('join')}
            >
              {th.joinTabStudent}
            </button>
            <button
              type="button"
              role="tab"
              data-active={tab === 'create'}
              aria-selected={tab === 'create'}
              onClick={() => setTab('create')}
            >
              {th.joinTabTeacher}
            </button>
          </div>

          {tab === 'join' ? (
            <form onSubmit={handleJoin} className="mt-5 flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-black uppercase tracking-wide text-ink/50">
                  {th.roomCode}
                </span>
                <input
                  className="pin-field"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
                  placeholder={th.roomCodePlaceholder}
                  inputMode="text"
                  autoCapitalize="characters"
                  autoComplete="off"
                  autoFocus
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-black uppercase tracking-wide text-ink/50">
                  {th.nickname}
                </span>
                <input
                  className="field"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value.slice(0, 20))}
                  placeholder={th.nicknamePlaceholder}
                  autoComplete="off"
                />
              </label>

              {error && (
                <p className="chunk-sm bg-berry/10 px-3 py-2.5 text-sm font-bold text-berry">
                  {error}
                </p>
              )}

              <button
                type="submit"
                className="btn btn-pop w-full py-4 text-lg"
                disabled={!joinable || busy !== null}
              >
                {busy === 'join' ? th.joining : th.join}
              </button>
            </form>
          ) : (
            <div className="mt-5 flex flex-col gap-4">
              <p className="text-center text-sm font-bold leading-relaxed text-ink/60">
                {th.createRoomHint}
              </p>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-black uppercase tracking-wide text-ink/50">
                  {th.roomModeLabel}
                </span>
                <div className="tab-switch" role="radiogroup" aria-label={th.roomModeLabel}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={roomMode === 'PHONE'}
                    data-active={roomMode === 'PHONE'}
                    onClick={() => setRoomMode('PHONE')}
                  >
                    {th.roomModePhone}
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={roomMode === 'SOLO'}
                    data-active={roomMode === 'SOLO'}
                    onClick={() => setRoomMode('SOLO')}
                  >
                    {th.roomModeSolo}
                  </button>
                </div>
                <p className="text-center text-xs font-bold text-ink/40">
                  {roomMode === 'PHONE' ? th.roomModePhoneHint : th.roomModeSoloHint}
                </p>
              </div>

              {error && (
                <p className="chunk-sm bg-berry/10 px-3 py-2.5 text-sm font-bold text-berry">
                  {error}
                </p>
              )}

              <button
                type="button"
                onClick={handleCreate}
                className="btn btn-mint w-full py-4 text-lg"
                disabled={busy !== null}
              >
                {busy === 'create' ? th.creatingRoom : th.createRoomShort}
              </button>

              {/* Last resort: the room exists, so give the teacher a link they can
                  click even if neither navigation went through. */}
              {createdCode && (
                <a className="btn btn-ghost w-full" href={`/host/${createdCode}`}>
                  เข้าห้อง {createdCode}
                </a>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-xs font-bold text-ink/40">
          ครูสร้างห้อง → เปิดจอฉาย → นักเรียนเข้าด้วยรหัสห้อง
        </p>
      </main>
    </div>
  );
}
