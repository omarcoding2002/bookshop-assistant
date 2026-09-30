import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  Book,
  Cart,
  ChatResult,
  Message,
  Order,
  Quote,
} from "../shared.js";
import { money } from "../shared.js";
import "./style.css";

type Config = {
  mode: "ai" | "offline";
  categories: string[];
  liveSearch: boolean;
};
type ChatMessage = Message & { books?: Book[] };
const emptyCart: Cart = {
  lines: [],
  count: 0,
  totalCents: 0,
  currency: "USD",
  version: 0,
};
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error?.message ||
        "We couldn’t complete that request. Please try again.",
    );
  return data;
}
function Icon({
  name,
  size = 20,
}: {
  name: "book" | "arrow" | "bag" | "search" | "close" | "spark" | "check";
  size?: number;
}) {
  const paths = {
    book: (
      <>
        <path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Z" />
        <path d="M12 5v15" />
      </>
    ),
    arrow: (
      <>
        <path d="M5 12h14M13 6l6 6-6 6" />
      </>
    ),
    bag: (
      <>
        <path d="M5 7h14l1 14H4L5 7Z" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2" />
      </>
    ),
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 5 5" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    spark: (
      <>
        <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
function Cover({ book, small = false }: { book: Book; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  const tint = Number(book.id.replace(/\D/g, "").slice(-2)) % 6;
  return (
    <div className={`cover tint-${tint} ${small ? "small-cover" : ""}`}>
      {book.coverId && !failed ? (
        <img
          src={`https://covers.openlibrary.org/b/id/${book.coverId}-M.jpg?default=false`}
          alt={`Cover of ${book.title}`}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="cover-fallback">
          <span>THE BOOKSHOP COLLECTION</span>
          <strong>{book.title}</strong>
          <i>{book.authors[0]}</i>
          <Icon name="book" size={26} />
        </div>
      )}
    </div>
  );
}
function Modal({
  children,
  onClose,
  title,
  className = "",
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current!;
    el.showModal();
    const listener = () => onClose();
    el.addEventListener("cancel", listener);
    return () => {
      el.removeEventListener("cancel", listener);
      el.close();
    };
  }, []);
  return (
    <dialog ref={ref} className={className} aria-label={title}>
      <div className="modal-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label={`Close ${title}`}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function App() {
  const [config, setConfig] = useState<Config>();
  const [cart, setCart] = useState<Cart>(emptyCart);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [searchKind, setSearchKind] = useState("all");
  const [activeKind, setActiveKind] = useState("all");
  const [page, setPage] = useState(1);
  const [nextPage, setNextPage] = useState<number>();
  const [detailsLoading, setDetailsLoading] = useState(false);
  function browseCategory(value: string) {
    setQuery("");
    setActiveQuery("");
    setCategory(value);
    setPage(1);
    setNextPage(undefined);
  }

  const [maxPrice, setMaxPrice] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [basketOpen, setBasketOpen] = useState(false);
  const [selected, setSelected] = useState<Book>();
  const [quote, setQuote] = useState<Quote>();
  const [order, setOrder] = useState<Order>();
  const [searchVersion, setSearchVersion] = useState(0);
  const [ready, setReady] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  async function initialize(reset = false) {
    setError("");
    try {
      const settings = await api<Config>("/config");
      const session = await api<{
        cart: Cart;
        messages: Message[];
        orders: Order[];
      }>("/sessions", "POST", { reset });
      setConfig(settings);
      setCart(session.cart);
      setMessages(session.messages);
      setQuote(undefined);
      setOrder(undefined);
      setReady(true);
      setSearchVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void initialize();
  }, []);
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ limit: "12" });
        if (category) params.set("category", category);
        if (activeQuery) {
          params.set("query", activeQuery);
          params.set("kind", activeKind);
          params.set("page", String(page));
        }
        if (maxPrice)
          params.set("maxPriceCents", String(Number(maxPrice) * 100));
        const response = await fetch(
          `/api/v1/${activeQuery ? "discover" : "books"}?${params}`,
          {
            signal: controller.signal,
          },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error.message);
        setBooks((previous) =>
          page === 1
            ? data.books
            : [
                ...new Map(
                  [...previous, ...data.books].map((b: Book) => [
                    b.workId || b.id,
                    b,
                  ]),
                ).values(),
              ],
        );
        setNextPage(data.nextPage);
        if (data.warning) setNotice(data.warning);
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [ready, category, activeQuery, activeKind, page, maxPrice, searchVersion]);
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    const id = selected.id;
    setDetailsLoading(true);
    api<Book>(`/books/${id}`)
      .then((book) => {
        if (!cancelled)
          setSelected((current) => (current?.id === id ? book : current));
      })
      .catch(() => {
        if (!cancelled)
          setSelected((current) =>
            current?.id === id
              ? {
                  ...current,
                  metadataWarning:
                    "Could not refresh details; showing saved information.",
                }
              : current,
          );
      })
      .finally(() => {
        if (!cancelled) setDetailsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.id]);
  useEffect(() => {
    if (messages.length)
      chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, busy]);
  async function changeCart(book: Book, quantity: number) {
    setActionBusy(true);
    setError("");
    try {
      setCart(await api<Cart>("/cart", "PATCH", { bookId: book.id, quantity }));
      setQuote(undefined);
      setOrder(undefined);
      setNotice(
        quantity
          ? `${book.title} is in your basket.`
          : `${book.title} removed.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  }
  async function checkout() {
    setActionBusy(true);
    setError("");
    try {
      setQuote(await api<Quote>("/quotes", "POST", {}));
      setBasketOpen(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  }
  async function confirmOrder() {
    if (!quote) return;
    setActionBusy(true);
    setError("");
    try {
      const receipt = await api<Order>("/orders/confirm", "POST", {
        quoteId: quote.id,
        idempotencyKey: `ui-${quote.id}`,
        confirmed: true,
      });
      setOrder(receipt);
      setQuote(undefined);
      setCart(await api<Cart>("/cart"));
      setSearchVersion((v) => v + 1);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: `Your demo order is confirmed for ${money(receipt.cart.totalCents)}. No payment was taken. Happy reading!`,
        },
      ]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  }
  async function send(text = input) {
    if (!text.trim() || busy || !ready) return;
    setInput("");
    setBusy(true);
    setError("");
    setStatus("The bookseller is finding your next read…");
    setMessages((m) => [...m, { role: "user", content: text }]);
    try {
      const response = await fetch("/api/v1/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, stream: true }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error.message);
      }
      const reader = response.body!.getReader(),
        decoder = new TextDecoder();
      let buffer = "",
        complete = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const event = frame.match(/^event: (.+)$/m)?.[1];
          const raw = frame.match(/^data: (.+)$/m)?.[1];
          if (!raw) continue;
          const data = JSON.parse(raw);
          if (event === "status") setStatus(data.text);
          if (event === "error") throw new Error(data.message);
          if (event === "result") {
            const result = data as ChatResult;
            complete = true;
            setMessages((m) => [
              ...m,
              { role: "assistant", content: result.text, books: result.books },
            ]);
            setCart(result.cart);
            setQuote(result.quote);
            if (result.warning) setNotice(result.warning);
            if (result.quote) setBasketOpen(true);
            if (result.order) {
              setOrder(result.order);
              setBasketOpen(true);
              setSearchVersion((v) => v + 1);
            }
          }
        }
      }
      if (!complete)
        throw new Error(
          "The connection ended early. Your basket is saved; please try again.",
        );
    } catch (e) {
      setError((e as Error).message);
      try {
        setCart(await api<Cart>("/cart"));
      } catch {
        /* Original error remains visible. */
      }
    } finally {
      setBusy(false);
      setStatus("");
      composer.current?.focus();
    }
  }
  const locked = busy || actionBusy || !ready;
  return (
    <>
      <div className="top-note">
        A little curiosity. A very good book.{" "}
        <span>SIMULATED BOOKSTORE · NO REAL PAYMENTS</span>
      </div>
      <header className="header">
        <a className="brand" href="/" aria-label="Between the Lines home">
          <span className="brand-mark">
            <Icon name="book" size={28} />
          </span>
          <span>
            between the lines<small>YOUR NEXT CHAPTER STARTS HERE</small>
          </span>
        </a>
        <div className="header-right">
          <span className="open-sign">
            <i /> The bookshop is open
          </span>
          <button
            aria-label={"Your basket, " + cart.count + " books"}
            className="basket-button"
            onClick={() => {
              setBasketOpen(true);
              setError("");
            }}
          >
            <Icon name="bag" /> <span>Your basket</span>
            <b>{cart.count}</b>
          </button>
        </div>
      </header>
      <main>
        <section className="intro">
          <div>
            <div className="eyebrow">
              <span /> A BOOKSELLER, JUST FOR YOU
            </div>
            <h1>
              A good book starts with
              <br />a <em>conversation.</em>
            </h1>
            <p>
              A familiar favourite, a thoughtful gift, or something you didn’t
              know
              <br className="desktop-break" /> you were looking for. Let’s find
              your next read.
            </p>
          </div>
          <div className="hero-stamp">
            <Icon name="spark" size={24} />
            <span>
              Less searching.
              <br />
              <em>More discovering.</em>
            </span>
          </div>
        </section>
        {error && (
          <div className="error" role="alert">
            <span>{error}</span>
            {!ready ? (
              <button onClick={() => void initialize()}>
                Retry connection
              </button>
            ) : (
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <Icon name="close" size={16} />
              </button>
            )}
          </div>
        )}
        <div className="workspace">
          <section className="shelves" aria-label="Book catalogue">
            <div className="section-heading">
              <div>
                <span className="eyebrow">THE SHELVES</span>
                <h2>Room for a new favourite.</h2>
              </div>
              <span className="edition-note">
                Real books.
                <br />
                Fictional prices.
              </span>
            </div>
            <form
              className="search-row"
              onSubmit={(e) => {
                e.preventDefault();
                if (query.trim().length < 2) return;
                setActiveQuery(query.trim());
                setActiveKind(searchKind);
                setCategory("");
                setPage(1);
                setSearchVersion((v) => v + 1);
              }}
            >
              <label className="search">
                <Icon name="search" />
                <input
                  aria-label="Search books"
                  placeholder="Search a title, author or ISBN…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  maxLength={200}
                />
                {query && (
                  <button
                    aria-label="Clear search"
                    type="button"
                    onClick={() => browseCategory("")}
                  >
                    <Icon name="close" size={16} />
                  </button>
                )}
              </label>
              <select
                aria-label="Search by"
                value={searchKind}
                onChange={(e) => setSearchKind(e.target.value)}
              >
                <option value="all">Title, author or ISBN</option>
                <option value="title">Title</option>
                <option value="author">Author</option>
                <option value="topic">Topic</option>
              </select>
              <select
                aria-label="Maximum price"
                value={maxPrice}
                onChange={(e) => {
                  setMaxPrice(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Any price</option>
                <option value="10">Under $10</option>
                <option value="15">Under $15</option>
                <option value="25">Under $25</option>
              </select>
              <button
                type="submit"
                className="primary search-submit"
                disabled={!ready || searching || query.trim().length < 2}
              >
                Search books
              </button>
            </form>
            <p className="discovery-note">
              {activeQuery
                ? `Search results for “${activeQuery}”`
                : "Browse our curated shelves, or search for more books."}{" "}
              {config?.liveSearch
                ? "Live discovery powered by Open Library."
                : "Live discovery is currently off; searching saved books."}
            </p>
            <div className="categories" aria-label="Book categories">
              <button
                className={!category ? "active" : ""}
                onClick={() => browseCategory("")}
              >
                All books
              </button>
              {config?.categories.map((c) => (
                <button
                  key={c}
                  className={category === c ? "active" : ""}
                  onClick={() => browseCategory(c)}
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="catalogue-meta">
              <span>
                {searching
                  ? "Looking along the shelves…"
                  : `${books.length} editions to explore`}
              </span>
              <span>CURATED WITH CURIOSITY</span>
            </div>
            <div className="book-grid" aria-busy={searching}>
              {books.map((book) => (
                <article className="book-card" key={book.id}>
                  <button
                    className="book-art"
                    onClick={() => setSelected(book)}
                    aria-label={`Details for ${book.title}`}
                  >
                    <Cover book={book} />
                    <span className="book-category">{book.category}</span>
                  </button>
                  <div className="book-copy">
                    <button
                      className="title-button"
                      onClick={() => setSelected(book)}
                    >
                      <h3>{book.title}</h3>
                    </button>
                    <p>{book.authors.join(", ")}</p>
                    <span className="format">
                      {book.format === "unspecified"
                        ? "Format unspecified"
                        : book.format}
                    </span>
                    <div className="book-bottom">
                      <strong>
                        {book.stocked ? money(book.priceCents) : "Not stocked"}
                      </strong>
                      <button
                        className="add-button"
                        disabled={
                          locked ||
                          !book.stocked ||
                          book.stock === 0 ||
                          (cart.lines.find((l) => l.book.id === book.id)
                            ?.quantity || 0) >= book.stock
                        }
                        onClick={() =>
                          void changeCart(
                            book,
                            (cart.lines.find((l) => l.book.id === book.id)
                              ?.quantity || 0) + 1,
                          )
                        }
                        aria-label={`Add ${book.title} to basket`}
                      >
                        {book.stock === 0 ? (
                          "Unavailable"
                        ) : (
                          <>
                            Add <span>+</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            {nextPage && (
              <button
                className="secondary load-more"
                disabled={searching}
                onClick={() => setPage(nextPage)}
              >
                Load more books
              </button>
            )}
            {!searching && ready && !books.length && (
              <div className="empty-shelf">
                <Icon name="book" size={32} />
                <h3>No books on this shelf just yet.</h3>
                <p>Try a different search or a wider budget.</p>
                <button
                  onClick={() => {
                    browseCategory("");
                    setMaxPrice("");
                  }}
                >
                  Browse all books
                </button>
              </div>
            )}
            <p className="source-note">
              Book metadata from{" "}
              <a
                href="https://openlibrary.org"
                target="_blank"
                rel="noreferrer"
              >
                Open Library ↗
              </a>
              . Prices and availability are made up for this demo.
            </p>
          </section>
          <aside className="chat-panel" aria-label="Your bookseller">
            <div className="chat-heading">
              <span className="avatar">
                <Icon name="book" size={23} />
              </span>
              <div>
                <h2>Your bookseller</h2>
                <span>
                  <i />
                  {!config
                    ? "Connecting to your bookseller…"
                    : config.mode === "ai"
                      ? "AI-powered · here to help"
                      : "Offline demo · guided responses"}
                </span>
              </div>
              <button
                className="reset-button"
                disabled={locked}
                onClick={() => {
                  void initialize(true);
                  setNotice(
                    "Started a fresh session. Previous basket and history cleared.",
                  );
                }}
                title="Clear conversation and basket"
              >
                Start fresh
              </button>
            </div>
            <div
              className={`mode-banner ${config?.mode === "ai" ? "ai-banner" : ""}`}
            >
              <Icon name="spark" size={16} />
              <span>
                {!config
                  ? "Connecting to the bookshop…"
                  : config.mode === "ai"
                    ? "An AI bookseller with real book data. All sales are simulated."
                    : "Offline demonstration: guided responses, real book records, simulated purchases."}
              </span>
            </div>
            <div className="conversation" role="log" aria-label="Conversation">
              <div className="message assistant">
                <span className="message-label">YOUR BOOKSELLER</span>
                <p>Welcome in. What brings you to the bookshop today?</p>
                <p>
                  Tell me a little about what you love, or we can discover
                  something together.
                </p>
              </div>
              {!messages.length && (
                <div className="starter-list">
                  {[
                    "I’m not sure what to read",
                    "A mystery for under $15",
                    "Help me find a gift",
                  ].map((s) => (
                    <button
                      key={s}
                      disabled={locked}
                      onClick={() => void send(s)}
                    >
                      {s}
                      <Icon name="arrow" size={16} />
                    </button>
                  ))}
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`message ${m.role}`}>
                  <span className="message-label">
                    {m.role === "assistant" ? "YOUR BOOKSELLER" : "YOU"}
                  </span>
                  <p>{m.content}</p>
                  {m.books?.map((book) => (
                    <button
                      key={book.id}
                      className="chat-book"
                      onClick={() => setSelected(book)}
                    >
                      <Cover book={book} small />
                      <span>
                        <strong>{book.title}</strong>
                        <small>{book.authors[0]}</small>
                        <b>
                          {book.stocked
                            ? money(book.priceCents)
                            : "Not stocked"}
                        </b>
                      </span>
                      <Icon name="arrow" size={16} />
                    </button>
                  ))}
                </div>
              ))}
              {busy && (
                <div className="thinking" role="status">
                  <span className="thinking-dot" />
                  {status}
                </div>
              )}
              <div ref={chatEnd} />
            </div>
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <label className="sr-only" htmlFor="message">
                Message your bookseller
              </label>
              <textarea
                id="message"
                ref={composer}
                rows={2}
                maxLength={2000}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="A book you loved. A mood. A wild idea…"
                disabled={!ready}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div>
                <span>YOUR NEXT CHAPTER IS A MESSAGE AWAY</span>
                <button
                  type="submit"
                  disabled={locked || !input.trim()}
                  aria-label="Send message"
                >
                  <Icon name="arrow" size={19} />
                </button>
              </div>
            </form>
            <div className="chat-footer">
              Thoughtful suggestions. Always your choice.
            </div>
          </aside>
        </div>
        <footer>
          <span className="footer-brand">
            <Icon name="book" size={17} /> between the lines
          </span>
          <span>A prototype made for the joy of finding your next book.</span>
          <a href="/api/openapi.json" target="_blank" rel="noreferrer">
            API reference ↗
          </a>
        </footer>
      </main>
      {notice && (
        <div className="toast" role="status">
          <Icon name="check" size={17} />
          <span>{notice}</span>
          <button onClick={() => setNotice("")} aria-label="Dismiss notice">
            <Icon name="close" size={15} />
          </button>
        </div>
      )}
      {selected && (
        <Modal title="A closer look" onClose={() => setSelected(undefined)}>
          <div className="book-detail">
            <Cover book={selected} />
            <div>
              <span className="eyebrow">{selected.category}</span>
              <h3>{selected.title}</h3>
              <p>{selected.authors.join(", ")}</p>
              {detailsLoading && <p role="status">Checking source details…</p>}
              {selected.metadataWarning && (
                <p role="status">{selected.metadataWarning}</p>
              )}
              <dl>
                <dt>Format</dt>
                <dd>
                  {selected.format === "unspecified"
                    ? "Not verified by source"
                    : selected.format}
                </dd>
                <dt>First published (work)</dt>
                <dd>{selected.year || "Unknown"}</dd>
                <dt>Edition publication</dt>
                <dd>{selected.editionPublishDate || "Unknown"}</dd>
                <dt>Pages (edition)</dt>
                <dd>{selected.pages || "Unknown"}</dd>
                <dt>Language</dt>
                <dd>{selected.language?.join(", ") || "Unknown"}</dd>
                <dt>Record ID</dt>
                <dd>{selected.id}</dd>
                <dt>ISBN</dt>
                <dd>{selected.isbn[0] || "Not provided"}</dd>
                <dt>Demo price</dt>
                <dd>
                  {selected.stocked
                    ? money(selected.priceCents)
                    : "Not stocked"}
                </dd>
                <dt>Demo availability</dt>
                <dd>
                  {selected.stock > 0
                    ? `${selected.stock} copies in this session`
                    : "Unavailable"}
                </dd>
              </dl>
              <a href={selected.sourceUrl} target="_blank" rel="noreferrer">
                {selected.id.endsWith("W")
                  ? "View work on Open Library ↗"
                  : "View edition on Open Library ↗"}
              </a>
            </div>
          </div>
          <section className="source-description">
            <h3>About this book</h3>
            {selected.description ? (
              <>
                <p>
                  {selected.description}
                  {selected.descriptionTruncated ? "…" : ""}
                </p>
                <a
                  href={selected.descriptionSourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {selected.descriptionTruncated
                    ? "Description excerpt"
                    : "Description"}{" "}
                  from Open Library ({selected.descriptionLevel}) ↗
                </a>
              </>
            ) : (
              <p>No source description is available for this record.</p>
            )}
            <small>
              Metadata retrieved{" "}
              {new Date(
                selected.detailsFetchedAt || selected.fetchedAt,
              ).toLocaleDateString()}
              .
            </small>
          </section>
          <p className="detail-note">
            Subjects:{" "}
            {selected.subjects.slice(0, 6).join(" · ") || "Not provided"}. Age
            suitability is not verified. Metadata can be incomplete.
          </p>
          <button
            className="primary wide"
            disabled={locked || selected.stock === 0 || !selected.stocked}
            onClick={() => {
              void changeCart(
                selected,
                (cart.lines.find((l) => l.book.id === selected.id)?.quantity ||
                  0) + 1,
              );
            }}
          >
            {selected.stocked
              ? `Add to basket — ${money(selected.priceCents)}`
              : "Discovery only — no demo stock"}
          </button>
        </Modal>
      )}
      {basketOpen && (
        <Modal
          title={order ? "Your next chapter awaits." : "Your basket"}
          className="basket-modal"
          onClose={() => setBasketOpen(false)}
        >
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {order ? (
            <div className="receipt">
              <span className="receipt-check">
                <Icon name="check" size={28} />
              </span>
              <h3>Demo order confirmed</h3>
              <p>No payment was taken. No books will be shipped.</p>
              <ul>
                {order.cart.lines.map((l) => (
                  <li key={l.book.id}>
                    {l.quantity} × {l.book.title}
                    <strong>{money(l.subtotalCents)}</strong>
                  </li>
                ))}
              </ul>
              <div className="total">
                <span>Demo total</span>
                <strong>{money(order.cart.totalCents)}</strong>
              </div>
              <small>
                Order reference
                <br />
                {order.id}
              </small>
              <button
                className="primary wide"
                onClick={() => {
                  setBasketOpen(false);
                  setOrder(undefined);
                }}
              >
                Keep exploring
              </button>
            </div>
          ) : (
            <>
              <p className="basket-intro">
                A few good books, a little possibility.
                <br />
                <strong>
                  Demo only. No payment or personal details needed.
                </strong>
              </p>
              {!cart.count ? (
                <div className="empty-shelf">
                  <Icon name="bag" size={35} />
                  <h3>Your next read is out there.</h3>
                  <p>Add a book from the shelves or ask your bookseller.</p>
                  <button onClick={() => setBasketOpen(false)}>
                    Back to the shelves
                  </button>
                </div>
              ) : (
                <>
                  <div className="basket-lines">
                    {cart.lines.map((line) => (
                      <div className="basket-line" key={line.book.id}>
                        <Cover book={line.book} small />
                        <div>
                          <h3>{line.book.title}</h3>
                          <span>
                            {money(line.book.priceCents)} each ·{" "}
                            {line.book.format === "unspecified"
                              ? "format unspecified"
                              : line.book.format}
                          </span>
                          <div className="quantity">
                            <button
                              disabled={locked}
                              aria-label={`Decrease quantity of ${line.book.title}`}
                              onClick={() =>
                                void changeCart(line.book, line.quantity - 1)
                              }
                            >
                              −
                            </button>
                            <span aria-label="Quantity">{line.quantity}</span>
                            <button
                              disabled={locked || line.quantity >= 5}
                              aria-label={`Increase quantity of ${line.book.title}`}
                              onClick={() =>
                                void changeCart(line.book, line.quantity + 1)
                              }
                            >
                              +
                            </button>
                            <button
                              className="remove"
                              disabled={locked}
                              onClick={() => void changeCart(line.book, 0)}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                        <strong>{money(line.subtotalCents)}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="total">
                    <span>
                      Demo total <small>USD · no tax or shipping</small>
                    </span>
                    <strong>{money(cart.totalCents)}</strong>
                  </div>
                  {quote ? (
                    <div className="quote-confirm">
                      <h3>Ready for your next chapter?</h3>
                      <p>
                        You’re confirming {quote.cart.count} book(s) for{" "}
                        {money(quote.cart.totalCents)}. This creates a simulated
                        order, with no charge.
                      </p>
                      <button
                        className="primary wide"
                        disabled={locked}
                        onClick={() => void confirmOrder()}
                      >
                        {actionBusy ? "Confirming…" : "Confirm demo order"}
                        <Icon name="arrow" size={17} />
                      </button>
                      <small>
                        Quote valid until{" "}
                        {new Date(quote.expiresAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        .
                      </small>
                    </div>
                  ) : (
                    <button
                      className="primary wide"
                      disabled={locked}
                      onClick={() => void checkout()}
                    >
                      Review demo order
                      <Icon name="arrow" size={17} />
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </Modal>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
