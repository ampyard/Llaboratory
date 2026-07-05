// Vibrant color palette for charts - each color is bold and distinct
export const VIBRANT = [
  '#6366F1', // indigo
  '#EC4899', // pink
  '#14B8A6', // teal
  '#F59E0B', // amber
  '#8B5CF6', // violet
  '#EF4444', // red
  '#06B6D4', // cyan
  '#84CC16', // lime
  '#F97316', // orange
  '#A855F7', // purple
  '#10B981', // emerald
  '#E11D48', // rose
  '#0EA5E9', // sky
  '#EAB308', // yellow
  '#2DD4BF', // teal-light
  '#D946EF', // fuchsia
];

// Gradients for fills (Sankey-like, areas, bars)
export const GRADIENTS: Record<string, { start: string; end: string }> = {
  indigo: { start: '#6366F1', end: '#4338CA' },
  pink: { start: '#EC4899', end: '#BE185D' },
  teal: { start: '#14B8A6', end: '#0F766E' },
  amber: { start: '#F59E0B', end: '#B45309' },
  violet: { start: '#8B5CF6', end: '#6D28D9' },
  red: { start: '#EF4444', end: '#B91C1C' },
  cyan: { start: '#06B6D4', end: '#0E7490' },
  lime: { start: '#84CC16', end: '#4D7C0F' },
  orange: { start: '#F97316', end: '#C2410C' },
  purple: { start: '#A855F7', end: '#7E22CE' },
  emerald: { start: '#10B981', end: '#047857' },
  rose: { start: '#E11D48', end: '#9F1239' },
  sky: { start: '#0EA5E9', end: '#0369A1' },
  yellow: { start: '#EAB308', end: '#A16207' },
  fuchsia: { start: '#D946EF', end: '#A21CAF' },
};

// Termination reason - color mapping (consistent across charts)
export const TERMINATION_COLORS: Record<string, string> = {
  completed_no_tool_call: '#10B981',
  completed_with_tool_call: '#059669',
  max_turns: '#6366F1',
  loop_guard: '#F59E0B',
  timeout: '#EF4444',
  aborted: '#6B7280',
  errored: '#E11D48',
  max_tool_calls: '#8B5CF6',
  length: '#0EA5E9',
};

// Pick a color by index, wrapping around
export const colorAt = (i: number) => VIBRANT[i % VIBRANT.length];
