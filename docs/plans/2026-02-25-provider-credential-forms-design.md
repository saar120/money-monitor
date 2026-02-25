# Design: Provider-Specific Credential Forms

**Date:** 2026-02-25
**Status:** Approved

## Problem

The "Add Account" dialog currently shows generic key-value pair inputs. Users must manually type credential field names (e.g., `userCode`, `card6Digits`) with no guidance. This is confusing and error-prone.

## Goal

When a user selects a bank/provider, automatically render the correct labeled credential fields for that provider, with hints where helpful.

## Approach

Static frontend config (Approach A): a new `dashboard/src/lib/providers.ts` file exports a `PROVIDERS` array with field definitions per provider. `AccountManager.vue` consumes it to render dynamic forms. No backend changes required.

## Data Shape

```ts
interface ProviderField {
  key: string          // credential key sent to backend
  label: string        // human-readable label
  type: 'text' | 'password'
  placeholder?: string
  hint?: string        // helper text below the field
}

interface Provider {
  id: string           // matches CompanyTypes key
  name: string
  fields: ProviderField[]
  otpNote?: string     // info banner shown when provider may request OTP
}
```

## Provider Credential Map

| Provider | Fields |
|---|---|
| hapoalim | `userCode` (text), `password` |
| leumi | `username` (text), `password` |
| discount | `id` (text), `password`, `num` (text, hint: identification code) |
| mizrahi | `username` (text), `password` |
| otsarHahayal | `username` (text), `password` |
| mercantile | `id` (text), `password`, `num` (text, hint: identification code) |
| massad | `username` (text), `password` |
| beinleumi | `username` (text), `password` |
| union | `username` (text), `password` |
| yahav | `username` (text), `nationalID` (text, hint: Israeli national ID), `password` |
| isracard | `id` (text), `card6Digits` (text, hint: last 6 digits of card), `password` |
| amex | `username` (text), `card6Digits` (text, hint: last 6 digits of card), `password` |
| max | `username` (text), `password` |
| visaCal | `username` (text), `password` |
| beyahadBishvilha | `id` (text), `password` |
| oneZero | `email` (text), `password` — plus `otpNote` banner |
| behatsdaa | generic fallback |
| pagi | generic fallback |

Providers with no known field schema fall back to a single generic key/value pair row (current behavior).

## AccountManager.vue Changes

1. Remove `credentialFields` ref (key-value array) and "Add Field" button.
2. Add `credentialValues` ref: `Record<string, string>` — keyed by field key.
3. When `newCompanyId` changes (watcher), reset `credentialValues` to `{}`.
4. In the dialog, replace the generic fields section with:
   - If provider has defined `fields`: render one `<Input>` per field with label, type, placeholder, and optional hint text.
   - If provider has `otpNote`: show an info callout above the fields.
   - If provider has no `fields` entry (fallback): render one generic key/value pair row (same as today).
5. In `handleAdd()`, pass `credentialValues` directly as the credentials object.
6. Replace the inline `providers` array with the imported `PROVIDERS` from `providers.ts`.

## Files Changed

- `dashboard/src/lib/providers.ts` — new file
- `dashboard/src/components/AccountManager.vue` — consume providers.ts, replace credential UI
