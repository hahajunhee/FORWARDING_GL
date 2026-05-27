import { NextResponse } from 'next/server'
import { readFileSync, existsSync, readdirSync } from 'fs'
import path from 'path'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'

const DOWNLOAD_DIR = path.join(process.cwd(), 'scripts', '.downloads')

export async function GET() {
  try {
    if (!existsSync(DOWNLOAD_DIR)) {
      return NextResponse.json({ error: '다운로드 디렉토리가 없습니다.' }, { status: 404 })
    }

    const resultFile = path.join(DOWNLOAD_DIR, 'crawl_result.json')
    let excelPath = ''

    if (existsSync(resultFile)) {
      const result = JSON.parse(readFileSync(resultFile, 'utf-8'))
      if (result.file && existsSync(result.file)) {
        excelPath = result.file
      }
    }

    if (!excelPath) {
      const files = readdirSync(DOWNLOAD_DIR)
        .filter(f => /\.xlsx?$/i.test(f))
        .map(f => ({ name: f, path: path.join(DOWNLOAD_DIR, f) }))

      if (files.length === 0) {
        return NextResponse.json({ error: '다운로드된 엑셀 파일이 없습니다.' }, { status: 404 })
      }
      excelPath = files[files.length - 1].path
    }

    const workbook = XLSX.readFile(excelPath)
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

    const headers = jsonData.length > 0 ? Object.keys(jsonData[0]) : []

    const MAX_PREVIEW = 500
    const previewData = jsonData.slice(0, MAX_PREVIEW)

    return NextResponse.json({
      filename: path.basename(excelPath),
      sheetName,
      headers,
      totalRows: jsonData.length,
      previewRows: previewData.length,
      data: previewData,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
