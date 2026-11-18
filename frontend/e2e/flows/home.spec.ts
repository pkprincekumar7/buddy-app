import { expect, test } from '../fixtures';

// Home's Android app download (e2e/FLOWS.md, NAV-05): shown only in an Android browser.
// Download APK asks for a short-lived link (GET /downloads/apk) and opens it; the link's
// host is answered here, as S3 would, with the file as an attachment.

const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
const download = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: 'Download APK' });

test('NAV-05 outside Android, Home offers no APK', async ({ api, page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Continue Your Journey' })).toBeVisible();
  await expect(page.getByText('Get the Superpower Android App')).toHaveCount(0);
  expect(api.callsTo('GET /downloads/apk')).toHaveLength(0);
});

test.describe('in an Android browser', () => {
  test.use({ userAgent: ANDROID });

  test('NAV-05 Download APK fetches the link and downloads the app', async ({ api, page }) => {
    await page.route('https://downloads.example.test/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/vnd.android.package-archive',
        headers: { 'Content-Disposition': 'attachment; filename="superpower.apk"' },
        body: 'not really an apk',
      }),
    );
    // The link waits until the test has seen the button's busy state.
    let release = () => {};
    const held = new Promise<void>((r) => (release = r));
    const link = api.get('GET /downloads/apk');
    api.set('GET /downloads/apk', async (call) => {
      await held;
      return typeof link === 'function' ? link(call) : link!;
    });
    await page.goto('/');
    await expect(page.getByText('Get the Superpower Android App')).toBeVisible();
    const file = page.waitForEvent('download');
    await download(page).click();
    await expect.poll(() => api.callsTo('GET /downloads/apk').length).toBe(1);
    await expect(page.getByRole('button', { name: /Preparing/ })).toBeDisabled();
    release();
    expect((await file).suggestedFilename()).toBe('superpower.apk');
    await expect(download(page)).toBeEnabled();
    expect(api.callsTo('GET /downloads/apk')).toHaveLength(1);
  });

  test("NAV-05 a link that can't be fetched says so, and the button works again", async ({
    api,
    page,
  }) => {
    api.fail('GET /downloads/apk', 503);
    await page.goto('/');
    await download(page).click();
    await expect(
      page.getByText('Could not fetch the download link. Please try again.'),
    ).toBeVisible();
    await expect(download(page)).toBeEnabled();
  });
});
