import { extractUrls } from '../lib/extractor.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { input } = req.body;
    if (!input) {
      return res.status(400).json({ error: 'Missing input text' });
    }

    const result = await extractUrls(input);
    return res.status(200).json(result);

  } catch (error: any) {
    console.error('Error processing:', error);
    return res.status(500).json({ error: error?.message || 'Internal server error while extracting' });
  }
}
