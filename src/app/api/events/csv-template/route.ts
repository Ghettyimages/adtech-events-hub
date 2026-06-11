import { NextResponse } from 'next/server';
import Papa from 'papaparse';
import { CSV_UPLOAD_TEMPLATE_ROWS } from '@/lib/csvHubIngest';

export async function GET() {
  const csv = Papa.unparse(CSV_UPLOAD_TEMPLATE_ROWS);

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="events-upload-template.csv"',
    },
  });
}
