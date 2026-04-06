import React, { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Progress } from './ui/progress';

const API = 'http://localhost:8000';

interface PipelineStep {
  label: string;
  status: 'waiting' | 'running' | 'done' | 'error';
  detail?: string;
}

export function CvUploader({ companyId, onUploaded }: { companyId: string; onUploaded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [candidateName, setCandidateName] = useState('');
  const [candidateEmail, setCandidateEmail] = useState('');
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [steps, setSteps] = useState<PipelineStep[]>([]);

  const updateStep = useCallback((index: number, update: Partial<PipelineStep>) => {
    setSteps(prev => prev.map((s, i) => i === index ? { ...s, ...update } : s));
  }, []);

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setResult(null);

    const pipeline: PipelineStep[] = [
      { label: 'Uploading PDF', status: 'running' },
      { label: 'Parsing & Chunking (RAG)', status: 'waiting' },
      { label: 'Embedding into ChromaDB', status: 'waiting' },
      { label: 'AI Pre-Screening (Groq)', status: 'waiting' },
      { label: 'Generating Verdict', status: 'waiting' },
    ];
    setSteps(pipeline);

    // Simulate step visualization while the real call runs
    const form = new FormData();
    form.append('file', file);
    form.append('candidate_name', candidateName || file.name.replace('.pdf', ''));
    form.append('candidate_email', candidateEmail);
    form.append('company_id', companyId);

    // Step 1: Upload
    await delay(400);
    updateStep(0, { status: 'done' });
    updateStep(1, { status: 'running' });

    try {
      const res = await fetch(`${API}/api/upload-cv`, { method: 'POST', body: form });
      const data = await res.json();

      // Mark remaining steps done
      updateStep(1, { status: 'done', detail: `${data.chunks} chunks created` });
      await delay(300);
      updateStep(2, { status: 'done', detail: 'Vectors stored' });
      await delay(300);
      updateStep(3, { status: 'done', detail: data.screening ? `Score: ${data.screening.match_score}%` : 'Skipped' });
      await delay(300);
      updateStep(4, { status: 'done', detail: data.status?.toUpperCase() });

      setResult(data);
    } catch (err: any) {
      const failIdx = steps.findIndex(s => s.status === 'running' || s.status === 'waiting');
      if (failIdx >= 0) updateStep(failIdx, { status: 'error', detail: err.message });
    }
    setUploading(false);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Upload Candidate CV</h1>
      <p className="text-muted-foreground">PDFs are parsed, chunked, embedded, and screened against your job description in real-time.</p>

      <Card className="border-border">
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5 text-foreground/80">Candidate Name</label>
              <input value={candidateName} onChange={e => setCandidateName(e.target.value)}
                placeholder="e.g. Alice Smith"
                className="w-full bg-muted border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-primary transition-colors" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5 text-foreground/80">Email</label>
              <input value={candidateEmail} onChange={e => setCandidateEmail(e.target.value)}
                placeholder="alice@example.com"
                className="w-full bg-muted border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-primary transition-colors" />
            </div>
          </div>

          <div
            className="border-2 border-dashed border-border rounded-xl p-8 text-center hover:border-primary/50 transition-colors cursor-pointer"
            onClick={() => document.getElementById('cv-file-input')?.click()}
          >
            <input id="cv-file-input" type="file" accept=".pdf" className="hidden"
              onChange={e => setFile(e.target.files?.[0] || null)} />
            {file ? (
              <div className="text-primary font-medium">{file.name} <span className="text-muted-foreground text-sm">({(file.size / 1024).toFixed(0)} KB)</span></div>
            ) : (
              <div className="text-muted-foreground">
                <p className="text-lg mb-1">Drop a PDF here or click to browse</p>
                <p className="text-xs">Only .pdf files are supported</p>
              </div>
            )}
          </div>

          <Button onClick={handleUpload} disabled={!file || uploading}
            className="w-full h-11 font-semibold bg-gradient-to-r from-primary to-blue-600 shadow-lg shadow-primary/20 transition-all hover:scale-[1.01]">
            {uploading ? 'Processing...' : 'Run AI Pipeline →'}
          </Button>
        </CardContent>
      </Card>

      {/* Pipeline Visualization */}
      {steps.length > 0 && (
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-lg">RAG Pipeline Progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {steps.map((step, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                  step.status === 'done' ? 'bg-green-500/20 text-green-400' :
                  step.status === 'running' ? 'bg-primary/20 text-primary animate-pulse' :
                  step.status === 'error' ? 'bg-red-500/20 text-red-400' :
                  'bg-muted text-muted-foreground'
                }`}>
                  {step.status === 'done' ? '✓' : step.status === 'error' ? '✗' : step.status === 'running' ? '⟳' : i + 1}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium">{step.label}</div>
                  {step.detail && <div className="text-xs text-muted-foreground">{step.detail}</div>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Screening Result */}
      {result?.screening && (
        <Card className={`border-2 ${result.status === 'passed' ? 'border-green-500/30' : 'border-red-500/30'}`}>
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <span className={`text-3xl ${result.status === 'passed' ? 'text-green-400' : 'text-red-400'}`}>
                {result.status === 'passed' ? '✅' : '❌'}
              </span>
              Pre-Screening: {result.status?.toUpperCase()}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">Match Score:</span>
              <Progress value={result.screening.match_score} className="flex-1" />
              <span className="font-bold text-lg">{result.screening.match_score}%</span>
            </div>

            <p className="text-sm text-foreground/80">{result.screening.reasoning}</p>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="text-xs font-semibold text-green-400 uppercase mb-2">Matching Skills</h4>
                <div className="flex flex-wrap gap-1">{(result.screening.matching_skills || []).map((s: string, i: number) => (
                  <span key={i} className="bg-green-500/10 text-green-400 text-xs px-2 py-0.5 rounded-full border border-green-500/20">{s}</span>
                ))}</div>
              </div>
              <div>
                <h4 className="text-xs font-semibold text-red-400 uppercase mb-2">Missing Skills</h4>
                <div className="flex flex-wrap gap-1">{(result.screening.missing_skills || []).map((s: string, i: number) => (
                  <span key={i} className="bg-red-500/10 text-red-400 text-xs px-2 py-0.5 rounded-full border border-red-500/20">{s}</span>
                ))}</div>
              </div>
            </div>

            {result.screening.recommended_questions?.length > 0 && (
              <div className="mt-4">
                <h4 className="text-xs font-semibold text-primary uppercase mb-2">AI-Generated Interview Questions</h4>
                <ol className="list-decimal pl-5 text-sm space-y-1 text-foreground/80">
                  {result.screening.recommended_questions.map((q: string, i: number) => <li key={i}>{q}</li>)}
                </ol>
              </div>
            )}

            <Button onClick={onUploaded} variant="outline" className="mt-4">← Back to Pipeline</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }
