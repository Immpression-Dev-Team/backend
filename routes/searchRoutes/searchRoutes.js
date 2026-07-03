import express from 'express';
import ImageModel from '../../models/images.js';
import { searchPublicArt } from '../../services/publicArt.js';

const router = express.Router();

// GET /api/search?q=<query>&limit=<n>
// Unified search across marketplace (MongoDB) + public domain (museum APIs)
router.get('/', async (req, res) => {
  const { q, limit = 12 } = req.query;

  if (!q || !q.trim()) {
    return res.status(400).json({ success: false, error: 'Query is required' });
  }

  const query = q.trim();
  const n = Math.min(Number(limit) || 12, 40);
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'i');

  const [marketplaceSettled, publicDomainSettled] = await Promise.allSettled([
    ImageModel.find({
      stage: 'approved',
      $or: [
        { name: regex },
        { artistName: regex },
        { description: regex },
        { category: regex },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(n)
      .select('_id artistName name price imageLink category isSigned isFramed soldStatus'),

    searchPublicArt(query, 'all', n),
  ]);

  const marketplace =
    marketplaceSettled.status === 'fulfilled'
      ? marketplaceSettled.value.map((img) => ({
          ...img.toObject(),
          isSold: img.soldStatus === 'sold',
        }))
      : [];

  const publicDomain =
    publicDomainSettled.status === 'fulfilled'
      ? publicDomainSettled.value.filter((a) => a.thumbnailUrl || a.imageUrl).slice(0, n)
      : [];

  res.json({ success: true, q: query, marketplace, publicDomain });
});

export default router;
