import type { RoleStatus } from "../data/fixtures";

/* Role status chip (2h statusChip). */
export const StatusChip = ({ status }: { status: RoleStatus }) => (
  <span className={`chip ${status === "Open" ? "c-ok" : status === "On hold" ? "c-warn" : "c-mute"}`}><i className="d" />{status}</span>
);
