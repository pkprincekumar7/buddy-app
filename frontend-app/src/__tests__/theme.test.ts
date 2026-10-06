import { color, css, edge, font, hsl, rgb, withAlpha } from '@/theme';

describe('theme tokens (generated from frontend/src/index.css)', () => {
  it('resolves semantic hsl tokens to the web hex values', () => {
    expect(color.background).toBe('#0a0a0a');
    expect(color.primary).toBe('#3ee0cf');
    // hsl(174 84% 32%) exactly as the browser renders it (index.css's '#0d9488' comment is approximate)
    expect(color['primary-action']).toBe('#0d9688');
    expect(color['muted-foreground']).toBe('#94a3b8');
  });

  it('applies alpha like hsl(var(--x) / a) and rgb(var(--x-rgb) / a)', () => {
    expect(hsl('primary', 0.2)).toBe('rgba(62,224,207,0.2)');
    expect(rgb('constellation-cyan')).toBe('rgb(75,233,255)');
    expect(rgb('constellation-cyan', 0.7)).toBe('rgba(75,233,255,0.7)');
    expect(edge(0.08)).toBe('rgba(255,255,255,0.08)');
    expect(withAlpha('#ffffff', 0.5)).toBe('rgba(255,255,255,0.5)');
  });

  it('resolves var() references inside web CSS strings', () => {
    expect(css('0 0 16px rgb(var(--constellation-cyan-rgb) / .7)')).toBe(
      '0 0 16px rgba(75,233,255,0.7)',
    );
    expect(
      css(
        'linear-gradient(to right, hsl(var(--primary-medium)), hsl(var(--primary) / 50%))',
      ),
    ).toBe('linear-gradient(to right, #10b7a6, rgba(62,224,207,0.5))');
    expect(css('linear-gradient(var(--bg-deep-1), var(--bg-deep-3))')).toBe(
      'linear-gradient(#0d1525, #080c18)',
    );
  });

  it('includes mobile supplementary tokens for colors the web writes inline', () => {
    expect(rgb('starfield', 0.5)).toBe('rgba(190,235,255,0.5)');
  });

  it('maps web font family + weight to a per-weight family', () => {
    expect(font('orbitron', 900)).toEqual({ fontFamily: 'Orbitron-Black' });
    expect(font('orbitron', 700)).toEqual({ fontFamily: 'Orbitron-Bold' });
    expect(font('rajdhani', 600)).toEqual({ fontFamily: 'Rajdhani-SemiBold' });
    expect(font('rajdhani', 500)).toEqual({ fontFamily: 'Rajdhani-Medium' });
  });
});
