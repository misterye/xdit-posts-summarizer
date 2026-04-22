import React, { useState, useRef, useEffect } from 'react';
import { Download, FileText, FileDown, Loader2, Copy, Check, Settings, Key, Zap, Sun, Moon, Eye, EyeOff, RefreshCw } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Document as DocxDocument, Packer as DocxPacker, Paragraph as DocxParagraph, TextRun as DocxTextRun } from 'docx';
import type { GoogleGenAI as GoogleGenAIType } from '@google/genai';

export default function App() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState('');
  const [processedUrls, setProcessedUrls] = useState<{original: string, expanded: string, failed?: boolean, failureReason?: string}[]>([]);
  const [urlTruncation, setUrlTruncation] = useState<{truncated: boolean, totalFound: number} | null>(null);
  const [copied, setCopied] = useState(false);
  
  // API Key & Model configs
  const [isLight, setIsLight] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [customApiKey, setCustomApiKey] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState('gemini-1.5-flash');
  const [isPaidTier, setIsPaidTier] = useState(false);

  const [apiError, setApiError] = useState('');
  const [isValidatingKey, setIsValidatingKey] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  const printRef = useRef<HTMLDivElement>(null);

  // Safely attempt to read the Vite-injected literal string for the API key.
  // We use a try-catch because if Vite DOES NOT replace it (e.g. some environments), 
  // referencing `process.env` will throw a ReferenceError in the browser.
  let injectedSystemKey: string | undefined = undefined;
  try {
    injectedSystemKey = process.env.GEMINI_API_KEY;
  } catch (err) {
    injectedSystemKey = undefined;
  }

  const isSystemKeyAvailable = injectedSystemKey !== undefined && injectedSystemKey !== 'undefined' && injectedSystemKey !== '';

  useEffect(() => {
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) {
      setApiKeyInput(savedKey);
      setCustomApiKey(savedKey);

      const savedModelsStr = localStorage.getItem('gemini_models');
      if (savedModelsStr) {
        try {
          const parsedModels = JSON.parse(savedModelsStr);
          if (Array.isArray(parsedModels) && parsedModels.length > 0) {
            setModels(parsedModels);
            const savedSelected = localStorage.getItem('gemini_selected_model');
            if (savedSelected && parsedModels.includes(savedSelected)) {
              setSelectedModel(savedSelected);
            } else {
              setSelectedModel(parsedModels[0]);
            }
            const isPaid = parsedModels.some((m: string) => m.includes('3.1') || m.includes('2.0-pro-preview'));
            setIsPaidTier(isPaid);
            return;
          }
        } catch (e) {}
      }
      fetchModels(savedKey, true);
    }
  }, []);

  const fetchModels = async (key: string, silent = false) => {
    setApiError('');
    setIsValidatingKey(true);
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
      if (!response.ok) {
        throw new Error('Invalid API Key');
      }
      const data = await response.json();
      const availableModels = data.models
        .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
        .filter((m: any) => {
          const name = m.name.toLowerCase();
          return name.includes('gemini') && 
                 !name.includes('vision') && 
                 !name.includes('learnlm') && 
                 !name.includes('aqa') && 
                 !name.includes('embedding');
        })
        .map((m: any) => m.name.replace('models/', ''));
      
      // Sort models by version to easily pick the highest
      const versionWeight = (m: string) => {
        let w = 0;
        if (m.includes('3.1')) w += 400;
        else if (m.includes('2.5')) w += 300;
        else if (m.includes('2.0')) w += 200;
        else if (m.includes('1.5')) w += 100;
        
        if (m.includes('pro')) w += 50;
        if (m.includes('flash')) w += 20;
        if (m.includes('preview')) w -= 5;
        return w;
      };
      
      availableModels.sort((a: string, b: string) => versionWeight(b) - versionWeight(a));

      // Real-time access check: Ping ONLY the advanced/pro models to verify actual generation availability.
      // This avoids consuming Free Tier quotas on basic flash models while strictly enforcing permissions.
      const checkAccess = async (model: string) => {
        // Assume 'flash' and basic models are natively accessible on all tiers.
        if (!model.includes('pro') && !model.includes('preview') && !model.includes('advanced')) {
          return { model, available: true };
        }
        
        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }] })
          });
          
          // STRICT RULE: If Google API returns ANY error (including 429 Quota Zero for paid models), it is UNAVAILABLE.
          return { model, available: res.ok };
        } catch (e) {
          return { model, available: false };
        }
      };

      const accessResults = [];
      // Test sequentially to prevent aggressive rate-limiting on valid Free Tier keys
      for (const m of availableModels) {
        accessResults.push(await checkAccess(m));
      }
      
      const finalModels = accessResults.filter(r => r.available).map(r => r.model);
      
      setModels(finalModels);

      // Determine 'Tier' based purely on the models that survived real-time validation. 
      // If the key can still access advanced paid models like 3.1 or premium 2.0-pro, it's considered Paid.
      const isPaid = finalModels.some((m: string) => m.includes('3.1') || m.includes('2.0-pro-preview'));
      if (isPaid !== isPaidTier) {
        setIsPaidTier(isPaid);
      }

      // Successfully validated, keep in session
      setCustomApiKey(key);
      localStorage.setItem('gemini_api_key', key);
      localStorage.setItem('gemini_models', JSON.stringify(finalModels));

      if (finalModels.length > 0) {
        const savedSelected = localStorage.getItem('gemini_selected_model');
        const newSel = (savedSelected && finalModels.includes(savedSelected)) ? savedSelected : finalModels[0];
        setSelectedModel(newSel);
        localStorage.setItem('gemini_selected_model', newSel);
      }
    } catch (error: any) {
      console.error(error);
      if (!silent || !isSystemKeyAvailable) {
        setApiError('Invalid or expired API Key. Please enter a valid key.');
      }
      // If validation fails, keep input visible so they know what was wrong
      setCustomApiKey('');
      setModels([]);
    } finally {
      setIsValidatingKey(false);
    }
  };

  const handleSaveApiKey = () => {
    const key = apiKeyInput.trim();
    if (!key) {
      setApiError('Please enter a GEMINI API KEY');
      return;
    }

    if (!key.startsWith('AIzaSy') || key.length !== 39) {
      setApiError('Invalid API Key format. Must start with AIzaSy and be 39 characters long.');
      setApiKeyInput('');
      return;
    }

    setApiError('');
    fetchModels(key);
  };

  const clearApiKey = () => {
    setApiKeyInput('');
    setApiError('');
    setCustomApiKey('');
    setModels([]);
    setSelectedModel('gemini-1.5-flash');
    localStorage.removeItem('gemini_api_key');
    localStorage.removeItem('gemini_models');
    localStorage.removeItem('gemini_selected_model');
  };

  const handleProcess = async () => {
    if (!input.trim()) return;
    setLoading(true);
    setSummary('');
    try {
      // 1. Backend extraction
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input })
      });
      const data = await res.json();
      
      if (!res.ok) {
        alert('Error extracting URLs: ' + data.error);
        setLoading(false);
        return;
      }

      const extractedData = data.processedData || [];
      setProcessedUrls(extractedData.map((d: any) => ({ original: d.originalUrl, expanded: d.expandedUrl, failed: d.failed, failureReason: d.failureReason })));
      setUrlTruncation(data.truncated ? { truncated: true, totalFound: data.totalFound } : null);

      // 2. Client-side Gemini Generate
      const systemInstruction = 
        "You are a helpful assistant for extracting and summarizing information from bookmarked X posts, Reddit posts, articles, and urls. " +
        "Output in nicely formatted Markdown. You MUST output the ENTIRE summary twice: first in English, and then followed by a Chinese translation.";
        
      const prompt = 
        "Please summarize the following bookmarks/content.\n" +
        "CRITICAL INSTRUCTION FOR CATEGORIZATION & REFERENCES: You MUST categorize the summaries explicitly by source using headings (e.g., '### Source: X' and '### Source: Reddit').\n" +
        "Do NOT list all URLs grouped together at the beginning or at the end. Instead, append the exact original URL reference directly after the specific summary block or bullet point that it corresponds to.\n" +
        "Provide your output in two sections: '## English Summary' followed by '## 中文总结' (Chinese Summary).\n" +
        "Original Input:\n" + input + "\n\n" +
        "Extracted Contents:\n" + JSON.stringify(extractedData, null, 2);

      const activeApiKey = customApiKey || injectedSystemKey;
      
      if (!activeApiKey) {
        alert("Please set your Gemini API key in settings, or define it in your environment.");
        setLoading(false);
        return;
      }
      
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: activeApiKey });
      const response = await ai.models.generateContent({
        model: selectedModel || 'gemini-3.1-pro-preview',
        contents: prompt,
        config: {
          systemInstruction
        }
      });

      setSummary(response.text || '');

    } catch (err: any) {
      console.error(err);
      alert('Error while processing: ' + (err.message || 'Unknown network error'));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const exportMarkdown = () => {
    const blob = new Blob([summary], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Summary.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportDocx = async () => {
    const { Document, Packer, Paragraph, TextRun } = await import('docx');
    const lines = summary.split('\n');
    const paragraphs: DocxParagraph[] = [];
    
    for (let line of lines) {
      if (!line.trim()) continue;
      
      const isHeader = line.startsWith('#');
      // Strip markdown header hashes and list asterisks/dashes at the start of lines
      let cleanText = line.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '');
      
      // Split by bold markdown to render bold sequences correctly
      const parts = cleanText.split(/(\*\*.*?\*\*|\*.*?\*)/g);
      
      const children = parts.map(part => {
        // Handle bold blocks
        if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('*') && part.endsWith('*'))) {
          const innerText = part.replace(/^\*+|\*+$/g, '');
          return new TextRun({ text: innerText, bold: true, size: isHeader ? 28 : 24 });
        }
        // Handle normal blocks
        return new TextRun({ text: part, bold: isHeader, size: isHeader ? 28 : 24 });
      });

      paragraphs.push(new Paragraph({
        children,
        spacing: { after: 120 },
        bullet: line.trim().startsWith('-') || line.trim().startsWith('* ') ? { level: 0 } : undefined
      }));
    }

    const doc = new Document({
      sections: [{
        properties: {},
        children: paragraphs,
      }]
    });

    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Summary.docx';
    a.click();
    URL.revokeObjectURL(url);
  };

  const isReady = Boolean(customApiKey || isSystemKeyAvailable);
  
  return (
    <div className={`min-h-screen font-sans flex flex-col transition-colors duration-300 ${isLight ? 'light' : ''} bg-[var(--bg-page)] text-[var(--text-main)]`}>
      <header className="h-20 border-b border-[var(--border-main)] flex items-center px-6 md:px-10 bg-[var(--bg-header)] backdrop-blur-md relative z-10">
        <div className="max-w-6xl w-full mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-[var(--icon-bg)] border border-[var(--border-subtle)] text-[var(--text-white)] p-2 rounded-lg">
              <FileText className="w-5 h-5" />
            </div>
            <h1 className="text-xl md:text-2xl font-serif italic tracking-tight text-[var(--text-white)]">Bookmark Summarizer</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsLight(!isLight)}
              className="w-10 h-10 rounded-full flex items-center justify-center transition-all text-[var(--text-subtle)] hover:text-[var(--text-white)] hover:bg-[var(--icon-hover)]"
              title="Toggle Theme"
            >
              {isLight ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl w-full mx-auto px-4 py-8 grid grid-cols-1 md:grid-cols-2 gap-8 flex-1 relative">
        
        {/* Settings Panel */}
        <div className="md:col-span-2 bg-[var(--bg-panel-alt)] border border-[var(--border-main)] rounded-2xl p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Zap className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-medium text-[var(--text-white)] tracking-wide">Model Configuration</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="flex flex-col gap-3">
                <label className="text-xs uppercase tracking-wider text-[var(--text-subtle)]">Gemini API Key</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
                    <input 
                      type={showApiKey ? "text" : "password"}
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder="Please input GEMINI API KEY" 
                      className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-lg py-2.5 pl-10 pr-10 text-sm text-[var(--text-white)] focus:outline-none focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all font-mono"
                    />
                    <button 
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)] hover:text-[var(--text-white)] transition-colors"
                      title={showApiKey ? "Hide API key" : "Show API key"}
                    >
                      {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <button 
                    onClick={handleSaveApiKey}
                    disabled={isValidatingKey || (!!customApiKey && customApiKey === apiKeyInput)}
                    className="px-4 py-2 bg-[var(--icon-hover)] hover:bg-[var(--border-main)] text-[var(--text-white)] text-sm font-medium rounded-lg transition-colors whitespace-nowrap min-w-[95px] flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isValidatingKey ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Key"}
                  </button>
                  {customApiKey && (
                    <button 
                      onClick={clearApiKey}
                      className="px-3 py-2 text-[var(--text-faint)] hover:text-red-500 hover:bg-red-500/10 text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {apiError && <p className="text-[11px] text-red-500 font-medium">{apiError}</p>}
                <p className="text-[10px] text-[var(--text-faint)]">Keys are stored securely in your browser session and never sent to our servers.</p>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex flex-row justify-between items-center">
                  <label className="text-xs uppercase tracking-wider text-[var(--text-subtle)]">
                    Language Model {customApiKey && typeof isPaidTier !== 'undefined' ? (isPaidTier ? '(Paid Tier)' : '(Free Tier)') : ''}
                  </label>
                  {customApiKey && (
                    <button 
                      onClick={() => fetchModels(customApiKey)}
                      disabled={isValidatingKey}
                      className="text-[10px] uppercase font-bold tracking-wider text-[var(--text-subtle)] hover:text-[var(--text-white)] transition-colors flex items-center gap-1 disabled:opacity-50"
                      title="Refresh Model List"
                    >
                      <RefreshCw className={`w-3 h-3 ${isValidatingKey ? 'animate-spin' : ''}`} />
                      Refresh
                    </button>
                  )}
                </div>
                <select 
                  value={selectedModel}
                  onChange={(e) => {
                    setSelectedModel(e.target.value);
                    localStorage.setItem('gemini_selected_model', e.target.value);
                  }}
                  disabled={isValidatingKey || !customApiKey || models.length === 0}
                  className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-lg py-2.5 px-4 text-sm text-[var(--text-white)] focus:outline-none focus:ring-1 focus:ring-amber-500/50 appearance-none disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isValidatingKey ? (
                    <option value="" className="bg-[var(--bg-panel-alt)] text-[var(--text-main)] italic text-[var(--text-faint)]">
                      Loading available models...
                    </option>
                  ) : (
                    <>
                      {models.map(m => (
                        <option key={m} value={m} className="bg-[var(--bg-panel-alt)] text-[var(--text-main)]">
                          {m}
                        </option>
                      ))}
                      {models.length === 0 && (
                        <option value="gemini-1.5-flash" className="bg-[var(--bg-panel-alt)] text-[var(--text-main)]">
                          gemini-1.5-flash (Default)
                        </option>
                      )}
                    </>
                  )}
                </select>
                {!customApiKey && <p className="text-[10px] text-amber-600 dark:text-amber-500/60">Set your API Key to load models.</p>}
              </div>
            </div>
          </div>

        {/* Left Column: Input */}
        <section className="flex flex-col gap-4">
          <div className="bg-[var(--bg-panel)] p-6 md:p-8 rounded-2xl border border-[var(--border-main)] flex flex-col gap-6 min-h-[500px] md:h-[calc(100vh-160px)]">
            <div>
              <h2 className="text-lg font-serif italic text-[var(--text-white)] flex items-center gap-2 mb-2">
                Input Bookmarks
              </h2>
              <p className="text-sm text-[var(--text-muted)] leading-relaxed">
                Paste your copied bookmarks here. X links, Reddit posts, t.co short URLs, and generic article URLs will be expanded, read, and summarized by topic. <span className="text-[var(--text-faint)]">(Max 30 URLs per batch)</span>
              </p>
            </div>
            <textarea
              className="flex-1 w-full border border-[var(--border-main)] bg-[var(--bg-input)] rounded-xl p-4 text-sm text-[var(--text-white)] focus:ring-1 focus:ring-[var(--border-main)] focus:border-[var(--border-main)] outline-none resize-none font-mono placeholder-[var(--text-faint)] transition-all custom-scrollbar"
              placeholder="Paste URLs or text containing links here..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button
              onClick={handleProcess}
              disabled={loading || !input.trim() || !isReady}
              title={!isReady ? "Please Setup API Key in Settings First" : ""}
              className="w-full py-3.5 bg-[var(--btn-bg)] text-[var(--btn-text)] border border-[var(--border-main)] rounded-xl text-sm font-semibold tracking-wide hover:bg-[var(--btn-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-sm"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : !isReady ? "Please Set API Key" : "Extract & Summarize"}
            </button>
          </div>
        </section>

        {/* Right Column: Output */}
        <section className="flex flex-col gap-4">
          <div className="bg-[var(--bg-panel-alt)] p-6 md:p-8 rounded-2xl border border-[var(--border-main)] flex flex-col gap-6 min-h-[500px] md:h-[calc(100vh-160px)] relative overflow-hidden">
             
            <div className="flex items-center justify-between border-b border-[var(--border-main)] pb-4">
              <h2 className="text-[11px] uppercase tracking-[0.2em] text-[var(--text-subtle)]">Synthesized Insights</h2>
              {summary && (
                <div className="flex items-center gap-2">
                  <button onClick={handleCopy} className="w-9 h-9 rounded-full border border-[var(--border-main)] flex items-center justify-center hover:bg-[var(--bg-input)] transition-all text-[var(--text-muted)]" title="Copy">
                    {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <button onClick={exportMarkdown} className="w-9 h-9 rounded-full border border-[var(--border-main)] flex items-center justify-center hover:bg-[var(--bg-input)] transition-all text-[var(--text-muted)]" title="Export Markdown">
                    <span className="text-[10px] font-bold">MD</span>
                  </button>
                  <button onClick={exportDocx} className="w-9 h-9 rounded-full border border-[var(--border-main)] flex items-center justify-center hover:bg-[var(--bg-input)] transition-all text-[var(--text-muted)]" title="Export DOCX">
                    <span className="text-[10px] font-bold">DOC</span>
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto w-full relative custom-scrollbar pr-2">
              {loading ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-[var(--text-faint)] gap-4">
                  <Loader2 className="w-8 h-8 animate-spin text-[var(--text-faint)]" />
                  <p className="text-sm tracking-wide text-[var(--text-subtle)]">Analyzing and reading contents...</p>
                </div>
              ) : summary ? (
                <div className="w-full pb-8">
                  <div className={`prose prose-sm max-w-none ${!isLight ? 'prose-invert' : ''} prose-headings:font-serif prose-headings:italic prose-headings:text-[var(--text-white)] prose-p:text-[var(--text-muted)] prose-p:leading-relaxed prose-strong:text-[var(--text-white)] prose-a:text-blue-500`} ref={printRef}>
                    <Markdown remarkPlugins={[remarkGfm]}>{summary}</Markdown>
                  </div>
                  
                  {/* Expanded URLs Section */}
                  <div className="mt-10 pt-8 border-t border-[var(--border-main)]">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-[11px] uppercase tracking-[0.2em] text-[var(--text-subtle)]">Resource Map (Resolved URLs)</h3>
                      <span className="text-[10px] text-[var(--text-faint)]">{processedUrls.length} URL{processedUrls.length !== 1 ? 's' : ''} processed</span>
                    </div>
                    {urlTruncation && (
                      <div className="flex items-start gap-2 px-3 py-2 mb-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                        <span className="text-amber-500 text-xs mt-0.5">⚠</span>
                        <p className="text-[11px] text-amber-400 leading-relaxed">
                          Found {urlTruncation.totalFound} URLs but only the first 30 were processed. The remaining {urlTruncation.totalFound - 30} were skipped.
                        </p>
                      </div>
                    )}
                    <div className="space-y-3">
                      {processedUrls.map((u, i) => (
                        <div key={i} className={`p-3 bg-[var(--bg-input)] rounded-lg flex flex-col gap-2 group border ${u.failed ? 'border-red-500/50' : 'border-[var(--border-subtle)]'}`}>
                          <div className="flex items-center gap-3">
                            <div className="flex-1 flex flex-col md:flex-row md:items-center gap-2 md:gap-6 min-w-0">
                              <div className="flex flex-col min-w-0 md:w-1/2">
                                <p className="text-[10px] text-[var(--text-subtle)] uppercase mb-0.5 tracking-wider">Original URL</p>
                                <p className="text-xs font-mono text-[var(--text-subtle)] truncate">{u.original}</p>
                              </div>
                              <span className="hidden md:inline text-[var(--text-faint)]">→</span>
                              <div className="flex flex-col min-w-0 md:flex-1">
                                <p className="text-[10px] text-[var(--text-subtle)] uppercase mb-0.5 tracking-wider">Resolved Link</p>
                                <a href={u.expanded} target="_blank" rel="noreferrer" className="text-xs font-mono text-blue-500 hover:text-blue-400 truncate transition-colors">{u.expanded}</a>
                              </div>
                            </div>
                          </div>
                          {u.failed && (
                            <div className="flex items-start gap-2 px-1 py-1.5 bg-red-500/10 rounded-md">
                              <span className="text-red-500 text-xs mt-0.5">⚠</span>
                              <p className="text-[11px] text-red-400 leading-relaxed">{u.failureReason || 'Unknown failure'}</p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-[var(--text-faint)] text-sm">
                  <p>Synthesized insights will appear here.</p>
                </div>
              )}
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}

