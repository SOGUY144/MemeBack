'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServer, RoomState, ServerToClient } from '@/lib/realtime/events';

export type AppSocket = Socket<ServerToClient, ClientToServer>;

let shared: AppSocket | null = null;

export function getSocket(): AppSocket {
  shared ??= io({ transports: ['websocket', 'polling'], autoConnect: true });
  return shared;
}

const playerKey = (code: string) => `memeback:player:${code}`;
const teacherKeyOf = (code: string) => `memeback:teacher:${code}`;

export function rememberPlayer(code: string, playerId: string) {
  try {
    localStorage.setItem(playerKey(code), playerId);
  } catch {
    /* private mode — reconnect just makes a new player */
  }
}

export function recallPlayer(code: string): string | null {
  try {
    return localStorage.getItem(playerKey(code));
  } catch {
    return null;
  }
}

export function rememberTeacherKey(code: string, key: string) {
  try {
    localStorage.setItem(teacherKeyOf(code), key);
  } catch {
    /* ignore */
  }
}

export function recallTeacherKey(code: string): string | null {
  try {
    return localStorage.getItem(teacherKeyOf(code));
  } catch {
    return null;
  }
}

export type JoinAs =
  | { role: 'player'; nickname?: string }
  | { role: 'teacher' }
  | { role: 'screen' };

export type RoomConnection = {
  socket: AppSocket;
  state: RoomState | null;
  connected: boolean;
  playerId: string | null;
  error: string | null;
  /** Join with a nickname — used by the landing form once the student types one. */
  join: (nickname: string) => Promise<void>;
};

/**
 * Connects, joins, and re-joins on every reconnect.
 *
 * The student's identity lives in localStorage, so a dropped phone comes back as
 * the same Player instead of a duplicate in the lobby. Teacher and projector
 * clients authenticate with the room's teacherKey.
 */
export function useRoom(code: string, as: JoinAs): RoomConnection {
  const [state, setState] = useState<RoomState | null>(null);
  const [connected, setConnected] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<AppSocket | null>(null);
  const nicknameRef = useRef<string | undefined>(
    as.role === 'player' ? as.nickname : undefined,
  );

  if (!socketRef.current && typeof window !== 'undefined') {
    socketRef.current = getSocket();
  }

  useEffect(() => {
    if (!code) return;
    const socket = getSocket();
    socketRef.current = socket;

    const doJoin = () => {
      if (as.role === 'screen') {
        socket.emit('room:join', { code, asScreen: true }, (res) => {
          setError(res.ok ? null : res.error);
        });
        return;
      }

      const teacherKey = as.role === 'teacher' ? (recallTeacherKey(code) ?? undefined) : undefined;
      const stored = recallPlayer(code) ?? undefined;

      if (as.role === 'teacher' && !teacherKey) {
        setError('no-teacher-key');
        return;
      }
      if (as.role === 'player' && !stored && !nicknameRef.current) {
        // nothing to join with yet; the form will call join()
        return;
      }

      socket.emit(
        'room:join',
        {
          code,
          nickname: nicknameRef.current,
          playerId: as.role === 'player' ? stored : undefined,
          teacherKey,
        },
        (res) => {
          if (!res.ok) {
            setError(res.error);
            return;
          }
          setError(null);
          if (res.playerId) {
            setPlayerId(res.playerId);
            rememberPlayer(code, res.playerId);
          }
        },
      );
    };

    const onConnect = () => {
      setConnected(true);
      doJoin();
    };
    const onDisconnect = () => setConnected(false);
    const onState = (s: RoomState) => setState(s);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room:state', onState);
    if (socket.connected) onConnect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room:state', onState);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, as.role]);

  const join = async (nickname: string) => {
    nicknameRef.current = nickname;
    const socket = getSocket();
    await new Promise<void>((resolve) => {
      socket.emit(
        'room:join',
        { code, nickname, playerId: recallPlayer(code) ?? undefined },
        (res) => {
          if (res.ok) {
            setError(null);
            if (res.playerId) {
              setPlayerId(res.playerId);
              rememberPlayer(code, res.playerId);
            }
          } else {
            setError(res.error);
          }
          resolve();
        },
      );
    });
  };

  return { socket: socketRef.current ?? getSocket(), state, connected, playerId, error, join };
}
