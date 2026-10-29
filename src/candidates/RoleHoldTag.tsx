import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LockIcon } from '../components/icons';

/** Information only. It describes the existing role status; it never changes move permissions. */
export function RoleHoldTag({ title, status }: { title: string; status: string }) {
  const id = useId(), tag = useRef<HTMLSpanElement>(null), tip = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false), [dismissed, setDismissed] = useState(false);
  const open = (hovered || focused) && !dismissed;
  const explanation = `${title} is ${status.toLowerCase()}, so stage changes are paused`;
  const enter = () => { if (timer.current) clearTimeout(timer.current); setHovered(true); setDismissed(false); };
  // Allow the pointer to cross the small gap into the tooltip without hiding it.
  const leave = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setHovered(false), 100); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      if (!tag.current || !tip.current) return;
      const a = tag.current.getBoundingClientRect(), b = tip.current.getBoundingClientRect();
      tip.current.style.left = `${Math.max(8, Math.min(a.left, innerWidth - b.width - 8))}px`;
      tip.current.style.top = `${Math.max(8, a.bottom + 6 + b.height <= innerHeight - 8 ? a.bottom + 6 : a.top - b.height - 6)}px`;
    };
    position();
    window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
    return () => { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [open]);
  const tooltip = <span ref={tip} id={id} role="tooltip" className="candidates-holdtip" hidden={!open} onMouseEnter={enter} onMouseLeave={leave}>{explanation}</span>;
  return <><span ref={tag} className="x-holdtag" tabIndex={0} aria-describedby={id} onMouseEnter={enter} onMouseLeave={leave}
    onFocus={() => { setFocused(true); setDismissed(false); }} onBlur={() => setFocused(false)}
    onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); setDismissed(true); } }}><LockIcon/>Role {status.toLowerCase()}</span>
    {open ? createPortal(tooltip, document.body) : tooltip}</>;
}
