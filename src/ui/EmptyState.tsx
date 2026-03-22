import React from "react";

export function EmptyState(props: { children: React.ReactNode; className?: string }) {
  const cls = ["muted", props.className].filter(Boolean).join(" ");
  return <div className={cls}>{props.children}</div>;
}
