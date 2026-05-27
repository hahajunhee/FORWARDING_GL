import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const DOWNLOAD_DIR = path.join(process.cwd(), 'scripts', '.downloads')
const STATUS_FILE = path.join(DOWNLOAD_DIR, 'crawl_status.json')

export async function POST(request: NextRequest) {
  try {
    const { userId, password, dateFrom, dateTo, codes } = await request.json()

    if (!userId || !password) {
      return NextResponse.json({ error: 'SAP 아이디와 비밀번호를 입력해주세요.' }, { status: 400 })
    }

    mkdirSync(DOWNLOAD_DIR, { recursive: true })

    let codesFile = ''
    if (codes && codes.trim()) {
      codesFile = path.join(DOWNLOAD_DIR, 'booking_codes.txt')
      writeFileSync(codesFile, codes, 'utf-8')
    }

    writeFileSync(STATUS_FILE, JSON.stringify({
      stage: 'starting', progress: 0, message: '크롤링 시작 준비 중...', error: '', ts: Date.now() / 1000,
    }), 'utf-8')

    const scriptPath = path.join(process.cwd(), 'scripts', 'sap_crawl.py')
    const args = [
      scriptPath,
      '--user', userId,
      '--password', password,
      '--download-dir', DOWNLOAD_DIR,
      '--date-from', dateFrom || '20250301',
      '--date-to', dateTo || '20991010',
      '--status-file', STATUS_FILE,
    ]
    if (codesFile) {
      args.push('--codes-file', codesFile)
    }

    const child = spawn('python', args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    })

    child.stdout?.on('data', (data: Buffer) => {
      console.log('[crawl stdout]', data.toString())
    })
    child.stderr?.on('data', (data: Buffer) => {
      console.error('[crawl stderr]', data.toString())
    })
    child.on('error', (err) => {
      writeFileSync(STATUS_FILE, JSON.stringify({
        stage: 'error', progress: 0, message: '', error: `프로세스 실행 실패: ${err.message}`, ts: Date.now() / 1000,
      }), 'utf-8')
    })

    return NextResponse.json({ ok: true, pid: child.pid })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
