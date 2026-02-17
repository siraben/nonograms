import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function Pagination(props: {
  page: number;
  onPageChange: (page: number) => void;
  totalPages?: number;
  hasMore?: boolean;
}) {
  const canPrev = props.page > 0;
  const canNext = props.totalPages != null
    ? props.page < props.totalPages - 1
    : !!props.hasMore;

  return (
    <div className="pagination">
      <button
        className="btn sm icon-btn"
        disabled={!canPrev}
        onClick={() => props.onPageChange(props.page - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft size={14} />
      </button>
      <span className="pagination-info">
        {props.totalPages != null ? `${props.page + 1}/${props.totalPages}` : props.page + 1}
      </span>
      <button
        className="btn sm icon-btn"
        disabled={!canNext}
        onClick={() => props.onPageChange(props.page + 1)}
        aria-label="Next page"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}
