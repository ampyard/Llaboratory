import { useQuery } from '@tanstack/react-query'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Download, FileText, Loader2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../api/client'

export default function PlanReport() {
  const { planId } = useParams<{ planId: string }>()
  const [searchParams] = useSearchParams()
  const versionIdParam = searchParams.get('versionId')

  const { data: plan } = useQuery({
    queryKey: ['plans', planId],
    queryFn: () => api.plans.get(planId!),
    enabled: !!planId,
  })

  const targetVersion = versionIdParam
    ? plan?.versions.find(v => v.id === versionIdParam)
    : plan?.versions[plan.versions.length - 1]

  const { data: markdown, isLoading, isError } = useQuery({
    queryKey: ['report', targetVersion?.id],
    queryFn: () => api.analysis.fetchReport(targetVersion!.id),
    enabled: !!targetVersion,
  })

  return (
    <div className="p-6 max-w-4xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3 mb-6">
        <Link to="/plans" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-4 h-4" /> Plans
        </Link>
        <span className="text-gray-300">/</span>
        {planId && (
          <Link to={`/plans/${planId}/stats`} className="text-sm font-mono text-gray-400 hover:text-gray-600">
            {plan?.name ?? planId.slice(0, 8)}
          </Link>
        )}
        <span className="text-gray-300">/</span>
        <span className="text-sm text-gray-600">Report</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-indigo-600" />
          <h1 className="text-xl font-semibold">Findings Report</h1>
          {targetVersion && (
            <span className="text-xs text-gray-400 bg-gray-100 rounded px-2 py-0.5">
              v{targetVersion.version_number}
            </span>
          )}
        </div>
        {targetVersion && markdown && (
          <a
            href={api.analysis.reportDownloadUrl(targetVersion.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> Download .md
          </a>
        )}
      </div>

      {/* Body */}
      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-12 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Generating report…
        </div>
      )}

      {isError && (
        <div className="border border-red-200 bg-red-50 rounded-xl p-6 text-sm text-red-600">
          Failed to load report. Make sure the backend is running and this plan version has sessions.
        </div>
      )}

      {markdown && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 prose prose-sm prose-gray max-w-none
          prose-headings:font-semibold prose-headings:text-gray-900
          prose-h1:text-xl prose-h2:text-base prose-h3:text-sm
          prose-table:text-xs prose-td:py-1.5 prose-th:py-1.5
          prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-indigo-700 prose-code:font-normal
          prose-pre:bg-gray-50 prose-pre:border prose-pre:border-gray-200
          prose-hr:border-gray-200
          prose-a:text-indigo-600 hover:prose-a:text-indigo-800">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </div>
      )}
    </div>
  )
}
