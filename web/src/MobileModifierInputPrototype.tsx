import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Keyboard, Send } from "lucide-react";
import { useEffect, useState } from "react";
import "./mobileModifierInputPrototype.css";

type Modifier = "Ctrl" | "Shift" | "Alt";
type ArrowKey = "Up" | "Down" | "Left" | "Right";
type PrototypeVariant = "A" | "B" | "C";

type SentTerminalKey = {
  label: string;
  sequence: string;
};

const PROTOTYPE_VARIANTS: Array<{ id: PrototypeVariant; name: string }> = [
  { id: "A", name: "One-shot latches" },
  { id: "B", name: "Chord composer" },
  { id: "C", name: "Shortcut shelf" },
];

const ARROW_FINAL_BYTE: Record<ArrowKey, string> = {
  Up: "A",
  Down: "B",
  Right: "C",
  Left: "D",
};

/** PROTOTYPE ONLY: compares three mobile interfaces for sending modified terminal keys. */
export function MobileModifierInputPrototype() {
  const variant = readPrototypeVariant();
  const [sentKey, setSentKey] = useState<SentTerminalKey | null>(null);
  const [activity, setActivity] = useState("A steering prompt is waiting while Pi works.");

  useEffect(() => {
    const cycleVariant = (direction: -1 | 1) => {
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement?.getAttribute("contenteditable") === "true"
      ) {
        return;
      }
      setPrototypeVariant(nextPrototypeVariant(variant, direction));
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "ArrowLeft") cycleVariant(-1);
      if (event.key === "ArrowRight") cycleVariant(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [variant]);

  const sendTerminalKey = (key: ArrowKey, modifiers: Modifier[]) => {
    const sequence = encodeModifiedArrowKey(key, modifiers);
    const label = [...modifiers, key].join("+");
    setSentKey({ label, sequence });
    setActivity(
      key === "Up" && modifiers.includes("Ctrl") && modifiers.includes("Shift")
        ? "Pi restored the waiting steering prompt to the editor."
        : `Sent ${label} to the terminal.`,
    );
  };

  return (
    <main className="modifier-prototype-page">
      <section className="modifier-prototype-phone" aria-label="Herdr Web mobile input prototype">
        <PrototypeHeader variant={variant} />
        <PrototypeTerminal activity={activity} sentKey={sentKey} />
        {variant === "A" ? <LatchVariant onSend={sendTerminalKey} /> : null}
        {variant === "B" ? <ComposerVariant onSend={sendTerminalKey} /> : null}
        {variant === "C" ? <ShortcutVariant onSend={sendTerminalKey} /> : null}
      </section>
      <PrototypeVariantSwitcher variant={variant} />
    </main>
  );
}

function PrototypeHeader({ variant }: { variant: PrototypeVariant }) {
  const variantName = PROTOTYPE_VARIANTS.find((item) => item.id === variant)?.name;
  return (
    <header className="modifier-prototype-header">
      <div>
        <span className="modifier-prototype-kicker">PROTOTYPE · {variant}</span>
        <strong>Shell</strong>
        <span>herdr-web · pi</span>
      </div>
      <div className="modifier-prototype-status"><i /> working</div>
      <p>{variantName}</p>
    </header>
  );
}

function PrototypeTerminal({
  activity,
  sentKey,
}: {
  activity: string;
  sentKey: SentTerminalKey | null;
}) {
  return (
    <section className="modifier-prototype-terminal" aria-live="polite">
      <div className="modifier-prototype-transcript">
        <p><span>✓</span> Agent is working</p>
        <p className="modifier-prototype-prompt">Please tighten the mobile input controls and keep the implementation small.</p>
        <p className="modifier-prototype-queue">↳ 1 steering prompt waiting</p>
      </div>
      <div className="modifier-prototype-event">
        <strong>{activity}</strong>
        <dl>
          <div><dt>Last key</dt><dd>{sentKey?.label ?? "None"}</dd></div>
          <div><dt>Terminal bytes</dt><dd>{sentKey ? visibleTerminalSequence(sentKey.sequence) : "—"}</dd></div>
          <div><dt>Pi action</dt><dd>{sentKey?.label === "Ctrl+Shift+Up" ? "Edit queued messages" : "—"}</dd></div>
        </dl>
      </div>
    </section>
  );
}

function LatchVariant({ onSend }: { onSend: (key: ArrowKey, modifiers: Modifier[]) => void }) {
  const [modifiers, setModifiers] = useState<Modifier[]>([]);
  const toggleModifier = (modifier: Modifier) => {
    setModifiers((current) =>
      current.includes(modifier)
        ? current.filter((item) => item !== modifier)
        : [...current, modifier],
    );
  };
  const send = (key: ArrowKey) => {
    onSend(key, modifiers);
    setModifiers([]);
  };

  return (
    <section className="modifier-prototype-controls latch-variant">
      <p className="modifier-prototype-instruction">Tap modifiers, then tap a key. Modifiers clear after one key.</p>
      <div className="prototype-scroll-row">
        <PrototypeKey label="Esc" />
        {(["Ctrl", "Shift", "Alt"] as Modifier[]).map((modifier) => (
          <PrototypeKey
            key={modifier}
            label={modifier}
            active={modifiers.includes(modifier)}
            onClick={() => toggleModifier(modifier)}
          />
        ))}
        <PrototypeKey label="Tab" />
        <PrototypeKey label="C-c" />
      </div>
      <ArrowKeyGrid onSend={send} />
      <PrototypeCommandRow />
    </section>
  );
}

function ComposerVariant({ onSend }: { onSend: (key: ArrowKey, modifiers: Modifier[]) => void }) {
  const [isComposing, setIsComposing] = useState(false);
  const [modifiers, setModifiers] = useState<Modifier[]>([]);
  const [key, setKey] = useState<ArrowKey | null>(null);
  const toggleModifier = (modifier: Modifier) => {
    setModifiers((current) =>
      current.includes(modifier)
        ? current.filter((item) => item !== modifier)
        : [...current, modifier],
    );
  };
  const chordLabel = key ? [...modifiers, key].join(" + ") : null;
  const closeComposer = () => {
    setIsComposing(false);
    setModifiers([]);
    setKey(null);
  };

  return (
    <section className="modifier-prototype-controls composer-variant">
      <p className="modifier-prototype-instruction">
        {isComposing
          ? "Build a chord, then tap Compose again to send it."
          : "Use normal keys directly, or open Compose for a modified chord."}
      </p>
      <div className="composer-toolbar">
        <div className="prototype-scroll-row">
          <PrototypeKey label="Esc" />
          <PrototypeKey label="Ctrl" />
          <PrototypeKey label="Tab" />
          <PrototypeKey label="C-c" />
        </div>
        <button
          className="composer-toggle"
          type="button"
          data-active={isComposing ? "true" : "false"}
          disabled={isComposing && !key}
          onClick={() => {
            if (!isComposing) {
              setIsComposing(true);
              return;
            }
            if (!key) return;
            onSend(key, modifiers);
            closeComposer();
          }}
        >
          {isComposing && key ? <Send size={16} /> : <Keyboard size={16} />}
          <span>Compose</span>
          {chordLabel ? <kbd>{chordLabel}</kbd> : null}
        </button>
      </div>
      {isComposing ? (
        <div className="composer-panel">
          <div className="composer-preview">
            <span>Building terminal chord</span>
            <strong>{chordLabel ?? "Choose a key"}</strong>
          </div>
          <div className="composer-builder">
            <div className="composer-modifiers">
              {(["Ctrl", "Shift", "Alt"] as Modifier[]).map((modifier) => (
                <PrototypeKey
                  key={modifier}
                  label={modifier}
                  active={modifiers.includes(modifier)}
                  onClick={() => toggleModifier(modifier)}
                />
              ))}
            </div>
            <ArrowKeyGrid selectedKey={key ?? undefined} onSelect={setKey} />
          </div>
          <button className="composer-cancel" type="button" onClick={closeComposer}>Cancel</button>
        </div>
      ) : (
        <ArrowKeyGrid onSend={(selectedKey) => onSend(selectedKey, [])} />
      )}
      <PrototypeCommandRow />
    </section>
  );
}

function ShortcutVariant({ onSend }: { onSend: (key: ArrowKey, modifiers: Modifier[]) => void }) {
  const [showGeneralKeys, setShowGeneralKeys] = useState(false);
  return (
    <section className="modifier-prototype-controls shortcut-variant">
      <p className="modifier-prototype-instruction">Pin the terminal actions you use most; keep general keys one tap away.</p>
      <div className="shortcut-shelf">
        <button type="button" onClick={() => onSend("Up", ["Ctrl", "Shift"])}>
          <span>Edit queued</span><kbd>Ctrl Shift ↑</kbd>
        </button>
        <button type="button" onClick={() => onSend("Up", ["Alt"])}>
          <span>Restore queue</span><kbd>Alt ↑</kbd>
        </button>
        <button type="button" onClick={() => onSend("Down", ["Ctrl", "Shift"])}>
          <span>Next prompt</span><kbd>Ctrl Shift ↓</kbd>
        </button>
      </div>
      <button
        className="shortcut-general-toggle"
        type="button"
        onClick={() => setShowGeneralKeys((open) => !open)}
      >
        <Keyboard size={16} /> {showGeneralKeys ? "Hide general keys" : "General keys"}
      </button>
      {showGeneralKeys ? <ArrowKeyGrid onSend={(key) => onSend(key, [])} /> : null}
      <PrototypeCommandRow />
    </section>
  );
}

function ArrowKeyGrid({
  onSend,
  onSelect,
  selectedKey,
}: {
  onSend?: (key: ArrowKey) => void;
  onSelect?: (key: ArrowKey) => void;
  selectedKey?: ArrowKey;
}) {
  const arrows: Array<{ key: ArrowKey; icon: typeof ArrowUp }> = [
    { key: "Left", icon: ArrowLeft },
    { key: "Up", icon: ArrowUp },
    { key: "Down", icon: ArrowDown },
    { key: "Right", icon: ArrowRight },
  ];
  return (
    <div className="prototype-arrow-grid" aria-label="Terminal arrow keys">
      {arrows.map(({ key, icon: Icon }) => (
        <button
          key={key}
          type="button"
          aria-label={key}
          data-active={selectedKey === key ? "true" : "false"}
          onClick={() => (onSelect ? onSelect(key) : onSend?.(key))}
        >
          <Icon size={20} />
        </button>
      ))}
      <PrototypeKey label="S-Tab" />
      <PrototypeKey label="PgUp" />
      <PrototypeKey label="PgDn" />
      <PrototypeKey label="Home" />
    </div>
  );
}

function PrototypeKey({
  label,
  active = false,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button type="button" data-active={active ? "true" : "false"} onClick={onClick}>
      {label}
    </button>
  );
}

function PrototypeCommandRow() {
  return (
    <div className="prototype-command-row">
      <input aria-label="Command" placeholder="Type a command…" />
      <button type="button" aria-label="Send command"><Send size={18} /></button>
    </div>
  );
}

function PrototypeVariantSwitcher({ variant }: { variant: PrototypeVariant }) {
  const item = PROTOTYPE_VARIANTS.find((candidate) => candidate.id === variant)!;
  return (
    <nav className="prototype-variant-switcher" aria-label="Prototype variants">
      <button type="button" aria-label="Previous variant" onClick={() => setPrototypeVariant(nextPrototypeVariant(variant, -1))}>←</button>
      <span><strong>{item.id}</strong> — {item.name}</span>
      <button type="button" aria-label="Next variant" onClick={() => setPrototypeVariant(nextPrototypeVariant(variant, 1))}>→</button>
    </nav>
  );
}

function encodeModifiedArrowKey(key: ArrowKey, modifiers: Modifier[]) {
  if (modifiers.length === 0) return `\x1B[${ARROW_FINAL_BYTE[key]}`;
  const modifierParameter =
    1 +
    (modifiers.includes("Shift") ? 1 : 0) +
    (modifiers.includes("Alt") ? 2 : 0) +
    (modifiers.includes("Ctrl") ? 4 : 0);
  return `\x1B[1;${modifierParameter}${ARROW_FINAL_BYTE[key]}`;
}

function visibleTerminalSequence(sequence: string) {
  return sequence.replace("\x1B", "ESC ");
}

function readPrototypeVariant(): PrototypeVariant {
  const value = new URLSearchParams(window.location.search).get("variant");
  return value === "B" || value === "C" ? value : "A";
}

function nextPrototypeVariant(current: PrototypeVariant, direction: -1 | 1): PrototypeVariant {
  const index = PROTOTYPE_VARIANTS.findIndex((item) => item.id === current);
  return PROTOTYPE_VARIANTS[(index + direction + PROTOTYPE_VARIANTS.length) % PROTOTYPE_VARIANTS.length]!.id;
}

function setPrototypeVariant(variant: PrototypeVariant) {
  const url = new URL(window.location.href);
  url.searchParams.set("variant", variant);
  window.location.assign(url);
}
