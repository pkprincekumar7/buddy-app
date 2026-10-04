import { SearchParams, buildPath, parsePath } from '@/lib/router';

describe('router path parsing (web App.tsx routes → stack routes)', () => {
  it('maps / and bare pages', () => {
    expect(parsePath('/')).toEqual({ name: 'Home', params: {} });
    expect(parsePath('/Home')).toEqual({ name: 'Home', params: {} });
    expect(parsePath('/Onboarding')).toEqual({
      name: 'Onboarding',
      params: {},
    });
  });

  it('extracts childId and sub-paths', () => {
    expect(parsePath('/GrowthAreas/abc')).toEqual({
      name: 'GrowthAreas',
      params: { childId: 'abc' },
    });
    expect(parsePath('/PersonalityJourney/c1/DimensionCircles')).toEqual({
      name: 'PersonalityJourney',
      params: { childId: 'c1', sub: 'DimensionCircles' },
    });
  });

  it('redirects stale /GrowthAreas/:id/Activity/... links to the map', () => {
    expect(parsePath('/GrowthAreas/c1/Activity/self-care/Game?q=1')).toEqual({
      name: 'GrowthAreas',
      params: { childId: 'c1', search: 'q=1' },
    });
  });

  it('sends unknown pages to NotFound', () => {
    expect(parsePath('/PersonalityType/c1').name).toBe('NotFound');
  });

  it('round-trips through buildPath', () => {
    expect(
      buildPath('PersonalityJourney', {
        childId: 'c1',
        sub: 'DimensionCircles',
      }),
    ).toBe('/PersonalityJourney/c1/DimensionCircles');
    expect(buildPath('Home')).toBe('/Home');
  });
});

describe('SearchParams', () => {
  it('reads, sets and serialises like URLSearchParams', () => {
    const sp = new SearchParams('?a=1&b=hello%20world&c=x+y');
    expect(sp.get('a')).toBe('1');
    expect(sp.get('b')).toBe('hello world');
    expect(sp.get('c')).toBe('x y');
    expect(sp.get('missing')).toBeNull();
    sp.set('a', '2');
    sp.delete('b');
    expect(sp.toString()).toBe('c=x%20y&a=2');
  });
});
