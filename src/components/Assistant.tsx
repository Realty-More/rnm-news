// "Ask R&M": a chat sheet that answers from RealtyNMore's own stories (server: /ai/ask).
// Open it from anywhere with openAssistant(), optionally about one story.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { PUSH_API } from "../lib/push.ts";
import { useT } from "../lib/i18n.ts";
import { Icon } from "./Icon.tsx";

const EVENT = "rnm:assistant";
export const assistantReady = !!PUSH_API;

interface Source {
  n: number;
  id: number;
  title: string;
  link: string;
}
interface Msg {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  error?: boolean;
}

export function openAssistant(post?: { id: number; title: string }) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: post ?? null }));
}

const GENERAL = [
  "What’s new in real estate today?",
  "Latest RERA updates",
  "Which developers launched projects this week?",
  "आज की बड़ी रियल एस्टेट ख़बरें?",
];
const ABOUT_STORY = [
  "Summarise this in 3 points",
  "Explain it in simple words",
  "What does this mean for home buyers?",
  "इसे हिंदी में समझाओ",
];

/** Renders **bold** and [n] citations from the answer as text, never as HTML. */
function Answer({ text }: { text: string }) {
  return (
    <>
      {text
        .split("\n")
        .filter((line) => line.trim())
        .map((line, i) => (
          <p key={i}>
            {line
              .replace(/^\s*[-*]\s+/, "• ")
              .split(/(\*\*[^*]+\*\*|\[\d+\])/g)
              .map((part, j) =>
                /^\*\*[^*]+\*\*$/.test(part) ? (
                  <strong key={j}>{part.slice(2, -2)}</strong>
                ) : /^\[\d+\]$/.test(part) ? (
                  <sup key={j} className="ai-cite">
                    {part.slice(1, -1)}
                  </sup>
                ) : (
                  part
                ),
              )}
          </p>
        ))}
    </>
  );
}

export function Assistant() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [post, setPost] = useState<{ id: number; title: string } | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const on = (e: Event) => {
      const next = (e as CustomEvent<{ id: number; title: string } | null>)
        .detail;
      // A new story starts a new conversation; the general chat keeps going.
      setPost((cur) => {
        if ((cur?.id ?? null) !== (next?.id ?? null)) setMsgs([]);
        return next;
      });
      setOpen(true);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.documentElement.classList.add("menu-open");
    setTimeout(() => inputRef.current?.focus(), 250);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("menu-open");
    };
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [msgs, busy]);

  if (!assistantReady) return null;

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    setQ("");
    const history = msgs
      .filter((m) => !m.error)
      .map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: "user", content: question }]);
    setBusy(true);
    try {
      const res = await fetch(`${PUSH_API}/ai/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: question, postId: post?.id, history }),
      });
      const data = (await res.json()) as {
        answer?: string;
        sources?: Source[];
        error?: string;
      };
      if (!res.ok || !data.answer)
        throw new Error(data.error ?? t("ai.failed"));
      setMsgs((m) => [
        ...m,
        { role: "assistant", content: data.answer!, sources: data.sources },
      ]);
    } catch (err) {
      setMsgs((m) => [
        ...m,
        {
          role: "assistant",
          content: navigator.onLine ? (err as Error).message : t("ai.offline"),
          error: true,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(q);
  };
  const suggestions = post ? ABOUT_STORY : GENERAL;

  return (
    <div
      className={`ai-sheet ${open ? "open" : ""}`}
      aria-hidden={!open}
      inert={!open}
    >
      <button
        className="nav-scrim"
        onClick={() => setOpen(false)}
        aria-label={t("menu.close")}
        tabIndex={-1}
      />
      <section
        className="ai-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Ask R&M"
      >
        <header className="ai-head">
          <span className="ai-logo" aria-hidden="true">
            <Icon name="sparkle" size={18} />
          </span>
          <div>
            <strong>Ask R&amp;M</strong>
            <span>{t("ai.sub")}</span>
          </div>
          {msgs.length > 0 && (
            <button className="mini-btn" onClick={() => setMsgs([])}>
              {t("ai.new")}
            </button>
          )}
          <button
            className="icon-btn"
            onClick={() => setOpen(false)}
            aria-label={t("menu.close")}
          >
            <Icon name="close" />
          </button>
        </header>
        {post && (
          <div className="ai-context">
            <Icon name="news" size={15} />
            <span>
              {t("ai.about")} <b>{post.title}</b>
            </span>
            <button
              className="icon-btn"
              onClick={() => (setPost(null), setMsgs([]))}
              aria-label={t("ai.anyStory")}
            >
              <Icon name="close" size={15} />
            </button>
          </div>
        )}
        <div className="ai-list" ref={listRef} aria-live="polite">
          {msgs.length === 0 && (
            <div className="ai-empty">
              <p>{post ? t("ai.helloStory") : t("ai.hello")}</p>
              <div className="ai-chips">
                {suggestions.map((s) => (
                  <button key={s} onClick={() => void send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div
              key={i}
              className={`ai-msg ${m.role} ${m.error ? "error" : ""}`}
            >
              {m.role === "assistant" ? (
                <Answer text={m.content} />
              ) : (
                <p>{m.content}</p>
              )}
              {m.sources && m.sources.length > 0 && (
                <div className="ai-sources">
                  <span>{t("ai.sources")}</span>
                  {m.sources.map((s) => (
                    <Link
                      key={s.n}
                      to={`/article/${s.id}`}
                      onClick={() => setOpen(false)}
                    >
                      <sup>{s.n}</sup> {s.title}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div
              className="ai-msg assistant typing"
              aria-label={t("ai.thinking")}
            >
              <span />
              <span />
              <span />
            </div>
          )}
        </div>
        <form className="ai-input" onSubmit={submit}>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={post ? t("ai.placeholderStory") : t("ai.placeholder")}
            aria-label={t("ai.placeholder")}
            maxLength={300}
          />
          <button
            className="ai-send"
            disabled={busy || q.trim().length < 3}
            aria-label={t("ai.send")}
          >
            <Icon name="arrowUp" size={18} />
          </button>
        </form>
        <p className="ai-note">{t("ai.note")}</p>
      </section>
    </div>
  );
}
