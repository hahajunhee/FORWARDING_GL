import { NextResponse } from 'next/server'
import { readFileSync, existsSync } from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const DOWNLOAD_DIR = path.join(process.cwd(), 'scripts', '.downloads')
const STATUS_FILE = path.join(DOWNLOAD_DIR, 'crawl_status.json')

export async function GET() {
  try {
    if (!existsSync(STATUS_FILE)) {
      return NextResponse.json({ stage: 'idle', progress: 0, message: '대기 중', error: '' })
    }
    const data = readFileSync(STATUS_FILE, 'utf-8')
    return NextResponse.json(JSON.parse(data))
  } catch {
    return NextResponse.json({ stage: 'idle', progress: 0, message: '대기 중', error: '' })
  }
}
