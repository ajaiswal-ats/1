/* Icons from 2h's ICON set. */
const svg = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, "aria-hidden": true } as const;
export const EyeIcon = ({ hidden = false }: { hidden?: boolean }) => <svg {...svg}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{hidden && <path d="m3 3 18 18" />}</svg>;

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
export const MenuIcon = () => (
  <svg {...svg}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
);
export const ChevronIcon = () => <svg {...svg}><path d="m6 9 6 6 6-6" /></svg>;
export const SlidersIcon = () => <svg {...svg}><path d="M4 7h7m4 0h5M4 17h3m4 0h9"/><circle cx="13" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>;
export const LockIcon = () => <svg {...svg}><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>;
export const MoonIcon = () => <svg {...svg}><path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z"/></svg>;
export const SignOutIcon = () => <svg {...svg}><path d="M10 4H4v16h6M12 8l4 4-4 4M8 12h12"/></svg>;

export const CloseIcon = () => <svg {...svg}><path d="M6 6l12 12M18 6 6 18" /></svg>;

export const HelpIcon = () => <svg {...svg}><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 17v.5"/></svg>;

export const GripIcon = () => <svg {...svg}>{[6,12,18].flatMap(y=>[9,15].map(x=><circle key={`${x}-${y}`} cx={x} cy={y} r="1.2"/>))}</svg>;
export const MoreIcon = () => <svg {...svg}>{[5,12,19].map(x=><circle key={x} cx={x} cy="12" r="1.3"/>)}</svg>;

export const ResetIcon = () => <svg {...svg}><path d="M3 11a9 9 0 1 1 2 7M3 3v8h8"/></svg>;
export const InfoIcon = () => <svg {...svg}><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.5"/></svg>;
