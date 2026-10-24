// Ready to copy into packetlab/tests/e2e/. Uses the repository's installed runner.
import { test, expect } from '@playwright/test';

test('all channel sliders have stable accessible names and visible labels focus them', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('language-en').click();
  for (const [key, name] of [
    ['loss', 'Packet loss'],
    ['duplicate', 'Duplication'],
    ['delayMs', 'Base delay'],
    ['jitterMs', 'Delay variation'],
  ] as const) {
    const slider = page.getByRole('slider', { name, exact: true });
    await expect(slider).toHaveAttribute('data-testid', `config-${key}`);
    await page.getByText(name, { exact: true }).click();
    await expect(slider).toBeFocused();
    await slider.press('Home');
    await slider.press('ArrowRight');
    await expect(slider).toHaveAccessibleName(name);
    const value = await slider.inputValue();
    await expect(slider).toHaveAttribute('aria-valuetext', /%|ms/);
    expect(Number(value)).toBeGreaterThan(Number(await slider.getAttribute('min')));
  }
});

test('Run completion is exposed through a polite status without the ticking clock', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('language-en').click();
  await page.getByTestId('speed').selectOption('16');
  await page.getByTestId('play-pause').click();
  await expect(page.getByTestId('simulation-status')).toHaveAttribute('data-status', 'complete');
  const completion = page.getByRole('status').filter({ hasText: 'Experiment complete' });
  await expect(completion).toBeVisible();
  await expect(completion).not.toContainText(/\d+\.\d+s/);
  await expect(page.getByTestId('step')).toBeDisabled();
  await expect(page.getByTestId('play-pause')).toHaveAttribute('aria-pressed', 'false');
});
