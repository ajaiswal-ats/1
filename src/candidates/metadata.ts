/** Wrap presentation text only at meaningful boundaries. Never infer dates from feedback or another event. */
export function interviewFragments(text: string, board = false): string[] {
  const date = String.raw`(?:Sun |Mon |Tue |Wed |Thu |Fri |Sat )?\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)`;
  const scheduled = text.match(new RegExp(`^Scheduled (${date})(?:, (.+))?$`));
  if (scheduled) return [...(board ? [] : ['Scheduled']), scheduled[1] + (scheduled[2] ? ',' : ''), ...(scheduled[2] ? [scheduled[2]] : [])];
  const recorded = text.match(new RegExp(`^(Requested|Held) (${date})( · feedback given)?$`));
  if (recorded) {
    const [, status, day, feedback] = recorded;
    return board ? [`${status} ${day}${feedback ? ' ·' : ''}`, ...(feedback ? ['feedback given'] : [])]
      : [status, day + (feedback ? ' ·' : ''), ...(feedback ? ['feedback', 'given'] : [])];
  }
  if (text === 'Held · feedback given') return board ? ['Held ·', 'feedback given'] : ['Held ·', 'feedback', 'given'];
  if (text === 'None recorded' || text === 'Not connected yet') return text.split(' ');
  return [text];
}

export const missingMetadata = (text: string) => ['None shared', 'None recorded', 'Not connected yet'].includes(text);
