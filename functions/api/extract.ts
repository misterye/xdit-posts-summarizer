import { extractUrls } from '../../lib/extractor';

interface CFContext {
  request: Request;
  env: Record<string, unknown>;
  params: Record<string, string>;
  waitUntil: (promise: Promise<unknown>) => void;
}

export async function onRequest(context: CFContext): Promise<Response> {
  const { request } = context;

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await request.json() as { input?: string };
    if (!body.input) {
      return new Response(JSON.stringify({ error: 'Missing input text' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const result = await extractUrls(body.input);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('Error processing:', error);
    return new Response(
      JSON.stringify({ error: error?.message || 'Internal server error while extracting' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
