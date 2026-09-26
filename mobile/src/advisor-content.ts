export type AdvisorBlock =
  | { kind: 'text'; text: string }
  | { kind: 'table'; headers: string[]; rows: string[][] };

/** Use the first strong letter so an English sentence mentioning a Hebrew merchant stays LTR. */
export function isHebrewText(text: string | null | undefined): boolean {
  if (typeof text !== 'string') return false;
  const first = text.match(/[A-Za-z\u0590-\u05FF]/)?.[0];
  return first ? /[\u0590-\u05FF]/.test(first) : false;
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** Keep prose intact while turning complete Markdown tables into native rows. */
export function advisorBlocks(content: string): AdvisorBlock[] {
  const lines = content.split('\n');
  const blocks: AdvisorBlock[] = [];
  let prose: string[] = [];
  const flush = () => {
    const text = prose.join('\n').trim();
    if (text) blocks.push({ kind: 'text', text });
    prose = [];
  };

  for (let index = 0; index < lines.length; index++) {
    const headers = cells(lines[index]);
    const divider = cells(lines[index + 1] ?? '');
    if (
      !lines[index].includes('|') ||
      headers.length < 2 ||
      divider.length !== headers.length ||
      !divider.every((cell) => /^:?-{3,}:?$/.test(cell))
    ) {
      prose.push(lines[index]);
      continue;
    }

    flush();
    index++;
    const rows: string[][] = [];
    while (index + 1 < lines.length && lines[index + 1].includes('|')) {
      const row = cells(lines[index + 1]);
      if (row.length !== headers.length) break;
      rows.push(row);
      index++;
    }
    blocks.push({ kind: 'table', headers, rows });
  }
  flush();
  return blocks;
}
