export interface ResultDocument {
  id: string;
  filename: string;
  treePath: string;
  readable: boolean;
}

export interface ResultFieldValue {
  key: string;
  value: string;
  confidence: number;
  rationale: string;
}

export interface ResultRecord {
  id: string;
  label: string;
  fields: ResultFieldValue[];
  sourceDocumentIds: string[];
}

export interface SampleResult {
  documents: ResultDocument[];
  records: ResultRecord[];
  exceptionFileIds: string[];
}

// The table is one column per field, so the columns are the union of the keys
// every record carries. First-seen order keeps the schema's ordering for the
// common case where every record has the same fields, without depending on the
// schema being available client-side.
export const fieldColumnKeys = (records: ResultRecord[]): string[] => {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    for (const field of record.fields) {
      if (seen.has(field.key)) continue;
      seen.add(field.key);
      keys.push(field.key);
    }
  }
  return keys;
};

export const fieldValue = (record: ResultRecord, key: string): ResultFieldValue | null =>
  record.fields.find((field) => field.key === key) ?? null;

// The expanded detail lays fields out four columns wide — field, value, field,
// value — so they are consumed two at a time. The trailing slot is null on an
// odd count, keeping the grid rectangular.
export const pairFields = (
  fields: ResultFieldValue[],
): Array<[ResultFieldValue, ResultFieldValue | null]> => {
  const pairs: Array<[ResultFieldValue, ResultFieldValue | null]> = [];
  for (let index = 0; index < fields.length; index += 2) {
    pairs.push([fields[index]!, fields[index + 1] ?? null]);
  }
  return pairs;
};

export const toggleExpanded = (expanded: Set<string>, recordId: string): Set<string> => {
  const next = new Set(expanded);
  if (next.has(recordId)) {
    next.delete(recordId);
    return next;
  }
  next.add(recordId);
  return next;
};

// A record is an exception when it drew on an exception file, or when every one
// of its fields is empty (nothing was pulled) — the triage the operator filters to.
export const exceptionRecordIds = (result: SampleResult): Set<string> => {
  const exceptionFiles = new Set(result.exceptionFileIds);
  const ids = new Set<string>();
  for (const record of result.records) {
    const drewOnException = record.sourceDocumentIds.some((id) => exceptionFiles.has(id));
    const allBlank = record.fields.every((field) => field.value.trim().length === 0);
    if (drewOnException || allBlank) ids.add(record.id);
  }
  return ids;
};

export interface RecordFilter {
  query: string;
  exceptionsOnly: boolean;
}

export const visibleRecords = (result: SampleResult, filter: RecordFilter): ResultRecord[] => {
  const exceptions = exceptionRecordIds(result);
  const needle = filter.query.trim().toLowerCase();
  return result.records.filter((record) => {
    if (filter.exceptionsOnly && !exceptions.has(record.id)) return false;
    if (needle.length === 0) return true;
    return (
      record.label.toLowerCase().includes(needle) ||
      record.fields.some((field) => field.value.toLowerCase().includes(needle))
    );
  });
};
