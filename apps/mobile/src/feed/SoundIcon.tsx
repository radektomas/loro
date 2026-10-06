import Svg, { Line, Path } from 'react-native-svg';

/**
 * A speaker, in SVG (Radek, 2026-10-06: the sound button "looks weird"). It
 * used to be built from Views and border tricks, because react-native-svg was
 * not in the binary then; it is now (since 1.7.0), so it is a real glyph:
 * a rounded speaker body, two soft waves when on, a clean slash when off.
 * One colour, round caps, drawn on a 24-unit grid.
 */
export function SoundIcon({ on, color, size = 14 }: { on: boolean; color: string; size?: number }) {
  return (
    <Svg width={size * (17 / 14)} height={size} viewBox="0 0 24 20">
      <Path
        d="M2.5 7.2c0-.7.5-1.2 1.2-1.2h3.1l4.6-3.7c.7-.6 1.6 0 1.6.8v13.8c0 .9-.9 1.4-1.6.8L6.8 14H3.7c-.7 0-1.2-.5-1.2-1.2z"
        fill={color}
      />
      {on ? (
        <>
          <Path d="M16.2 7.1c.9.8 1.4 1.8 1.4 2.9s-.5 2.1-1.4 2.9" stroke={color} strokeWidth={2} strokeLinecap="round" fill="none" />
          <Path d="M18.9 4.3c1.7 1.5 2.6 3.5 2.6 5.7s-.9 4.2-2.6 5.7" stroke={color} strokeWidth={2} strokeLinecap="round" fill="none" />
        </>
      ) : (
        <>
          <Line x1={16.5} y1={7} x2={22} y2={13} stroke={color} strokeWidth={2} strokeLinecap="round" />
          <Line x1={22} y1={7} x2={16.5} y2={13} stroke={color} strokeWidth={2} strokeLinecap="round" />
        </>
      )}
    </Svg>
  );
}
