import { POWER_COUNT, POWER_SLOTS, powerSize } from '@/lib/kidsPowers';

describe('kidsPowers', () => {
  it('puts the first power at the top and the rest clockwise on the orbit', () => {
    expect(POWER_SLOTS).toHaveLength(POWER_COUNT);
    expect(POWER_SLOTS[0]).toEqual({ x: 50, y: 11 });
    // Clockwise: the second is to the right of the top.
    expect(POWER_SLOTS[1]!.x).toBeGreaterThan(50);
    for (const { x, y } of POWER_SLOTS) {
      expect(Math.hypot(x - 50, y - 50)).toBeCloseTo(39, 0);
    }
  });

  it('makes a higher level a bigger bubble', () => {
    expect(powerSize(5)).toBeGreaterThan(powerSize(3));
  });
});
