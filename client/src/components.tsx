import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { useText } from "./i18n";
import type { PublicUser } from "../../shared/types";
export function Avatar({
  user,
  size = "",
}: {
  user: Pick<PublicUser, "firstName" | "photoUrl">;
  size?: string;
}) {
  return (
    <span className={`avatar ${size}`}>
      {user.photoUrl ? (
        <img
          src={user.photoUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : (
        user.firstName.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}
export function Loading() {
  const t = useText();
  return (
    <div className="empty">
      <div className="spinner" />
      <p>{t.loading}</p>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const t = useText();
  return createPortal(
    <div className="overlay" onClick={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-head">
          <h2>{title}</h2>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label={t.close}
          >
            ×
          </button>
        </div>
        {children}
      </section>
    </div>,
    document.body,
  );
}
export function Bingo({ count, target }: { count: number; target: number }) {
  return (
    <div className="bingo">
      {"BINGO".split("").map((c, i) => (
        <span
          key={i}
          className={count >= Math.ceil(((i + 1) * target) / 5) ? "lit" : ""}
        >
          {c}
        </span>
      ))}
    </div>
  );
}
export function Board({
  cells,
  called,
  lines = [],
  size = 5,
}: {
  cells: number[];
  called: number[];
  lines?: string[];
  size?: number;
}) {
  const t = useText();
  return (
    <div
      className="board"
      style={{ gridTemplateColumns: `repeat(${size},1fr)` }}
    >
      {cells.map((n, i) => {
        const completed =
          lines.includes(`r${Math.floor(i / size)}`) ||
          lines.includes(`c${i % size}`) ||
          (lines.includes("d0") && Math.floor(i / size) === i % size) ||
          (lines.includes("d1") &&
            Math.floor(i / size) + (i % size) === size - 1);
        return (
          <div
            key={i}
            className={`cell ${called.includes(n) ? "marked" : ""} ${completed ? "completed" : ""}`}
            aria-label={`${n}${called.includes(n) ? " ✓" : ""}`}
          >
            <span>{n}</span>
            {called.includes(n) && (
              <small aria-label={t.calledNumbers}>✓</small>
            )}
          </div>
        );
      })}
    </div>
  );
}
export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
