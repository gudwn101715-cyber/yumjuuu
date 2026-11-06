import { useCallback, useEffect, useRef, useState } from 'react';

export function useGame() {
  const [state, setState] = useState(null);
  const [channels, setChannels] = useState([]);
  const [status, setStatus] = useState('connecting');
  const [messages, setMessages] = useState([]);
  const [notices, setNotices] = useState([]);
  const socketRef = useRef(null);
  const currentChannel = useRef('ch-01');
  const joinedChannel = useRef(null);
  const nameRef = useRef(localStorage.getItem('yeomju-name') || '이름 없는 순례자');
  const notice = useCallback((text, kind = 'info') => {
    const id = crypto.randomUUID();
    setNotices((old) => [...old.slice(-1), { id, text, kind }]);
    setTimeout(
      () => setNotices((old) => old.filter((n) => n.id !== id)),
      kind === 'error' ? 5000 : 3200,
    );
  }, []);

  useEffect(() => {
    let disposed = false;
    let retry;
    let attempts = 0;
    async function connect() {
      if (disposed) return;
      setStatus('connecting');
      try {
        const response = await fetch('/api/session', { credentials: 'same-origin' });
        if (!response.ok) throw new Error('세션을 열지 못했어요');
        await response.json();
        if (disposed) return;
        const socket = new WebSocket(
          `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`,
        );
        socketRef.current = socket;
        socket.onopen = () => {
          if (disposed) return socket.close();
          attempts = 0;
          setStatus('connected');
          setMessages([]);
        };
        socket.onmessage = (event) => {
          if (disposed) return;
          let data;
          try {
            data = JSON.parse(event.data);
          } catch {
            return;
          }
          if (data.type === 'connected') {
            const available = data.channels || [];
            setChannels(available);
            const preferred = available.find((channel) => channel.id === currentChannel.current);
            const target =
              preferred &&
              (preferred.count < preferred.capacity || joinedChannel.current === preferred.id)
                ? preferred
                : available.find((channel) => channel.count < channel.capacity);
            if (target)
              socket.send(
                JSON.stringify({
                  type: 'join',
                  channelId: target.id,
                  name: nameRef.current,
                }),
              );
            else {
              setStatus('full');
              notice('모든 산사가 가득 찼어요. 다른 순례자가 자리를 비우면 입장할 수 있습니다.');
            }
          } else if (data.type === 'state') {
            setStatus('connected');
            if (data.channel?.id && joinedChannel.current !== data.channel.id) {
              setMessages([]);
              joinedChannel.current = data.channel.id;
            }
            setState(data);
            if (data.channel?.id) currentChannel.current = data.channel.id;
          } else if (data.type === 'chat') {
            setMessages((old) => [...old.slice(-49), data]);
          } else if (data.type === 'notice' || data.type === 'error') {
            notice(
              data.text || data.message || '잠시 후 다시 시도해 주세요.',
              data.kind || (data.type === 'error' ? 'error' : 'info'),
            );
            // Another entrant may win the last slot after the initial channel list.
            if (data.code === 'CHANNEL_FULL' && !joinedChannel.current) {
              fetch('/api/channels')
                .then((response) => response.json())
                .then((result) => {
                  if (disposed || socket.readyState !== WebSocket.OPEN) return;
                  const target = (result.channels || []).find(
                    (channel) => channel.count < channel.capacity,
                  );
                  if (target)
                    socket.send(
                      JSON.stringify({
                        type: 'join',
                        channelId: target.id,
                        name: nameRef.current,
                      }),
                    );
                  else setStatus('full');
                })
                .catch(() => setStatus('full'));
            }
          }
        };
        socket.onclose = (event) => {
          if (disposed) return;
          if (event.code === 4001) {
            setStatus('elsewhere');
            notice('다른 창에서 산사에 접속했어요. 이 창에서 다시 시작하려면 새로고침해 주세요.');
            return;
          }
          setStatus('disconnected');
          retry = setTimeout(connect, Math.min(1000 * 2 ** attempts++, 15000));
        };
        socket.onerror = () => socket.close();
      } catch {
        if (!disposed) {
          setStatus('disconnected');
          retry = setTimeout(connect, Math.min(1000 * 2 ** attempts++, 15000));
        }
      }
    }
    async function refresh() {
      try {
        const res = await fetch('/api/channels');
        if (!res.ok) return;
        const data = await res.json();
        if (!disposed) setChannels(Array.isArray(data) ? data : data.channels || []);
      } catch {
        /* The connection status already communicates outages. */
      }
    }
    connect();
    refresh();
    const poll = setInterval(refresh, 4000);
    return () => {
      disposed = true;
      clearTimeout(retry);
      clearInterval(poll);
      socketRef.current?.close();
    };
  }, [notice]);

  const send = useCallback((message) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      return true;
    }
    return false;
  }, []);
  const join = useCallback(
    (channelId) => {
      if (
        !send({
          type: 'join',
          channelId,
          name: nameRef.current,
        })
      ) {
        notice('산사에 다시 연결하고 있어요. 잠시만 기다려 주세요.');
      }
    },
    [send, notice],
  );
  const rename = useCallback(
    (name) => {
      nameRef.current = name.trim().slice(0, 16) || '이름 없는 순례자';
      localStorage.setItem('yeomju-name', nameRef.current);
      send({
        type: 'join',
        channelId: currentChannel.current,
        name: nameRef.current,
      });
    },
    [send],
  );
  return { state, channels, status, messages, notices, notice, send, join, rename };
}
