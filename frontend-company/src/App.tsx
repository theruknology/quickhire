import React, { useState, useEffect } from 'react';
import { DashboardOverview } from './components/DashboardOverview';
import { TalentPipeline } from './components/TalentPipeline';
import { CandidateInterviewUpdates } from './components/CandidateInterviewUpdates';
import { CandidateDossier } from './components/CandidateDossier';
import { CompanySetup } from './components/CompanySetup';
import { CvUploader } from './components/CvUploader';
import { Skeleton } from './components/ui/skeleton';

const API = 'http://localhost:8000';

function App() {
  const [companyId, setCompanyId] = useState<string | null>(localStorage.getItem('qh_company_id'));
  const [companyName, setCompanyName] = useState(localStorage.getItem('qh_company_name') || '');
  const [stats, setStats] = useState<any>(null);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<any>(null);
  const [view, setView] = useState<'dashboard' | 'upload'>('dashboard');

  const loadDashboard = async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const [statsRes, candRes] = await Promise.all([
        fetch(`${API}/api/dashboard/stats?company_id=${companyId}`),
        fetch(`${API}/api/dashboard/candidates?company_id=${companyId}`),
      ]);
      setStats(await statsRes.json());
      const data = await candRes.json();
      setCandidates(data.candidates || []);
    } catch (e) {
      console.error('Failed to load dashboard:', e);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (companyId) loadDashboard();
  }, [companyId]);

  const handleCompanyCreated = (id: string, name: string) => {
    localStorage.setItem('qh_company_id', id);
    localStorage.setItem('qh_company_name', name);
    setCompanyId(id);
    setCompanyName(name);
  };

  const handleCvUploaded = () => {
    loadDashboard();
    setView('dashboard');
  };

  // If no company is configured yet, show setup
  if (!companyId) {
    return <CompanySetup onCreated={handleCompanyCreated} />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30">
      <header className="border-b border-border/40 bg-card/50 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="font-bold text-xl tracking-tight flex items-center gap-2">
            <div className="w-3 h-3 bg-primary rounded-full animate-pulse shadow-[0_0_10px_hsl(var(--primary))]"></div>
            QuickHire <span className="text-primary font-light text-sm ml-1 bg-primary/10 px-2 py-0.5 rounded border border-primary/20">Terminal</span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <button
              onClick={() => setView('dashboard')}
              className={`px-3 py-1.5 rounded transition-colors ${view === 'dashboard' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}
            >Pipeline</button>
            <button
              onClick={() => setView('upload')}
              className={`px-3 py-1.5 rounded transition-colors ${view === 'upload' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}
            >Upload CVs</button>
            <span className="w-px h-4 bg-border"></span>
            <span className="text-muted-foreground">Firm: <span className="text-foreground font-medium">{companyName}</span></span>
            <button
              onClick={() => { localStorage.removeItem('qh_company_id'); localStorage.removeItem('qh_company_name'); setCompanyId(null); }}
              className="text-xs text-red-400 hover:text-red-300 transition-colors"
            >Switch</button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {view === 'upload' ? (
          <CvUploader companyId={companyId} onUploaded={handleCvUploaded} />
        ) : (
          <>
            <h1 className="text-3xl font-bold tracking-tight mb-2">Acquisition Pipeline</h1>
            <p className="text-muted-foreground mb-8">Real-time candidate screening via RAG + Groq inference.</p>

            {loading ? (
              <div className="space-y-6">
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  <Skeleton className="h-32 w-full rounded-xl" />
                  <Skeleton className="h-32 w-full rounded-xl" />
                  <Skeleton className="h-32 w-full rounded-xl" />
                </div>
                <Skeleton className="h-96 w-full rounded-xl" />
              </div>
            ) : (
              <>
                <DashboardOverview stats={stats} />
                {companyId && <CandidateInterviewUpdates companyId={companyId} />}
                <TalentPipeline candidates={candidates} onSelectCandidate={setSelectedCandidate} />
              </>
            )}
          </>
        )}
      </main>

      {selectedCandidate && (
        <CandidateDossier candidate={selectedCandidate} onClose={() => setSelectedCandidate(null)} />
      )}
    </div>
  );
}

export default App;
