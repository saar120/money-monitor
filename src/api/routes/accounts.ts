import { Router } from 'express';
import { z } from 'zod';
import type { AccountRepository } from '../../storage/repositories/accounts.js';
import type { ProviderType } from '../../types/index.js';

const VALID_PROVIDERS: ProviderType[] = [
  'hapoalim', 'beinleumi', 'union', 'amex', 'isracard', 'visaCal', 'max',
  'otsarHahayal', 'discount', 'mercantile', 'mizrahi', 'leumi', 'massad',
  'yahav', 'behatsdaa', 'beyahadBishvilha', 'oneZero', 'pagi',
];

const CreateAccountSchema = z.object({
  name: z.string().min(1),
  provider: z.enum(VALID_PROVIDERS as [string, ...string[]]),
  credentials: z.object({
    username: z.string().optional(),
    password: z.string().optional(),
    card6Digits: z.string().optional(),
    nationalID: z.string().optional(),
    otpLongTermToken: z.string().optional(),
  }),
});

export function createAccountRoutes(accountRepo: AccountRepository): Router {
  const router = Router();

  /** GET /api/accounts — list all accounts (credentials are never returned) */
  router.get('/', (_req, res) => {
    const accounts = accountRepo.findAll();
    res.json({ success: true, data: accounts });
  });

  /** GET /api/accounts/:id — single account */
  router.get('/:id', (req, res) => {
    const account = accountRepo.findById(req.params.id);
    if (!account) {
      res.status(404).json({ success: false, error: 'Account not found' });
      return;
    }
    // Strip credentials from the response
    const { encryptedCredentials: _, ...safe } = account;
    res.json({ success: true, data: safe });
  });

  /** POST /api/accounts — create a new account */
  router.post('/', (req, res) => {
    const parsed = CreateAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: parsed.error.issues.map((i) => i.message).join(', '),
      });
      return;
    }

    const { name, provider, credentials } = parsed.data;
    const account = accountRepo.create(
      name,
      provider as ProviderType,
      credentials,
    );
    const { encryptedCredentials: _, ...safe } = account;
    res.status(201).json({ success: true, data: safe });
  });

  /** DELETE /api/accounts/:id */
  router.delete('/:id', (req, res) => {
    const deleted = accountRepo.delete(req.params.id);
    if (!deleted) {
      res.status(404).json({ success: false, error: 'Account not found' });
      return;
    }
    res.json({ success: true });
  });

  return router;
}
