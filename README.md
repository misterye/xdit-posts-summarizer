# Xdit Posts Summarizer

A powerful full-stack web application that extracts, categorizes, and summarizes content from X (Twitter) bookmarks and Reddit posts using Google's Gemini AI. 

## Latest Updates
- Improved explicit filtering of Gemini models inside the settings configuration.
- Unified model instruction references.
- Enhanced button visuals.

## Features

- **Smart Extraction:** Automatically detects and extracts URLs from raw text input. Expands short links (like `t.co` and `redd.it`) and scrapes content using optimized API approaches.
- **Dual-Platform Native Supported:** Perfectly handles X (Twitter) and Reddit links, including grabbing the top comments from Reddit threads for rich context. Unrecognized URLs fallback to generic article extraction.
- **AI Summarization:** Utilizes Gemini AI (`gemini-3.1-pro-preview` by default) to digest large amounts of textual data and reorganize it intelligently by topics and themes.
- **Bilingual Output:** Generates perfectly formatted Markdown summaries in both English and Chinese simultaneously.
- **Inline Referencing:** Appends the exact original source URLs directly alongside their corresponding summarized insights for easy fact-checking and referencing.
- **Bring Your Own Key (BYOK):** Seamlessly configure your own Google AI Studio API key. Securely stored in your local browser, unlocking dynamic access to any compatible Gemini model attached to your account.
- **Export Options:** Instantly export your generated insights into `.md` (Markdown) or `.docx` (Microsoft Word) formatting. Markdown tokens are cleanly mapped to native MS Word styling.

## Tech Stack

- **Frontend:** React 19, Tailwind CSS v4, Lucide React (Icons)
- **Backend:** Express.js, cheerio
- **AI Integration:** `@google/genai` (Official GenAI SDK)
- **Document Export:** `docx` (for native Microsoft Word generation)
- **Build System:** Vite, TypeScript

## How to Use

1. **Provide Bookmarks:** Paste plain text containing a list of your X or Reddit links into the input box.
2. **Configure AI (Optional):** Click the Settings (gear) icon to securely input your own Gemini API key and select your preferred language model from your account's available roster.
3. **Summarize:** Click "Extract & Summarize". The backend proxy will iteratively resolve the links, fetch the posts, and use AI to generate a clean, topic-categorized summary.
4. **Copy or Export:** Click the "Copy", "MD", or "DOC" buttons on the output panel to take your synthesized insights anywhere.

## License

MIT
