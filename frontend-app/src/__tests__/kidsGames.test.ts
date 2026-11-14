import {
  DRAW_START,
  bestNote,
  climbSlide,
  climbSpot,
  climbTap,
  drawLift,
  drawTo,
  energyTick,
  gameSeconds,
  hidePlanets,
  orderTap,
  planetsFound,
  voiceStep,
  winLine,
} from '@/lib/kidsGames';

describe('kidsGames', () => {
  it("keeps a game's time to one decimal, within what the server keeps", () => {
    expect(gameSeconds(1000, 5260)).toBe(4.3);
    expect(gameSeconds(1000, 1100)).toBe(0.5);
    expect(gameSeconds(0, 10 * 60_000 + 1)).toBe(600);
  });

  it('says first try, a new best, or the best to beat', () => {
    expect(bestNote(4, undefined)).toEqual({
      isBest: true,
      text: 'First try!',
    });
    expect(bestNote(3.9, 4)).toEqual({ isBest: true, text: 'New best!' });
    expect(bestNote(4, 4)).toEqual({ isBest: false, text: 'Best: 4.0s' });
    expect(winLine('energy', 7.25)).toBe(
      'You popped 10 bubbles in 7.3 seconds. So much Energy!',
    );
  });

  it('hides three different planets among the nine boxes', () => {
    const planets = hidePlanets(() => 0.42);
    expect(new Set(planets).size).toBe(3);
    for (const p of planets) expect(p).toBeGreaterThanOrEqual(0);
    expect(planetsFound(planets, new Set([planets[0]!, 99]))).toBe(1);
  });

  it('joins the stars only in order, and a skipped one is wrong', () => {
    expect(orderTap(0, 0)).toEqual({ done: 1, wrong: false });
    expect(orderTap(1, 3)).toEqual({ done: 1, wrong: true });
    expect(orderTap(2, 0)).toEqual({ done: 2, wrong: false });
  });

  it('counts the line drawn, not the jumps between strokes', () => {
    let s = drawTo(DRAW_START, { x: 0, y: 0 }, false);
    s = drawTo(s, { x: 10, y: 0 });
    s = drawTo(s, { x: 10.5, y: 0 }); // too small a step: ignored
    expect(s.length).toBe(10);
    s = drawLift(s);
    s = drawTo(s, { x: 90, y: 90 }, false);
    expect(s.length).toBe(10);
    expect(s.points).toHaveLength(3);
  });

  it('climbs on a tap, slides when you stop, and stays at the top', () => {
    expect(climbTap(97)).toBe(100);
    expect(climbSlide(0.5)).toBe(0);
    expect(climbSlide(100)).toBe(100);
    expect(climbSpot(0)).toEqual({ x: 14, y: 86 });
    expect(climbSpot(100)).toEqual({ x: 50, y: 20 });
  });

  it('grows the voice while held and shrinks it when let go', () => {
    expect(voiceStep(10, true)).toBe(11.5);
    expect(voiceStep(1, false)).toBe(0);
    expect(voiceStep(100, false)).toBe(100);
  });

  it('raises the bubbles, drops the gone ones and adds new ones now and then', () => {
    const start = energyTick([], 1, () => 0.01);
    expect(start.bubbles).toHaveLength(1);
    expect(start.nextId).toBe(2);
    const gone = energyTick(
      [{ id: 1, x: 50, y: -11.8, speed: 0.5, size: 12, phase: 0 }],
      2,
      () => 0.5,
    );
    expect(gone.bubbles).toHaveLength(0);
  });
});
