import { Router } from 'express';
import type { TransactionRepository } from '../../storage/repositories/transactions.js';
import type { TransactionFilters } from '../../types/index.js';

export function createTransactionRoutes(
  transactionRepo: TransactionRepository,
): Router {
  const router = Router();

  /** GET /api/transactions — query transactions with filters */
  router.get('/', (req, res) => {
    const filters: TransactionFilters = {
      accountId: req.query.accountId as string | undefined,
      startDate: req.query.startDate as string | undefined,
      endDate: req.query.endDate as string | undefined,
      category: req.query.category as string | undefined,
      status: req.query.status as 'completed' | 'pending' | undefined,
      description: req.query.description as string | undefined,
      minAmount: req.query.minAmount
        ? parseFloat(req.query.minAmount as string)
        : undefined,
      maxAmount: req.query.maxAmount
        ? parseFloat(req.query.maxAmount as string)
        : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 200,
      offset: req.query.offset
        ? parseInt(req.query.offset as string, 10)
        : 0,
    };

    const transactions = transactionRepo.findAll(filters);
    res.json({ success: true, data: transactions });
  });

  /** GET /api/transactions/summary — aggregated summary */
  router.get('/summary', (req, res) => {
    const filters: TransactionFilters = {
      accountId: req.query.accountId as string | undefined,
      startDate: req.query.startDate as string | undefined,
      endDate: req.query.endDate as string | undefined,
      category: req.query.category as string | undefined,
    };

    const summary = transactionRepo.getSummary(filters);
    res.json({ success: true, data: summary });
  });

  /** GET /api/transactions/categories — list known categories */
  router.get('/categories', (_req, res) => {
    const categories = transactionRepo.getCategories();
    res.json({ success: true, data: categories });
  });

  /** GET /api/transactions/monthly — monthly income vs expenses */
  router.get('/monthly', (_req, res) => {
    const monthly = transactionRepo.getMonthlyTotals();
    res.json({ success: true, data: monthly });
  });

  /** GET /api/transactions/top-expenses — biggest expenses in a date range */
  router.get('/top-expenses', (req, res) => {
    const startDate =
      (req.query.startDate as string) ??
      new Date(Date.now() - 30 * 86400000).toISOString();
    const endDate =
      (req.query.endDate as string) ?? new Date().toISOString();
    const limit = req.query.limit
      ? parseInt(req.query.limit as string, 10)
      : 20;

    const top = transactionRepo.getTopExpenses(startDate, endDate, limit);
    res.json({ success: true, data: top });
  });

  /** PATCH /api/transactions/:id/category — set a category on a single txn */
  router.patch('/:id/category', (req, res) => {
    const { category } = req.body;
    if (!category || typeof category !== 'string') {
      res
        .status(400)
        .json({ success: false, error: 'category is required' });
      return;
    }
    const updated = transactionRepo.updateCategory(req.params.id, category);
    if (!updated) {
      res
        .status(404)
        .json({ success: false, error: 'Transaction not found' });
      return;
    }
    res.json({ success: true });
  });

  /** POST /api/transactions/bulk-categorize — categorize by description pattern */
  router.post('/bulk-categorize', (req, res) => {
    const { description, category } = req.body;
    if (!description || !category) {
      res.status(400).json({
        success: false,
        error: 'description and category are required',
      });
      return;
    }
    const count = transactionRepo.bulkUpdateCategory(
      { description },
      category,
    );
    res.json({ success: true, data: { updated: count } });
  });

  return router;
}
