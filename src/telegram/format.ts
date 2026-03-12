function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Convert a markdown table into a padded monospace <pre> block. */
function formatTable(tableBlock: string): string {
  const lines = tableBlock.trim().split('\n');
  // Parse rows, skip separator lines (|---|---|)
  const rows = lines
    .filter(l => !/^\|[\s-:|]+\|$/.test(l))
    .map(l =>
      l.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()),
    );
  if (rows.length === 0) return escapeHtml(tableBlock);

  // Compute max width per column
  const colCount = rows[0].length;
  const widths = Array.from({ length: colCount }, (_, col) =>
    Math.max(...rows.map(r => (r[col] ?? '').length)),
  );

  // Precompute which columns are numeric so we right-align them
  const isNumericCol = Array.from({ length: colCount }, (_, col) =>
    rows.slice(1).every(r => /^[₪\d,.%\s-]+$/.test(r[col] ?? '')),
  );
  const pad = (s: string, w: number, col: number) =>
    isNumericCol[col] ? s.padStart(w) : s.padEnd(w);

  const formatted = rows.map((row) => {
    const cells = row.map((cell, ci) => pad(cell, widths[ci], ci));
    return cells.join('  ');
  });

  // Insert a separator after the header
  if (formatted.length > 1) {
    const sep = widths.map(w => '─'.repeat(w)).join('──');
    formatted.splice(1, 0, sep);
  }

  return `<pre>${escapeHtml(formatted.join('\n'))}</pre>`;
}

/**
 * Convert standard markdown to Telegram-compatible HTML.
 *
 * Handles: fenced code blocks, inline code, bold, italic,
 * strikethrough, headers (→ bold), links, blockquotes, and tables.
 */
export function markdownToTelegramHtml(md: string): string {
  // 1. Extract fenced code blocks to protect them from further processing
  const codeBlocks: string[] = [];
  let text = md.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    const escaped = escapeHtml(code.trimEnd());
    codeBlocks.push(
      lang
        ? `<pre><code class="language-${lang}">${escaped}</code></pre>`
        : `<pre>${escaped}</pre>`,
    );
    return `\x00CB${idx}\x00`;
  });

  // 1b. Convert markdown tables to monospace <pre> blocks (use same placeholder array)
  text = text.replace(
    /(?:^|\n)((?:\|.+\|\n?){2,})/g,
    (match) => {
      const idx = codeBlocks.length;
      codeBlocks.push(formatTable(match.trim()));
      return `\n\x00CB${idx}\x00\n`;
    },
  );

  // 2. Extract inline code
  const inlineCodes: string[] = [];
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00IC${idx}\x00`;
  });

  // 3. Escape HTML entities in remaining text
  text = escapeHtml(text);

  // 4. Convert markdown syntax to HTML tags
  text = text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  text = text.replace(/\*(.+?)\*/g, '<i>$1</i>');
  text = text.replace(/~~(.+?)~~/g, '<s>$1</s>');
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');
  text = text.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');

  // Blockquotes: > line  →  <blockquote>line</blockquote>, then merge adjacent
  text = text.replace(/^&gt;\s?(.+)$/gm, '<blockquote>$1</blockquote>');
  text = text.replace(/<\/blockquote>\n<blockquote>/g, '\n');

  // 5. Restore protected code blocks and inline code
  text = text.replace(/\x00CB(\d+)\x00/g, (_, idx) => codeBlocks[Number(idx)]);
  text = text.replace(/\x00IC(\d+)\x00/g, (_, idx) => inlineCodes[Number(idx)]);

  return text;
}

// ── Shared Telegram helpers ──────────────────────────────────────────────────

const MAX_MESSAGE_LENGTH = 4096;

/** Split text into chunks that fit Telegram's message limit. */
export function splitMessage(text: string): string[] {
  if (text.length <= MAX_MESSAGE_LENGTH) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_MESSAGE_LENGTH) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf('\n', MAX_MESSAGE_LENGTH);
    if (splitAt <= 0) splitAt = MAX_MESSAGE_LENGTH;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, '');
  }
  return chunks;
}
