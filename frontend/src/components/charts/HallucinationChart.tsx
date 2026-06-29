import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  Legend,
} from 'recharts';

interface PerSession {
  tool_calls: Record<string, number>;
  hallucinated_tool_calls: number;
  tool_errors: number;
}

interface Props {
  sessions: PerSession[];
}

interface ToolDatum {
  name: string;
  valid: number;
  errors: number;
  total: number;
}

function buildToolData(sessions: PerSession[]): ToolDatum[] {
  const toolMap = new Map<string, { valid: number; errors: number }>();

  for (const s of sessions) {
    for (const [toolName, count] of Object.entries(s.tool_calls)) {
      const entry = toolMap.get(toolName) ?? { valid: 0, errors: 0 };
      entry.valid += count;
      toolMap.set(toolName, entry);
    }
    const allCount = Object.values(s.tool_calls).reduce((a, b) => a + b, 0);
    if (allCount > 0 && s.tool_errors > 0) {
      for (const [toolName, count] of Object.entries(s.tool_calls)) {
        const entry = toolMap.get(toolName)!;
        entry.errors += (count / allCount) * s.tool_errors;
      }
    }
  }

  return [...toolMap.entries()]
    .map(([name, entry]) => ({
      name,
      valid: entry.valid,
      errors: Math.round(entry.errors),
      total: entry.valid + Math.round(entry.errors),
    }))
    .sort((a, b) => b.total - a.total);
}

interface SessionSummary {
  total_hallucinated: number;
  total_errors: number;
  total_valid: number;
}

function getAggregateSummary(sessions: PerSession[]): SessionSummary {
  let totalValid = 0;
  let totalHall = 0;
  let totalErr = 0;
  for (const s of sessions) {
    totalValid += Object.values(s.tool_calls).reduce((a, b) => a + b, 0);
    totalHall += s.hallucinated_tool_calls ?? 0;
    totalErr += s.tool_errors ?? 0;
  }
  return { total_hallucinated: totalHall, total_errors: totalErr, total_valid: totalValid };
}

interface BarTooltipPayloadEntry {
  dataKey: string;
  value: number;
}

function StackedTooltip({ active, payload, label }: { active?: boolean; payload?: BarTooltipPayloadEntry[]; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  const valid = payload.find(p => p.dataKey === 'valid')?.value ?? 0;
  const errors = payload.find(p => p.dataKey === 'errors')?.value ?? 0;
  const total = valid + errors;
  const errorRate = total > 0 ? ((errors / total) * 100).toFixed(1) : '0';

  return (
    <div className="bg-white px-3 py-2 rounded-lg shadow-lg border border-gray-200 text-xs">
      <span className="font-semibold text-gray-700 block mb-1">{label}</span>
      <div className="space-y-0.5">
        <div className="flex justify-between gap-4">
          <span className="text-emerald-600">Valid calls</span>
          <span className="font-medium">{valid}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-rose-500">Errors</span>
          <span className="font-medium">{errors}</span>
        </div>
        <div className="flex justify-between gap-4 border-t border-gray-100 pt-1 mt-1">
          <span className="text-gray-500">Total</span>
          <span className="font-medium">{total}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-gray-500">Error rate</span>
          <span className="font-medium">{errorRate}%</span>
        </div>
      </div>
    </div>
  );
}

export default function HallucinationChart({ sessions }: Props) {
  const data = useMemo(() => buildToolData(sessions), [sessions]);
  const summary = useMemo(() => getAggregateSummary(sessions), [sessions]);

  if (data.length === 0) return null;

  return (
    <div>
      {/* Summary banner */}
      <div className="flex flex-wrap gap-6 mb-4">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600" />
          <span className="text-xs text-gray-500">
            Total valid calls: <strong className="text-gray-700">{summary.total_valid.toLocaleString()}</strong>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-gradient-to-br from-rose-400 to-rose-600" />
          <span className="text-xs text-gray-500">
            Total errors: <strong className="text-gray-700">{summary.total_errors.toLocaleString()}</strong>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-gradient-to-br from-amber-400 to-amber-600" />
          <span className="text-xs text-gray-500">
            Hallucinated calls: <strong className="text-gray-700">{summary.total_hallucinated.toLocaleString()}</strong>
          </span>
        </div>
      </div>

      {/* Stacked bar chart */}
      <div style={{ width: '100%', height: Math.max(200, data.length * 36 + 60) }}>
        <ResponsiveContainer>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 5, right: 20, left: 80, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: '#9CA3AF' }} />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 11, fill: '#374151', fontWeight: 600 }}
              width={75}
            />
            <Tooltip content={<StackedTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
            <ReferenceLine x={0} stroke="#D1D5DB" />
            <Bar dataKey="valid" stackId="calls" name="Valid calls" radius={[0, 0, 0, 0]}>
              {data.map((_, i) => (
                <Cell key={i} fill={`url(#valid-bar-${i % 3})`} />
              ))}
            </Bar>
            <Bar dataKey="errors" stackId="calls" name="Errors" radius={[0, 4, 4, 0]}>
              {data.map((_, i) => (
                <Cell key={i} fill={`url(#error-bar-${i % 2})`} />
              ))}
            </Bar>
            <defs>
              <linearGradient id="valid-bar-0" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#10B981" />
                <stop offset="100%" stopColor="#059669" />
              </linearGradient>
              <linearGradient id="valid-bar-1" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#84CC16" />
                <stop offset="100%" stopColor="#65A30D" />
              </linearGradient>
              <linearGradient id="valid-bar-2" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#14B8A6" />
                <stop offset="100%" stopColor="#0F766E" />
              </linearGradient>
              <linearGradient id="error-bar-0" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#F43F5E" />
                <stop offset="100%" stopColor="#BE123C" />
              </linearGradient>
              <linearGradient id="error-bar-1" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#FB7185" />
                <stop offset="100%" stopColor="#E11D48" />
              </linearGradient>
            </defs>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
