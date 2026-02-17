import React from "react";

export function Modal(props: {
  title: string;
  ariaLabel: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="modal-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={props.ariaLabel}>
        <div className="modal-head">
          <div className="modal-title">{props.title}</div>
          <button className="modal-close" onClick={props.onClose} aria-label="Close">
            &times;
          </button>
        </div>
        <div className="modal-body">{props.children}</div>
      </div>
    </div>
  );
}
