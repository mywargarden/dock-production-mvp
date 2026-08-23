import { NextRequest, NextResponse } from 'next/server';
import { buildExtensionConfigForEmail } from '../../../../lib/license';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email') || '';

  if (!email.includes('@')) {
    return NextResponse.json(
      {
        ok: false,
        reason: 'missing_email',
        license: { status: 'inactive' },
      },
      { status: 400 }
    );
  }

  const config = await buildExtensionConfigForEmail(email);
  return NextResponse.json(config);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '');

  if (!email.includes('@')) {
    return NextResponse.json(
      {
        ok: false,
        reason: 'missing_email',
        license: { status: 'inactive' },
      },
      { status: 400 }
    );
  }

  const config = await buildExtensionConfigForEmail(email);
  return NextResponse.json(config);
}
