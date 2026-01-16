export interface OCRMetadata {
  method: string
  processing_time_ms: number
  page_count: number
  gpu_used: boolean
  model_version?: string
}

export interface OCRResult {
  status: string
  raw_output: string
  parsed_data: Record<string, unknown>
  metadata: OCRMetadata
  warnings: string[]
}
