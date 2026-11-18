// Page helpers (docs/web-ui-test-plan.md, section 6): layout, motion, randomness, media,
// Google sign-in and uploads. Each is installed before the app loads where it has to be.

import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/**
 * Elements that make the page (or the box `within`) scroll sideways: wider than the page,
 * or content an `overflow: hidden` box cuts off. Empty means the layout fits.
 */
export async function overflowing(page: Page, within = 'body'): Promise<string[]> {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector);
    if (!root) return [`no ${selector}`];
    const limit = Math.min(window.innerWidth, root.getBoundingClientRect().right);
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${
        el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''
      }`;
    const out: string[] = [];
    if (root.scrollWidth > root.clientWidth + 1)
      out.push(`${selector} scrolls sideways (${root.scrollWidth} > ${root.clientWidth})`);
    for (const el of root.querySelectorAll<HTMLElement>('*')) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      // Screen-reader-only text is a 1px clipped box on purpose (Tailwind's sr-only).
      if (r.width <= 1 || style.position === 'fixed' || style.visibility === 'hidden') continue;
      // Inside a box that scrolls or clips sideways on purpose (a row of chips, a carousel).
      let clipped = false;
      for (let a = el.parentElement; a && a !== root && !clipped; a = a.parentElement)
        clipped = ['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(a).overflowX);
      if (!clipped && r.right > limit + 1)
        out.push(`${name(el)} ends at ${Math.round(r.right)} > ${Math.round(limit)}`);
      // A box that clips sideways: a fault only when it cuts off content a person needs (text
      // or a control), not a decorative glow or a scenery layer drawn past its edge.
      if (el.scrollWidth > el.clientWidth + 1 && ['hidden', 'clip'].includes(style.overflowX)) {
        const box = el.getBoundingClientRect();
        const cut = [...el.querySelectorAll<HTMLElement>('*')].find((c) => {
          if (c.closest('[aria-hidden="true"]')) return false;
          const cs = getComputedStyle(c);
          if (cs.visibility === 'hidden' || cs.opacity === '0') return false;
          const control = /^(INPUT|SELECT|TEXTAREA|BUTTON|A)$/.test(c.tagName);
          const text = [...c.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim());
          if (!control && !text) return false;
          const r = c.getBoundingClientRect();
          return r.width > 1 && (r.right > box.right + 1 || r.left < box.left - 1);
        });
        if (cut)
          out.push(
            `${name(el)} cuts off ${name(cut)} "${(cut.textContent ?? '').trim().slice(0, 30)}" (${el.scrollWidth - el.clientWidth}px)`,
          );
      }
    }
    return out;
  }, within);
}

/**
 * Waits until every animation that ends has ended. Pulses and twinkles loop forever
 * (an infinite end time), so they're ignored.
 */
export async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
      .every((a) => a.playState !== 'running' && !a.pending),
  );
}

/**
 * Replaces Math.random with a repeating fixed sequence before the app loads, so the games'
 * light spots, bubbles, words and patterns are the same every run.
 */
export async function freezeRandom(page: Page, values: number[] = [0.5]): Promise<void> {
  await page.addInitScript((seq) => {
    let i = 0;
    Math.random = () => {
      const v = seq[i % seq.length] ?? 0.5;
      i += 1;
      return v;
    };
  }, values);
}

/**
 * Media without speakers or a microphone: play() resolves, speechSynthesis records what it
 * would say (read back with `spoken(page)`), and getUserMedia/MediaRecorder give a short
 * silent recording. `mic` says what the microphone does: `refused` (permission denied),
 * `broken` (no device, or it won't open) or `none` (no navigator.mediaDevices, as on a page
 * served over plain HTTP on iOS).
 */
export async function stubMedia(
  page: Page,
  { mic = 'ok' }: { mic?: 'ok' | 'refused' | 'broken' | 'none' } = {},
): Promise<void> {
  await page.addInitScript((micState) => {
    const w = window as unknown as { __spoken: string[] };
    w.__spoken = [];
    // No browser speech recognition: voice input records and uploads instead
    // (POST /speech/transcriptions), which the stubs answer.
    delete (window as unknown as Record<string, unknown>)['SpeechRecognition'];
    delete (window as unknown as Record<string, unknown>)['webkitSpeechRecognition'];
    HTMLMediaElement.prototype.play = function play() {
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function pause() {};
    const synth = {
      speaking: false,
      pending: false,
      paused: false,
      speak(u: SpeechSynthesisUtterance) {
        w.__spoken.push(u.text);
        setTimeout(() => u.onend?.(new Event('end') as SpeechSynthesisEvent), 0);
      },
      cancel() {},
      pause() {},
      resume() {},
      getVoices: () => [],
      addEventListener() {},
      removeEventListener() {},
      onvoiceschanged: null,
    };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });

    const silentStream = () => new MediaStream();
    const failure = {
      refused: new DOMException('Permission denied', 'NotAllowedError'),
      broken: new DOMException('Requested device not found', 'NotFoundError'),
    };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value:
        micState === 'none'
          ? undefined
          : {
              getUserMedia: () =>
                micState === 'refused' || micState === 'broken'
                  ? Promise.reject(failure[micState])
                  : Promise.resolve(silentStream()),
            },
    });
    class FakeRecorder extends EventTarget {
      static isTypeSupported = () => true;
      state: 'inactive' | 'recording' = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        const data = new Blob(['silence'], { type: 'audio/webm' });
        this.ondataavailable?.({ data });
        this.dispatchEvent(Object.assign(new Event('dataavailable'), { data }));
        this.onstop?.();
        this.dispatchEvent(new Event('stop'));
      }
    }
    Object.defineProperty(window, 'MediaRecorder', { value: FakeRecorder, configurable: true });
  }, mic);
}

/** What the app asked speechSynthesis to say, in order (after `stubMedia`). */
export async function spoken(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
}

/**
 * Google Identity Services without Google: the script is answered with a fake
 * `google.accounts.id` whose button calls the app's callback with a fake credential (the
 * app then calls `POST /auth/google`, which the scenario stubs).
 */
export async function stubGoogle(page: Page, credential = 'fake-google-id-token'): Promise<void> {
  await page.route('https://accounts.google.com/gsi/client', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `
        (() => {
          let callback = null;
          window.google = { accounts: { id: {
            initialize: (o) => { callback = o.callback; },
            renderButton: (el) => {
              const b = document.createElement('button');
              b.type = 'button';
              b.textContent = 'Continue with Google';
              b.onclick = () => callback && callback({ credential: ${JSON.stringify(credential)} });
              el.appendChild(b);
            },
            prompt: () => {},
            disableAutoSelect: () => {},
            cancel: () => {},
          } } };
        })();`,
    }),
  );
}

/** The presigned S3 form POSTs (avatars, plan photos): answered 204, or `status`. */
export async function stubUploads(page: Page, status = 204): Promise<string[]> {
  const uploads: string[] = [];
  await page.route('https://uploads.example.test/**', async (route) => {
    uploads.push(route.request().url());
    await route.fulfill({ status, body: '' });
  });
  return uploads;
}

/** Serious and critical accessibility problems on the page (axe), as readable lines.
 *  `skip` leaves out rules a known gap already covers (a test.fail of its own). */
export async function axe(page: Page, skip: string[] = []): Promise<string[]> {
  const builder = new AxeBuilder({ page });
  if (skip.length) builder.disableRules(skip);
  const results = await builder.analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help} — ${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 3)
          .join(', ')}`,
    );
}
