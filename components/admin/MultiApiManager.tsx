import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Trash2, RefreshCw, CheckCircle2, AlertTriangle, XCircle,
  Server, Zap, Copy, ToggleLeft, ToggleRight, Info
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GlassPanel } from '@/components/ui/GlassPanel';
import {
  getApiEndpoints, addApiEndpoint, removeApiEndpoint,
  toggleApiEndpoint, checkAllEndpointsHealth, type ApiEndpoint
} from '@/lib/api/multiApiBalancer';

const CATEGORY_DESCRIPTIONS = [
  { category: 'anime / meta', description: 'Anime info, posters, episode lists, character data' },
  { category: 'manga', description: 'Manga chapters, covers, metadata' },
  { category: 'search', description: 'Search queries, auto-complete' },
  { category: 'video', description: 'Video streaming sources, M3U8 playlists' },
  { category: 'general', description: 'Home page data, trending, schedules' },
];

function HealthBadge({ health }: { health?: ApiEndpoint['health'] }) {
  if (health === 'healthy') return (
    <span className="flex items-center gap-1 text-green-400 text-xs font-medium">
      <CheckCircle2 className="w-3 h-3" /> Healthy
    </span>
  );
  if (health === 'degraded') return (
    <span className="flex items-center gap-1 text-yellow-400 text-xs font-medium">
      <AlertTriangle className="w-3 h-3" /> Degraded
    </span>
  );
  if (health === 'down') return (
    <span className="flex items-center gap-1 text-red-400 text-xs font-medium">
      <XCircle className="w-3 h-3" /> Down
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-muted-foreground text-xs">
      <Server className="w-3 h-3" /> Unknown
    </span>
  );
}

export function MultiApiManager() {
  const [endpoints, setEndpoints] = useState<ApiEndpoint[]>([]);
  const [newUrl, setNewUrl] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [showHint, setShowHint] = useState(false);

  const refresh = useCallback(() => {
    setEndpoints(getApiEndpoints());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleAdd = () => {
    const url = newUrl.trim();
    if (!url) { toast.error('Please enter an API URL'); return; }
    if (!url.startsWith('http')) { toast.error('URL must start with http:// or https://'); return; }
    try {
      addApiEndpoint(url, newLabel.trim() || undefined);
      setNewUrl('');
      setNewLabel('');
      refresh();
      toast.success('API endpoint added!');
    } catch (e: any) {
      toast.error(e.message || 'Failed to add endpoint');
    }
  };

  const handleRemove = (id: string, label: string) => {
    if (id === 'default') { toast.error('Cannot remove the default API'); return; }
    removeApiEndpoint(id);
    refresh();
    toast.success(`Removed: ${label}`);
  };

  const handleToggle = (id: string, enabled: boolean) => {
    toggleApiEndpoint(id, !enabled);
    refresh();
    toast.success(!enabled ? 'API enabled' : 'API disabled');
  };

  const handleCheckHealth = async () => {
    setIsChecking(true);
    try {
      await checkAllEndpointsHealth();
      refresh();
      toast.success('Health check complete');
    } catch {
      toast.error('Health check failed');
    } finally {
      setIsChecking(false);
    }
  };

  const enabledCount = endpoints.filter((e) => e.enabled).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <GlassPanel className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Server className="w-5 h-5 text-primary" />
              Multi-API Load Balancer
            </h2>
            <p className="text-muted-foreground text-sm mt-1">
              Add multiple API clones to distribute load. With {enabledCount} active API{enabledCount !== 1 ? 's' : ''}, each handles ~{Math.round(100 / Math.max(1, enabledCount))}% of the load.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCheckHealth}
            disabled={isChecking}
            className="shrink-0"
          >
            {isChecking
              ? <><RefreshCw className="w-4 h-4 mr-1 animate-spin" /> Checking...</>
              : <><RefreshCw className="w-4 h-4 mr-1" /> Check Health</>
            }
          </Button>
        </div>

        {/* How load is divided */}
        <div className="mt-4 p-3 bg-white/5 rounded-lg border border-white/10">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-yellow-400" />
            <span className="text-sm font-semibold text-white">How load is divided</span>
            <button onClick={() => setShowHint(!showHint)} className="ml-auto text-muted-foreground hover:text-white">
              <Info className="w-4 h-4" />
            </button>
          </div>
          {enabledCount === 1 ? (
            <p className="text-xs text-muted-foreground">1 API handles everything (anime, manga, search, video, metadata).</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {CATEGORY_DESCRIPTIONS.map((c, i) => {
                const apiIndex = i % enabledCount;
                const ep = endpoints.filter(e => e.enabled)[apiIndex];
                return (
                  <div key={c.category} className="text-xs p-2 bg-white/5 rounded border border-white/5">
                    <div className="font-semibold text-white capitalize">{c.category}</div>
                    <div className="text-muted-foreground">{c.description}</div>
                    <div className="mt-1 text-primary truncate">{ep?.label || `API ${apiIndex + 1}`}</div>
                  </div>
                );
              })}
            </div>
          )}
          {showHint && (
            <p className="mt-2 text-xs text-muted-foreground border-t border-white/10 pt-2">
              Categories rotate evenly across all enabled APIs. If an API goes down, its load shifts to the others automatically.
              Deploy the BeatAPI repo multiple times on Render (free tier each) and add each URL here.
            </p>
          )}
        </div>
      </GlassPanel>

      {/* Add New API */}
      <GlassPanel className="p-5">
        <h3 className="text-base font-semibold text-white mb-3 flex items-center gap-2">
          <Plus className="w-4 h-4 text-primary" /> Add API Endpoint
        </h3>
        <div className="flex flex-col sm:flex-row gap-3">
          <Input
            placeholder="API URL (e.g. https://beat-anime-api-2.onrender.com)"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            className="flex-1 bg-white/5 border-white/10"
          />
          <Input
            placeholder="Label (optional)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            className="w-full sm:w-40 bg-white/5 border-white/10"
          />
          <Button onClick={handleAdd} className="shrink-0">
            <Plus className="w-4 h-4 mr-1" /> Add
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Deploy the <a href="https://github.com/Beat-All-Repo/BeatAPI" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">BeatAPI</a> multiple times and paste each URL. Each instance reduces load proportionally.
        </p>
      </GlassPanel>

      {/* Endpoint List */}
      <div className="space-y-3">
        {endpoints.map((ep, idx) => (
          <GlassPanel key={ep.id} className={`p-4 border ${ep.enabled ? 'border-white/10' : 'border-white/5 opacity-60'}`}>
            <div className="flex items-center gap-3">
              {/* Index badge */}
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-primary">#{idx + 1}</span>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white font-semibold text-sm">{ep.label}</span>
                  <HealthBadge health={ep.health} />
                  {ep.latencyMs !== undefined && (
                    <span className="text-xs text-muted-foreground">{ep.latencyMs}ms</span>
                  )}
                  {!ep.enabled && (
                    <span className="text-xs bg-white/10 text-muted-foreground px-2 py-0.5 rounded-full">Disabled</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-muted-foreground truncate">{ep.url}</span>
                  <button
                    onClick={() => { navigator.clipboard.writeText(ep.url); toast.success('Copied!'); }}
                    className="text-muted-foreground hover:text-white shrink-0"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
                {ep.lastChecked && (
                  <p className="text-xs text-muted-foreground/60 mt-0.5">
                    Checked: {new Date(ep.lastChecked).toLocaleTimeString()}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleToggle(ep.id, ep.enabled)}
                  className={`transition-colors ${ep.enabled ? 'text-green-400 hover:text-yellow-400' : 'text-muted-foreground hover:text-green-400'}`}
                  title={ep.enabled ? 'Disable' : 'Enable'}
                >
                  {ep.enabled
                    ? <ToggleRight className="w-5 h-5" />
                    : <ToggleLeft className="w-5 h-5" />
                  }
                </button>
                <button
                  onClick={() => handleRemove(ep.id, ep.label)}
                  className="text-muted-foreground hover:text-red-400 transition-colors"
                  title="Remove"
                  disabled={ep.id === 'default'}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </GlassPanel>
        ))}
      </div>

      {/* Stats */}
      <GlassPanel className="p-4">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold text-white">{endpoints.length}</div>
            <div className="text-xs text-muted-foreground">Total APIs</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-green-400">{enabledCount}</div>
            <div className="text-xs text-muted-foreground">Active</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-primary">
              {enabledCount > 0 ? `${Math.round(100 / enabledCount)}%` : '0%'}
            </div>
            <div className="text-xs text-muted-foreground">Load per API</div>
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}
