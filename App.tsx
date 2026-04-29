import { useState, useMemo, useRef, useEffect } from 'react';
import Graph3D from './components/Graph3D';
import StarsBackground from './components/StarsBackground';
import AIChatbot from './components/AIChatbot';
import { ProfileCardsRow } from './components/ProfileCards';
import CareerMobility from './components/CareerMobility';
import SentimentEvolutionChart from './components/SentimentEvolutionChart';
import TopicChips from './components/TopicChips';
import { INITIAL_DATA, LAST_UPDATED } from './constants';
import { GraphData, GraphLink, GraphNode, SentimentScores } from './types';
import { analyzeSentiment } from './services/geminiService';
import { X as XIcon, ChevronLeft, ChevronRight, Search, HelpCircle } from 'lucide-react';

export default function App() {
  const [data] = useState<GraphData>(INITIAL_DATA);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isLegendOpen, setIsLegendOpen] = useState(false);
  const [showMethodology, setShowMethodology] = useState(false);

  // Selection State
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Sentiment Analysis State
  const [sentimentScores, setSentimentScores] = useState<SentimentScores | null>(null);
  const [sentimentLoading, setSentimentLoading] = useState(false);
  const sentimentCache = useRef<Map<string, SentimentScores>>(new Map());

  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Only show individual categories — exclude company and media
  const INDIVIDUAL_GROUPS = new Set(['founder', 'researcher', 'investor']);

  // 1. Calculate Statistics & Sort Nodes by Followers (or connections as fallback)
  const sortedNodes = useMemo(() => {
    const counts = new Map<string, number>();

    data.links.forEach(link => {
        const s = typeof link.source === 'object' ? (link.source as any).id : link.source;
        const t = typeof link.target === 'object' ? (link.target as any).id : link.target;
        counts.set(s, (counts.get(s) || 0) + 1);
        counts.set(t, (counts.get(t) || 0) + 1);
    });

    return [...data.nodes]
      .filter(node => INDIVIDUAL_GROUPS.has(node.group))
      .map(node => ({
        ...node,
        val: counts.get(node.id) || 0
      })).sort((a, b) => (b.followers || b.val || 0) - (a.followers || a.val || 0));

  }, [data]);

  // Create a map of node ID to original rank (1-based)
  const nodeRankMap = useMemo(() => {
    const map = new Map<string, number>();
    sortedNodes.forEach((node, idx) => {
      map.set(node.id, idx + 1);
    });
    return map;
  }, [sortedNodes]);

  // Filter nodes based on search query and selected category
  const filteredNodes = useMemo(() => {
    let nodes = sortedNodes;

    if (selectedCategory) {
      nodes = nodes.filter(node => node.group === selectedCategory);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      nodes = nodes.filter(node => {
        const name = (node.name || '').toLowerCase();
        const handle = (node.handle || '').toLowerCase();
        const role = (node.role || '').toLowerCase();
        const associated = (node.associated || '').toLowerCase();
        const bio = (node.bio || '').toLowerCase();
        const bioTags = ((node as any).bioTags || []).join(' ').toLowerCase();

        return name.includes(query) ||
               handle.includes(query) ||
               role.includes(query) ||
               associated.includes(query) ||
               bio.includes(query) ||
               bioTags.includes(query);
      });
    }

    return nodes;
  }, [sortedNodes, searchQuery, selectedCategory]);

  // Build filtered graph data — always exclude company/media, optionally filter by category
  const filteredGraphData = useMemo(() => {
    const baseNodes = data.nodes.filter(n => INDIVIDUAL_GROUPS.has(n.group));
    const baseNodeIds = new Set(baseNodes.map(n => n.id));

    const filteredNodeIds = selectedCategory
      ? new Set(baseNodes.filter(n => n.group === selectedCategory).map(n => n.id))
      : baseNodeIds;

    return {
      nodes: baseNodes.filter(n => filteredNodeIds.has(n.id)),
      links: data.links.filter(link => {
        const sId = typeof link.source === 'object' ? (link.source as any).id : link.source;
        const tId = typeof link.target === 'object' ? (link.target as any).id : link.target;
        return filteredNodeIds.has(sId) && filteredNodeIds.has(tId);
      }),
    };
  }, [data, selectedCategory]);

  // Scroll to selected node in the sidebar
  useEffect(() => {
    if (selectedNode && itemRefs.current.has(selectedNode.id)) {
      const element = itemRefs.current.get(selectedNode.id);
      element?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedNode]);

  // Fetch sentiment when a node is selected
  useEffect(() => {
    if (!selectedNode) {
      setSentimentScores(null);
      return;
    }
    const cached = sentimentCache.current.get(selectedNode.id);
    if (cached) {
      setSentimentScores(cached);
      return;
    }
    setSentimentScores(null);
    setSentimentLoading(true);
    analyzeSentiment(selectedNode).then(scores => {
      setSentimentLoading(false);
      if (scores) {
        sentimentCache.current.set(selectedNode.id, scores);
        setSentimentScores(scores);
      }
    });
  }, [selectedNode?.id]);

  // Per-node connection counts used in the X snapshot card (Network links stat).
  const connectionCountMap = useMemo(() => {
    const map = new Map<string, number>();
    data.links.forEach((link: GraphLink) => {
      const s = typeof link.source === 'object' ? (link.source as any).id : link.source;
      const t = typeof link.target === 'object' ? (link.target as any).id : link.target;
      map.set(s, (map.get(s) || 0) + 1);
      map.set(t, (map.get(t) || 0) + 1);
    });
    return map;
  }, [data]);

  // Sentiment bar for a single dimension
  const SentimentBar = ({ label, value, leftLabel, rightLabel }: {
    label: string; value: number; leftLabel: string; rightLabel: string;
  }) => {
    const pct = ((value + 1) / 2) * 100;
    return (
      <div className="mb-3">
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs font-medium text-slate-300">{label}</span>
        </div>
        <div className="relative h-1.5 bg-slate-700/60 rounded-full">
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-indigo-400 shadow-[0_0_6px_rgba(129,140,248,0.8)] transition-all duration-500"
            style={{ left: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-slate-500">{leftLabel}</span>
          <span className="text-[10px] text-slate-500">{rightLabel}</span>
        </div>
      </div>
    );
  };

  const handleNodeClick = (node: GraphNode) => {
    if (selectedNode?.id === node.id) {
      setSelectedNode(null);
      return;
    }
    setSelectedNode(node);
  };

  const closeSelection = () => {
    setSelectedNode(null);
  };

  const handleCategoryClick = (category: string) => {
    setSelectedCategory(prev => prev === category ? null : category);
    setSelectedNode(null);
  };

  return (
    <div className="relative h-screen w-full overflow-hidden bg-[#0B0C15] font-sans text-white">
      <StarsBackground />

      <div className="relative z-10 flex h-full w-full">
        <div
          className="relative z-20 h-full flex-shrink-0 overflow-visible transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ width: isSidebarOpen ? 320 : 0 }}
        >
          <button
            type="button"
            aria-label={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            onClick={() => setIsSidebarOpen((o) => !o)}
            className={`absolute top-1/2 z-30 flex h-16 w-5 -translate-y-1/2 items-center justify-center rounded-r-xl border border-l-0 border-white/15 bg-black/70 text-slate-400 shadow-lg backdrop-blur-md transition-all hover:bg-white/15 hover:text-white ${isSidebarOpen ? '-right-5' : 'right-[-12px]'}`}
          >
            {isSidebarOpen ? (
              <ChevronLeft className="h-2.5 w-2.5" strokeWidth={2.5} />
            ) : (
              <ChevronRight className="h-2.5 w-2.5" strokeWidth={2.5} />
            )}
          </button>

          <div className="flex h-full w-[320px] flex-col overflow-hidden border-r border-white/10 bg-black/40 backdrop-blur-xl">
            <div className="border-b border-white/10 bg-[#05060A]/50 px-4 py-3">
              <h1 className="text-xl font-bold tracking-tight text-white">Top AI Influencers on X</h1>
              <p className="mt-0.5 text-xs text-slate-400">Data last updated: {LAST_UPDATED}</p>
            </div>

            <div className="border-b border-white/10 p-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by name, handle, or role..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-slate-800/50 py-2 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:border-indigo-500/50 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            <div className="custom-scroll flex-1 overflow-y-auto overflow-x-hidden p-2">
              {filteredNodes.map((node) => {
                const isSelected = selectedNode?.id === node.id;
                return (
                  <button
                    key={node.id}
                    ref={(el) => {
                      if (el) itemRefs.current.set(node.id, el);
                      else itemRefs.current.delete(node.id);
                    }}
                    type="button"
                    onClick={() => handleNodeClick(node)}
                    className={`mb-1 flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all duration-200 ${
                      isSelected
                        ? 'border-indigo-500/50 bg-indigo-600/20 shadow-lg shadow-indigo-900/20'
                        : 'border-transparent hover:bg-white/5'
                    }`}
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        isSelected ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {nodeRankMap.get(node.id)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-1.5 truncate">
                        <span className={`text-sm font-semibold ${isSelected ? 'text-white' : 'text-slate-200'}`}>
                          {node.name}
                        </span>
                        {node.handle && (
                          <span className="truncate font-mono text-xs text-slate-500">@{node.handle}</span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="flex-1 truncate text-xs text-slate-500">
                          {node.role
                            ? `${node.role}${node.associated && node.associated !== node.name ? ` @ ${node.associated}` : ''}`
                            : '\u00A0'}
                        </span>
                        <span className="shrink-0 whitespace-nowrap text-[10px] text-slate-600">
                          {node.followers
                            ? node.followers >= 1_000_000
                              ? `${(node.followers / 1_000_000).toFixed(1)}M`
                              : `${Math.round(node.followers / 1000)}K`
                            : `${node.val} conn.`}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="border-t border-white/10 bg-[#05060A]/50 px-3 py-2">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setIsLegendOpen((o) => !o)}
                  className="flex items-center gap-1.5 text-left"
                >
                  <ChevronRight
                    className={`h-3 w-3 text-slate-500 transition-transform duration-200 ${isLegendOpen ? 'rotate-90' : ''}`}
                  />
                  <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Legend</span>
                </button>
                <span className="ml-4 text-xs text-slate-500">Created by WoW</span>
              </div>
              <div
                className={`flex flex-col gap-0.5 overflow-hidden transition-all duration-200 ease-in-out ${
                  isLegendOpen ? 'max-h-60 opacity-100' : 'max-h-0 opacity-0'
                }`}
              >
                <div className="flex flex-col gap-0.5 pt-2">
                  {[
                    { key: 'founder', color: '#38BDF8', label: 'Founder / Builder' },
                    { key: 'researcher', color: '#E879F9', label: 'Researcher / Academia' },
                    { key: 'investor', color: '#4ADE80', label: 'Investor' },
                  ].map((cat) => (
                    <button
                      key={cat.key}
                      type="button"
                      onClick={() => handleCategoryClick(cat.key)}
                      className={`flex items-center gap-2 rounded-md px-1 py-0.5 text-left transition-all duration-200 hover:bg-white/5 ${
                        selectedCategory === cat.key ? 'bg-white/10 ring-1 ring-white/20' : ''
                      } ${selectedCategory && selectedCategory !== cat.key ? 'opacity-40' : 'opacity-100'}`}
                    >
                      <div
                        className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: cat.color, boxShadow: `0 0 6px ${cat.color}` }}
                      />
                      <span className="text-[11px] text-slate-300">{cat.label}</span>
                    </button>
                  ))}
                  {selectedCategory && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCategory(null);
                        setSelectedNode(null);
                      }}
                      className="mt-0.5 px-1 text-left text-[10px] text-indigo-400 transition-colors hover:text-indigo-300"
                    >
                      Clear filter
                    </button>
                  )}
                  <div className="my-1.5 border-t border-white/10" />
                  <button
                    type="button"
                    onClick={() => setShowMethodology(true)}
                    className="flex items-center gap-1.5 px-1 text-[11px] text-indigo-400 transition-colors hover:text-indigo-300"
                  >
                    <HelpCircle className="h-3 w-3" />
                    <span>Methodology</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <Graph3D
            data={filteredGraphData}
            onNodeClick={handleNodeClick}
            selectedNode={selectedNode}
            keepOrphans={!!selectedCategory}
          />
        </div>
      </div>

      {selectedNode && (
        <div className="details-panel-scroll pointer-events-none fixed right-4 top-4 z-50 flex max-h-[calc(100vh-90px)] w-[420px] max-w-[min(420px,calc(100vw-2rem))] flex-col gap-2 overflow-y-auto">
          <ProfileCardsRow
            node={selectedNode}
            connectionCount={connectionCountMap.get(selectedNode.id) || 0}
            onClose={closeSelection}
          />

          <SentimentEvolutionChart personId={selectedNode.id} />

          <CareerMobility personId={selectedNode.id} />

          <div className="pointer-events-auto rounded-xl border border-white/10 bg-[#090A10]/95 p-3 shadow-2xl backdrop-blur-xl">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold text-white">AI Sentiment</h3>
              </div>
              <div className="flex items-center gap-1.5">
                {sentimentScores && (
                  <>
                    <span className="text-[9px] text-slate-400">Trends:</span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                        sentimentScores.trends === 'optimistic'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : sentimentScores.trends === 'pessimistic'
                            ? 'bg-red-500/20 text-red-300'
                            : 'bg-slate-500/20 text-slate-300'
                      }`}
                    >
                      {sentimentScores.trends.charAt(0).toUpperCase() + sentimentScores.trends.slice(1)}
                    </span>
                  </>
                )}
                <span className="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-1.5 py-0.5 text-[8px] font-semibold text-indigo-400">
                  Gemini
                </span>
                {sentimentLoading && (
                  <div className="flex items-center gap-1.5">
                    <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400" style={{ animationDelay: '0ms' }} />
                    <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400" style={{ animationDelay: '150ms' }} />
                    <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400" style={{ animationDelay: '300ms' }} />
                  </div>
                )}
              </div>
            </div>

            {sentimentLoading && !sentimentScores && (
              <p className="text-xs italic text-slate-500">Analyzing profile…</p>
            )}

            {sentimentScores && (
              <>
                <SentimentBar
                  label="Regulation"
                  value={sentimentScores.regulation}
                  leftLabel="Against"
                  rightLabel="Pro"
                />
                <SentimentBar
                  label="AI Usage"
                  value={sentimentScores.usage}
                  leftLabel="Restrictive"
                  rightLabel="Enthusiastic"
                />
                <SentimentBar
                  label="Trust vs. Risk"
                  value={sentimentScores.trust}
                  leftLabel="High Risk"
                  rightLabel="High Trust"
                />
                <SentimentBar
                  label="AI Agents"
                  value={sentimentScores.agent}
                  leftLabel="Skeptical"
                  rightLabel="Bullish"
                />
                <p className="mt-2 text-[10px] italic text-slate-600">Inferred from bio & focus areas via Gemini</p>
              </>
            )}

            {!sentimentLoading && !sentimentScores && (
              <p className="text-xs italic text-slate-500">No API key configured for sentiment analysis.</p>
            )}
          </div>

          <TopicChips topics={selectedNode.bioTags} />
        </div>
      )}

      {/* Methodology Modal */}
      {showMethodology && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setShowMethodology(false)}
          />

          {/* Modal */}
          <div className="relative bg-[#0B0C15] border border-white/10 rounded-2xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto custom-scrollbar">
            {/* Header */}
            <div className="sticky top-0 bg-[#0B0C15] border-b border-white/10 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Methodology</h2>
              <button
                onClick={() => setShowMethodology(false)}
                className="p-1.5 hover:bg-white/10 rounded-full text-slate-400 hover:text-white transition-colors"
              >
                <XIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="px-5 py-3 space-y-2.5">
              <div>
                <h3 className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-1">Discovery & Selection</h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Starting from <span className="text-white font-medium">seed accounts</span> (OpenAI, Anthropic, DeepMind, top researchers), we crawl who they follow to find AI voices. If multiple trusted sources follow someone, they matter. The shortlist is then scored by:
                </p>
                <div className="bg-slate-800/50 border border-white/10 rounded-md px-2.5 py-1.5 font-mono text-xs text-white mt-1.5 mb-1">
                  Score = log<sub>10</sub>(followers) x seed_connections
                </div>
                <p className="text-xs text-slate-400">
                  Log scale prevents mega-accounts from dominating. Minimum 1K followers, AI keywords in bio, blocklist for general media.
                </p>
              </div>

              <div>
                <h3 className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-1">Graph & Connections</h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  The default view shows all connections. <span className="text-white font-medium">Click a node</span> to see who they follow. Node sizes reflect followers. Filter by category using the legend.
                </p>
              </div>

              <div className="pt-2 border-t border-white/10">
                <p className="text-xs text-slate-400">
                  This methodology may not be perfect. Have ideas?{' '}
                  <a
                    href="https://x.com/Jenny_the_Bunny"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-400 hover:text-indigo-300"
                  >
                    Hit me up on X
                  </a>
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .custom-scroll::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scroll::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.02);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
        .details-panel-scroll { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.12) transparent; }
        .details-panel-scroll::-webkit-scrollbar { display: none; }
      `}</style>

      {/* In-app AI assistant (Gemini-powered) */}
      <AIChatbot />
    </div>
  );
}