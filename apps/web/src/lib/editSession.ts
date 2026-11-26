import type { EditorPresence, EditorServerMessage } from '@slides/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { editClientId } from './api.ts';
import { wsBase } from './live.ts';

/**
 * Gemeinsames Bearbeiten im Editor: WebSocket mit Anwesenheit („wer ist wo“) und
 * Hinweisen auf Änderungen anderer. Inhalte kommen nicht über den Socket –
 * bei einem Hinweis lädt der Editor die Präsentation neu (gebündelt).
 */
export function useEditSession(
  presentationId: number,
  onGone: () => void,
): {
  editors: EditorPresence[];
  /** Wer zuletzt welche Folie geändert hat (für Konflikthinweise) */
  lastEditor: Record<number, string>;
  focus: (slideId: number | null) => void;
  connected: boolean;
} {
  const queryClient = useQueryClient();
  const [editors, setEditors] = useState<EditorPresence[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastEditor, setLastEditor] = useState<Record<number, string>>({});
  const socketRef = useRef<WebSocket | null>(null);
  const focusRef = useRef<number | null>(null);
  const goneRef = useRef(onGone);
  goneRef.current = onGone;

  useEffect(() => {
    let closed = false;
    let retry = 0;
    let retryTimer: number | undefined;
    let refetchTimer: number | undefined;
    const refetch = (versions: boolean) => {
      window.clearTimeout(refetchTimer);
      refetchTimer = window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['presentation', presentationId] });
        if (versions) void queryClient.invalidateQueries({ queryKey: ['versions', presentationId] });
      }, 150);
    };
    const connect = () => {
      const socket = new WebSocket(`${wsBase()}/ws?editor=${presentationId}&client=${editClientId}`);
      socketRef.current = socket;
      socket.onopen = () => {
        retry = 0;
        setConnected(true);
        socket.send(JSON.stringify({ type: 'focus', slideId: focusRef.current }));
        // Was während der Trennung passierte, nachladen
        refetch(true);
      };
      socket.onmessage = (event) => {
        let msg: EditorServerMessage;
        try {
          msg = JSON.parse(String(event.data)) as EditorServerMessage;
        } catch {
          return;
        }
        if (msg.type === 'presence') setEditors(msg.editors.filter((e) => e.id !== msg.self));
        else if (msg.type === 'gone') {
          closed = true;
          goneRef.current();
        } else if (msg.type === 'changed') {
          if (msg.by === editClientId) return;
          if (msg.who && msg.slides?.length) {
            setLastEditor((prev) => ({ ...prev, ...Object.fromEntries(msg.slides!.map((id) => [id, msg.who!])) }));
          }
          refetch(!!msg.versions || !!msg.structure || !!msg.source);
        }
      };
      socket.onclose = (event) => {
        setConnected(false);
        setEditors([]);
        if (closed || event.code === 4004 || event.code === 4001) return;
        retryTimer = window.setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry++));
      };
    };
    connect();
    return () => {
      closed = true;
      window.clearTimeout(retryTimer);
      window.clearTimeout(refetchTimer);
      socketRef.current?.close();
    };
  }, [presentationId, queryClient]);

  const focus = useCallback((slideId: number | null) => {
    if (focusRef.current === slideId) return;
    focusRef.current = slideId;
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'focus', slideId }));
  }, []);

  return { editors, lastEditor, focus, connected };
}
