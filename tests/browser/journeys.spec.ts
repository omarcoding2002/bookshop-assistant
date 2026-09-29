import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("https://covers.openlibrary.org/**", (route) =>
    route.abort(),
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "A mystery for under $15", exact: true }),
  ).toBeEnabled();
});
test("a visitor can discover a book and complete a simulated order", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .getByRole("button", { name: "A mystery for under $15", exact: true })
    .click();
  await expect(page.locator(".chat-book")).toHaveCount(3);
  await page.getByLabel("Message your bookseller").fill("add the first one");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator(".basket-button b")).toHaveText("1");
  await page.getByRole("button", { name: /Your basket/ }).click();
  await page
    .getByRole("button", { name: "Review demo order", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm demo order", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm demo order", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Demo order confirmed" }),
  ).toBeVisible();
  await expect(
    page.getByText("No payment was taken. No books will be shipped."),
  ).toBeVisible();
  await expect(page.locator(".basket-button b")).toHaveText("0");
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("filter, inspect an edition, and change quantities before checkout", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Mystery", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Maximum price" })
    .selectOption("15");
  await expect(page.locator(".book-card")).toHaveCount(10);
  const first = page.locator(".book-card").first();
  await first.locator(".book-art").click();
  await expect(
    page.getByRole("dialog", { name: "A closer look" }),
  ).toBeVisible();
  await expect(page.getByText("View edition on Open Library")).toBeVisible();
  await page.getByRole("button", { name: /Add to basket —/ }).click();
  await page.getByRole("button", { name: "Close A closer look" }).click();
  await page.getByRole("button", { name: /Your basket/ }).click();
  await page.getByRole("button", { name: /Increase quantity/ }).click();
  await expect(page.locator(".quantity>span")).toHaveText("2");
  await page
    .getByRole("button", { name: "Review demo order", exact: true })
    .click();
  await page.getByRole("button", { name: /Decrease quantity/ }).click();
  await expect(
    page.getByRole("button", { name: "Confirm demo order", exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review demo order", exact: true }),
  ).toBeVisible();
});
test("unknown search, offline transparency, and a fresh session", async ({
  page,
}) => {
  await expect(page.getByText("Offline demo · guided responses")).toBeVisible();
  await page.getByLabel("Search books").fill("zzzznonexistentbookzzzz");
  await expect(
    page.getByText("No books on this shelf just yet."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Browse all books" }).click();
  await expect(page.locator(".book-card")).toHaveCount(12);
  await page
    .getByRole("button", { name: "Help me find a gift", exact: true })
    .click();
  await expect(
    page.getByText(
      "Who is the gift for, and what do they enjoy reading? An approximate age and budget will help too.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start fresh" }).click();
  await expect(
    page.getByRole("button", { name: "Help me find a gift", exact: true }),
  ).toBeVisible();
});
test("capture usable layout", async ({ page }, info) => {
  await expect(page.locator(".book-card")).toHaveCount(12);
  await page.screenshot({
    path: `docs/screenshots/${info.project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
