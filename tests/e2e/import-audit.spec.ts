import { expect, test } from '@playwright/test';

test('closing replay invalidates a pending file and reopens a usable current draft', async ({ page }) => {
  await page.addInitScript(() => {
    const original = File.prototype.text;
    const state: { started: boolean; done: boolean; release?: () => void } = { started: false, done: false };
    (window as unknown as { importGate: typeof state }).importGate = state;
    File.prototype.text = async function () {
      state.started = true;
      await new Promise<void>(resolve => { state.release = resolve; });
      const text = await original.call(this);
      state.done = true;
      return text;
    };
  });
  await page.goto('./');
  await page.getByTestId('replay-open').click();
  await page.getByTestId('replay-file').setInputFiles({ name: 'slow.json', mimeType: 'application/json', buffer: Buffer.from('old file') });
  await page.waitForFunction(() => (window as unknown as { importGate: { started: boolean } }).importGate.started);
  await page.keyboard.press('Escape');
  await page.getByTestId('replay-open').click();
  const field = page.getByTestId('replay-textarea');
  await expect(field).toBeEnabled();
  const current = await field.inputValue();
  await page.evaluate(() => (window as unknown as { importGate: { release: () => void } }).importGate.release());
  await page.waitForFunction(() => (window as unknown as { importGate: { done: boolean } }).importGate.done);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(field).toHaveValue(current);
  await expect(field).toBeEnabled();
});
