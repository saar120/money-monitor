export interface ProviderField {
  key: string
  label: string
  type: 'text' | 'password'
  placeholder?: string
  hint?: string
}

export interface Provider {
  id: string
  name: string
  fields: ProviderField[]
  otpNote?: string
}

// Shared field definitions (reused across multiple providers)
const pw: ProviderField = { key: 'password', label: 'Password', type: 'password' }
const username: ProviderField = { key: 'username', label: 'Username', type: 'text' }
const idField: ProviderField = { key: 'id', label: 'ID Number', type: 'text' }
const num: ProviderField = {
  key: 'num',
  label: 'Identification Code',
  type: 'text',
  hint: 'The 2–4 digit code assigned to your account',
}
const card6: ProviderField = {
  key: 'card6Digits',
  label: 'Last 6 Card Digits',
  type: 'text',
  hint: 'Last 6 digits of your card number',
}

export const PROVIDERS: Provider[] = [
  {
    id: 'hapoalim',
    name: 'Bank Hapoalim',
    fields: [{ key: 'userCode', label: 'User Code', type: 'text' }, pw],
  },
  { id: 'leumi', name: 'Bank Leumi', fields: [username, pw] },
  { id: 'discount', name: 'Bank Discount', fields: [idField, pw, num] },
  { id: 'mizrahi', name: 'Bank Mizrahi', fields: [username, pw] },
  { id: 'otsarHahayal', name: 'Otsar Hahayal', fields: [username, pw] },
  { id: 'mercantile', name: 'Mercantile', fields: [idField, pw, num] },
  { id: 'massad', name: 'Massad', fields: [username, pw] },
  { id: 'beinleumi', name: 'First International', fields: [username, pw] },
  { id: 'union', name: 'Union Bank', fields: [username, pw] },
  {
    id: 'yahav',
    name: 'Bank Yahav',
    fields: [
      username,
      { key: 'nationalID', label: 'National ID', type: 'text', hint: 'Your Israeli national ID number' },
      pw,
    ],
  },
  { id: 'isracard', name: 'Isracard', fields: [idField, card6, pw] },
  { id: 'amex', name: 'American Express (Israel)', fields: [username, card6, pw] },
  { id: 'max', name: 'Max (Leumi Card)', fields: [username, pw] },
  { id: 'visaCal', name: 'Visa Cal', fields: [username, pw] },
  { id: 'beyahadBishvilha', name: 'Beyond (Beyahad)', fields: [idField, pw] },
  {
    id: 'oneZero',
    name: 'One Zero',
    fields: [{ key: 'email', label: 'Email', type: 'text', placeholder: 'your@email.com' }, pw],
    otpNote:
      'One Zero requires a one-time password during each scrape — you will be prompted to enter it at scrape time.',
  },
  // Unknown credential schema — will use generic fallback UI (fields: [])
  { id: 'behatsdaa', name: 'Behatsdaa', fields: [] },
  { id: 'pagi', name: 'Pagi', fields: [] },
]
