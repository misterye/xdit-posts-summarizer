import * as cheerio from 'cheerio';

// ── Configuration ──────────────────────────────────────────────────────────
export const MAX_URLS = 30;
const CONCURRENCY = 5;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
const MAX_ARTICLE_LENGTH = 5000;

// ── Types ──────────────────────────────────────────────────────────────────
export interface ProcessedItem {
  originalUrl: string;
  expandedUrl: string;
  content: string;
  failed?: boolean;
  failureReason?: string;
}

export interface ExtractionResult {
  processedData: ProcessedItem[];
  totalFound: number;
  truncated: boolean;
}

// ── URL Classification Helpers ─────────────────────────────────────────────

async function expandUrl(shortUrl: string): Promise<string> {
  try {
    const res = await fetch(shortUrl, { redirect: 'follow', method: 'HEAD' });
    return res.url;
  } catch {
    return shortUrl;
  }
}

function isTwitterUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith('twitter.com') || parsed.hostname.endsWith('x.com');
  } catch {
    return false;
  }
}

function isRedditUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith('reddit.com') || parsed.hostname.endsWith('redd.it');
  } catch {
    return false;
  }
}

function isRedditShareOrShortUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith('redd.it')) return true;
    if (parsed.hostname.endsWith('reddit.com') && /\/s\//.test(parsed.pathname)) return true;
    return false;
  } catch {
    return false;
  }
}

const MEDIA_EXTENSIONS = /\.(jpe?g|png|gif|webp|bmp|svg|ico|mp4|webm|mov|avi|mkv|mp3|wav|ogg|flac|aac|m4a|pdf)(\?.*)?$/i;
function isMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return MEDIA_EXTENSIONS.test(parsed.pathname);
  } catch {
    return false;
  }
}

// ── Content Fetchers ───────────────────────────────────────────────────────

async function expandRedditUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT }
    });
    return res.url;
  } catch {
    return url;
  }
}

async function fetchTwitterContent(url: string): Promise<string | null> {
  try {
    const parsed = new URL(url);
    const vxUrl = `https://api.vxtwitter.com${parsed.pathname}`;
    const res = await fetch(vxUrl);
    if (!res.ok) return null;
    const data = await res.json() as any;
    return `Twitter Post by @${data.user_screen_name}:\n${data.text}\nMedia: ${data.mediaURLs?.join(', ')}`;
  } catch {
    return null;
  }
}

async function fetchRedditContent(url: string): Promise<string | null> {
  try {
    let resolvedUrl = url;

    // Expand short/share URLs (redd.it or /s/ paths) to canonical /comments/ form
    if (isRedditShareOrShortUrl(url)) {
      resolvedUrl = await expandRedditUrl(url);
    }

    const parsed = new URL(resolvedUrl);
    let pathname = parsed.pathname.replace(/\/$/, '');

    // Verify we have a /comments/ path — if not, the redirect didn't resolve properly
    if (!pathname.includes('/comments/')) {
      return null;
    }

    if (!pathname.endsWith('.json')) {
      pathname += '.json';
    }

    const fetchUrl = `https://www.reddit.com${pathname}`;
    const res = await fetch(fetchUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return null;

    const data = await res.json() as any;
    const postData = data[0]?.data?.children[0]?.data;
    if (!postData) return null;

    const title = postData.title;
    const author = postData.author;
    const selftext = postData.selftext || '';
    const postHint = postData.post_hint || '';
    const isMediaPost = ['image', 'hosted:video', 'rich:video', 'link'].includes(postHint) || postData.is_video;

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

    const mediaNote = (isMediaPost && !selftext.trim())
      ? '\n[Note: This post contains media content (image/video) — text summary based on title and comments only]'
      : '';
    return `Reddit Post by u/${author}:\nTitle: ${title}\nBody: ${selftext}${mediaNote}${comments}`;
  } catch {
    return null;
  }
}

async function fetchArticleContent(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return null;

    // Reject non-HTML responses (binary media, PDFs, etc.)
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/xhtml')) {
      return null;
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    // Remove all media elements before extracting text
    $('img, video, audio, picture, figure, svg, canvas, iframe, source, embed, object').remove();
    $('script, style, noscript').remove();

    let text = $('article').text();
    if (!text || text.trim().length < 50) {
      const paragraphs: string[] = [];
      $('p').each((_, el) => {
        const pText = $(el).text().trim();
        if (pText) paragraphs.push(pText);
      });
      text = paragraphs.join('\n');
    }

    text = text.trim();
    if (!text) return null;

    return text.substring(0, MAX_ARTICLE_LENGTH);
  } catch {
    return null;
  }
}

// ── Single URL Processor ───────────────────────────────────────────────────

async function processOneUrl(urlStr: string): Promise<ProcessedItem> {
  try {
    let finalUrl = urlStr;

    // Expand t.co short links
    if (urlStr.includes('t.co')) {
      finalUrl = await expandUrl(urlStr);
    }

    // Skip direct media file URLs
    if (isMediaUrl(finalUrl)) {
      return {
        originalUrl: urlStr,
        expandedUrl: finalUrl,
        content: '(Skipped — direct media file)',
        failed: true,
        failureReason: 'URL points directly to a media file (image/video/audio). Only text content is processed.'
      };
    }

    let content: string | null = null;
    if (isTwitterUrl(finalUrl)) {
      content = await fetchTwitterContent(finalUrl);
    } else if (isRedditUrl(finalUrl)) {
      content = await fetchRedditContent(finalUrl);
    } else {
      content = await fetchArticleContent(finalUrl);
    }

    if (content) {
      return { originalUrl: urlStr, expandedUrl: finalUrl, content };
    } else {
      return {
        originalUrl: urlStr,
        expandedUrl: finalUrl,
        content: '(Content could not be extracted)',
        failed: true,
        failureReason: 'Content extraction returned empty — the URL may be invalid, contain only media (images/videos), or require authentication.'
      };
    }
  } catch (error: any) {
    return {
      originalUrl: urlStr,
      expandedUrl: urlStr,
      content: '(Content could not be extracted)',
      failed: true,
      failureReason: error?.message || 'Unknown error during content extraction'
    };
  }
}

// ── Main Extraction Function ───────────────────────────────────────────────

/**
 * Extract and process URLs from raw input text.
 * - Enforces a MAX_URLS limit (excess URLs are truncated).
 * - Processes URLs concurrently in batches of CONCURRENCY.
 */
export async function extractUrls(input: string): Promise<ExtractionResult> {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const allUrls = input.match(urlRegex) || [];

  const totalFound = allUrls.length;
  const truncated = totalFound > MAX_URLS;
  const urls = allUrls.slice(0, MAX_URLS);

  // Process in concurrent batches
  const results: ProcessedItem[] = [];
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(processOneUrl));
    results.push(...batchResults);
  }

  return { processedData: results, totalFound, truncated };
}
