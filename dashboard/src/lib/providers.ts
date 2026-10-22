import { language } from './language';

export interface ProviderField {
  key: string;
  label: string;
  type: 'text' | 'password';
  placeholder?: string;
  hint?: string;
}

export interface Provider {
  id: string;
  name: string;
  accountType: 'bank' | 'credit_card';
  fields: ProviderField[];
  otpNote?: string;
}

// Shared field definitions (reused across multiple providers)
const pw: ProviderField = { key: 'password', label: 'Password', type: 'password' };
const username: ProviderField = { key: 'username', label: 'Username', type: 'text' };
const idField: ProviderField = { key: 'id', label: 'ID Number', type: 'text' };
const num: ProviderField = {
  key: 'num',
  label: 'Identification Code',
  type: 'text',
  hint: 'The 2–4 digit code assigned to your account',
};
const card6: ProviderField = {
  key: 'card6Digits',
  label: 'Last 6 Card Digits',
  type: 'text',
  hint: 'Last 6 digits of your card number',
};

const providerDefinitions: Provider[] = [
  {
    id: 'hapoalim',
    name: 'Bank Hapoalim',
    accountType: 'bank',
    fields: [{ key: 'userCode', label: 'User Code', type: 'text' }, pw],
  },
  { id: 'leumi', name: 'Bank Leumi', accountType: 'bank', fields: [username, pw] },
  { id: 'discount', name: 'Bank Discount', accountType: 'bank', fields: [idField, pw, num] },
  { id: 'mizrahi', name: 'Bank Mizrahi', accountType: 'bank', fields: [username, pw] },
  { id: 'otsarHahayal', name: 'Otsar Hahayal', accountType: 'bank', fields: [username, pw] },
  { id: 'mercantile', name: 'Mercantile', accountType: 'bank', fields: [idField, pw, num] },
  { id: 'massad', name: 'Massad', accountType: 'bank', fields: [username, pw] },
  { id: 'beinleumi', name: 'First International', accountType: 'bank', fields: [username, pw] },
  { id: 'union', name: 'Union Bank', accountType: 'bank', fields: [username, pw] },
  {
    id: 'yahav',
    name: 'Bank Yahav',
    accountType: 'bank',
    fields: [
      username,
      {
        key: 'nationalID',
        label: 'National ID',
        type: 'text',
        hint: 'Your Israeli national ID number',
      },
      pw,
    ],
  },
  { id: 'isracard', name: 'Isracard', accountType: 'credit_card', fields: [idField, card6, pw] },
  {
    id: 'amex',
    name: 'American Express (Israel)',
    accountType: 'credit_card',
    fields: [username, card6, pw],
  },
  { id: 'max', name: 'Max (Leumi Card)', accountType: 'credit_card', fields: [username, pw] },
  { id: 'visaCal', name: 'Visa Cal', accountType: 'credit_card', fields: [username, pw] },
  {
    id: 'beyahadBishvilha',
    name: 'Beyond (Beyahad)',
    accountType: 'credit_card',
    fields: [idField, pw],
  },
  {
    id: 'oneZero',
    name: 'One Zero',
    accountType: 'bank',
    fields: [
      { key: 'email', label: 'Email', type: 'text', placeholder: 'your@email.com' },
      pw,
      {
        key: 'phoneNumber',
        label: 'Phone Number',
        type: 'text',
        placeholder: '+972501234567',
        hint: 'Phone number linked to your One Zero account (used for OTP)',
      },
    ],
    otpNote:
      'One Zero requires a one-time password during each scrape — you will be prompted to enter it at scrape time.',
  },
  // Unknown credential schema — will use generic fallback UI (fields: [])
  { id: 'behatsdaa', name: 'Behatsdaa', accountType: 'credit_card', fields: [] },
  { id: 'pagi', name: 'Pagi', accountType: 'credit_card', fields: [] },
];

const hebrewNames: Record<string, string> = {
  hapoalim: 'בנק הפועלים',
  leumi: 'בנק לאומי',
  discount: 'בנק דיסקונט',
  mizrahi: 'בנק מזרחי',
  otsarHahayal: 'אוצר החייל',
  mercantile: 'מרכנתיל',
  massad: 'מסד',
  beinleumi: 'הבינלאומי',
  union: 'בנק אגוד',
  yahav: 'בנק יהב',
  isracard: 'ישראכרט',
  amex: 'אמריקן אקספרס (ישראל)',
  max: 'מקס (לאומי קארד)',
  visaCal: 'כאל',
  beyahadBishvilha: 'Beyond (ביחד בשבילך)',
  oneZero: 'וואן זירו',
  behatsdaa: 'בהצדעה',
  pagi: 'פאגי',
};

const hebrewFields: Record<string, { label: string; hint?: string }> = {
  password: { label: 'סיסמה' },
  username: { label: 'שם משתמש' },
  id: { label: 'מספר תעודת זהות' },
  num: {
    label: 'קוד זיהוי',
    hint: 'הקוד בן 2–4 הספרות שהוקצה לחשבון',
  },
  card6Digits: {
    label: '6 הספרות האחרונות בכרטיס',
    hint: '6 הספרות האחרונות של מספר כרטיס האשראי',
  },
  userCode: { label: 'קוד משתמש' },
  nationalID: {
    label: 'מספר תעודת זהות',
    hint: 'מספר תעודת הזהות הישראלית שלכם',
  },
  email: { label: 'אימייל' },
  phoneNumber: {
    label: 'מספר טלפון',
    hint: 'המספר שמקושר לחשבון וואן זירו, לקבלת קוד אימות',
  },
};

// Getters keep existing consumers reactive when the interface language changes.
export const PROVIDERS: Provider[] = providerDefinitions.map((provider) => ({
  ...provider,
  get name() {
    return language.value === 'he' ? (hebrewNames[provider.id] ?? provider.name) : provider.name;
  },
  fields: provider.fields.map((field) => ({
    ...field,
    get label() {
      return language.value === 'he'
        ? (hebrewFields[field.key]?.label ?? field.label)
        : field.label;
    },
    get hint() {
      return language.value === 'he' ? (hebrewFields[field.key]?.hint ?? field.hint) : field.hint;
    },
  })),
  get otpNote() {
    return language.value === 'he' && provider.id === 'oneZero'
      ? 'בכל סנכרון של חשבון וואן זירו תתבקשו להזין קוד אימות חד־פעמי.'
      : provider.otpNote;
  },
}));
