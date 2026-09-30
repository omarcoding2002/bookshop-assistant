import { randomUUID, randomBytes, createHash } from "node:crypto";
import type { Database, Queryable } from "./db.js";
import type { Catalogue } from "./catalogue.js";
import type { Cart, SessionState, Quote, Order } from "../shared.js";
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const policy = {
  storeName: "Between the Lines",
  currency: "USD",
  simulated: true,
  pricing:
    "Fictional fixed prices: paperback $12.99, hardcover $22.99, ebook $7.99, unspecified format $12.99. No discretionary discounts.",
  fulfilment:
    "Simulated orders only. No payment, delivery, tax or personal details required. No real returns or refunds.",
  stock:
    "Fictional stock is independent for each visitor. Validated editions can be purchased in the demo. Incomplete and work-only records are discovery-only.",
  suitability:
    "Age suitability and content warnings are not guaranteed; say when evidence is missing.",
};
export class Store {
  constructor(
    public db: Database,
    public catalogue: Catalogue,
  ) {}
  async createSession() {
    const id = randomUUID(),
      token = randomBytes(32).toString("hex");
    const state: SessionState = {
      id,
      cart: {},
      purchased: {},
      version: 0,
      messages: [],
      preferences: {},
      lastBookIds: [],
    };
    await this.db.query(
      "INSERT INTO sessions(id,token_hash,state,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '7 days')",
      [id, hashToken(token), JSON.stringify(state)],
    );
    return { token, state };
  }
  async authenticate(token?: string): Promise<SessionState> {
    if (!token)
      throw new AppError(
        401,
        "SESSION_REQUIRED",
        "Start a new bookshop session.",
      );
    const result = await this.db.query<{ state: SessionState }>(
      "SELECT state FROM sessions WHERE token_hash=$1 AND expires_at>NOW()",
      [hashToken(token)],
    );
    if (!result.rows[0])
      throw new AppError(
        401,
        "SESSION_EXPIRED",
        "Your session expired. Start a new session.",
      );
    return result.rows[0].state;
  }
  async state(id: string) {
    const result = await this.db.query<{ state: SessionState }>(
      "SELECT state FROM sessions WHERE id=$1 AND expires_at>NOW()",
      [id],
    );
    if (!result.rows[0])
      throw new AppError(401, "SESSION_EXPIRED", "Session expired.");
    return result.rows[0].state;
  }
  async change<T>(
    id: string,
    work: (state: SessionState, tx: Queryable) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      const result = await tx.query<{ state: SessionState }>(
        "SELECT state FROM sessions WHERE id=$1 AND expires_at>NOW() FOR UPDATE",
        [id],
      );
      if (!result.rows[0])
        throw new AppError(401, "SESSION_EXPIRED", "Session expired.");
      const state = result.rows[0].state;
      const value = await work(state, tx);
      await tx.query("UPDATE sessions SET state=$2 WHERE id=$1", [
        id,
        JSON.stringify(state),
      ]);
      return value;
    });
  }
  cart(state: SessionState): Cart {
    const lines = Object.entries(state.cart).map(([id, quantity]) => {
      const book = this.catalogue.get(id);
      if (!book)
        throw new AppError(
          409,
          "CATALOGUE_CHANGED",
          "A basket item is no longer available. Please start a new session.",
        );
      return { book, quantity, subtotalCents: quantity * book.priceCents };
    });
    return {
      lines,
      totalCents: lines.reduce((n, l) => n + l.subtotalCents, 0),
      count: lines.reduce((n, l) => n + l.quantity, 0),
      currency: "USD",
      version: state.version,
    };
  }
  available(state: SessionState, id: string) {
    return Math.max(
      0,
      (this.catalogue.get(id)?.stock || 0) - (state.purchased[id] || 0),
    );
  }
  async updateCart(id: string, bookId: string, quantity: number) {
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 5)
      throw new AppError(400, "QUANTITY", "Choose a quantity from 0 to 5.");
    return this.change(id, async (state) => {
      const book = this.catalogue.get(bookId);
      if (!book?.stocked)
        throw new AppError(
          404,
          "BOOK_NOT_STOCKED",
          "That edition is not stocked in this demo.",
        );
      if (quantity > this.available(state, bookId))
        throw new AppError(
          409,
          "OUT_OF_STOCK",
          "That quantity is unavailable. Try another book or a smaller quantity.",
        );
      if (quantity) state.cart[bookId] = quantity;
      else delete state.cart[bookId];
      if (Object.keys(state.cart).length > 20)
        throw new AppError(
          400,
          "CART_LIMIT",
          "The demo allows up to 20 different books per basket.",
        );
      state.version++;
      delete state.quoteId;
      return this.cart(state);
    });
  }
  async quote(id: string): Promise<Quote> {
    return this.change(id, async (state, tx) => {
      const cart = this.cart(state);
      if (!cart.count)
        throw new AppError(
          400,
          "EMPTY_CART",
          "Add a book before checking out.",
        );
      const quote: Quote = {
        id: randomUUID(),
        cart,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        label: "Demo quote — no payment will be taken",
      };
      await tx.query(
        "INSERT INTO quotes(id,session_id,cart_version,payload,expires_at) VALUES($1,$2,$3,$4,$5)",
        [quote.id, id, state.version, JSON.stringify(quote), quote.expiresAt],
      );
      state.quoteId = quote.id;
      return quote;
    });
  }
  async confirm(id: string, quoteId: string, key: string): Promise<Order> {
    return this.change(id, async (state, tx) => {
      const duplicate = await tx.query<{ payload: Order }>(
        "SELECT payload FROM orders WHERE session_id=$1 AND (idempotency_key=$2 OR quote_id=$3)",
        [id, key, quoteId],
      );
      if (duplicate.rows[0]) {
        if (duplicate.rows[0].payload.quoteId !== quoteId)
          throw new AppError(
            409,
            "KEY_REUSED",
            "This confirmation key was used for a different quote.",
          );
        return duplicate.rows[0].payload;
      }
      const result = await tx.query<{
        payload: Quote;
        cart_version: number;
        valid: boolean;
      }>(
        "SELECT payload,cart_version,expires_at>NOW() AS valid FROM quotes WHERE id=$1 AND session_id=$2",
        [quoteId, id],
      );
      const row = result.rows[0];
      if (!row) throw new AppError(404, "QUOTE_NOT_FOUND", "Quote not found.");
      if (
        !row.valid ||
        row.cart_version !== state.version ||
        state.quoteId !== quoteId
      )
        throw new AppError(
          409,
          "QUOTE_STALE",
          "Your quote changed or expired. Review a new quote before confirming.",
        );
      const cart = this.cart(state);
      if (
        cart.totalCents !== row.payload.cart.totalCents ||
        cart.lines.some((l) => l.quantity > this.available(state, l.book.id))
      )
        throw new AppError(
          409,
          "STOCK_CHANGED",
          "Price or availability changed. Please review your basket.",
        );
      const order: Order = {
        id: `DEMO-${randomUUID()}`,
        quoteId,
        cart,
        createdAt: new Date().toISOString(),
        label: "Demo order — no payment taken",
      };
      await tx.query(
        "INSERT INTO orders(id,session_id,quote_id,idempotency_key,payload) VALUES($1,$2,$3,$4,$5)",
        [order.id, id, quoteId, key, JSON.stringify(order)],
      );
      for (const line of cart.lines)
        state.purchased[line.book.id] =
          (state.purchased[line.book.id] || 0) + line.quantity;
      state.cart = {};
      state.version++;
      delete state.quoteId;
      return order;
    });
  }
  async orders(id: string) {
    return (
      await this.db.query<{ payload: Order }>(
        "SELECT payload FROM orders WHERE session_id=$1 ORDER BY id",
        [id],
      )
    ).rows.map((r) => r.payload);
  }
  async cleanup() {
    await this.db.query("DELETE FROM sessions WHERE expires_at<NOW()");
    await this.db.query(
      "DELETE FROM catalogue_cache WHERE expires_at<NOW()-INTERVAL '7 days'",
    );
  }
}
