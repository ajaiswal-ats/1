/* Icons from 2h's ICON set. */
const svg = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, "aria-hidden": true } as const;

export const PeopleIcon = () => (
  <svg {...svg}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" /><circle cx="17.5" cy="9" r="2.5" /><path d="M17 14.5c2.4.2 4 1.8 4.5 4.5" /></svg>
);
export const BriefIcon = () => (
  <svg {...svg}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5h6v2" /></svg>
);
export const ChartIcon = () => (
  <svg {...svg}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
);
export const SearchIcon = () => (
  <svg {...svg}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);
export const CheckIcon = () => (
  <svg {...svg}><path d="m5 12 4 4 10-10" /></svg>
);
export const VideoIcon = () => (
  <svg {...svg}><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3" /></svg>
);
export const PinIcon = () => (
  <svg {...svg} width="14" height="14"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
);
