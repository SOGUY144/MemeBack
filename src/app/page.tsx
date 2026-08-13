'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { rememberTeacherKey } from '@/lib/realtime/client';
import { th } from '@/lib/i18n/th';

export default function LandingPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState<'join' | 'create' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createdCode, setCreatedCode] = useState<string | null>(null);

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
      const res = await fetch('/api/rooms', { method: 'POST' });
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
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-6 px-5 py-10">
      <header className="text-center">
        <h1 className="wiggle text-6xl text-pop drop-shadow-[5px_5px_0_var(--color-ink)] sm:text-7xl">
          {th.appName}
        </h1>
        <p className="mt-3 text-base font-bold text-ink/70">{th.tagline}</p>
      </header>

      <form onSubmit={handleJoin} className="chunk flex flex-col gap-4 p-5">
        <h2 className="text-2xl">{th.joinTitle}</h2>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-black uppercase tracking-wide">{th.roomCode}</span>
          <input
            className="field text-center text-2xl tracking-[0.25em] uppercase"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
            placeholder={th.roomCodePlaceholder}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-black uppercase tracking-wide">{th.nickname}</span>
          <input
            className="field"
            value={nickname}
            onChange={(e) => setNickname(e.target.value.slice(0, 20))}
            placeholder={th.nicknamePlaceholder}
            autoComplete="off"
          />
        </label>

        {error && (
          <p className="chunk-sm bg-berry px-3 py-2 text-sm font-black text-white">{error}</p>
        )}

        <button type="submit" className="btn btn-pop w-full" disabled={!joinable || busy !== null}>
          {busy === 'join' ? th.joining : th.join}
        </button>
      </form>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={handleCreate}
          className="btn btn-sun w-full"
          disabled={busy !== null}
        >
          {busy === 'create' ? th.creatingRoom : th.createRoom}
        </button>

        {/* Last resort: the room exists, so give the teacher a link they can
            click even if neither navigation went through. */}
        {createdCode && (
          <a className="btn btn-mint w-full" href={`/host/${createdCode}`}>
            เข้าห้อง {createdCode}
          </a>
        )}
        <p className="text-center text-xs font-bold text-ink/55">
          ครูสร้างห้อง → เปิดจอฉาย → นักเรียนเข้าด้วยรหัสห้อง
        </p>
      </div>
    </main>
  );
}
