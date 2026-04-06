import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Progress } from './ui/progress';
import { RefreshCw } from 'lucide-react';

const API = 'http://localhost:8000';

export function CandidateInterviewUpdates({ companyId }: { companyId: string }) {
  const [updates, setUpdates] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchUpdates = async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/company/${companyId}/candidate-updates`);
      const data = await res.json();
      setUpdates(data.updates || []);
    } catch (e) {
      console.error('Failed to load candidate updates:', e);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchUpdates();
    
    const interval = setInterval(fetchUpdates, 5000);
    return () => clearInterval(interval);
  }, [companyId]);

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed':
        return 'bg-green-500/20 text-green-400';
      case 'in_progress':
        return 'bg-blue-500/20 text-blue-400';
      case 'failed':
        return 'bg-red-500/20 text-red-400';
      default:
        return 'bg-gray-500/20 text-gray-400';
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Live Candidate Interview Updates</CardTitle>
        <button
          onClick={fetchUpdates}
          disabled={loading}
          className="p-2 hover:bg-muted rounded transition-colors disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </CardHeader>
      <CardContent>
        {updates.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>No active interviews yet. Candidates will appear here when they start their assessments.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {updates.map((update) => (
              <div key={update.id} className="border border-border/50 rounded-lg p-4 hover:bg-muted/50 transition-colors">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h4 className="font-semibold text-primary">{update.name}</h4>
                    <p className="text-xs text-muted-foreground">{formatTime(update.started_at)}</p>
                  </div>
                  <span className={`text-xs px-3 py-1 rounded-full ${getStatusColor(update.status)}`}>
                    {update.status === 'in_progress' ? 'In Progress' : 'Completed'}
                  </span>
                </div>

                <div className="space-y-3">
                  {/* Interview Round Progress */}
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <p className="text-xs font-medium text-foreground/80">Round Progress</p>
                      <p className="text-xs text-muted-foreground">{update.current_round || 1}/{update.total_rounds || 4}</p>
                    </div>
                    <Progress 
                      value={((update.current_round || 1) / (update.total_rounds || 4)) * 100} 
                      className="h-2"
                    />
                  </div>

                  {/* Score if completed */}
                  {update.overall_score !== null && update.overall_score !== undefined && (
                    <div className="bg-card border border-border/30 rounded p-3">
                      <div className="flex justify-between items-center mb-2">
                        <p className="text-xs font-medium">Overall Score</p>
                        <span className="text-sm font-bold text-primary">{Math.round(update.overall_score || 0)}%</span>
                      </div>
                      <Progress 
                        value={update.overall_score || 0} 
                        className="h-2"
                      />
                    </div>
                  )}

                  {/* Hints used */}
                  {update.hints_used > 0 && (
                    <p className="text-xs text-muted-foreground">
                      💡 Used {update.hints_used} hint{update.hints_used !== 1 ? 's' : ''}
                    </p>
                  )}

                  {/* Feedback snippet */}
                  {update.feedback && (
                    <p className="text-xs text-foreground/70 italic">
                      "{update.feedback.substring(0, 80)}..."
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
