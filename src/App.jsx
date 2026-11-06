import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Bell,
  BellOff,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  Flower2,
  Footprints,
  Gem,
  Leaf,
  Map,
  MessageCircle,
  Mountain,
  Send,
  Settings2,
  Sparkles,
  Sun,
  Menu,
  Volume2,
  VolumeX,
  Wind,
  X,
} from 'lucide-react';
import {
  CHANNELS,
  HALLS,
  ITEMS,
  NODES,
  RARITIES,
  THEMES,
  computeStats,
  bowDropChance,
} from '../shared/game.js';
import { createScene } from './scene.js';
import { createAmbience } from './ambient.js';
import { createMoktakAudio } from './moktakAudio.js';
import { useGame } from './useGame.js';

const STAT_LABELS = { moveSpeed: '이동 속도', bowSpeed: '절 속도', dropRate: '발견 확률' };
const THEME_ICONS = [Wind, Flower2, Leaf, Sparkles, Sun, Mountain, Leaf, Wind, Mountain, Gem];

function BeadLogo({ small = false }) {
  return (
    <span className={`brand-symbol ${small ? 'small' : ''}`} aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => (
        <i key={i} style={{ '--angle': `${i * 40}deg` }} />
      ))}
      <span />
    </span>
  );
}

function BeadArt({ item, size = 42, className = '' }) {
  if (!item) return null;
  return (
    <span
      className={`item-art ${item.type} ${className}`}
      style={{ '--item-color': item.color, width: size, height: size }}
      aria-hidden="true"
    >
      {item.type === 'cord' ? (
        <svg viewBox="0 0 60 60">
          <ellipse
            cx="29"
            cy="26"
            rx="19"
            ry="17"
            fill="none"
            stroke="currentColor"
            strokeWidth="5"
          />
          <ellipse
            cx="29"
            cy="26"
            rx="19"
            ry="17"
            fill="none"
            stroke="#ffffff55"
            strokeWidth="1.5"
            strokeDasharray="2 3"
          />
          <path
            d="M27 42v10m5-10v12m-9-10-3 7m16-7 3 7"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="29" cy="43" r="4" fill="currentColor" />
        </svg>
      ) : (
        <span className="wood-bead">
          <i />
          <b />
        </span>
      )}
    </span>
  );
}

function Bracelet({ inventory = [], equipped, compact = false }) {
  const equippedIds = equipped?.beads || [];
  const beads = equippedIds
    .map((id) => ITEMS[inventory.find((item) => item.id === id)?.defId])
    .filter(Boolean);
  const cord = ITEMS[inventory.find((item) => item.id === equipped?.cord)?.defId];
  const capacity = Math.min(cord?.capacity || 8, 27);
  const slots = Math.max(Math.min(capacity, 18), Math.min(beads.length, 27));
  return (
    <div
      className={`bracelet ${compact ? 'compact' : ''}`}
      aria-label={`${beads.length}개의 염주알을 장착한 염주`}
    >
      <div className="bracelet-shadow" />
      <svg viewBox="0 0 230 210" className="bracelet-string">
        <ellipse
          cx="115"
          cy="97"
          rx="66"
          ry="60"
          fill="none"
          stroke={cord?.color || '#c4aa7d'}
          strokeWidth="3"
        />
        <path
          d="M115 156v24m-4-1-4 17m8-17v20m4-20 4 17"
          fill="none"
          stroke={cord?.color || '#c4aa7d'}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <circle cx="115" cy="165" r="6" fill={cord?.color || '#b69a70'} />
      </svg>
      {Array.from({ length: slots }, (_, i) => {
        const angle = (i / slots) * Math.PI * 2 - Math.PI / 2;
        const item = beads[i];
        return (
          <span
            className={`bracelet-slot ${item ? 'filled' : ''}`}
            key={i}
            style={{
              left: `${50 + Math.cos(angle) * 28.7}%`,
              top: `${46.2 + Math.sin(angle) * 28.6}%`,
              '--item-color': item?.color,
            }}
          >
            {item ? (
              <span className="wood-bead">
                <i />
                <b />
              </span>
            ) : (
              <i />
            )}
          </span>
        );
      })}
      <span className="bracelet-center">
        <small>나만의 작은 우주</small>
        <strong>
          {beads.length}
          <span> / {cord?.capacity || 0}</span>
        </strong>
        <small>이어진 마음</small>
      </span>
    </div>
  );
}

function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const el = ref.current;
    el?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const buttons = [...el.querySelectorAll('button, input, textarea, [tabindex="0"]')].filter(
          (x) => !x.disabled,
        );
        const first = buttons[0],
          last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={ref}
        tabIndex={-1}
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-header">
          <div>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="닫기">
            <X size={21} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function Inventory({ state, send, catalog = false }) {
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const inventory = state?.self?.inventory || [];
  const equipped = state?.self?.equipped || { beads: [] };
  const owned = new Set(inventory.map((i) => i.defId));
  const items = catalog
    ? Object.values(ITEMS).map((item) => ({ id: item.id, defId: item.id }))
    : inventory;
  const visible = items.filter((i) => filter === 'all' || ITEMS[i.defId]?.type === filter);
  const active = visible.find((item) => item.id === selected) || visible[0];
  const definition = ITEMS[active?.defId];
  const isEquipped = active && (equipped.cord === active.id || equipped.beads?.includes(active.id));
  const capacity = state?.self?.stats?.capacity || 0;
  const full = !isEquipped && definition?.type === 'bead' && equipped.beads.length >= capacity;
  return (
    <>
      <div className="inventory-top">
        <div className="tabs">
          {[
            ['all', '전체'],
            ['bead', '염주알'],
            ['cord', '염주띠'],
          ].map(([id, label]) => (
            <button
              className={filter === id ? 'active' : ''}
              onClick={() => {
                setFilter(id);
                setSelected(null);
              }}
              key={id}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="muted small-text">
          {catalog
            ? `${owned.size} / ${Object.keys(ITEMS).length} 발견`
            : `${inventory.length} / 500 보관`}
        </span>
      </div>
      <div className="inventory-layout">
        <div className="inventory-grid">
          {visible.map((instance) => {
            const item = ITEMS[instance.defId];
            const equippedItem =
              equipped.cord === instance.id || equipped.beads?.includes(instance.id);
            return (
              <button
                key={instance.id}
                className={`inventory-item ${active?.id === instance.id ? 'selected' : ''} ${catalog && !owned.has(item.id) ? 'undiscovered' : ''}`}
                onClick={() => setSelected(instance.id)}
                style={{ '--rarity': RARITIES[item.rarity].color }}
              >
                {equippedItem && !catalog && (
                  <span className="equipped-dot">
                    <Check size={10} />
                  </span>
                )}
                <BeadArt item={item} size={55} />
                <span>{item.name}</span>
                <small>{RARITIES[item.rarity].label}</small>
              </button>
            );
          })}
          {!visible.length && (
            <div className="empty-state">
              <Leaf size={28} />
              <p>아직 비어 있어요.</p>
              <small>숲의 선물을 찾거나 법당에서 절해 보세요.</small>
            </div>
          )}
        </div>
        {definition && (
          <aside className="item-details">
            <span className="rarity-tag" style={{ color: RARITIES[definition.rarity].color }}>
              {RARITIES[definition.rarity].label} ·{' '}
              {definition.type === 'bead' ? '염주알' : '염주띠'}
            </span>
            <BeadArt item={definition} size={100} />
            <h3>{definition.name}</h3>
            <p>{definition.description}</p>
            <div className="item-stat-list">
              {definition.capacity && (
                <div>
                  <span>염주알 자리</span>
                  <strong>{definition.capacity}개</strong>
                </div>
              )}
              {Object.entries(definition.stats).map(([stat, value]) => (
                <div key={stat}>
                  <span>{STAT_LABELS[stat]}</span>
                  <strong>+{value}%</strong>
                </div>
              ))}
            </div>
            {catalog ? (
              <div className="catalog-status">
                {owned.has(definition.id) ? (
                  <>
                    <Check size={14} /> 발견한 인연
                  </>
                ) : (
                  '아직 만나지 못한 인연'
                )}
              </div>
            ) : (
              <>
                <button
                  className={`button ${isEquipped ? 'secondary' : 'primary'}`}
                  disabled={full || !state}
                  onClick={() =>
                    send({ type: isEquipped ? 'unequip' : 'equip', itemId: active.id })
                  }
                >
                  {isEquipped
                    ? '염주에서 빼기'
                    : definition.type === 'cord'
                      ? '이 염주띠로 바꾸기'
                      : '염주에 이어 넣기'}
                  <ArrowRight size={16} />
                </button>
                {full && (
                  <small className="capacity-warning">
                    자리가 가득 찼어요. 염주알을 빼거나 더 긴 띠를 장착해 주세요.
                  </small>
                )}
              </>
            )}
          </aside>
        )}
      </div>
      {!catalog && (
        <p className="modal-footnote">
          <Leaf size={13} /> 장착 효과는 합산됩니다. 이동 속도 +75%, 절 속도 +200%, 발견 확률
          +100%까지 적용됩니다.
        </p>
      )}
    </>
  );
}

function Chat({ messages, send, connected }) {
  const [text, setText] = useState('');
  const list = useRef(null);
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [messages]);
  function submit(event) {
    event.preventDefault();
    if (text.trim() && send({ type: 'chat', text: text.trim().slice(0, 160) })) setText('');
  }
  return (
    <section className="chat-card">
      <header>
        <span>
          <MessageCircle size={15} /> 마당 이야기
        </span>
        <i className="live-dot" />
      </header>
      <div className="chat-messages" ref={list} aria-live="polite">
        {messages.length ? (
          messages.map((m, i) => (
            <p key={m.id || i}>
              <strong>{m.name}</strong> {m.text}
            </p>
          ))
        ) : (
          <div className="chat-empty">
            <span>풍경 소리에 귀 기울여 보세요.</span>
            <small>같은 채널의 도반들과 인사를 나눠요.</small>
          </div>
        )}
      </div>
      <form onSubmit={submit}>
        <input
          aria-label="채널 채팅 메시지"
          placeholder="따뜻한 인사 한마디…"
          value={text}
          maxLength={160}
          onChange={(e) => setText(e.target.value)}
          disabled={!connected}
        />
        <button aria-label="메시지 보내기" disabled={!connected || !text.trim()}>
          <Send size={15} />
        </button>
      </form>
    </section>
  );
}

function WorldMap({ state, onHall, onNode }) {
  const self = state?.self;
  return (
    <>
      <p className="map-intro">가고 싶은 법당이나 숲의 선물을 누르면 천천히 걸어갑니다.</p>
      <div className="world-map">
        <div className="map-river" />
        <span className="map-caption">산사 안내도</span>
        {HALLS.map((hall) => (
          <button
            className="map-hall"
            key={hall.id}
            style={{
              left: `${((hall.x + 76) / 152) * 100}%`,
              top: `${((hall.z + 76) / 140) * 100}%`,
            }}
            onClick={() => onHall(hall.id)}
          >
            <span>⌂</span>
            <strong>{hall.name}</strong>
            <small>함께 108배</small>
          </button>
        ))}
        {NODES.map((node) => (
          <button
            key={node.id}
            className="map-node"
            style={{
              left: `${((node.x + 76) / 152) * 100}%`,
              top: `${((node.z + 76) / 140) * 100}%`,
            }}
            onClick={() => onNode(node)}
            title={node.name}
            aria-label={`${node.name}으로 이동`}
          >
            <Leaf size={15} />
          </button>
        ))}
        {self && (
          <span
            className="map-you"
            style={{
              left: `${((self.x + 76) / 152) * 100}%`,
              top: `${((self.z + 76) / 140) * 100}%`,
            }}
          >
            나
          </span>
        )}
      </div>
      <div className="map-key">
        <span>
          <i className="green-key" /> 법당
        </span>
        <span>
          <Leaf size={12} /> 채집 장소
        </span>
        <span>
          <i className="orange-key" /> 내 위치
        </span>
      </div>
    </>
  );
}

function Showcase({ player }) {
  const showcase = player.showcase || {};
  const inventory = [
    { id: 'cord', defId: showcase.cord },
    ...(showcase.beads || []).map((defId, i) => ({ id: `bead-${i}`, defId })),
  ].filter((item) => ITEMS[item.defId]);
  const equipped = {
    cord: 'cord',
    beads: inventory.filter((i) => i.id !== 'cord').map((i) => i.id),
  };
  const stats = computeStats(inventory, equipped);
  return (
    <div className="showcase-content">
      <div className="showcase-user">
        <span className="mini-avatar">◡</span>
        <h3>{player.name}</h3>
      </div>
      <Bracelet inventory={inventory} equipped={equipped} />
      <div className="bracelet-caption">
        <strong>{ITEMS[showcase.cord]?.name || '고요한 빈 손목'}</strong>
        <span>도반의 손목에 이어진 {equipped.beads.length}알의 마음</span>
      </div>
      <div className="stats-list">
        {Object.keys(STAT_LABELS).map((key) => (
          <div key={key}>
            <span>{STAT_LABELS[key]}</span>
            <strong>+{stats[key]}%</strong>
          </div>
        ))}
        <div>
          <span>정성스럽게 올린 절</span>
          <strong>{showcase.bows || 0}회</strong>
        </div>
      </div>
      <p className="modal-footnote">
        다른 도반과 나란히 서서 함께 절해 보세요. 염주는 서로 구경할 수 있으며, 거래 기능은 아직
        없습니다.
      </p>
    </div>
  );
}

function TouchMovement({ onMove }) {
  const [active, setActive] = useState(null);
  const stop = useCallback(() => {
    onMove(0, 0);
    setActive(null);
  }, [onMove]);
  useEffect(() => {
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('blur', stop);
      onMove(0, 0);
    };
  }, [onMove, stop]);
  const directions = [
    ['forward', '앞으로 이동', 0, 1, ChevronUp],
    ['left', '왼쪽으로 이동', -1, 0, ChevronLeft],
    ['right', '오른쪽으로 이동', 1, 0, ChevronRight],
    ['back', '뒤로 이동', 0, -1, ChevronDown],
  ];
  return (
    <div className="touch-movement" aria-label="이동 조작판">
      {directions.map(([id, label, x, z, Icon]) => (
        <button
          className={`${id} ${active === id ? 'pressed' : ''}`}
          key={id}
          aria-label={label}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            onMove(x, z);
            setActive(id);
          }}
          onPointerUp={stop}
          onPointerCancel={stop}
          onLostPointerCapture={stop}
        >
          <Icon size={23} strokeWidth={1.5} />
        </button>
      ))}
      <span className="touch-pad-center" />
    </div>
  );
}

export default function App() {
  const game = useGame();
  const { state, status, channels, send, notice } = game;
  const [modal, setModal] = useState(null);
  const [sound, setSound] = useState(false);
  const [soundLoading, setSoundLoading] = useState(false);
  const [moktakMuted, setMoktakMuted] = useState(
    () => localStorage.getItem('yeomju-moktak-muted') === 'true',
  );
  const [name, setName] = useState(localStorage.getItem('yeomju-name') || '이름 없는 순례자');
  const [sceneError, setSceneError] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [inspectedPlayer, setInspectedPlayer] = useState(null);
  const [quality, setQuality] = useState(() => {
    const saved = localStorage.getItem('yeomju-quality');
    return ['auto', 'high', 'balanced', 'low'].includes(saved) ? saved : 'auto';
  });
  const sceneHost = useRef(null);
  const scene = useRef(null);
  const audio = useRef(null);
  const moktakAudio = useRef(null);
  const moktakMutedRef = useRef(moktakMuted);
  moktakMutedRef.current = moktakMuted;
  const latest = useRef(state);
  latest.current = state;
  const closeModal = useCallback(() => setModal(null), []);
  const moveWithPad = useCallback(
    (strafe, forward) => scene.current?.setMoveInput(strafe, forward),
    [],
  );
  const getMoktakAudio = useCallback(() => {
    if (!moktakAudio.current) {
      moktakAudio.current = createMoktakAudio({ onError: notice });
      moktakAudio.current.setMuted(moktakMutedRef.current);
    }
    return moktakAudio.current;
  }, [notice]);
  const handleSceneInteraction = useCallback(
    (action) => {
      if (action.type === 'prime-audio') {
        void getMoktakAudio().prime();
      } else if (action.type === 'hint') {
        notice(action.message);
      } else if (action.type === 'moktak') {
        // A strike belongs to this browser; it never enters the shared game connection.
        const instrument = getMoktakAudio();
        void instrument.strike();
      } else {
        send(action);
      }
    },
    [getMoktakAudio, send, notice],
  );
  const current = state?.channel || CHANNELS[0];
  const theme = THEMES[current.theme] || THEMES.bamboo;
  const self = state?.self;
  const stats = self?.stats || { moveSpeed: 0, bowSpeed: 0, dropRate: 0, capacity: 8 };
  const inventory = self?.inventory || [];
  const count = state?.players?.length || (self ? 1 : 0);
  const totalBows = self?.bows || 0;
  const discovered = new Set(inventory.map((i) => i.defId)).size;
  const nearbyNode = self && NODES.find((n) => Math.hypot(n.x - self.x, n.z - self.z) <= 6.5);
  const bowing = self?.bowingUntil > (state?.serverTime || Date.now());
  const hasSession = Boolean(self);

  useEffect(() => {
    if (!hasSession) return;
    let disposed = false;
    setSceneReady(false);
    // Let session requests and the first HUD paint run before GPU construction.
    const bootstrap = setTimeout(() => {
      if (disposed) return;
      try {
        scene.current = createScene(sceneHost.current, {
          quality,
          onMove: (x, z) => send({ type: 'move', x, z }),
          onInteract: handleSceneInteraction,
          onInspect: (player) => {
            setInspectedPlayer(player);
            setModal('showcase');
          },
        });
        if (latest.current) scene.current.setState(latest.current);
        setSceneReady(true);
      } catch (error) {
        console.error('Scene initialization failed', error);
        setSceneError(true);
      }
    }, 0);
    return () => {
      disposed = true;
      clearTimeout(bootstrap);
      scene.current?.dispose();
      audio.current?.stop();
    };
  }, [send, hasSession, handleSceneInteraction]);
  useEffect(() => {
    localStorage.setItem('yeomju-moktak-muted', String(moktakMuted));
    moktakAudio.current?.setMuted(moktakMuted);
  }, [moktakMuted]);
  useEffect(
    () => () => {
      moktakAudio.current?.dispose();
      moktakAudio.current = null;
    },
    [],
  );
  useEffect(() => {
    localStorage.setItem('yeomju-quality', quality);
    scene.current?.setQuality?.(quality);
  }, [quality]);
  useEffect(() => {
    if (state) {
      scene.current?.setState(state);
      scene.current?.setTheme(theme.id);
    }
  }, [state, theme.id]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    if (modal) {
      scene.current?.setMoveInput(0, 0);
      if (document.pointerLockElement) document.exitPointerLock();
    }
    if (modal === 'chat') {
      const focus = setTimeout(() => document.querySelector('.game-chat input')?.focus(), 0);
      return () => clearTimeout(focus);
    }
  }, [modal]);

  useEffect(() => {
    const shortcuts = (event) => {
      if (event.key === 'Escape') {
        if (document.pointerLockElement) return;
        if (!modal) {
          event.preventDefault();
          setModal('menu');
        }
        return;
      }
      if (
        modal ||
        event.defaultPrevented ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) ||
        document.activeElement?.isContentEditable
      )
        return;
      const key = event.key.toLowerCase();
      if (!['m', 'i', 'enter', '?'].includes(key)) return;
      event.preventDefault();
      if (key === 'm') setModal('map');
      else if (key === 'i') setModal('inventory');
      else if (key === '?') setModal('help');
      else setModal('chat');
    };
    document.addEventListener('keydown', shortcuts);
    return () => document.removeEventListener('keydown', shortcuts);
  }, [modal]);

  async function toggleSound() {
    // A second click also cancels a recording that is still loading.
    if (audio.current) {
      const currentAudio = audio.current;
      audio.current = null;
      currentAudio.stop();
      setSound(false);
      setSoundLoading(false);
      return;
    }
    const recording = createAmbience({
      onError: (message) => {
        if (audio.current !== recording) return;
        audio.current = null;
        recording.stop();
        setSound(false);
        setSoundLoading(false);
        notice(message, 'error');
      },
    });
    if (!recording) return notice('이 브라우저에서는 배경음을 재생할 수 없어요.', 'error');
    audio.current = recording;
    setSoundLoading(true);
    const playing = await recording.play();
    if (audio.current === recording) {
      setSoundLoading(false);
      setSound(playing);
      if (!playing) {
        audio.current = null;
        recording.stop();
      }
    }
  }
  function toggleMoktakSound() {
    const nextMuted = !moktakMuted;
    moktakMutedRef.current = nextMuted;
    const instrument = getMoktakAudio();
    instrument.setMuted(nextMuted);
    if (!nextMuted) void instrument.prime();
    setMoktakMuted(nextMuted);
  }
  function visitHall(id = 'hall-main') {
    scene.current?.focusHall(id);
    if (!self) notice('연결이 완료되면 법당으로 이동할 수 있어요.');
    closeModal();
  }
  function bow() {
    if (!self || status !== 'connected')
      return notice('산사에 연결하고 있어요. 잠시만 기다려 주세요.');
    scene.current?.requestBow();
  }
  function offerIncense() {
    scene.current?.queueIncense();
    closeModal();
  }
  function leaveIncense() {
    scene.current?.cancelAutowalk();
    send({ type: 'leaveIncense' });
  }
  function gather() {
    if (nearbyNode) send({ type: 'gather', nodeId: nearbyNode.id });
    else notice('반짝이는 숲의 선물을 눌러 다가가거나, 가까이에서 E를 눌러 주세요.');
  }
  function goNode(node) {
    if (scene.current?.focusNode) scene.current.focusNode(node.id);
    else send({ type: 'move', x: node.x, z: node.z });
    closeModal();
  }

  const queued = Boolean(self?.incenseStationId);
  const offering = self?.incenseOfferingUntil > (state?.serverTime || Date.now());
  const incenseStation = state?.incenseStations?.find(
    (station) => station.id === self?.incenseStationId,
  );
  const queuePosition = Number.isInteger(self?.incenseQueueIndex) ? self.incenseQueueIndex + 1 : 1;
  const connected = status === 'connected';

  return (
    <div className="game-screen">
      <main className="game-viewport" aria-label="염주 온라인 게임 화면">
        <div className="world-canvas" ref={sceneHost} />
        {sceneError && (
          <div className="scene-error">
            <Mountain size={32} />
            <strong>3D 산사를 열지 못했어요.</strong>
            <p>WebGL을 지원하는 Chrome 또는 Edge에서 다시 열어 주세요.</p>
            <button className="button secondary" onClick={() => location.reload()}>
              다시 열기
            </button>
          </div>
        )}
        {(!state || !sceneReady) && !sceneError && (
          <div className="connecting-overlay">
            <BeadLogo />
            <strong>
              {status === 'full'
                ? '산사의 빈자리를 기다려 주세요'
                : status === 'elsewhere'
                  ? '다른 창에서 접속 중입니다'
                  : '산사에 들어가는 중…'}
            </strong>
            <small>
              {status === 'elsewhere'
                ? '이 창에서 플레이하려면 새로고침해 주세요.'
                : status === 'disconnected'
                  ? '서버에 다시 연결하고 있습니다.'
                  : '잠시만 기다려 주세요.'}
            </small>
          </div>
        )}
        <div className="game-top-left">
          <button
            className="game-channel"
            onClick={() => setModal('channels')}
            aria-label="채널 선택"
          >
            <i className={`game-connection ${status}`} />
            <span>{theme.name}</span>
            <small>{count}/108</small>
            <ChevronDown size={12} />
          </button>
        </div>
        <div className="game-top-right">
          <button
            className="game-icon"
            onClick={() => setModal('inventory')}
            aria-label="염주함 열기"
            title="염주함 · I"
          >
            <Gem size={19} />
          </button>
          <button
            className="game-icon"
            onClick={() => setModal('menu')}
            aria-label="게임 메뉴 열기"
            title="메뉴 · Esc"
          >
            <Menu size={19} />
          </button>
        </div>
        <TouchMovement onMove={moveWithPad} />
        {!modal && self && (
          <div className="game-bottom">
            {bowing ? (
              <div className="game-action-status" role="status">
                절을 올리는 중…
              </div>
            ) : queued ? (
              <div className="game-action-status" role="status">
                {offering
                  ? `향을 올리는 중 · ${Math.max(1, Math.ceil((self.incenseOfferingUntil - (state?.serverTime || Date.now())) / 1000))}초`
                  : `향 공양 ${queuePosition}번째${incenseStation?.queue ? ` · 줄 ${incenseStation.queue.length}명` : ''}`}
              </div>
            ) : self.gassho ? (
              <div className="game-action-status">두 손을 모아 합장합니다</div>
            ) : null}
            <div className="game-actions" aria-label="수행 동작">
              <button
                className={`game-action ${self.gassho ? 'selected' : ''}`}
                onClick={() => send({ type: 'gassho' })}
                disabled={!connected || bowing || queued}
                aria-label={self.gassho ? '합장 풀기' : '합장하기'}
                aria-pressed={Boolean(self.gassho)}
              >
                <Flower2 size={16} />
                <span>합장</span>
                <kbd>G</kbd>
              </button>
              <button
                className="game-action"
                onClick={bow}
                disabled={!connected || bowing || queued}
                aria-label="절하기"
              >
                <Footprints size={16} />
                <span>절하기</span>
                <kbd>Space</kbd>
              </button>
              {queued ? (
                <button
                  className="game-action"
                  onClick={leaveIncense}
                  disabled={offering}
                  aria-label="대기 취소"
                >
                  <X size={15} />
                  <span>대기 취소</span>
                </button>
              ) : (
                <button
                  className="game-action"
                  onClick={offerIncense}
                  disabled={!connected || bowing}
                  aria-label="향 공양하기"
                >
                  <Wind size={16} />
                  <span>향 공양</span>
                </button>
              )}
              {self.seatId && (
                <button
                  className="game-action"
                  onClick={() => scene.current?.strikeMoktak()}
                  disabled={!connected || bowing}
                  aria-label="목탁 두드리기"
                  title="본인에게만 들려요"
                >
                  <Bell size={16} />
                  <span>목탁</span>
                  <kbd>F</kbd>
                </button>
              )}
              {self.seatId && (
                <button
                  className="game-action game-action-icon"
                  onClick={() => send({ type: 'stand' })}
                  disabled={!connected || bowing}
                  aria-label="일어나기"
                  title="일어나기"
                >
                  <Footprints size={16} />
                </button>
              )}
              {nearbyNode && !self.seatId && !queued && (
                <button
                  className="game-action"
                  onClick={gather}
                  disabled={!connected}
                  aria-label="가까운 선물 줍기"
                >
                  <Leaf size={16} />
                  <span>줍기</span>
                  <kbd>E</kbd>
                </button>
              )}
            </div>
          </div>
        )}
      </main>

      <div className="toasts" role="status" aria-live="polite">
        {game.notices.map((n) => (
          <div className={`toast ${n.kind}`} key={n.id}>
            <Leaf size={17} />
            <span>{n.text}</span>
          </div>
        ))}
      </div>

      {(modal === 'inventory' || modal === 'catalog') && (
        <Modal title={modal === 'catalog' ? '인연 도감' : '나의 염주함'} wide onClose={closeModal}>
          <Inventory state={state} send={send} catalog={modal === 'catalog'} />
        </Modal>
      )}
      {modal === 'showcase' && inspectedPlayer && (
        <Modal title="도반의 염주 구경" onClose={closeModal}>
          <Showcase player={inspectedPlayer} />
        </Modal>
      )}
      {modal === 'channels' && (
        <Modal title="어느 산사에 머물까요?" wide onClose={closeModal}>
          <p className="modal-intro">
            저마다 다른 빛과 재료를 품은 열 곳의 산사. 염주와 수행 기록은 어디서든 함께합니다.
          </p>
          <div className="channel-grid">
            {CHANNELS.map((channel, index) => {
              const th = THEMES[channel.theme];
              const Icon = THEME_ICONS[index];
              const live = channels.find((c) => c.id === channel.id);
              const population = live?.count ?? live?.population ?? 0;
              return (
                <button
                  className={`channel-tile ${current.id === channel.id ? 'current' : ''}`}
                  key={channel.id}
                  disabled={population >= 108 && current.id !== channel.id}
                  onClick={() => {
                    game.join(channel.id);
                    closeModal();
                  }}
                  style={{ '--theme': th.color, '--theme-light': th.accent }}
                >
                  <span className="channel-tile-top">
                    <Icon size={22} strokeWidth={1.4} />
                    <small>CH. {String(channel.number).padStart(2, '0')}</small>
                    {current.id === channel.id && <Check size={16} />}
                  </span>
                  <strong>{channel.name}</strong>
                  <p>{th.subtitle}</p>
                  <span className="channel-tile-bottom">
                    <span>
                      <i className="live-dot" />
                      {population >= 108
                        ? '가득 참'
                        : current.id === channel.id
                          ? '머무는 중'
                          : '입장 가능'}
                    </span>
                    <span>{population} / 108</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Modal>
      )}
      {modal === 'map' && (
        <Modal title="느리게 걷는 산사" wide onClose={closeModal}>
          <WorldMap state={state} onHall={visitHall} onNode={goNode} />
        </Modal>
      )}
      {modal === 'drops' && (
        <Modal title={`${theme.name}의 선물`} wide onClose={closeModal}>
          <p className="modal-intro">
            숲의 선물을 줍거나 법당에서 절하면 아래 재료를 만날 수 있어요. 채널을 옮기면 드롭 목록도
            달라집니다.
          </p>
          <div className="drop-grid">
            {theme.loot.map((id) => {
              const item = ITEMS[id];
              return (
                <div className="drop-list-item" key={id}>
                  <BeadArt item={item} size={46} />
                  <div>
                    <strong>{item.name}</strong>
                    <span style={{ color: RARITIES[item.rarity].color }}>
                      {RARITIES[item.rarity].label}
                      {item.capacity ? ` · ${item.capacity}알` : ''}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="modal-footnote">
            채집은 재료 1개를 보장합니다. 절의 기본 개인 드롭 확률은 8%이며 발견 확률 능력치로 최대
            20%까지 높아집니다. 지금 내 확률은 {Math.round(bowDropChance(stats) * 100)}%입니다. 공동
            108배 보상은 해당 법당 주변의 참여자에게 지급됩니다.
          </p>
        </Modal>
      )}
      {modal === 'menu' && (
        <Modal title="게임 메뉴" onClose={closeModal}>
          <div className="game-menu-grid">
            <button onClick={() => setModal('map')} aria-label="산사 지도 열기">
              <Map size={19} />
              <span>산사 지도</span>
              <kbd>M</kbd>
            </button>
            <button onClick={() => setModal('chat')} aria-label="마당 이야기 열기">
              <MessageCircle size={19} />
              <span>마당 이야기</span>
              <kbd>Enter</kbd>
            </button>
            <button
              onClick={() => {
                setName(self?.name || name);
                setModal('profile');
              }}
              aria-label="순례자 이름 변경"
            >
              <Settings2 size={19} />
              <span>나의 이름</span>
            </button>
            <button onClick={() => setModal('drops')}>
              <Leaf size={19} />
              <span>드롭 목록</span>
            </button>
            <button onClick={() => setModal('catalog')}>
              <BookOpen size={19} />
              <span>인연 도감</span>
            </button>
            <button onClick={() => setModal('help')} aria-label="도움말 열기">
              <CircleHelp size={19} />
              <span>조작 안내</span>
              <kbd>?</kbd>
            </button>
          </div>
          <div className="game-settings">
            <label htmlFor="game-quality">
              화질
              <select
                id="game-quality"
                aria-label="그래픽 품질"
                value={quality}
                onChange={(event) => setQuality(event.target.value)}
              >
                <option value="auto">자동</option>
                <option value="high">높음</option>
                <option value="balanced">보통</option>
                <option value="low">낮음</option>
              </select>
            </label>
            <button
              onClick={toggleSound}
              aria-label={
                soundLoading ? '배경음 불러오기 취소' : sound ? '배경음 끄기' : '배경음 켜기'
              }
            >
              {sound ? <Volume2 size={17} /> : <VolumeX size={17} />}독경·염불{' '}
              <strong>{soundLoading ? '불러오는 중' : sound ? '켜짐' : '꺼짐'}</strong>
            </button>
            <button
              onClick={toggleMoktakSound}
              aria-label={moktakMuted ? '목탁 소리 켜기' : '목탁 소리 끄기'}
            >
              {moktakMuted ? <BellOff size={17} /> : <Bell size={17} />}내 목탁 소리{' '}
              <strong>{moktakMuted ? '꺼짐' : '켜짐'}</strong>
            </button>
          </div>
          <a
            className="game-audio-credits"
            href="/audio/credits.txt"
            target="_blank"
            rel="noopener noreferrer"
          >
            음원 출처
          </a>
          <p className="game-menu-record">
            {self?.name || name} · 누적 절 {totalBows}회 · 재료 {inventory.length}개
          </p>
          <button className="button secondary full-width" onClick={closeModal}>
            게임으로 돌아가기
          </button>
        </Modal>
      )}
      {modal === 'chat' && (
        <Modal title="마당 이야기" onClose={closeModal}>
          <div className="game-chat">
            <Chat messages={game.messages} send={send} connected={connected} />
          </div>
        </Modal>
      )}
      {modal === 'help' && (
        <Modal title="조작 안내" onClose={closeModal}>
          <div className="game-help-controls">
            <p>
              <kbd>WASD</kbd>
              <span>이동 · Shift를 누르면 빠른 걸음</span>
            </p>
            <p>
              <kbd>드래그</kbd>
              <span>게임 배경 아무 곳이나 누른 채 움직여 둘러보기</span>
            </p>
            <p>
              <kbd>클릭</kbd>
              <span>땅으로 걷기 · 방석에 앉기 · 물건과 상호작용</span>
            </p>
            <p>
              <kbd>Space</kbd>
              <span>빈 방석으로 자동 이동한 뒤 절 한 번</span>
            </p>
            <p>
              <kbd>G</kbd>
              <span>합장하기 / 합장 풀기</span>
            </p>
            <p>
              <kbd>E</kbd>
              <span>가까운 방석·채집물과 상호작용</span>
            </p>
            <p>
              <kbd>F</kbd>
              <span>앉은 자리의 목탁 · 소리는 나에게만 들려요</span>
            </p>
            <p>
              <kbd>I / M</kbd>
              <span>염주함 / 산사 지도</span>
            </p>
            <p>
              <kbd>Enter</kbd>
              <span>같은 채널의 도반과 대화</span>
            </p>
            <p>
              <kbd>Esc</kbd>
              <span>메뉴 열기 / 열린 창 닫기</span>
            </p>
          </div>
          <p className="modal-footnote">
            합장은 보상 없이 두 손을 모으는 동작입니다. 절은 방석에서 무릎을 꿇고 몸을 숙이며, 개인
            재료는 기본 8% 확률로 지급됩니다. 발견 확률 장비로 최대 20%까지 높일 수 있습니다.
          </p>
          <p className="modal-footnote">
            향 공양을 누르면 향로 대기줄로 걸어갑니다. 차례가 오면 향을 올린 뒤 다음 도반에게 자리를
            양보합니다. 대기 중에는 ‘대기 취소’로 줄을 나올 수 있습니다.
          </p>
          <button className="button primary full-width" onClick={closeModal}>
            게임으로 돌아가기
          </button>
        </Modal>
      )}
      {modal === 'profile' && (
        <Modal title="나의 순례자를 정해요" onClose={closeModal}>
          <form
            className="profile-form"
            onSubmit={(event) => {
              event.preventDefault();
              game.rename(name);
              closeModal();
            }}
          >
            <label htmlFor="pilgrim-name">순례자의 이름</label>
            <input
              id="pilgrim-name"
              autoComplete="nickname"
              maxLength={16}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="16자 이내로 적어 주세요"
            />
            <p>같은 채널의 도반들에게 보이는 이름이에요.</p>
            <div className="profile-record">
              <span>
                지금까지 올린 절 <strong>{totalBows}회</strong>
              </span>
              <span>
                만난 재료 <strong>{discovered}종</strong>
              </span>
            </div>
            <button className="button primary full-width" type="submit" disabled={!name.trim()}>
              이 이름으로 머물기 <Check size={16} />
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
