export type Book = {
  id: string;
  workId: string;
  title: string;
  authors: string[];
  category: string;
  subjects: string[];
  isbn: string[];
  year?: number;
  pages?: number;
  format: "paperback" | "hardcover" | "ebook" | "unspecified";
  priceCents: number;
  stock: number;
  stocked: boolean;
  sourceUrl: string;
  fetchedAt: string;
  coverId?: number;
};
export type CartLine = { book: Book; quantity: number; subtotalCents: number };
export type Cart = {
  lines: CartLine[];
  totalCents: number;
  count: number;
  currency: "USD";
  version: number;
};
export type Quote = {
  id: string;
  cart: Cart;
  expiresAt: string;
  label: string;
};
export type Order = {
  id: string;
  quoteId: string;
  cart: Cart;
  createdAt: string;
  label: string;
};
export type Message = { role: "user" | "assistant"; content: string };
export type Preferences = {
  budgetCents?: number;
  category?: string;
  recipient?: string;
  interests?: string[];
  readingLevel?: string;
  avoid?: string[];
  rejectedBookIds?: string[];
};
export type SessionState = {
  id: string;
  cart: Record<string, number>;
  purchased: Record<string, number>;
  version: number;
  messages: Message[];
  preferences: Preferences;
  lastBookIds: string[];
  quoteId?: string;
};
export type ChatResult = {
  text: string;
  books: Book[];
  cart: Cart;
  quote?: Quote;
  order?: Order;
  mode: "ai" | "offline";
  warning?: string;
};
export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
