import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  BellOff,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  Compass,
  Feather,
  Flower2,
  Footprints,
  Gem,
  Leaf,
  Map,
  Maximize2,
  MessageCircle,
  Minimize2,
  Minus,
  MousePointer2,
  Mountain,
  Plus,
  Send,
  Settings2,
  Sparkles,
  Sun,
  Users,
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
  WORLD,
  computeStats,
} from '../shared/game.js';
import { createScene } from './scene.js';
import { createAmbience } from './ambient.js';
import { createMoktakAudio } from './moktakAudio.js';
import { useGame } from './useGame.js';
import { SEATS } from '../shared/templeLayout.js';

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

function Modal({ title, eyebrow, children, onClose, wide = false }) {
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
            <span className="eyebrow">{eyebrow}</span>
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

function MiniMap({ state, onOpen }) {
  const point = (x, z) => ({
    x: 12 + ((x - WORLD.minX) / (WORLD.maxX - WORLD.minX)) * 136,
    y: 12 + ((z - WORLD.minZ) / (WORLD.maxZ - WORLD.minZ)) * 136,
  });
  const self = state?.self;
  const position = self && point(self.x, self.z);
  return (
    <button className="hud-minimap" aria-label="산사 지도 열기" onClick={onOpen}>
      <span className="minimap-north">N</span>
      <svg viewBox="0 0 160 160" aria-hidden="true">
        <defs>
          <radialGradient id="map-terrain">
            <stop stopColor="#71836a" />
            <stop offset="1" stopColor="#354a3c" />
          </radialGradient>
        </defs>
        <circle cx="80" cy="80" r="77" fill="url(#map-terrain)" />
        <path
          d="M17 116Q50 101 79 117T149 108"
          fill="none"
          stroke="#91b2a6"
          strokeWidth="9"
          opacity=".5"
        />
        <path
          d="M80 146L80 15M28 57L80 41L132 57M27 55L45 85L79 110L123 88L134 56"
          fill="none"
          stroke="#e3d8b5"
          strokeWidth="3"
          opacity=".6"
        />
        {NODES.map((node) => {
          const p = point(node.x, node.z);
          return <circle key={node.id} cx={p.x} cy={p.y} r="1.6" fill="#d7d4ac" opacity=".7" />;
        })}
        {HALLS.map((hall) => {
          const p = point(hall.x, hall.z);
          return (
            <g key={hall.id}>
              <path d={`M${p.x - 5} ${p.y}l5-3 5 3v4h-10z`} fill="#f0e4c5" />
              <text x={p.x} y={p.y + 12} textAnchor="middle" fill="#e7e4d2" fontSize="5.5">
                {hall.name}
              </text>
            </g>
          );
        })}
        {position && (
          <g>
            <circle cx={position.x} cy={position.y} r="7" fill="#f9e7b2" opacity=".15" />
            <circle
              cx={position.x}
              cy={position.y}
              r="3"
              fill="#f8e8bb"
              stroke="#fffef5"
              strokeWidth="1.3"
            />
          </g>
        )}
        <circle
          cx="80"
          cy="80"
          r="77"
          fill="none"
          stroke="#e1dfc7"
          strokeWidth=".8"
          opacity=".45"
        />
      </svg>
      <span className="minimap-caption">
        <Map size={11} /> 산사 안내도 <span>M</span>
      </span>
    </button>
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
  const [moktakMuted, setMoktakMuted] = useState(
    () => localStorage.getItem('yeomju-moktak-muted') === 'true',
  );
  const [name, setName] = useState(localStorage.getItem('yeomju-name') || '이름 없는 순례자');
  const [gender, setGender] = useState('male');
  const [sceneError, setSceneError] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [inspectedPlayer, setInspectedPlayer] = useState(null);
  const [immersive, setImmersive] = useState(true);
  const [lookLocked, setLookLocked] = useState(false);
  const [lookPrompt, setLookPrompt] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
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
      moktakAudio.current = createMoktakAudio();
      moktakAudio.current.setMuted(moktakMutedRef.current);
    }
    return moktakAudio.current;
  }, []);
  const handleSceneInteraction = useCallback(
    (action) => {
      if (action.type === 'prime-audio') {
        void getMoktakAudio().prime();
      } else if (action.type === 'moktak') {
        // A strike belongs to this browser; it never enters the shared game connection.
        const instrument = getMoktakAudio();
        void instrument.prime();
        void instrument.strike();
      } else {
        send(action);
      }
    },
    [getMoktakAudio, send],
  );
  const current = state?.channel || CHANNELS[0];
  const theme = THEMES[current.theme] || THEMES.bamboo;
  const self = state?.self;
  const stats = self?.stats || { moveSpeed: 0, bowSpeed: 0, dropRate: 0, capacity: 8 };
  const inventory = self?.inventory || [];
  const equipped = self?.equipped;
  const equippedCord = ITEMS[inventory.find((i) => i.id === equipped?.cord)?.defId];
  const count = state?.players?.length || (self ? 1 : 0);
  const hallStates = state?.halls || [];
  const mainHall = hallStates.find((h) => h.id === 'hall-main');
  const totalBows = self?.bows || 0;
  const discovered = new Set(inventory.map((i) => i.defId)).size;
  const nearbyHall = self && HALLS.find((h) => Math.hypot(h.x - self.x, h.z - self.z) <= h.radius);
  const nearbyNode = self && NODES.find((n) => Math.hypot(n.x - self.x, n.z - self.z) <= 6.5);
  const occupiedSeats = new Set(
    (state?.players || []).map((player) => player.seatId).filter(Boolean),
  );
  const nearbySeat =
    self && !self.seatId
      ? SEATS.reduce((nearest, seat) => {
          if (occupiedSeats.has(seat.id)) return nearest;
          const distance = Math.hypot(seat.x - self.x, seat.z - self.z);
          return distance <= 1.8 && (!nearest || distance < nearest.distance)
            ? { ...seat, distance }
            : nearest;
        }, null)
      : null;
  const currentHall = nearbyHall && hallStates.find((hall) => hall.id === nearbyHall.id);
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
    const updateLook = () => {
      setLookLocked(document.pointerLockElement === sceneHost.current?.querySelector('canvas'));
    };
    document.addEventListener('pointerlockchange', updateLook);
    return () => document.removeEventListener('pointerlockchange', updateLook);
  }, []);

  useEffect(() => {
    if (!immersive) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const exitView = (event) => {
      if (event.key === 'Escape' && !document.pointerLockElement && !modal) {
        if (chatOpen) setChatOpen(false);
        else setImmersive(false);
      }
    };
    document.addEventListener('keydown', exitView);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', exitView);
    };
  }, [immersive, modal, chatOpen]);

  useEffect(() => {
    if (modal) {
      scene.current?.setMoveInput(0, 0);
      if (document.pointerLockElement) document.exitPointerLock();
    }
  }, [modal]);

  useEffect(() => {
    const shortcuts = (event) => {
      if (
        !immersive ||
        modal ||
        event.defaultPrevented ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) ||
        document.activeElement?.isContentEditable
      )
        return;
      const key = event.key.toLowerCase();
      if (!['m', 'i', 'enter'].includes(key)) return;
      event.preventDefault();
      if (document.pointerLockElement) document.exitPointerLock();
      if (key === 'm') setModal('map');
      else if (key === 'i') setModal('inventory');
      else {
        setChatOpen(true);
        setTimeout(() => document.querySelector('.hud-chat input')?.focus(), 0);
      }
    };
    document.addEventListener('keydown', shortcuts);
    return () => document.removeEventListener('keydown', shortcuts);
  }, [immersive, modal]);

  function toggleImmersive() {
    if (document.pointerLockElement) document.exitPointerLock();
    setImmersive((value) => !value);
  }

  async function toggleLook() {
    setLookPrompt(false);
    if (document.pointerLockElement) document.exitPointerLock();
    else {
      const enabled = await scene.current?.requestLook();
      if (enabled === false) notice('우클릭 드래그로 주변을 둘러볼 수 있어요.');
    }
  }

  function toggleSound() {
    if (sound) {
      audio.current?.stop();
      audio.current = null;
      setSound(false);
    } else {
      audio.current = createAmbience();
      if (audio.current) setSound(true);
      else notice('이 브라우저에서는 배경음을 재생할 수 없어요.');
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
    if (nearbyHall) send({ type: 'bow', hallId: nearbyHall.id });
    else {
      visitHall();
      notice('대웅전으로 걸어갑니다. 도착하면 첫 절을 올려요.');
    }
  }
  function findSeat() {
    if (!self || !nearbyHall) return;
    const seat = SEATS.reduce((nearest, candidate) => {
      if (candidate.hallId !== nearbyHall.id || occupiedSeats.has(candidate.id)) return nearest;
      const distance = Math.hypot(candidate.x - self.x, candidate.z - self.z);
      return !nearest || distance < nearest.distance ? { ...candidate, distance } : nearest;
    }, null);
    if (seat) scene.current?.focusSeat(seat.id);
    else notice('이 법당의 방석이 모두 사용 중이에요. 잠시 뒤 다시 찾아 주세요.');
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

  return (
    <div className={`app-shell ${immersive ? 'immersive-mode' : ''}`}>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="염주 온라인 홈">
          <BeadLogo />
          <span>
            <strong>염주 온라인</strong>
            <small>YEOMJU ONLINE</small>
          </span>
        </a>
        <span className="sidebar-label">나만의 느린 여행</span>
        <nav aria-label="주 메뉴">
          <button
            aria-label="산사 둘러보기"
            className={`nav-item ${!modal ? 'active' : ''}`}
            onClick={closeModal}
          >
            <Compass size={19} />
            <span>산사 둘러보기</span>
            <i />
          </button>
          <button
            aria-label="나의 염주함"
            className={`nav-item ${modal === 'inventory' ? 'active' : ''}`}
            onClick={() => setModal('inventory')}
          >
            <Gem size={19} />
            <span>나의 염주함</span>
            <span className="nav-count">{inventory.length}</span>
          </button>
          <button
            aria-label="인연 도감"
            className={`nav-item ${modal === 'catalog' ? 'active' : ''}`}
            onClick={() => setModal('catalog')}
          >
            <BookOpen size={19} />
            <span>인연 도감</span>
          </button>
          <button
            aria-label="산사 안내도"
            className={`nav-item ${modal === 'map' ? 'active' : ''}`}
            onClick={() => setModal('map')}
          >
            <Map size={19} />
            <span>산사 안내도</span>
          </button>
        </nav>
        <div className="sidebar-divider" />
        <div className="channel-heading">
          <span className="sidebar-label">함께 머무는 곳</span>
          <span className="tiny-badge">10</span>
        </div>
        <div className="sidebar-channels">
          {CHANNELS.slice(0, 4).map((channel, index) => {
            const Icon = THEME_ICONS[index];
            const c = channels.find((ch) => ch.id === channel.id);
            return (
              <button
                className={`channel-link ${current.id === channel.id ? 'selected' : ''}`}
                key={channel.id}
                onClick={() => game.join(channel.id)}
              >
                <span className="channel-icon" style={{ '--theme': THEMES[channel.theme].color }}>
                  <Icon size={15} />
                </span>
                <span>
                  <strong>{channel.name}</strong>
                  <small>CH. {String(channel.number).padStart(2, '0')}</small>
                </span>
                {current.id === channel.id ? (
                  <span className="live-dot" />
                ) : (
                  <small className="channel-population">{c?.count ?? c?.population ?? 0}</small>
                )}
              </button>
            );
          })}
        </div>
        <button className="all-channels" onClick={() => setModal('channels')}>
          모든 산사 보기 <ChevronRight size={14} />
        </button>
        <div className="sidebar-note">
          <Leaf size={21} strokeWidth={1.3} />
          <p>
            서두르지 않아도 괜찮아요.
            <br />
            당신의 속도로 머물러요.
          </p>
          <small>작은 마음이 모이는 곳</small>
          <span className="note-line" />
        </div>
        <button
          aria-label="순례자 이름 변경"
          className="sidebar-profile"
          onClick={() => {
            setName(self?.name || name);
            setGender(self?.gender === 'female' ? 'female' : 'male');
            setModal('profile');
          }}
        >
          <span className="mini-avatar">◡</span>
          <span>
            <strong>{self?.name || name}</strong>
            <small>마음을 잇는 순례자</small>
          </span>
          <Settings2 size={15} />
        </button>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            <Leaf size={14} />
            <span>산사의 하루</span>
            <ChevronRight size={12} />
            <strong>{theme.name}</strong>
          </div>
          <div className="topbar-actions">
            <span className={`connection-status ${status}`}>
              <i />
              {status === 'connected'
                ? '평온하게 연결됨'
                : status === 'connecting'
                  ? '산사에 연결 중'
                  : status === 'elsewhere'
                    ? '다른 창에서 접속 중'
                    : status === 'full'
                      ? '모든 산사 정원 마감'
                      : '다시 연결하는 중'}
            </span>
            <span className="topbar-line" />
            <button
              className={`icon-button ${sound ? 'sound-on' : ''}`}
              onClick={toggleSound}
              aria-label={sound ? '배경음 끄기' : '배경음 켜기'}
              title={sound ? '배경음 끄기' : '배경음 켜기'}
            >
              {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
            <button
              className={`icon-button moktak-toggle ${moktakMuted ? 'is-muted' : ''}`}
              onClick={toggleMoktakSound}
              aria-label={moktakMuted ? '목탁 소리 켜기' : '목탁 소리 끄기'}
              aria-pressed={!moktakMuted}
              title={`${moktakMuted ? '목탁 소리 켜기' : '목탁 소리 끄기'} · 나에게만 들려요`}
            >
              {moktakMuted ? <BellOff size={18} /> : <Bell size={18} />}
            </button>
            <button
              className="icon-button"
              onClick={() => setModal('help')}
              aria-label="게임 도움말"
            >
              <CircleHelp size={18} />
            </button>
          </div>
        </header>
        <section className="page-heading">
          <div>
            <span className="eyebrow">A LITTLE PEACE, TOGETHER</span>
            <h1>오늘도, 마음 한 알.</h1>
            <p>숲을 거닐고 마음을 모아, 나만의 염주를 이어가요.</p>
          </div>
          <div className="day-stamp">
            <Sun size={22} strokeWidth={1.3} />
            <div>
              <span>산사의 느린 오후</span>
              <small>마음이 쉬어가는 시간</small>
            </div>
          </div>
        </section>

        <div className="game-layout">
          <div className="world-column">
            <section className="world-card" aria-label="3D 사찰 게임 월드">
              <div className="world-canvas" ref={sceneHost} />
              {sceneError && (
                <div className="scene-error">
                  <Mountain size={32} />
                  <strong>3D 산사를 열지 못했어요.</strong>
                  <p>WebGL을 지원하는 브라우저에서 다시 열어 주세요.</p>
                  <button className="button secondary" onClick={() => location.reload()}>
                    다시 열기
                  </button>
                </div>
              )}
              {(!state || !sceneReady) && !sceneError && (
                <div className="connecting-overlay">
                  <BeadLogo />
                  <strong>
                    {status === 'full' ? '잠시 쉬어가는 시간' : '고요한 산사를 열고 있어요'}
                  </strong>
                  <small>
                    {status === 'full'
                      ? '모든 산사가 가득 찼어요. 빈자리가 나면 입장해 주세요.'
                      : status === 'disconnected'
                        ? '서버 연결을 다시 시도하고 있습니다.'
                        : '잠시만 마음을 내려놓아요.'}
                  </small>
                  <button className="button secondary" onClick={() => setModal('channels')}>
                    다른 산사 살펴보기 <ArrowRight size={14} />
                  </button>
                </div>
              )}
              <div className="world-top">
                <div className="world-identity">
                  {immersive && (
                    <button
                      className="game-wordmark"
                      onClick={() => setModal('help')}
                      aria-label="염주 온라인 안내"
                    >
                      <BeadLogo />
                      <span>
                        <strong>염주 온라인</strong>
                        <small>YEOMJU ONLINE</small>
                      </span>
                    </button>
                  )}
                  <button className="world-channel" onClick={() => setModal('channels')}>
                    <span className={`hud-connection ${status}`} />
                    <span>CH. {String(current.number || 1).padStart(2, '0')}</span>
                    <b>{theme.name}</b>
                    <ChevronDown size={13} />
                    <span className="world-player-count">
                      <Users size={12} /> {count} / 108
                    </span>
                  </button>
                </div>
                <div className="world-top-actions">
                  <span className="weather">
                    <Sun size={14} />{' '}
                    {theme.id === 'snow' ? '눈' : theme.id === 'mist' ? '안개' : '맑음'} <i />{' '}
                    {theme.id === 'moon' ? '밤' : theme.id === 'dawn' ? '새벽' : '낮'}
                  </span>
                  {immersive && (
                    <>
                      <button
                        className="hud-icon-button"
                        onClick={toggleSound}
                        aria-label={sound ? '배경음 끄기' : '배경음 켜기'}
                        title={sound ? '배경음 끄기' : '배경음 켜기'}
                      >
                        {sound ? <Volume2 size={17} /> : <VolumeX size={17} />}
                      </button>
                      <button
                        className={`hud-icon-button moktak-toggle ${moktakMuted ? 'is-muted' : ''}`}
                        onClick={toggleMoktakSound}
                        aria-label={moktakMuted ? '목탁 소리 켜기' : '목탁 소리 끄기'}
                        aria-pressed={!moktakMuted}
                        title={`${moktakMuted ? '목탁 소리 켜기' : '목탁 소리 끄기'} · 나에게만 들려요`}
                      >
                        {moktakMuted ? <BellOff size={17} /> : <Bell size={17} />}
                      </button>
                      <button
                        className="hud-menu-button"
                        onClick={() => setModal('inventory')}
                        aria-label="염주함 열기"
                      >
                        <Gem size={16} />
                        <span>염주함</span>
                        <kbd>I</kbd>
                      </button>
                      <label className="hud-quality">
                        <span>화질</span>
                        <select
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
                        className="hud-icon-button"
                        onClick={() => setModal('help')}
                        aria-label="도움말 열기"
                        title="도움말"
                      >
                        <CircleHelp size={17} />
                      </button>
                    </>
                  )}
                  <button
                    className="view-size-button"
                    aria-label={immersive ? '집중 화면 닫기' : '게임 화면 넓히기'}
                    aria-pressed={immersive}
                    title={immersive ? '염주함과 기록 화면 · Esc' : '게임 화면으로 돌아가기'}
                    onClick={toggleImmersive}
                  >
                    {immersive ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                  </button>
                </div>
              </div>
              {immersive && (
                <>
                  <div className="hud-vignette" aria-hidden="true" />
                  <div className="hud-place">
                    <span>마음이 머무는 곳</span>
                    <h2>{nearbyHall?.name || theme.name}</h2>
                    <p>{nearbyNode?.name || theme.subtitle}</p>
                  </div>
                  <button
                    className="hud-profile"
                    aria-label="순례자 이름 변경"
                    onClick={() => {
                      setName(self?.name || name);
                      setGender(self?.gender === 'female' ? 'female' : 'male');
                      setModal('profile');
                    }}
                  >
                    <span className="hud-profile-title">
                      <span className="hud-profile-mark">
                        <Leaf size={19} strokeWidth={1.2} />
                      </span>
                      <span>
                        <small>마음을 잇는 순례자</small>
                        <strong>{self?.name || name}</strong>
                      </span>
                      <Settings2 size={13} />
                    </span>
                    <span className="hud-profile-stats">
                      <span>
                        <Footprints size={12} /> +{stats.moveSpeed}%
                      </span>
                      <span>
                        <Flower2 size={12} /> +{stats.bowSpeed}%
                      </span>
                      <span>
                        <Sparkles size={12} /> +{stats.dropRate}%
                      </span>
                    </span>
                    <span className="hud-profile-record">
                      <span>
                        누적 절 <b>{totalBows}</b>
                      </span>
                      <i />
                      <span>
                        보관 재료 <b>{inventory.length}</b>
                      </span>
                    </span>
                  </button>
                  <button
                    className={`hud-chat-toggle ${chatOpen ? 'active' : ''}`}
                    aria-label={chatOpen ? '마당 이야기 닫기' : '마당 이야기 열기'}
                    onClick={() => setChatOpen((value) => !value)}
                  >
                    <MessageCircle size={14} />
                    <span>마당 이야기</span>
                    <kbd>Enter</kbd>
                  </button>
                  {chatOpen && (
                    <div className="hud-chat">
                      <button
                        className="hud-chat-close"
                        aria-label="채팅창 닫기"
                        onClick={() => setChatOpen(false)}
                      >
                        <X size={15} />
                      </button>
                      <Chat
                        messages={game.messages}
                        send={send}
                        connected={status === 'connected'}
                      />
                    </div>
                  )}
                  <MiniMap state={state} onOpen={() => setModal('map')} />
                  <TouchMovement onMove={moveWithPad} />
                  {lookPrompt && !lookLocked && self && !modal && (
                    <div className="look-invitation">
                      <button onClick={toggleLook} aria-label="마우스로 둘러보기">
                        <MousePointer2 size={16} />
                        <span>마우스로 둘러보기</span>
                        <ArrowRight size={15} />
                      </button>
                      <small>우클릭 드래그로도 자유롭게 둘러볼 수 있어요</small>
                      <button
                        className="look-invitation-close"
                        aria-label="시점 안내 닫기"
                        onClick={() => setLookPrompt(false)}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )}
                </>
              )}
              {lookLocked && <span className="view-reticle" aria-hidden="true" />}
              <div className="world-location">
                <span className="location-line" />
                <span>{nearbyHall?.name || nearbyNode?.name || theme.subtitle}</span>
              </div>
              <div className="world-controls">
                <button
                  aria-label={lookLocked ? '마우스 시점 해제' : '마우스 시점 켜기'}
                  title="마우스 시점 켜기 · Esc로 해제"
                  className={lookLocked ? 'active' : ''}
                  onClick={toggleLook}
                >
                  <MousePointer2 size={17} />
                </button>
                <span />
                <button
                  aria-label="내 위치 보기"
                  title="내 위치 보기"
                  onClick={() => scene.current?.focusPlayer()}
                >
                  <Compass size={17} />
                </button>
                <span />
                <button
                  aria-label="확대"
                  title="카메라 가까이"
                  onClick={() => scene.current?.setZoom(1)}
                >
                  <Plus size={17} />
                </button>
                <button
                  aria-label="축소"
                  title="카메라 멀리"
                  onClick={() => scene.current?.setZoom(-1)}
                >
                  <Minus size={17} />
                </button>
                <span />
                <button aria-label="전체 지도 열기" onClick={() => setModal('map')}>
                  <Map size={16} />
                </button>
              </div>
              <div className="world-hint">
                <span>
                  <kbd>W</kbd>
                  <span className="key-row">
                    <kbd>A</kbd>
                    <kbd>S</kbd>
                    <kbd>D</kbd>
                  </span>
                </span>
                <span>바라보는 방향으로 걷기</span>
                <i />
                <kbd>{self?.seatId ? 'F' : 'E'}</kbd>
                <span>
                  {self?.seatId ? '내 목탁 두드리기' : nearbySeat ? '방석에 앉기' : '절하기 · 줍기'}
                </span>
                <span className="view-control-hint">
                  <MousePointer2 size={12} />
                  {lookLocked ? (
                    <span>마우스로 둘러보기 · Esc 해제</span>
                  ) : (
                    <>
                      <span className="desktop-look-hint">우클릭 드래그로 둘러보기</span>
                      <span className="touch-look-hint">드래그로 둘러보기</span>
                    </>
                  )}
                </span>
              </div>
              {bowing && (
                <div className="bowing-indicator">
                  <Flower2 size={20} className="slow-spin" />
                  <span>마음을 내려놓는 중…</span>
                </div>
              )}
            </section>

            <section
              className={`action-bar ${self?.seatId ? 'is-seated' : nearbySeat || nearbyHall ? 'has-seat-action' : ''}`}
            >
              <div className="action-copy">
                <span className="action-icon">
                  {immersive ? (
                    <kbd>{self?.seatId ? 'F' : 'E'}</kbd>
                  ) : (
                    <Flower2 size={23} strokeWidth={1.4} />
                  )}
                </span>
                <div>
                  <strong>
                    {self?.seatId
                      ? '방석에서 마음을 모아요'
                      : nearbySeat
                        ? '나만의 방석과 목탁'
                        : nearbyHall
                          ? `${nearbyHall.name} · 함께 올리는 절`
                          : nearbyNode
                            ? nearbyNode.name
                            : '법당으로 향하는 길'}
                  </strong>
                  <p>
                    {self?.seatId
                      ? 'F · 나에게만 들리는 목탁'
                      : nearbySeat
                        ? '빈 방석에 앉아 잠시 쉬어가세요.'
                        : nearbyHall
                          ? `함께 모은 마음 ${currentHall?.progress || 0} / 108`
                          : nearbyNode
                            ? '자연이 건네는 작은 인연을 주워보세요.'
                            : 'WASD로 걷거나, 법당으로 가기를 눌러보세요.'}
                  </p>
                </div>
              </div>
              {self?.seatId ? (
                <div className="seat-action-group">
                  <button
                    className="seat-action-button moktak-button"
                    onClick={() => scene.current?.strikeMoktak()}
                    title="F · 목탁 소리는 나에게만 들려요"
                    disabled={bowing || status !== 'connected'}
                  >
                    <Bell size={16} />
                    <span>목탁 두드리기</span>
                  </button>
                  <button
                    className="seat-action-button stand-button"
                    onClick={() => send({ type: 'stand' })}
                    disabled={status !== 'connected'}
                  >
                    <Footprints size={15} />
                    <span>일어나기</span>
                  </button>
                </div>
              ) : nearbySeat ? (
                <button
                  className="seat-action-button seat-sit-button"
                  onClick={() => send({ type: 'sit', seatId: nearbySeat.id })}
                  disabled={status !== 'connected'}
                >
                  <Flower2 size={16} />
                  <span>방석에 앉기</span>
                </button>
              ) : nearbyHall ? (
                <button
                  className="seat-action-button seat-find-button"
                  onClick={findSeat}
                  disabled={status !== 'connected'}
                >
                  <Footprints size={16} />
                  <span>방석 찾아가기</span>
                </button>
              ) : (
                <button className="gather-button" onClick={gather} aria-label="가까운 선물 줍기">
                  <Leaf size={17} />
                  <span>줍기</span>
                </button>
              )}
              <button
                className="button primary bow-button"
                onClick={bow}
                disabled={bowing || status !== 'connected'}
              >
                <Flower2 size={17} />
                {bowing
                  ? '절을 올리고 있어요'
                  : nearbyHall
                    ? '마음을 담아 절하기'
                    : '법당으로 가기'}
                {!bowing && <ArrowUpRight size={17} />}
              </button>
            </section>

            <div className="below-world">
              <section className="discovery-card">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">GIFTS OF THE GROVE</span>
                    <h3>이 산사에서 만나는 인연</h3>
                  </div>
                  <button className="text-button" onClick={() => setModal('drops')}>
                    드롭 목록 <ArrowUpRight size={13} />
                  </button>
                </div>
                <div className="featured-drops">
                  {theme.loot
                    .filter((id) => ITEMS[id].type === 'bead')
                    .slice(0, 3)
                    .map((id) => (
                      <button className="featured-drop" key={id} onClick={() => setModal('drops')}>
                        <BeadArt item={ITEMS[id]} size={35} />
                        <span>
                          <strong>{ITEMS[id].name}</strong>
                          <small style={{ color: RARITIES[ITEMS[id].rarity].color }}>
                            {RARITIES[ITEMS[id].rarity].label} <i />{' '}
                            {Object.keys(ITEMS[id].stats)
                              .map((k) => STAT_LABELS[k])
                              .slice(0, 1)}
                          </small>
                        </span>
                      </button>
                    ))}
                </div>
              </section>
              <section className="community-card">
                <span className="community-flower">
                  <Flower2 size={26} strokeWidth={1.2} />
                </span>
                <div className="section-heading">
                  <h3>함께 채우는 108배</h3>
                  <span className="cooperative-badge">대웅전</span>
                </div>
                <p>마음이 모이면, 모두에게 선물이 와요.</p>
                <div className="community-progress">
                  <span style={{ width: `${((mainHall?.progress || 0) / 108) * 100}%` }} />
                </div>
                <div className="community-numbers">
                  <span>도반들과 이어가는 마음</span>
                  <strong>
                    {mainHall?.progress || 0}
                    <small> / 108</small>
                  </strong>
                </div>
              </section>
            </div>
          </div>

          <aside className="right-column">
            <section className="bracelet-card">
              <header>
                <div>
                  <span className="eyebrow">MY LITTLE TREASURE</span>
                  <h2>나의 염주</h2>
                </div>
                <span className="equipment-badge">장착 중</span>
              </header>
              <Bracelet inventory={inventory} equipped={equipped} />
              <div className="bracelet-caption">
                <strong>{equippedCord?.name || '나의 첫 염주'}</strong>
                <span>소박하게 시작하는 작은 수행</span>
              </div>
              <div className="stats-list">
                {[
                  [Footprints, 'moveSpeed'],
                  [Flower2, 'bowSpeed'],
                  [Sparkles, 'dropRate'],
                ].map(([Icon, key]) => (
                  <div key={key}>
                    <span>
                      <Icon size={15} />
                      {STAT_LABELS[key]}
                    </span>
                    <strong>
                      +{stats[key]}
                      <small>%</small>
                    </strong>
                  </div>
                ))}
              </div>
              <button className="button bracelet-button" onClick={() => setModal('inventory')}>
                <Gem size={15} /> 염주 엮기 <ArrowRight size={15} />
              </button>
            </section>
            <section className="journey-card">
              <div className="section-heading">
                <h3>작은 발걸음</h3>
                <Feather size={16} />
              </div>
              <div className="journey-item">
                <span className={totalBows > 0 ? 'done' : ''}>
                  {totalBows > 0 ? <Check size={11} /> : '01'}
                </span>
                <div>
                  <strong>첫 마음을 올리기</strong>
                  <small>법당에서 정성스러운 절 한 번</small>
                </div>
                <b>{Math.min(totalBows, 1)} / 1</b>
              </div>
              <div className="journey-item">
                <span className={discovered >= 5 ? 'done' : ''}>
                  {discovered >= 5 ? <Check size={11} /> : '02'}
                </span>
                <div>
                  <strong>새로운 인연 만나기</strong>
                  <small>다섯 종류의 염주 재료 발견</small>
                </div>
                <b>{Math.min(discovered, 5)} / 5</b>
              </div>
            </section>
            <Chat messages={game.messages} send={send} connected={status === 'connected'} />
          </aside>
        </div>
        <footer className="page-footer">
          <span>
            <BeadLogo small /> 작은 염주 한 알, 함께 만드는 큰 평온.
          </span>
          <span>
            YEOMJU ONLINE <i /> 첫 번째 이야기
          </span>
        </footer>
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
        <Modal
          title={modal === 'catalog' ? '인연 도감' : '나의 염주함'}
          eyebrow={modal === 'catalog' ? 'EVERY ENCOUNTER MATTERS' : 'THREAD YOUR OWN STORY'}
          wide
          onClose={closeModal}
        >
          <Inventory state={state} send={send} catalog={modal === 'catalog'} />
        </Modal>
      )}
      {modal === 'showcase' && inspectedPlayer && (
        <Modal title="도반의 염주 구경" eyebrow="A STORY ON YOUR WRIST" onClose={closeModal}>
          <Showcase player={inspectedPlayer} />
        </Modal>
      )}
      {modal === 'channels' && (
        <Modal
          title="어느 산사에 머물까요?"
          eyebrow="TEN PLACES, A HUNDRED AND EIGHT FRIENDS"
          wide
          onClose={closeModal}
        >
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
        <Modal
          title="느리게 걷는 산사"
          eyebrow="A MAP FOR A WANDERING HEART"
          wide
          onClose={closeModal}
        >
          <WorldMap state={state} onHall={visitHall} onNode={goNode} />
        </Modal>
      )}
      {modal === 'drops' && (
        <Modal
          title={`${theme.name}의 선물`}
          eyebrow="A LITTLE LUCK IN EVERY ENCOUNTER"
          wide
          onClose={closeModal}
        >
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
            채집은 재료 1개를 보장합니다. 절의 기본 개인 드롭 확률은 65%이며 발견 확률 능력치가
            더해집니다. 공동 108배 보상은 해당 법당 주변의 참여자에게 지급됩니다.
          </p>
        </Modal>
      )}
      {modal === 'help' && (
        <Modal title="가볍게, 한 걸음부터" eyebrow="WELCOME TO YEOMJU ONLINE" onClose={closeModal}>
          <div className="help-list">
            <div>
              <span>01</span>
              <section>
                <h3>산사를 천천히 거닐어요</h3>
                <p>
                  캐릭터 뒤에서 바라보는 3인칭 시점이에요. WASD·방향키로 지금 바라보는 방향을
                  기준으로 걸어요. 마우스 오른쪽 버튼을 누른 채 움직이면 주변을 둘러볼 수 있어요.
                  모바일에서는 화면을 드래그해 둘러보고, 땅을 가볍게 눌러 걸어가요.
                </p>
                <p>
                  마우스 시점 버튼을 누르면 커서를 잡고 자유롭게 둘러봅니다. Esc로 풀 수 있어요.
                  마우스 휠이나 + · −로 카메라 거리를 조절하고, 화면 넓히기로 산사에 집중해 보세요.
                </p>
              </section>
            </div>
            <div>
              <span>02</span>
              <section>
                <h3>숲의 선물을 만나요</h3>
                <p>
                  반짝이는 선물을 누르면 걸어가서 줍습니다. 가까이에서 E 또는 ‘줍기’를 눌러도
                  좋아요. 선물은 잠시 후 다시 나타나요.
                </p>
              </section>
            </div>
            <div>
              <span>03</span>
              <section>
                <h3>함께 절하고 마음을 모아요</h3>
                <p>
                  법당 가까이에서 E 또는 ‘절하기’를 눌러요. 절이 끝나면 재료를 얻을 기회가 생겨요.
                  도반들과 108회를 채우면 주변 참여자 모두 보상을 받아요.
                </p>
                <p>
                  법당의 빈 방석이나 목탁을 누르면 그 자리로 걸어가 앉아요. 방석마다 목탁이 하나씩
                  있어요. 앉아서 F 또는 ‘목탁 두드리기’를 누르면 나에게만 소리가 들립니다.
                  ‘일어나기’를 누르거나 걸으면 자리에서 일어나요. 상단의 종 버튼으로 목탁 소리를
                  켜고 끌 수 있어요.
                </p>
              </section>
            </div>
            <div>
              <span>04</span>
              <section>
                <h3>나만의 염주를 엮어요</h3>
                <p>
                  염주함에서 띠와 구슬을 장착하세요. 띠마다 자릿수가 다르고, 구슬의 능력치가
                  더해져요. 다른 순례자의 캐릭터를 눌러 염주를 구경할 수도 있어요.
                </p>
              </section>
            </div>
          </div>
          <div className="help-note">
            <Leaf size={17} /> 별도 가입 없이 이 브라우저의 쿠키로 기록을 이어갑니다. 쿠키를 지우면
            이전 기록에 접근할 수 없어요.
          </div>
          <button className="button primary full-width" onClick={closeModal}>
            나의 속도로 시작하기 <ArrowRight size={16} />
          </button>
        </Modal>
      )}
      {modal === 'profile' && (
        <Modal title="나의 순례자를 정해요" eyebrow="A NAME FOR YOUR JOURNEY" onClose={closeModal}>
          <form
            className="profile-form"
            onSubmit={(event) => {
              event.preventDefault();
              game.rename(name, gender);
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
            <label className="profile-gender-label" htmlFor="pilgrim-gender">
              캐릭터 성별
            </label>
            <select
              id="pilgrim-gender"
              aria-label="캐릭터 성별"
              value={gender}
              onChange={(event) => setGender(event.target.value)}
            >
              <option value="male">남성</option>
              <option value="female">여성</option>
            </select>
            <p>남녀 모두 단정한 삭발 머리와 스님 복장을 입어요.</p>
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
