import {
  allowedInChildView,
  childViewHome,
  isKidsArea,
  kidsPath,
} from '@/lib/childView';

describe('child view routes', () => {
  it('opens the child view on the circles, and the kids page by circle', () => {
    expect(childViewHome('a')).toBe('/PersonalityJourney/a/DimensionCircles');
    expect(kidsPath('a', 'grow')).toBe('/Kids/a/grow');
  });

  it("allows only the child's hub and kids page", () => {
    expect(allowedInChildView('/PersonalityJourney/a', 'a')).toBe(true);
    expect(
      allowedInChildView('/PersonalityJourney/a/DimensionCircles', 'a'),
    ).toBe(true);
    expect(allowedInChildView('/Kids/a/release', 'a')).toBe(true);
  });

  it("closes every parent page, and another child's", () => {
    for (const path of [
      '/Home',
      '/',
      '/Onboarding/a',
      '/ConversationalOnboarding/a',
      '/AccountSettings',
      '/PersonalityProfile/a',
      '/GrowthAreas/a',
      '/LifePathway/a',
      '/Observations/a',
      '/Connect/a',
      '/PersonalityJourney/b',
      '/Kids/b/grow',
    ]) {
      expect(allowedInChildView(path, 'a')).toBe(false);
    }
  });

  it('closes unknown circles and extra path segments', () => {
    expect(allowedInChildView('/Kids/a/settings', 'a')).toBe(false);
    expect(allowedInChildView('/Kids/a', 'a')).toBe(false);
    expect(allowedInChildView('/Kids/a/grow/x', 'a')).toBe(false);
    expect(allowedInChildView('/PersonalityJourney/a/Other', 'a')).toBe(false);
  });

  it('knows the five circles', () => {
    expect(isKidsArea('discover')).toBe(true);
    expect(isKidsArea('Discover')).toBe(false);
    expect(isKidsArea(undefined)).toBe(false);
  });
});
