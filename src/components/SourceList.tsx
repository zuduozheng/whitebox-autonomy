import PartialDateText from "@/components/PartialDateText";
import { formatIsoDate } from "@/lib/events/format";
import { sourceTypeLabel } from "@/lib/events/labels";
import type { Source } from "@/lib/events/types";

import styles from "./SourceList.module.css";

/**
 * The sources for an event. Each item is a labelled outbound link plus concise
 * provenance — never a transcript or a long quotation from the source.
 */
export default function SourceList({ sources }: { sources: Source[] }) {
  return (
    <ol className={styles.list}>
      {sources.map((source, index) => (
        <li key={`${source.url}-${index}`} className={styles.item}>
          <p className={styles.head}>
            <span className={styles.type}>{sourceTypeLabel(source.type)}</span>
            {source.publisher ? <span> &middot; {source.publisher}</span> : null}
          </p>
          <p className={styles.link}>
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
            >
              {source.label ?? source.url}
            </a>
          </p>
          {source.publishedOn || source.retrievedOn ? (
            <p className={styles.dates}>
              {source.publishedOn ? (
                <span>
                  Published{" "}
                  <PartialDateText
                    date={source.publishedOn}
                    withQualifier={false}
                  />
                </span>
              ) : null}
              {source.publishedOn && source.retrievedOn ? " · " : null}
              {source.retrievedOn ? (
                <span>Retrieved {formatIsoDate(source.retrievedOn)}</span>
              ) : null}
            </p>
          ) : null}
          {source.note ? <p className={styles.note}>{source.note}</p> : null}
        </li>
      ))}
    </ol>
  );
}
