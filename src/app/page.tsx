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
    <div className="min-h-dvh bg-[#f4f5f8]">
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-6 px-5 py-10">
        <header className="text-center">
          <h1 className="wiggle text-6xl font-black text-pop sm:text-7xl">{th.appName}</h1>
          <p className="mt-3 text-base font-bold text-ink/60">{th.tagline}</p>
        </header>

        <form
          onSubmit={handleJoin}
          className="flex flex-col gap-4 rounded-3xl bg-white p-6 shadow-[0_10px_30px_rgba(17,19,24,0.08)]"
        >
          <h2 className="text-2xl font-black text-ink">{th.joinTitle}</h2>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-black uppercase tracking-wide text-ink/50">
              {th.roomCode}
            </span>
            <input
              className="host-field text-center text-2xl tracking-[0.25em] uppercase"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
              placeholder={th.roomCodePlaceholder}
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-black uppercase tracking-wide text-ink/50">
              {th.nickname}
            </span>
            <input
              className="host-field"
              value={nickname}
              onChange={(e) => setNickname(e.target.value.slice(0, 20))}
              placeholder={th.nicknamePlaceholder}
              autoComplete="off"
            />
          </label>

          {error && (
            <p className="rounded-xl bg-berry/10 px-3 py-2.5 text-sm font-bold text-berry">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="flex w-full items-center justify-center rounded-2xl bg-gradient-to-r from-[#ff9d4d] to-[#ff6b1a] px-6 py-3.5 text-lg font-black text-white shadow-[0_10px_24px_rgba(255,107,26,0.35)] transition hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
            disabled={!joinable || busy !== null}
          >
            {busy === 'join' ? th.joining : th.join}
          </button>
        </form>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={handleCreate}
            className="flex w-full items-center justify-center rounded-2xl bg-gradient-to-r from-[#3fd6a8] to-[#16c79a] px-6 py-3.5 text-lg font-black text-[#06281f] shadow-[0_10px_24px_rgba(22,199,154,0.3)] transition hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
            disabled={busy !== null}
          >
            {busy === 'create' ? th.creatingRoom : th.createRoom}
          </button>

          {/* Last resort: the room exists, so give the teacher a link they can
              click even if neither navigation went through. */}
          {createdCode && (
            <a
              className="flex w-full items-center justify-center rounded-2xl bg-white px-6 py-3 text-base font-black text-ink shadow-[0_10px_24px_rgba(17,19,24,0.08)] transition hover:brightness-105"
              href={`/host/${createdCode}`}
            >
              เข้าห้อง {createdCode}
            </a>
          )}
          <p className="text-center text-xs font-bold text-ink/45">
            ครูสร้างห้อง → เปิดจอฉาย → นักเรียนเข้าด้วยรหัสห้อง
          </p>
        </div>
      </main>
    </div>
  );
}
