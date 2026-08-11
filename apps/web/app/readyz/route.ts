import { adminSql } from '@deviceops/db';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    await adminSql()`select 1 as ready`;
    return NextResponse.json({ status: 'ready', database: 'ok', timestamp: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ status: 'not_ready', database: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
