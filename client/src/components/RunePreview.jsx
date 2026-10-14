import { TEMPLATES, SPELLS } from '@rune/shared';

// Tiny SVG rendering of a rune's shape, used on cards and pickers.
export default function RunePreview({ spellId, size = 34 }) {
  const pts = TEMPLATES[spellId];
  if (!pts) return null;
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.x * 100).toFixed(1)},${(p.y * 100).toFixed(1)}`).join(' ');
  return (
    <svg className="rune-preview" width={size} height={size} viewBox="-10 -10 120 120">
      <path d={d} fill="none" stroke={SPELLS[spellId].color} strokeWidth="7"
        strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
      <circle cx={pts[0].x * 100} cy={pts[0].y * 100} r="8" fill={SPELLS[spellId].color} opacity="0.7" />
    </svg>
  );
}
