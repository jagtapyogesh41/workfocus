import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const targetBase = (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
  const search = req.nextUrl.search || '';
  const targetUrl = `${targetBase}/v1/${path.join('/')}${search}`;

  const headers = new Headers();
  const auth = req.headers.get('authorization');
  if (auth) headers.set('authorization', auth);
  const contentType = req.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const body = hasBody ? await req.arrayBuffer() : undefined;

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
      cache: 'no-store',
    });
    const resBody = await upstream.arrayBuffer();
    const resHeaders = new Headers();
    const upType = upstream.headers.get('content-type');
    if (upType) resHeaders.set('content-type', upType);
    return new NextResponse(resBody, { status: upstream.status, headers: resHeaders });
  } catch (err: any) {
    return NextResponse.json(
      { message: `Upstream API unreachable at ${targetBase}: ${err?.message ?? 'connection failed'}` },
      { status: 502 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
