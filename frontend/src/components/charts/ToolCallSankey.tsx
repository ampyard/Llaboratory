import { useMemo, useState } from 'react';
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
  sortedNodes.forEach((name, i) => {
    nodePositions[name] = i;
  });

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

interface HoveredLink {
  source: string;
  target: string;
  value: number;
  x: number;
  y: number;
}

export default function ToolCallSankey({ sessions }: Props) {
  const data = useMemo(() => buildSankeyData(sessions), [sessions]);
  const [hoveredLink, setHoveredLink] = useState<HoveredLink | null>(null);

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

  const chartWidth = Math.max(420, Math.min(760, data.nodes.length * 140));
  const chartHeight = Math.max(220, data.nodes.length * 32 + 60);
  const startX = 24;
  const endX = chartWidth - 170;
  const nodeWidth = 14;
  const nodeHeight = 12;
  const rowGap = Math.max(24, (chartHeight - 40) / Math.max(1, data.nodes.length));
  const maxLinkValue = Math.max(...data.links.map(link => link.value), 1);

  return (
    <div style={{ width: '100%', height: chartHeight, overflow: 'visible', position: 'relative' }}>
      <svg width={chartWidth} height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-full">
        {data.links.map((link, index) => {
          const sourceNode = data.nodes[link.source];
          const targetNode = data.nodes[link.target];
          const sourceY = 24 + link.source * rowGap + nodeHeight / 2;
          const targetY = 24 + link.target * rowGap + nodeHeight / 2;
          const strokeWidth = Math.max(3, (link.value / maxLinkValue) * 18);
          const isHovered = hoveredLink?.source === sourceNode.name && hoveredLink?.target === targetNode.name;
          const midX = (startX + nodeWidth + endX) / 2;
          const midY = (sourceY + targetY) / 2;

          return (
            <g key={`${sourceNode.name}-${targetNode.name}-${index}`}>
              <path
                d={`M ${startX + nodeWidth} ${sourceY} C ${startX + nodeWidth + 70} ${sourceY}, ${endX - 70} ${targetY}, ${endX} ${targetY}`}
                stroke={colorAt(link.source)}
                strokeWidth={isHovered ? strokeWidth + 2 : strokeWidth}
                strokeOpacity={isHovered ? 0.95 : 0.75}
                fill="none"
                strokeLinecap="round"
                data-link="true"
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoveredLink({ source: sourceNode.name, target: targetNode.name, value: link.value, x: midX, y: midY })}
                onMouseLeave={() => setHoveredLink(null)}
              />
            </g>
          );
        })}

        {data.nodes.map((node, index) => {
          const y = 24 + index * rowGap;
          return (
            <g key={node.name}>
              <rect
                x={startX}
                y={y}
                width={nodeWidth}
                height={nodeHeight}
                rx={3}
                ry={3}
                fill={colorAt(index)}
                fillOpacity={0.9}
              />
              <text
                x={startX + nodeWidth + 8}
                y={y + nodeHeight / 2}
                textAnchor="start"
                dominantBaseline="central"
                fontSize={11}
                fontWeight={600}
                fill="#374151"
              >
                {node.name}
              </text>
            </g>
          );
        })}
      </svg>

      {hoveredLink && (
        <div
          className="absolute rounded-lg border border-gray-200 bg-white/95 px-3 py-2 text-xs shadow-lg"
          style={{ left: Math.min(chartWidth - 140, hoveredLink.x + 10), top: Math.max(8, hoveredLink.y - 18) }}
        >
          <div className="font-semibold text-gray-700">{hoveredLink.source} → {hoveredLink.target}</div>
          <div className="text-gray-500">{hoveredLink.value} transition{hoveredLink.value === 1 ? '' : 's'}</div>
        </div>
      )}
    </div>
  );
}
