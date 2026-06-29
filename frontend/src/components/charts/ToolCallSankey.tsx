import { useMemo } from 'react';
import {
  ResponsiveContainer,
  Sankey,
  Tooltip,
  Rectangle,
} from 'recharts';
import { colorAt } from '../../theme/chartColors';

interface PerSession {
  tool_sequence: string[];
  tool_calls: Record<string, number>;
}

interface Props {
  sessions: PerSession[];
}

interface SankeyData {
  name: string;
  nodes: { name: string }[];
  links: { source: number; target: number; value: number }[];
}

function buildSankeyData(sessions: PerSession[]): SankeyData {
  const transitions = new Map<string, number>();
  const nodeTotals = new Map<string, number>();

  for (const s of sessions) {
    const seq = s.tool_sequence;
    for (let i = 0; i < seq.length; i++) {
      const tool = seq[i];
      nodeTotals.set(tool, (nodeTotals.get(tool) ?? 0) + 1);
      if (i < seq.length - 1) {
        const next = seq[i + 1];
        const key = `${tool}|||${next}`;
        transitions.set(key, (transitions.get(key) ?? 0) + 1);
      }
    }
  }

  const sortedNodes = [...nodeTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  const nodePositions: Record<string, number> = {};
  sortedNodes.forEach((name, i) => { nodePositions[name] = i; });

  const nodes = sortedNodes.map(name => ({ name }));

  const links: { source: number; target: number; value: number }[] = [];
  for (const [key, value] of transitions) {
    const [from, to] = key.split('|||');
    const srcIdx = nodePositions[from];
    const tgtIdx = nodePositions[to];
    if (srcIdx !== undefined && tgtIdx !== undefined && srcIdx !== tgtIdx) {
      links.push({ source: srcIdx, target: tgtIdx, value });
    }
  }

  const merged = new Map<string, number>();
  for (const l of links) {
    const key = `${l.source}->${l.target}`;
    merged.set(key, (merged.get(key) ?? 0) + l.value);
  }
  const finalLinks = [...merged.entries()].map(([key, value]) => {
    const [s, t] = key.split('->').map(Number);
    return { source: s, target: t, value };
  });

  return { name: 'Tool Call Flow', nodes, links: finalLinks };
}

const VibrantNode = (props: any) => {
  const { x, y, width, height, index, name } = props;
  const color = colorAt(index);
  return (
    <g>
      <Rectangle
        x={x}
        y={y}
        width={width}
        height={height}
        fill={color}
        fillOpacity={0.85}
        rx={4}
        ry={4}
      />
      <text
        x={x + width + 8}
        y={y + height / 2}
        textAnchor="start"
        dominantBaseline="central"
        fontSize={11}
        fontWeight={600}
        fill="#374151"
      >
        {name}
      </text>
    </g>
  );
};

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const data = payload[0]?.payload;
  if (!data?.source?.name && !data?.target?.name) return null;

  if (data.name) {
    return (
      <div className="bg-white px-3 py-2 rounded-lg shadow-lg border border-gray-200 text-xs">
        <span className="font-semibold text-gray-700">{data.name}</span>
      </div>
    );
  }
  return (
    <div className="bg-white px-3 py-2 rounded-lg shadow-lg border border-gray-200 text-xs">
      <span className="font-semibold text-gray-700">
        {data.source?.name}{' -> '}{data.target?.name}
      </span>
      <div className="text-gray-500 mt-0.5">{data.value} transition(s)</div>
    </div>
  );
}

export default function ToolCallSankey({ sessions }: Props) {
  const data = useMemo(() => buildSankeyData(sessions), [sessions]);

  if (data.nodes.length === 0) return null;
  if (data.links.length === 0) {
    return (
      <div className="space-y-1 mt-2">
        {data.nodes.map((n, i) => (
          <div key={n.name} className="flex items-center gap-2 text-xs">
            <span
              className="w-3 h-3 rounded-sm flex-shrink-0"
              style={{ backgroundColor: colorAt(i) }}
            />
            <span className="font-medium text-gray-700">{n.name}</span>
          </div>
        ))}
        <p className="text-xs text-gray-400 mt-2 italic">
          (Single-tool sessions - no transitions to visualize)
        </p>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: Math.max(220, data.nodes.length * 32 + 60) }}>
      <ResponsiveContainer>
        <Sankey
          data={data}
          node={<VibrantNode />}
          link={{ stroke: '#94A3B8', strokeOpacity: 0.3 }}
          nodePadding={12}
          margin={{ left: 10, right: 120, top: 10, bottom: 10 }}
        >
          <Tooltip content={<CustomTooltip />} />
        </Sankey>
      </ResponsiveContainer>
    </div>
  );
}
