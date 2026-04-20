import * as cheerio from 'cheerio';

async function expandUrl(shortUrl: string) {
  try {
    const res = await fetch(shortUrl, { redirect: 'follow', method: 'HEAD' });
    return res.url;
  } catch (err) {
    return shortUrl;
  }
}

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

async function fetchTwitterContent(url: string) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
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

async function fetchArticleContent(url: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    let text = $('article').text();
    if (!text) {
      const paragraphs: string[] = [];
      $('p').each((_, el) => {
        paragraphs.push($(el).text());
      });
      text = paragraphs.join('\n');
    }
    return text.substring(0, 5000);
  } catch (e) {
    return null;
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { input } = req.body;
    if (!input) {
      return res.status(400).json({ error: 'Missing input text' });
    }

    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = input.match(urlRegex) || [];
    
    let processedData = [];
    
    for (const urlStr of urls) {
      let finalUrl = urlStr;
      
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

    return res.status(200).json({ processedData });

  } catch (error: any) {
    console.error('Error processing:', error);
    return res.status(500).json({ error: error?.message || 'Internal server error while extracting' });
  }
}
