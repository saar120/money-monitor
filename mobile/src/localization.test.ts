import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import {
  choiceFromNativeDirection,
  currentLocale,
  formatMonthShort,
  setActiveLanguage,
} from './locale-state.ts';
import { english, hebrew, ownerLabel, t } from './translations.ts';
import {
  formatMoney,
  formatSpendingChange,
  formatSpendingComparison,
  formatUnsignedMoney,
} from './money.ts';

test('English and Hebrew catalogs cover the same explicit message keys', () => {
  assert.deepEqual(Object.keys(english).sort(), Object.keys(hebrew).sort());
  for (const key of Object.keys(english) as (keyof typeof english)[]) {
    assert.ok(english[key]);
    assert.ok(hebrew[key]);
  }
});

test('English and Hebrew message variants use the same interpolation variables', () => {
  const variables = (message: string) =>
    [...message.matchAll(/%\{([^}]+)\}/g)].map((match) => match[1]).sort();
  for (const key of Object.keys(english) as (keyof typeof english)[]) {
    const source = english[key];
    const translated = hebrew[key];
    if (typeof source === 'string' && typeof translated === 'string') {
      assert.deepEqual(variables(source), variables(translated), key);
    } else if (typeof source === 'object' && typeof translated === 'object') {
      assert.deepEqual(variables(source.one), variables(translated.one), `${key}.one`);
      assert.deepEqual(variables(source.other), variables(translated.other), `${key}.other`);
    } else {
      assert.fail(`${key}: plural variants differ`);
    }
  }
});

test('reserved owner labels change with language without changing their values', () => {
  setActiveLanguage('he');
  assert.equal(ownerLabel('Shared'), t('shared'));
  assert.equal(ownerLabel('Unassigned'), t('unassigned'));
  assert.equal(ownerLabel('Unknown'), t('unknown'));
  assert.equal(ownerLabel('Saar'), 'Saar');
  setActiveLanguage('en');
  assert.equal(ownerLabel('Shared'), 'Shared');
});

test('language switching applies plural forms and financial formatting', () => {
  setActiveLanguage('he');
  assert.equal(currentLocale(), 'he-IL');
  assert.equal(formatMonthShort('2026-09'), 'ספט׳');
  assert.equal(t('accountsNeedAttention', { count: 1 }), 'חשבון אחד דורש טיפול');
  assert.equal(t('accountsNeedAttention', { count: 5 }), '5 חשבונות דורשים טיפול');
  assert.equal(t('transactionCount', { count: 2 }), '2 תנועות');
  assert.match(formatSpendingChange(120, 'ILS'), /הוצאות גבוהות/);
  assert.match(formatSpendingComparison(120, 'ILS'), /לעומת החודש הקודם/);
  assert.match(formatMoney(1234, 'ILS'), /1,234/);
  assert.match(formatMoney(1234, 'ILS'), /₪/);
  assert.match(formatMoney(-379.9, 'ILS', true), /-379\.90/);
  assert.doesNotMatch(formatUnsignedMoney(379.9, 'ILS'), /\+/);

  setActiveLanguage('en');
  assert.equal(t('accountsNeedAttention', { count: 5 }), '5 accounts need attention');
  assert.equal(formatMonthShort('2026-09'), 'Sep');
});

test('native layout direction recovers a language choice when saved settings are unavailable', () => {
  assert.equal(choiceFromNativeDirection('en', false), 'system');
  assert.equal(choiceFromNativeDirection('en', true), 'he');
  assert.equal(choiceFromNativeDirection('he', false), 'en');
  assert.equal(choiceFromNativeDirection('he', true), 'system');
});

test('screen text has no implicit English-string translations', () => {
  const errors: string[] = [];
  const visitDirectory = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filename = join(directory, entry.name);
      if (entry.isDirectory()) visitDirectory(filename);
      else if (entry.name.endsWith('.tsx') && entry.name !== 'LocalizedText.tsx') {
        const content = readFileSync(filename, 'utf8');
        if (/\btranslate\(/.test(content)) errors.push(`${filename}: legacy translation call`);
        const source = ts.createSourceFile(
          filename,
          content,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TSX,
        );
        const visit = (node: ts.Node) => {
          if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'Text') {
            for (const child of node.children) {
              if (ts.isJsxText(child) && /[A-Za-z]/.test(child.getText(source))) {
                errors.push(`${filename}: raw English text ${child.getText(source).trim()}`);
              }
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(source);
      }
    }
  };
  visitDirectory(new URL('../app/', import.meta.url).pathname);
  visitDirectory(new URL('./', import.meta.url).pathname);
  assert.deepEqual(errors, []);
});
