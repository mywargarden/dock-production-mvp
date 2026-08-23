import { NextRequest } from 'next/server';

export function requireAdmin(request: NextRequest) {
  const expected = process.env.DOCK_ADMIN_TOKEN;
  if (!expected) {
    return { ok: false, status: 500, message: 'Missing DOCK_ADMIN_TOKEN' } as const;
  }

  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';

  if (!token || token !== expected) {
    return { ok: false, status: 401, message: 'Unauthorized' } as const;
  }

  return { ok: true } as const;
}
