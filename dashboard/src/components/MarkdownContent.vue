<script setup lang="ts">
import { computed } from 'vue';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';

const md = new Marked({ breaks: true, gfm: true });

const props = defineProps<{ content: string }>();

const html = computed(() => {
  const raw = md.parse(props.content) as string;
  return DOMPurify.sanitize(raw);
});
</script>

<template>
  <div class="markdown-content" v-html="html" />
</template>

<style scoped>
.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3) {
  font-weight: 600;
  margin-top: 1em;
  margin-bottom: 0.5em;
  line-height: 1.3;
}

.markdown-content :deep(h1) { font-size: 1.25em; }
.markdown-content :deep(h2) { font-size: 1.125em; }
.markdown-content :deep(h3) { font-size: 1em; }

.markdown-content :deep(p) {
  margin-bottom: 0.5em;
}
.markdown-content :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-content :deep(strong) {
  font-weight: 700;
  color: var(--text-primary);
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  padding-left: 1.25em;
  margin-bottom: 0.5em;
}

.markdown-content :deep(ul) { list-style-type: disc; }
.markdown-content :deep(ol) { list-style-type: decimal; }

.markdown-content :deep(li) {
  margin-bottom: 0.2em;
}

.markdown-content :deep(li > p) {
  margin-bottom: 0;
}

/* Tables */
.markdown-content :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 0.75em 0;
  font-size: 0.875em;
}

.markdown-content :deep(thead) {
  border-bottom: 1px solid var(--separator);
}

.markdown-content :deep(th) {
  padding: 0.5em 0.75em;
  text-align: left;
  font-weight: 600;
  color: var(--text-secondary);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
}

.markdown-content :deep(td) {
  padding: 0.4em 0.75em;
  border-bottom: 1px solid var(--separator);
}

.markdown-content :deep(tbody tr:hover) {
  background: rgba(0, 0, 0, 0.02);
}

@media (prefers-color-scheme: dark) {
  .markdown-content :deep(tbody tr:hover) {
    background: rgba(255, 255, 255, 0.03);
  }
}

.markdown-content :deep(tbody tr:last-child td) {
  border-bottom: none;
}

/* Bold row for totals */
.markdown-content :deep(td > strong),
.markdown-content :deep(th > strong) {
  color: var(--text-primary);
}

/* Inline code */
.markdown-content :deep(code) {
  background: var(--bg-tertiary);
  padding: 0.15em 0.4em;
  border-radius: 4px;
  font-size: 0.875em;
}

/* Code blocks */
.markdown-content :deep(pre) {
  background: var(--bg-tertiary);
  padding: 0.75em 1em;
  border-radius: 8px;
  overflow-x: auto;
  margin: 0.5em 0;
}

.markdown-content :deep(pre code) {
  background: none;
  padding: 0;
}

/* Blockquotes */
.markdown-content :deep(blockquote) {
  border-left: 3px solid var(--accent);
  padding-left: 0.75em;
  margin: 0.5em 0;
  color: var(--text-secondary);
}

/* Horizontal rules */
.markdown-content :deep(hr) {
  border: none;
  border-top: 1px solid var(--separator);
  margin: 0.75em 0;
}
</style>
