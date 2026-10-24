import { expect, test } from "@playwright/test";
import { DEFAULT_CONFIG, exportReplay } from "../../src/core";

test("throughput chart and current metric agree between delivery events", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByTestId("language-en").click();
  await page.getByTestId("replay-open").click();
  await page
    .getByTestId("replay-textarea")
    .fill(
      exportReplay({
        ...DEFAULT_CONFIG,
        messageCount: 2,
        sendIntervalMs: 2000,
        serviceMs: 10,
        delayMs: 10,
        jitterMs: 0,
        loss: 0,
        duplicate: 0,
        ack: false,
        retry: false,
      }),
    );
  await page.getByTestId("replay-import").click();
  await page.clock.install();
  await page.getByTestId("play-pause").click();
  await page.clock.runFor(1000);
  await page.getByTestId("play-pause").click();
  const metric = await page.getByTestId("metric-throughput").innerText();
  const chart = page.locator(".chart-panel").nth(1);
  const headline = await chart.locator(".chart-heading > span").innerText();
  expect(parseFloat(headline)).toBe(parseFloat(metric));
  expect(parseFloat(headline)).toBeLessThan(2);
  await expect(chart.getByRole("img")).toHaveAttribute(
    "aria-label",
    new RegExp(parseFloat(headline).toFixed(1)),
  );
});

test("chart axes remain readable and network adapts to its panel width", async ({
  page,
}) => {
  await page.goto("./");
  for (const viewport of [
    { width: 320, height: 844 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    const labels = page.locator(
      ".chart-y-axis span, .chart-x-axis span, .chart text",
    );
    expect(await labels.count()).toBeGreaterThanOrEqual(10);
    for (const label of await labels.all()) {
      const box = await label.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(10);
    }
    const network = await page.getByTestId("network").boundingBox();
    if (network && network.width <= 650)
      await expect(page.locator(".mobile-network")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
  }
});
