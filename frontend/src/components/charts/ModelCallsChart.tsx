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
  PieChart,
  Pie,
  Legend,
} from 'recharts';
import { VIBRANT, colorAt } from '../../theme/chartColors';

interface ModelStats {
  calls: number;
  errors: number;
  hallucinated: number;
  sessions: number;
  total_tokens: number;
}

interface Props {
  per_model: Record<string, ModelStats>;
}

interface ModelBarDatum {
  name: string;
  calls: number;
  errors: number;
  hallucinated: number;
  sessions: number;
}

interface PieDatum {
  name: string;
  value: number;
  color: string;
  total: number;
}

function buildBarData(per_model: Record<string, ModelStats>): ModelBarDatum[] {
  return Object.entries(per_model)
    .map(([name, stats]) => ({
      name,
      calls: stats.calls,
      errors: stats.errors,
      hallucinated: stats.hallucinated,
      sessions: stats.sessions,
    }))
    .sort((a, b) => b.calls - a.calls);
}

function buildPieData(per_model: Record<string, ModelStats>): PieDatum[] {
  const total = Object.values(per_model).reduce((sum, s) => sum + s.calls, 0);
  if (total === 0) return [];
  return Object.entries(per_model)
    .map(([name, stats], i) => ({
      name,
      value: stats.calls,
      color: VIBRANT[i % VIBRANT.length],
      total,
    }))
    .sort((a, b) => b.value - a.value);
}

interface BarTooltipPayloadEntry {
  dataKey: string;
  value: number;
  payload: ModelBarDatum;
}

function ModelBarTooltip({ active, payload, label }: { active?: boolean; payload?: BarTooltipPayloadEntry[]; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white px-3 py-2 rounded-lg shadow-lg border border-gray-200 text-xs">
      <div className="font-semibold text-gray-700 mb-1">{label}</div>
      <div className="space-y-0.5">
        <div className="flex justify-between gap-4">
          <span className="text-indigo-600">Calls</span>
          <span className="font-medium">{d.calls}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-emerald-600">Sessions</span>
          <span className="font-medium">{d.sessions}</span>
        </div>
        {d.errors > 0 && (
          <div className="flex justify-between gap-4">
            <span className="text-rose-500">Errors</span>
            <span className="font-medium">{d.errors}</span>
          </div>
        )}
        {d.hallucinated > 0 && (
          <div className="flex justify-between gap-4">
            <span className="text-amber-500">Hallucinated</span>
            <span className="font-medium">{d.hallucinated}</span>
          </div>
        )}
      </div>
    </div>
  );
}

interface PieTooltipPayload {
  name: string;
  value: number;
  payload: { color: string; total: number };
}

function ModelPieTooltip({ active, payload }: { active?: boolean; payload?: PieTooltipPayload[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0];
  const pct = ((d.value / d.payload.total) * 100).toFixed(1);
  return (
    <div className="bg-white px-3 py-2 rounded-lg shadow-lg border border-gray-200 text-xs">
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.payload.color }} />
        <span className="font-semibold text-gray-700">{d.name}</span>
      </div>
      <div className="text-gray-500 mt-0.5">{d.value} calls ({pct}%)</div>
    </div>
  );
}

export default function ModelCallsChart({ per_model }: Props) {
  const barData = useMemo(() => buildBarData(per_model), [per_model]);
  const pieData = useMemo(() => buildPieData(per_model), [per_model]);

  if (barData.length === 0) return null;

  const totalCalls = barData.reduce((sum, d) => sum + d.calls, 0);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Bar chart: calls per model */}
      <div>
        <h3 className="text-sm font-semibold text-gray-600 mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-gradient-to-r from-indigo-500 to-pink-500" />
          Calls per Model
        </h3>
        <div style={{ width: '100%', height: Math.max(180, barData.length * 40 + 40) }}>
          <ResponsiveContainer>
            <BarChart
              data={barData}
              layout="vertical"
              margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#9CA3AF' }} />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 11, fill: '#374151', fontWeight: 600 }}
                width={120}
                tickFormatter={(v: string) => v.length > 18 ? v.slice(0, 16) + '…' : v}
              />
              <Tooltip content={<ModelBarTooltip />} />
              <Bar dataKey="calls" radius={[0, 6, 6, 0]} barSize={20}>
                {barData.map((_, i) => (
                  <Cell key={i} fill={`url(#model-bar-${i % 3})`} />
                ))}
              </Bar>
              <defs>
                <linearGradient id="model-bar-0" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#6366F1" />
                  <stop offset="100%" stopColor="#4338CA" />
                </linearGradient>
                <linearGradient id="model-bar-1" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#EC4899" />
                  <stop offset="100%" stopColor="#BE185D" />
                </linearGradient>
                <linearGradient id="model-bar-2" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#14B8A6" />
                  <stop offset="100%" stopColor="#0F766E" />
                </linearGradient>
              </defs>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Pie chart: call distribution */}
      <div>
        <h3 className="text-sm font-semibold text-gray-600 mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-gradient-to-r from-violet-500 to-purple-500" />
          Call Distribution by Model
        </h3>
        {pieData.length > 0 ? (
          <>
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={85}
                    paddingAngle={2}
                    strokeWidth={1}
                    stroke="#fff"
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<ModelPieTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            {/* Legend */}
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
              {pieData.map((d, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs text-gray-600">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                  {d.name} ({d.value})
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-xs text-gray-400 italic">No model data</p>
        )}
      </div>
    </div>
  );
}
