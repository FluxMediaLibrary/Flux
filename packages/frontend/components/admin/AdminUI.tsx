'use client';

import { useEffect, type ReactNode } from 'react';

export function PageHeader({ kicker = 'Flux control center', title, description, actions }: { kicker?: string; title: string; description: string; actions?: ReactNode }) {
  return <header className="control-page-header"><div><span className="control-page-kicker">{kicker}</span><h1>{title}</h1><p>{description}</p></div>{actions && <div className="control-header-actions">{actions}</div>}</header>;
}

export function StatusBadge({ tone = 'neutral', children }: { tone?: 'good' | 'warn' | 'bad' | 'info' | 'neutral'; children: ReactNode }) {
  return <span className={`control-status${tone === 'neutral' ? '' : ` ${tone}`}`}>{children}</span>;
}

export function PageError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="control-error" role="alert"><span>{message}</span>{onRetry && <button className="control-button" onClick={onRetry}>Try again</button>}</div>;
}

export function LoadingState({ cards = 4 }: { cards?: number }) {
  return <div className="control-loading-grid" aria-label="Loading">{Array.from({ length: cards }, (_, index) => <div className="control-skeleton" key={index} />)}</div>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="control-empty">{children}</div>;
}

export type DataColumn<T> = {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  className?: string;
};

export function DataTable<T>({ rows, columns, rowKey, empty }: { rows: T[]; columns: DataColumn<T>[]; rowKey: (row: T) => string; empty: ReactNode }) {
  if (rows.length === 0) return <EmptyState>{empty}</EmptyState>;
  return <div className="control-table-wrap"><table className="control-table"><thead><tr>{columns.map((column) => <th key={column.key} className={column.className}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={rowKey(row)}>{columns.map((column) => <td key={column.key} className={column.className}>{column.render(row)}</td>)}</tr>)}</tbody></table></div>;
}

export function ConfirmDialog({ open, title, description, confirmLabel, dangerous = false, busy = false, onConfirm, onClose }: { open: boolean; title: string; description: string; confirmLabel: string; dangerous?: boolean; busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);
  if (!open) return null;
  return <div className="control-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onClose(); }}><div className="control-dialog" role="alertdialog" aria-modal="true" aria-labelledby="control-dialog-title"><span className={`control-dialog-mark${dangerous ? ' danger' : ''}`} aria-hidden>!</span><h2 id="control-dialog-title">{title}</h2><p>{description}</p><div><button className="control-button" disabled={busy} onClick={onClose}>Cancel</button><button className={`control-button${dangerous ? ' danger' : ' primary'}`} disabled={busy} onClick={onConfirm}>{busy ? 'Working…' : confirmLabel}</button></div></div></div>;
}
