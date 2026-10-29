import {useEffect,useRef} from 'react';
import {useCandidatesHref} from '../lib/candidatesRoute';

/** Demo-only exit screen; this never represents a real authentication boundary. */
export function DemoExit(){
 const href=useCandidatesHref(),heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{heading.current?.focus();},[]);
 return <main className="demo-exit"><section><h1 ref={heading} tabIndex={-1}>You’ve left the demo</h1><p>This is a fictional workspace. No account session was ended.</p><p>Your demo data has not been reset.</p><a href={href}>Open demo</a></section></main>;
}
