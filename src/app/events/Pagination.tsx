import Link from "next/link";

import { computePageWindow } from "./pagination-window";
import styles from "./Pagination.module.css";

/**
 * `filterQueryString` is the SHARED filter query string only (eventType /
 * valence / developerOrOperator — see lib/events/filter-params.ts) — never
 * includes `page` itself, so every link built here fully controls it.
 */
function pageHref(filterQueryString: string, targetPage: number): string {
  const params = new URLSearchParams(filterQueryString);
  if (targetPage > 1) {
    params.set("page", String(targetPage));
  } else {
    params.delete("page");
  }
  const query = params.toString();
  return query ? `/events?${query}` : "/events";
}

export default function Pagination({
  page,
  totalPages,
  filterQueryString,
}: {
  page: number;
  totalPages: number;
  filterQueryString: string;
}) {
  if (totalPages <= 1) return null;

  const window = computePageWindow(page, totalPages);

  return (
    <nav aria-label="Pagination" className={styles.pagination}>
      {page > 1 ? (
        <Link href={pageHref(filterQueryString, page - 1)} className={styles.control}>
          Previous
        </Link>
      ) : (
        <span className={styles.controlDisabled} aria-disabled="true">
          Previous
        </span>
      )}

      <ul className={styles.pages}>
        {window.map((item, index) =>
          item === "ellipsis" ? (
            <li key={`ellipsis-${index}`}>
              <span className={styles.ellipsis} aria-hidden="true">
                &hellip;
              </span>
            </li>
          ) : (
            <li key={item}>
              {item === page ? (
                <span className={styles.currentPage} aria-current="page">
                  {item}
                </span>
              ) : (
                <Link href={pageHref(filterQueryString, item)}>{item}</Link>
              )}
            </li>
          ),
        )}
      </ul>

      {page < totalPages ? (
        <Link href={pageHref(filterQueryString, page + 1)} className={styles.control}>
          Next
        </Link>
      ) : (
        <span className={styles.controlDisabled} aria-disabled="true">
          Next
        </span>
      )}
    </nav>
  );
}
