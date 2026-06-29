import { useMemo } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import { TERMINATION_COLORS, VIBRANT } from '../../theme/chartColors';

interface PerSession {
  status: string;
  termination_reason: string | null;
  cost_usd: number;
}

interface Props {
  sessions: PerSession[];
}

interface PieDatum {
  name: string;
  value: number;
  color: string;
  total: number;
}

const terminationLabel = (reason: string): string => {
  const map: Record<string, string> = {
    completed_no_tool_call: 'Done (no tool)',
    max_turns: 'Max turns reached',
    loop_guard: 'Loop guard',
    timeout: 'Timed out',
    aborted: 'Aborted',
    errored: 'Errored',
    max_tool_calls: 'Max tool calls',
    length: 'Token limit',
  };
  return map[reason] ?? reason;
};

function buildTerminationData(sessions: PerSession[], total: number): PieDatum[] {
  const counts = new Map<string, number>();
  for (const s of sessions) {
    const reason = s.termination_reason ?? s.status;
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], i) => ({
      name: terminationLabel(name),
      value,
      color: TERMINATION_COLORS[name] ?? VIBRANT[i % VIBRANT.length],
      total,
    }));
}

interface CostBin {
  range: string;
  count: number;
}

function buildCostHistogram(costs: number[], binCount = 10): CostBin[] {
  if (costs.length === 0) return [];
  const min = Math.min(...costs);
  const max = Math.max(...costs);

  if (min === max) {
    return [{ range: `$${min.toFixed(4)}`, count: costs.length }];
  }

  const binWidth = (max - min) / binCount;
  const bins: { lo: number; hi: number; count: number }[] = [];
  for (let i = 0; i < binCount; i++) {
    bins.push({ lo: min + i * binWidth, hi: min + (i + 1) * binWidth, count: 0 });
  }
  for (const cost of costs) {
    let idx = Math.min(Math.floor((cost - min) / binWidth), binCount - 1);
    bins[idx].count++;
  }
  return bins.map(b => ({
    range: `$${b.lo.toFixed(3)}-${b.hi.toFixed(3)}`,
    count: b.count,
  }));
}

function PieTooltip({ active, payload }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0];
  return (
    <div className="bg-white px-3 py-2 rounded-lg shadow-lg border border-gray-200 text-xs">
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.payload.color }} />
        <span className="font-semibold text-gray-700">{d.name}</span>
      </div>
      <div className="text-gray-500 mt-0.5">{d.value} session(s) ({((d.value / d.payload.total) * 100).toFixed(0)}%)</div>
    </div>
  );
}

function BarTooltip({ active, payload }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white px-3 py-2 rounded-lg shadow-lg border border-gray-200 text-xs">
      <span className="font-semibold text-gray-700">{d.count} session(s)</span>
      <p className="text-gray-400 mt-0.5">Cost range: {d.range}</p>
    </div>
  );
}

export default function TerminationAndCost({ sessions }: Props) {
  const totalSessions = sessions.length;
  const pieData = useMemo(() => buildTerminationData(sessions, totalSessions), [sessions, totalSessions]);
  const completedCosts = useMemo(
    () => sessions.filter(s => s.status === 'completed').map(s => s.cost_usd ?? 0),
    [sessions],
  );
  const histData = useMemo(() => buildCostHistogram(completedCosts), [completedCosts]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Termination Reasons Pie */}
      <div>
        <h3 className="text-sm font-semibold text-gray-600 mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-gradient-to-r from-pink-500 to-violet-500" />
          Session Termination
        </h3>
        {pieData.length > 0 ? (
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
                <Tooltip content={<PieTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic">No session data</p>
        )}
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
          {pieData.map((d, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs text-gray-600">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
              {d.name} ({d.value})
            </div>
          ))}
        </div>
      </div>

      {/* Cost Histogram */}
      <div>
        <h3 className="text-sm font-semibold text-gray-600 mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500" />
          Cost per Session (completed)
        </h3>
        {histData.length > 0 ? (
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={histData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis
                  dataKey="range"
                  tick={{ fontSize: 9, fill: '#9CA3AF' }}
                  angle={-20}
                  textAnchor="end"
                  height={50}
                  interval={Math.max(0, Math.floor(histData.length / 6) - 1)}
                />
                <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                <Tooltip content={<BarTooltip />} />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {histData.map((_, i) => (
                    <Cell key={i} fill={`url(#cost-bar-${i % 3})`} />
                  ))}
                </Bar>
                <defs>
                  <linearGradient id="cost-bar-0" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" />
                    <stop offset="100%" stopColor="#047857" />
                  </linearGradient>
                  <linearGradient id="cost-bar-1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#06B6D4" />
                    <stop offset="100%" stopColor="#0E7490" />
                  </linearGradient>
                  <linearGradient id="cost-bar-2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366F1" />
                    <stop offset="100%" stopColor="#4338CA" />
                  </linearGradient>
                </defs>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic">No completed sessions with cost data</p>
        )}
        {completedCosts.length > 0 && (
          <p className="text-xs text-gray-400 mt-2">
            mu = ${(completedCosts.reduce((a, b) => a + b, 0) / completedCosts.length).toFixed(5)}
            {' '}sigma = {(() => {
              const mean = completedCosts.reduce((a, b) => a + b, 0) / completedCosts.length;
              const variance = completedCosts.reduce((sum, v) => sum + (v - mean) ** 2, 0) / completedCosts.length;
              return Math.sqrt(variance).toFixed(5);
            })()}
          </p>
        )}
      </div>
    </div>
  );
}
