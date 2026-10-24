import { expect, test } from '@playwright/test';

for (const width of [320, 1440]) {
  test(`modal contains scrolling and restores the page at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('./');
    const opener = page.getByTestId('replay-open');
    await opener.click();
    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible();
    await dialog.evaluate(element => { element.scrollTop = element.scrollHeight; });
    const scrollBefore = await page.evaluate(() => scrollY);
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.move(bounds!.x + bounds!.width - 12, Math.min(820, bounds!.y + bounds!.height - 30));
    await page.mouse.wheel(0, 2000);
    // Let compositor scrolling settle; a leaked wheel scroll changes the document.
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => scrollY)).toBe(scrollBefore);
    await expect(dialog).toBeVisible();
    const dimensions = await dialog.evaluate(element => ({ height: element.clientHeight, content: element.scrollHeight }));
    if (dimensions.content > dimensions.height) {
      await dialog.evaluate(element => { element.scrollTop = 0; });
      await page.mouse.wheel(0, 100);
      await expect.poll(() => dialog.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).not.toBe('hidden');
    await page.evaluate(() => scrollTo(0, 0));
    if (await page.evaluate(() => document.documentElement.scrollHeight > innerHeight)) {
      await page.mouse.move(width / 2, 700);
      await page.mouse.wheel(0, 400);
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
    }
  });
}
