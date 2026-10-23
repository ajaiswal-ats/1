import { useEffect, useRef, useState } from "react";

/* Hover tooltip, as in 2h: any element with data-tip (a bold title) and data-tip-text shows it, following the pointer. */
export function Tooltip() {
  const [tip, setTip] = useState<{ title: string; text: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const over = (e: MouseEvent) => {
      const t = (e.target as Element).closest?.("[data-tip]");
      setTip(t ? { title: t.getAttribute("data-tip") || "", text: t.getAttribute("data-tip-text") || "" } : null);
    };
    const move = (e: MouseEvent) => {
      const el = ref.current; if (!el || el.hidden) return;
      el.style.left = Math.min(e.clientX + 14, innerWidth - el.offsetWidth - 8) + "px";
      el.style.top = e.clientY + 14 + "px";
    };
    document.addEventListener("mouseover", over);
    document.addEventListener("mousemove", move);
    return () => { document.removeEventListener("mouseover", over); document.removeEventListener("mousemove", move); };
  }, []);
  return <div className="tip" id="tip" ref={ref} hidden={!tip}>{tip && <><b>{tip.title}</b>{tip.text}</>}</div>;
}
