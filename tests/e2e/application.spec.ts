import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { SCENARIOS, Simulation } from "../../src/core";

async function assertNoSeriousA11yViolations(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter(
    (violation) =>
      violation.impact === "critical" || violation.impact === "serious",
  );
  if (serious.length > 0) {
    await test.info().attach("axe-violations.json", {
      body: JSON.stringify(serious, null, 2),
      contentType: "application/json",
    });
  }
  expect(
    serious.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
}

async function assertNoPageOverflow(page: Page) {
  const sizes = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.width + 1);
}

test("RU and EN initial states are accessible and honest about simulated metrics", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("./");
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  const expectedBuild =
    process.env.EXPECTED_BUILD_SHA || process.env.GITHUB_SHA;
  await expect(page.getByTestId("build-sha")).toHaveAttribute(
    "data-build-sha",
    expectedBuild || /^(development|[0-9a-f]{40})$/,
  );
  await expect(page.getByTestId("simulation-status")).toHaveAttribute(
    "data-status",
    "ready",
  );
  await expect(page.getByTestId("simulation-time")).toHaveText("0.00s");
  await expect(page.locator('[data-testid^="scenario-"]')).toHaveCount(4);
  await expect(page.getByTestId("network-text-alternative")).toBeVisible();
  await assertNoSeriousA11yViolations(page);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: testInfo.outputPath("desktop-ru.png"),
    fullPage: true,
  });
  await page.getByTestId("language-en").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Deliver.",
  );
  await expect(
    page.getByText("Not a network analyzer. Not a TCP implementation."),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Every value is computed by the model. These are not real network measurements.",
    ),
  ).toBeVisible();
  await assertNoSeriousA11yViolations(page);
  await assertNoPageOverflow(page);
  await expect(
    page.getByRole("button", { name: "Step", exact: true }),
  ).toBeEnabled();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByTestId("config-loss").focus();
  await page.keyboard.press("Home");
  await page.getByTestId("step").click();
  await page.getByTestId("step").click();
  await expect(page.locator(".network-svg .packet").first()).toBeAttached();
  await expect(page.locator(".network-svg .packet").first()).toHaveCSS(
    "display",
    "none",
  );
  expect(errors).toEqual([]);
});

test("play, pause, step and reset change the actual engine state", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByTestId("language-en").click();
  await page.getByTestId("scenario-backoff").click();
  await page.getByTestId("speed").selectOption("0.5");
  await page.getByTestId("play-pause").click();
  await expect(page.getByTestId("play-pause")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect
    .poll(() => page.getByTestId("simulation-time").innerText())
    .not.toBe("0.00s");
  await page.getByTestId("play-pause").click();
  await expect(page.getByTestId("play-pause")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  const pausedTime = await page.getByTestId("simulation-time").innerText();
  await page.waitForTimeout(200);
  await expect(page.getByTestId("simulation-time")).toHaveText(pausedTime);
  const previousTrace = await page.getByTestId("event-trace").innerText();
  await page.getByTestId("step").click();
  await expect(page.getByTestId("event-trace")).not.toHaveText(previousTrace);
  await page.getByTestId("reset").click();
  await expect(page.getByTestId("simulation-time")).toHaveText("0.00s");
  await expect(page.getByTestId("simulation-status")).toHaveAttribute(
    "data-status",
    "ready",
  );
  await expect(page.getByTestId("metric-applied")).toHaveText("0");
  await expect(page.getByTestId("event-trace")).toContainText(
    "The cause and effect of each step will appear here.",
  );
});

test("all four browser scenarios agree with the pure simulation results", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("./");
  await page.getByTestId("language-en").click();
  await page.getByTestId("speed").selectOption("16");
  for (const scenario of SCENARIOS) {
    const expected = new Simulation(scenario.config).runToEnd();
    await page.getByTestId(`scenario-${scenario.id}`).click();
    await expect(page.getByTestId(`scenario-${scenario.id}`)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByTestId("play-pause").click();
    await expect(page.getByTestId("simulation-status")).toHaveAttribute(
      "data-status",
      expected.status,
      { timeout: 20_000 },
    );
    await expect(page.getByTestId("metric-delivered")).toHaveText(
      `${expected.metrics.delivered}/ ${scenario.config.messageCount}`,
    );
    await expect(page.getByTestId("metric-applied")).toHaveText(
      String(expected.metrics.applied),
    );
    await expect(page.getByTestId("metric-retries")).toHaveText(
      String(expected.metrics.retries),
    );
    await expect(page.getByTestId("simulation-time")).toHaveText(
      `${(expected.now / 1000).toFixed(2)}s`,
    );
    await expect(page.getByTestId("step")).toBeDisabled();
    const outcomeDetails = page.locator(".outcomes-details");
    if (
      !(await outcomeDetails.evaluate(
        (element) => (element as HTMLDetailsElement).open,
      ))
    ) {
      await outcomeDetails.locator("summary").click();
    }
    await expect(outcomeDetails.locator("tbody tr")).toHaveCount(
      scenario.config.messageCount,
    );
    const failureLabel = scenario.config.ack
      ? /^Unconfirmed$/
      : /^Undelivered$/;
    await expect(
      outcomeDetails
        .locator("tbody tr td:last-child")
        .filter({ hasText: failureLabel }),
    ).toHaveCount(expected.metrics.failed);
  }
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: testInfo.outputPath("desktop-dedup-complete.png"),
    fullPage: true,
  });
  await page.locator(".instrument-panel").screenshot({
    path: testInfo.outputPath("desktop-instrument.png"),
  });
});

test("replay export, strict input error, import reset and dialog keyboard behavior", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await page.getByTestId("language-en").click();
  await page.getByTestId("scenario-dedup").click();
  await page.getByTestId("replay-open").click();
  await expect(page.getByTestId("replay-dialog")).toBeVisible();
  const json = await page.getByTestId("replay-textarea").inputValue();
  const envelope = JSON.parse(json);
  expect(envelope.schemaVersion).toBe(1);
  expect(envelope.config).toEqual(
    SCENARIOS.find((scenario) => scenario.id === "dedup")!.config,
  );
  await assertNoSeriousA11yViolations(page);
  const downloadEvent = page.waitForEvent("download");
  await page.getByTestId("replay-export").click();
  const download = await downloadEvent;
  const downloadPath = testInfo.outputPath("replay.json");
  await download.saveAs(downloadPath);
  expect(JSON.parse(await readFile(downloadPath, "utf8"))).toEqual(envelope);
  await page.getByTestId("replay-textarea").fill("{");
  await page.getByTestId("replay-import").click();
  await expect(page.getByTestId("replay-error")).toContainText(
    "Could not read the replay.",
  );
  await expect(page.getByTestId("replay-dialog")).toBeVisible();
  await page
    .getByTestId("replay-textarea")
    .fill(JSON.stringify({ ...envelope, schemaVersion: 99 }));
  await page.getByTestId("replay-import").click();
  await expect(page.getByTestId("replay-error")).toContainText(
    "Unsupported replay schemaVersion",
  );
  await page.getByTestId("replay-file").setInputFiles({
    name: "too-large.json",
    mimeType: "application/json",
    buffer: Buffer.alloc(1_000_000, "x"),
  });
  await expect(page.getByTestId("replay-error")).toContainText(
    "File too large",
  );
  await page.getByTestId("replay-file").setInputFiles({
    name: "valid-replay.json",
    mimeType: "application/json",
    buffer: Buffer.from(json),
  });
  await expect(page.getByTestId("replay-textarea")).toHaveValue(json);
  await expect(page.getByTestId("replay-import")).toBeEnabled();
  await page.getByTestId("replay-textarea").fill(json);
  await page.getByTestId("replay-import").click();
  await expect(page.getByTestId("replay-dialog")).not.toBeVisible();
  await expect(page.getByTestId("simulation-time")).toHaveText("0.00s");
  await expect(page.getByTestId("metric-applied")).toHaveText("0");
  await page.getByTestId("replay-open").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("replay-dialog")).not.toBeVisible();
  await expect(page.getByTestId("replay-open")).toBeFocused();
  await page.getByTestId("replay-open").click();
  await page.getByTestId("replay-textarea").fill(
    JSON.stringify({
      schemaVersion: 1,
      config: {
        ...envelope.config,
        messageCount: 2,
        sendIntervalMs: 0,
        delayMs: 100,
        jitterMs: 0,
        serviceMs: 10,
        loss: 0,
        duplicate: 0,
        ack: false,
        retry: true,
        dedup: true,
        backoff: false,
        retryJitter: false,
        maxAttempts: 3,
        timeoutMs: 100,
        queueCapacity: 16,
      },
    }),
  );
  await page.getByTestId("replay-import").click();
  await expect(page.getByTestId("config-retry")).toBeChecked();
  await expect(page.getByTestId("config-retry")).toBeEnabled();
  await page.getByTestId("speed").selectOption("16");
  await page.getByTestId("play-pause").click();
  await expect(page.getByTestId("simulation-status")).toHaveAttribute(
    "data-status",
    "complete",
  );
  await expect(page.getByTestId("metric-delivered")).toHaveText("2/ 2");
  await expect(page.getByTestId("metric-applied")).toHaveText("2");
  await expect(page.getByTestId("metric-retries")).toHaveText("4");
});

test("mobile, reduced motion, keyboard and validation stay usable", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./");
  await page.getByTestId("language-en").click();
  for (const width of [320, 768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await assertNoPageOverflow(page);
  }
  await assertNoPageOverflow(page);
  await assertNoSeriousA11yViolations(page);
  const motionStyle = await page
    .getByTestId("scenario-naive")
    .evaluate((element) => ({
      transition: getComputedStyle(element).transitionDuration,
      animation: getComputedStyle(element).animationName,
    }));
  expect(motionStyle).toEqual({ transition: "0s", animation: "none" });
  await page.getByTestId("step").focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByTestId("step")).toBeFocused();
  const focusStyle = await page.getByTestId("step").evaluate((element) => ({
    outline: getComputedStyle(element).outlineStyle,
    shadow: getComputedStyle(element).boxShadow,
  }));
  expect(
    focusStyle.outline !== "none" || focusStyle.shadow !== "none",
  ).toBeTruthy();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("event-trace")).not.toContainText(
    "The cause and effect of each step will appear here.",
  );
  await page.getByTestId("reset").click();
  await expect(page.locator(".advanced-settings > summary")).toContainText(
    "More parameters",
  );
  await page.locator(".advanced-settings > summary").click();
  const seed = page.getByRole("spinbutton", { name: /^Seed/ });
  await seed.fill("-1");
  await seed.press("Tab");
  await expect(seed).toHaveAttribute("aria-invalid", "true");
  await seed.fill("42");
  await seed.press("Enter");
  await expect(seed).toHaveAttribute("aria-invalid", "false");
  await expect(page.getByTestId("simulation-time")).toHaveText("0.00s");
  await page.getByTestId("replay-open").click();
  const replay = JSON.parse(
    await page.getByTestId("replay-textarea").inputValue(),
  );
  expect(replay.config.seed).toBe(42);
  await assertNoPageOverflow(page);
  await assertNoSeriousA11yViolations(page);
  await page.keyboard.press("Escape");
  await page.getByTestId("scenario-dedup").click();
  await page.getByTestId("speed").selectOption("16");
  await page.getByTestId("play-pause").click();
  await expect(page.getByTestId("simulation-status")).toHaveAttribute(
    "data-status",
    "complete",
  );
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: testInfo.outputPath("mobile-en.png"),
    fullPage: true,
  });
  await page
    .locator("#experiment")
    .evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.screenshot({
    path: testInfo.outputPath("mobile-instrument.png"),
    fullPage: false,
  });
});
