import React from "react";

export function BackButton(props: { href?: string }) {
  return (
    <div className="back-nav">
      <button className="btn" onClick={() => { location.hash = props.href ?? "/"; }}>
        &larr; Back
      </button>
    </div>
  );
}
