import type { Page } from '@playwright/test';
import { CHILD_ID, aChild, aPersonality, anOnboarding, progressThrough } from '../data/builders';
import { expect, test } from '../fixtures';
import { stubMedia, stubUploads } from '../helpers/page';

// Adding a child and the onboarding chat (e2e/FLOWS.md, ONB-01 to ONB-08), each write
// checked against what the app sent.

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const field = (page: Page, label: string) => page.getByLabel(label);
const cont = (page: Page) => page.getByRole('button', { name: /^Continue/ });

/** From Home with no children to the empty profile form. */
async function toForm(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start Your Journey' }).click();
  await page.getByRole('button', { name: /Let's start/ }).click();
  await expect(page.getByText('Tell us about your child')).toBeVisible();
}

async function fillForm(page: Page): Promise<void> {
  await field(page, "Child's Name").fill('Asha');
  await field(page, 'Age').fill('9');
  await page.getByRole('button', { name: 'Female', exact: true }).click();
  await field(page, 'School').fill('Test School');
}

test.describe('the profile form', () => {
  test.beforeEach(({ api }) => {
    api.use('newParent');
  });

  test('ONB-01 Continue with nothing filled says what is missing', async ({ api, page }) => {
    await toForm(page);
    await cont(page).click();
    for (const text of [
      'Name is required',
      'Age is required',
      'Please select a gender',
      'Please upload a photo or pick an avatar',
    ])
      await expect(page.getByText(text)).toBeVisible();
    await expect(field(page, "Child's Name")).toHaveAttribute('aria-invalid', 'true');
    expect(api.callsTo('POST /children')).toHaveLength(0);
  });

  for (const age of ['5', '26'])
    test(`ONB-01 an age of ${age} is refused`, async ({ page }) => {
      await toForm(page);
      await fillForm(page);
      await field(page, 'Age').fill(age);
      await cont(page).click();
      await expect(page.getByText('Age must be between 8 and 25')).toBeVisible();
    });

  test('ONB-01 a filled form with an avatar adds the child and opens the chat', async ({
    api,
    page,
  }) => {
    await toForm(page);
    await fillForm(page);
    await page.getByRole('button', { name: 'girl', exact: true }).click();
    await page.getByRole('button', { name: /Braid/ }).click();
    await cont(page).click();
    await expect(page).toHaveURL('/ConversationalOnboarding/c-new');
    expect(api.sent('POST /children')).toEqual([
      { name: 'Asha', age: 9, gender: 'Female', school: 'Test School', avatar_id: 'braid-girl' },
    ]);
  });

  test('ONB-01 an empty school is sent as none', async ({ api, page }) => {
    await toForm(page);
    await fillForm(page);
    await field(page, 'School').fill('   ');
    await page.getByRole('button', { name: /Capper/ }).click();
    await cont(page).click();
    await expect(page).toHaveURL('/ConversationalOnboarding/c-new');
    expect(api.sent('POST /children')[0]).toMatchObject({ school: null, avatar_id: 'capper-boy' });
  });

  test('ONB-01 a refused save says so and stays on the form', async ({ api, page }) => {
    api.fail('POST /children', 500, 'The children service is down.');
    await toForm(page);
    await fillForm(page);
    await page.getByRole('button', { name: /Capper/ }).click();
    await cont(page).click();
    await expect(page.getByText('The children service is down.')).toBeVisible();
    await expect(page.getByText('Tell us about your child')).toBeVisible();
  });

  test('ONB-02 a photo: presigned, uploaded, then saved by its key', async ({ api, page }) => {
    const uploads = await stubUploads(page);
    await toForm(page);
    await fillForm(page);
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'asha.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.locator('img[src^="data:image/png"]')).toBeVisible();
    await cont(page).click();
    await expect(page).toHaveURL('/ConversationalOnboarding/c-new');
    expect(api.sent('POST /children/{id}/avatar/presign')).toEqual([{ content_type: 'image/png' }]);
    expect(uploads).toEqual(['https://uploads.example.test/avatars']);
    expect(api.sent('PATCH /children/{id}')).toContainEqual(
      expect.objectContaining({ avatar_key: 'avatars/c-test/new.png' }),
    );
  });

  test('ONB-02 a failed upload saves the profile without it, and says so', async ({ page }) => {
    await stubUploads(page, 403);
    await toForm(page);
    await fillForm(page);
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'asha.png', mimeType: 'image/png', buffer: PNG });
    await cont(page).click();
    await expect(page.getByText(/The profile was saved without it\./)).toBeVisible();
    await expect(page).toHaveURL('/ConversationalOnboarding/c-new');
  });

  test('ONB-02 a file that is not an image is refused at once', async ({ api, page }) => {
    await toForm(page);
    await page.locator('input[type="file"]').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello'),
    });
    await expect(page.getByText(/JPEG, PNG, WebP or GIF/).last()).toBeVisible();
    expect(api.callsTo('POST /children/{id}/avatar/presign')).toHaveLength(0);
  });
});

test.describe("editing a child's profile", () => {
  test('ONB-03 a finished child: the form is filled, Save changes keeps the chat', async ({
    api,
    page,
  }) => {
    await page.goto(`/Onboarding/${CHILD_ID}`);
    await expect(field(page, "Child's Name")).toHaveValue('Asha');
    await expect(field(page, 'Age')).toHaveValue('9');
    await expect(page.getByRole('button', { name: 'Female', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await field(page, "Child's Name").fill('Asha Rose');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(`/PersonalityJourney/${CHILD_ID}`);
    expect(api.sent('PATCH /children/{id}')).toEqual([
      { name: 'Asha Rose', age: 9, gender: 'Female', school: 'Test School', avatar_id: 'avatar_1' },
    ]);
    expect(api.callsTo('POST /children')).toHaveLength(0);
  });

  test('ONB-03 a child in setup: saving goes on to the chat', async ({ api, page }) => {
    api.use('childInSetup');
    await page.goto(`/Onboarding/${CHILD_ID}`);
    await expect(field(page, "Child's Name")).toHaveValue('Asha');
    await cont(page).click();
    await expect(page).toHaveURL(`/ConversationalOnboarding/${CHILD_ID}`);
    expect(api.callsTo('PATCH /children/{id}')).toHaveLength(1);
  });

  test("ONB-03 a finished child's form offers to view the answers", async ({ page }) => {
    await page.goto(`/Onboarding/${CHILD_ID}`);
    await page.getByRole('button', { name: /answers/i }).click();
    await expect(page).toHaveURL(`/ConversationalOnboarding/${CHILD_ID}`);
  });
});

test.describe('the chat', () => {
  // Ivy types each question out: seven of them take a while.
  test.describe.configure({ timeout: 60_000 });
  test.beforeEach(async ({ api, page }) => {
    await stubMedia(page);
    api.use('childInSetup');
  });

  const ANSWERS = {
    strengths: ['Kind', 'Curious', 'Brave'],
    hobbies: ['Drawing', 'Football', 'Reading'],
    thinking_pattern: 'Visual',
    communication_style: 'Talkative',
    energy_level: 'Moderate - balanced',
    social_behaviour: 'Friendly',
    emotional_behaviour: 'Calm',
  };

  /** Answer all seven questions, until the app sends them (`saved` says it has). */
  async function answerAll(page: Page, saved: () => boolean): Promise<void> {
    const box = page.getByRole('textbox').first();
    await expect(page.getByText(/Mention the top 3 strengths that Asha has/)).toBeVisible();
    await box.fill(ANSWERS.strengths.join(', '));
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Mention the top 3 hobbies where Asha/)).toBeVisible();
    await page.getByRole('textbox').first().fill(ANSWERS.hobbies.join(', '));
    await page.keyboard.press('Enter');
    for (const [question, answer] of [
      [/thinking pattern/, ANSWERS.thinking_pattern],
      [/communication style/, ANSWERS.communication_style],
      [/energy level/, ANSWERS.energy_level],
      [/social situations/, ANSWERS.social_behaviour],
      [/emotionally/, ANSWERS.emotional_behaviour],
    ] as const) {
      const heading = page.getByRole('heading', { name: question });
      await expect(heading).toBeVisible();
      // A choice tapped while Ivy is still "typing" is ignored: tap until the question moves on.
      const choice = page.getByRole('button', { name: answer, exact: true });
      const last = answer === ANSWERS.emotional_behaviour;
      await expect(async () => {
        if (await choice.isVisible()) await choice.click({ timeout: 1000, force: last });
        // The last question stays up while the chat wraps up: wait for the save instead.
        if (last) expect(saved()).toBe(true);
        else await expect(heading).toHaveCount(0, { timeout: 3000 });
      }).toPass({ timeout: 20_000 });
    }
  }

  test('ONB-04 / ONB-06 seven answers, saved once, then the personality, then the journey', async ({
    api,
    page,
  }) => {
    let saved = false;
    api.set('PUT /children/{id}/onboarding', () => {
      saved = true;
      return { body: anOnboarding({ answers: ANSWERS }) };
    });
    api.set('GET /children/{id}', () => ({
      body: aChild({ progress: progressThrough(saved ? 'conversation' : 'profile') }),
    }));
    // The personality generates on its own once the answers are saved: it's polled.
    api.set('GET /children/{id}/personality', ({ count }) => ({
      body:
        saved && count > 2
          ? aPersonality()
          : aPersonality({ status: 'generating', view_model: null, job_id: null }),
    }));
    await page.goto(`/ConversationalOnboarding/${CHILD_ID}`);
    await answerAll(page, () => saved);
    await expect(page).toHaveURL(`/PersonalityJourney/${CHILD_ID}`, { timeout: 20_000 });
    expect(api.sent('PUT /children/{id}/onboarding')).toEqual([ANSWERS]);
  });

  test('ONB-04 a failed save says so, and Try again saves the same answers', async ({
    api,
    page,
  }) => {
    api.failOnce('PUT /children/{id}/onboarding', 500, 'The onboarding service is down.');
    api.set('GET /children/{id}/personality', { body: aPersonality() });
    await page.goto(`/ConversationalOnboarding/${CHILD_ID}`);
    await answerAll(page, () => api.callsTo('PUT /children/{id}/onboarding').length > 0);
    await expect(page.getByText('The onboarding service is down.')).toBeVisible();
    await page.getByRole('button', { name: /try again/i }).click();
    await expect(page).toHaveURL(`/PersonalityJourney/${CHILD_ID}`, { timeout: 20_000 });
    expect(api.sent('PUT /children/{id}/onboarding')).toEqual([ANSWERS, ANSWERS]);
  });

  test('ONB-05 voice input: record, stop, and the transcript fills the box', async ({
    api,
    page,
  }) => {
    await page.goto(`/ConversationalOnboarding/${CHILD_ID}`);
    await page.getByRole('button', { name: 'Start voice input' }).click();
    await page.getByRole('button', { name: 'Stop recording' }).click();
    await expect(page.getByRole('textbox').first()).toHaveValue(/She loves drawing maps/);
    expect(api.callsTo('POST /speech/transcriptions')).toHaveLength(1);
  });

  test('ONB-05 a refused microphone says so', async ({ api, page }) => {
    await stubMedia(page, { mic: 'refused' });
    await page.goto(`/ConversationalOnboarding/${CHILD_ID}`);
    await page.getByRole('button', { name: 'Start voice input' }).click();
    await expect(
      page.getByText('Microphone access was denied. Please allow mic access and try again.'),
    ).toBeVisible();
    expect(api.callsTo('POST /speech/transcriptions')).toHaveLength(0);
  });

  for (const [what, mic, message] of [
    [
      'a microphone that will not open',
      'broken',
      'Could not start recording. Please check your microphone.',
    ],
    [
      'no microphone at all (a page not on HTTPS)',
      'none',
      'Microphone is not available. Please make sure the page is loaded over HTTPS.',
    ],
  ] as const)
    test(`ONB-05 ${what} says so`, async ({ api, page }) => {
      await stubMedia(page, { mic });
      await page.goto(`/ConversationalOnboarding/${CHILD_ID}`);
      await page.getByRole('button', { name: 'Start voice input' }).click();
      await expect(page.getByText(message)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Start voice input' })).toBeVisible();
      expect(api.callsTo('POST /speech/transcriptions')).toHaveLength(0);
    });

  for (const [what, detail, message] of [
    [
      'a recording the service refuses says why',
      { code: 'audio_too_large', msg: 'Too large' },
      'That recording is too long. Please try a shorter one.',
    ],
    [
      'a transcription that fails says so',
      { code: 'unknown' },
      'Transcription failed. Please try again.',
    ],
  ] as const)
    test(`ONB-05 ${what}, and nothing lands in the box`, async ({ api, page }) => {
      api.fail('POST /speech/transcriptions', 503, detail);
      await page.goto(`/ConversationalOnboarding/${CHILD_ID}`);
      await page.getByRole('button', { name: 'Start voice input' }).click();
      await page.getByRole('button', { name: 'Stop recording' }).click();
      await expect(page.getByText(message)).toBeVisible();
      await expect(page.getByRole('textbox').first()).toHaveValue('');
      await expect(page.getByRole('button', { name: 'Start voice input' })).toBeEnabled();
      expect(api.callsTo('POST /speech/transcriptions')).toHaveLength(1);
    });

  test('ONB-07 a finished chat reopens on its answers, not the first question', async ({
    api,
    page,
  }) => {
    api.use('childDiscovered');
    await page.goto(`/ConversationalOnboarding/${CHILD_ID}`);
    await expect(page.getByText('Curious').first()).toBeVisible();
    await expect(page.getByText(/Mention the top 3 strengths/)).toHaveCount(0);
  });

  test('ONB-07 a finished chat: Continue saves its answers again, then the journey', async ({
    api,
    page,
  }) => {
    api.use('childDiscovered');
    await page.goto(`/ConversationalOnboarding/${CHILD_ID}`);
    const go = page.getByRole('button', { name: 'Continue to personality analysis' });
    await go.click();
    await expect(page).toHaveURL(`/PersonalityJourney/${CHILD_ID}`, { timeout: 20_000 });
    expect(api.sent('PUT /children/{id}/onboarding')).toHaveLength(1);
  });

  test('ONB-07 a Continue whose save fails says so, and Try again goes on', async ({
    api,
    page,
  }) => {
    api.use('childDiscovered');
    api.failOnce('PUT /children/{id}/onboarding', 500, 'The onboarding service is down.');
    await page.goto(`/ConversationalOnboarding/${CHILD_ID}`);
    await page.getByRole('button', { name: 'Continue to personality analysis' }).click();
    await expect(page.getByText('The onboarding service is down.')).toBeVisible();
    await page.getByRole('button', { name: /try again/i }).click();
    await expect(page).toHaveURL(`/PersonalityJourney/${CHILD_ID}`, { timeout: 20_000 });
    const [first, second] = api.sent('PUT /children/{id}/onboarding');
    expect(second).toEqual(first);
  });

  test('ONB-07 a chat left halfway starts again (answers are kept only once all are given)', async ({
    page,
  }) => {
    await page.goto(`/ConversationalOnboarding/${CHILD_ID}`);
    await page.getByRole('textbox').first().fill('Kind, Curious, Brave');
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Mention the top 3 hobbies/)).toBeVisible();
    await page.reload();
    await expect(page.getByText(/Mention the top 3 strengths that Asha has/)).toBeVisible();
  });
});

test('ONB-08 at ten children, Add Child is off', async ({ api, page }) => {
  api.use('tenChildren');
  await page.goto('/');
  await page.getByRole('button', { name: 'Your profile' }).click();
  await expect(page.getByRole('button', { name: 'Add Child' })).toBeDisabled();
});

test('ONB-08 below ten, Add Child opens an empty form', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Your profile' }).click();
  await page.getByRole('button', { name: 'Add Child' }).click();
  await expect(page).toHaveURL('/Onboarding');
});
