import { stop } from '@/components/ui/svg-stop';

describe('stop()', () => {
  it('moves rgba alpha into stopOpacity (react-native-svg drops stopColor alpha)', () => {
    expect(stop('rgba(96,165,250,.13)')).toEqual({
      stopColor: 'rgb(96,165,250)',
      stopOpacity: 0.13,
    });
    expect(stop('rgba(240,201,138,0.26)', 0.5)).toEqual({
      stopColor: 'rgb(240,201,138)',
      stopOpacity: 0.13,
    });
  });
  it('passes opaque colors through', () => {
    expect(stop('rgb(75,233,255)')).toEqual({
      stopColor: 'rgb(75,233,255)',
      stopOpacity: 1,
    });
    expect(stop('#ffffff')).toEqual({ stopColor: '#ffffff', stopOpacity: 1 });
  });
});
