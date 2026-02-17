import React from "react";

export function CardHeader(props: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="card-header-row">
      <h2>{props.title}</h2>
      {props.children}
    </div>
  );
}
