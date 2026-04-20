import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Helper to expand URL
async function expandUrl(shortUrl: string) {
  try {
    const res = await fetch(shortUrl, { redirect: 'follow', method: 'HEAD' });
    return res.url;
  } catch (err) {
    return shortUrl;
  }
}

// Helper to extract domain
function isTwitterUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith('twitter.com') || parsed.hostname.endsWith('x.com');
  } catch (err) {
    return false;
  }
}

function isRedditUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith('reddit.com') || parsed.hostname.endsWith('redd.it');
  } catch (err) {
    return false;
  }
}

// Helper to fetch twitter content via vxtwitter API
async function fetchTwitterContent(url: string) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname; // e.g. /user/status/123
    const vxUrl = `https://api.vxtwitter.com${path}`;
    const res = await fetch(vxUrl);
    if (!res.ok) return null;
    const data = await res.json() as any;
    return `Twitter Post by @${data.user_screen_name}:\n${data.text}\nMedia: ${data.mediaURLs?.join(', ')}`;
  } catch (e) {
    return null;
  }
}

async function fetchRedditContent(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith('redd.it')) {
      // It's a short URL, let's expand it first
      const res = await fetch(url, { redirect: 'follow', method: 'HEAD' });
      parsed.href = res.url;
    }

    let pathname = parsed.pathname.replace(/\/$/, '');
    if (!pathname.endsWith('.json')) {
      pathname += '.json';
    }
    
    const fetchUrl = `https://www.reddit.com${pathname}`;
    const res = await fetch(fetchUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' } });
    if (!res.ok) return null;
    
    const data = await res.json() as any;
    const postData = data[0]?.data?.children[0]?.data;
    if (!postData) return null;

    const title = postData.title;
    const author = postData.author;
    const selftext = postData.selftext;
    
    let comments = "";
    if (data[1]?.data?.children) {
      const topComments = data[1].data.children
        .slice(0, 3)
        .map((c: any) => c.data?.body)
        .filter(Boolean);
      if (topComments.length > 0) {
        comments = "\nTop Comments:\n- " + topComments.join("\n- ");
      }
    }

    return `Reddit Post by u/${author}:\nTitle: ${title}\nBody: ${selftext}${comments}`;
  } catch (e) {
    return null;
  }
}

// Helper to fetch article content
async function fetchArticleContent(url: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    let text = $('article').text();
    if (!text) {
      // Fallback to body paragraphs
      const paragraphs: string[] = [];
      $('p').each((_, el) => {
        paragraphs.push($(el).text());
      });
      text = paragraphs.join('\n');
    }
    // Trim length to avoid context limit (up to 5000 chars per article is reasonable)
    return text.substring(0, 5000);
  } catch (e) {
    return null;
  }
}

app.post('/api/extract', async (req, res) => {
  try {
    const { input } = req.body;
    if (!input) {
      return res.status(400).json({ error: 'Missing input text' });
    }

    // 1. Extract URLs from input
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = input.match(urlRegex) || [];
    
    let processedData = [];
    
    for (const urlStr of urls) {
      let finalUrl = urlStr;
      
      // Expand t.co
      if (urlStr.includes('t.co')) {
        finalUrl = await expandUrl(urlStr);
      }
      
      let content = null;
      if (isTwitterUrl(finalUrl)) {
        content = await fetchTwitterContent(finalUrl);
      } else if (isRedditUrl(finalUrl)) {
        content = await fetchRedditContent(finalUrl);
      } else {
        content = await fetchArticleContent(finalUrl);
      }
      
      processedData.push({
        originalUrl: urlStr,
        expandedUrl: finalUrl,
        content: content || '(Content could not be extracted)'
      });
    }

    res.json({
      processedData
    });

  } catch (error: any) {
    console.error('Error processing:', error);
    res.status(500).json({ error: error?.message || 'Internal server error while extracting' });
  }
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    app.use(express.static(path.join(process.cwd(), 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
