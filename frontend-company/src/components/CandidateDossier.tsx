import React from 'react';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Progress } from './ui/progress';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';

export function CandidateDossier({ candidate, onClose }: { candidate: any; onClose: () => void }) {
  if (!candidate) return null;

  const score = candidate.score || 0;
  const matchingSkills = candidate.core_competencies || [];
  const missingSkills = candidate.missing_skills || [];
  const reasoning = candidate.reasoning || 'No AI analysis available yet.';
  const questions = candidate.recommended_questions || [];

  // Build radar data from whatever we have
  const radarData = [
    { subject: 'Match Score', A: score },
    { subject: 'Skills Coverage', A: Math.min(100, matchingSkills.length * 20) },
    { subject: 'Gap Risk', A: Math.max(0, 100 - missingSkills.length * 25) },
    { subject: 'AI Confidence', A: score > 70 ? 85 : 45 },
    { subject: 'Readiness', A: candidate.status === 'Passed' ? 90 : 40 },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <Card className="w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden bg-background shadow-2xl border-primary/20">
        <div className="flex justify-between items-center p-4 border-b shrink-0">
          <h2 className="text-xl font-bold text-foreground">Candidate Dossier: {candidate.name}</h2>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left Side: RAG Context */}
          <div className="w-1/2 p-6 overflow-y-auto border-r border-border bg-muted/20">
            <h3 className="text-lg font-semibold mb-4 text-primary">AI Analysis</h3>

            <div className="flex items-center gap-3 mb-4">
              <span className="text-sm text-muted-foreground">Match:</span>
              <Progress value={score} className="flex-1" />
              <span className="font-bold text-lg">{score}%</span>
            </div>

            <div className={`inline-block px-3 py-1 rounded-full text-sm font-semibold mb-4 ${
              candidate.status === 'Passed' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
            }`}>
              {candidate.status}
            </div>

            <p className="text-sm text-foreground/80 leading-relaxed mb-6">{reasoning}</p>

            <div className="space-y-4">
              <div>
                <h4 className="text-xs font-semibold text-green-400 uppercase mb-2">Matching Skills</h4>
                <div className="flex flex-wrap gap-1.5">{matchingSkills.map((s: string, i: number) => (
                  <span key={i} className="bg-green-500/10 text-green-400 text-xs px-2 py-0.5 rounded-full border border-green-500/20">{s}</span>
                ))}</div>
              </div>
              <div>
                <h4 className="text-xs font-semibold text-red-400 uppercase mb-2">Missing Skills</h4>
                <div className="flex flex-wrap gap-1.5">{missingSkills.map((s: string, i: number) => (
                  <span key={i} className="bg-red-500/10 text-red-400 text-xs px-2 py-0.5 rounded-full border border-red-500/20">{s}</span>
                ))}</div>
              </div>
            </div>

            {questions.length > 0 && (
              <div className="mt-6">
                <h4 className="text-xs font-semibold text-primary uppercase mb-2">Suggested Interview Questions</h4>
                <ol className="list-decimal pl-5 text-sm space-y-1 text-foreground/80">{questions.map((q: string, i: number) => <li key={i}>{q}</li>)}</ol>
              </div>
            )}
          </div>

          {/* Right Side: Radar + CTA */}
          <div className="w-1/2 p-6 flex flex-col bg-background relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>

            <h3 className="text-lg font-semibold mb-2 relative z-10">Telemetry Profile</h3>
            <p className="text-xs text-muted-foreground mb-6 relative z-10">AI-generated candidate competency map</p>

            <div className="flex-1 w-full relative z-10 flex flex-col items-center justify-center">
              <ResponsiveContainer width="100%" height={300}>
                <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
                  <PolarGrid stroke="hsl(var(--border))" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: 'hsl(var(--foreground))', fontSize: 11 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                  <Radar name="Candidate" dataKey="A" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.4} />
                </RadarChart>
              </ResponsiveContainer>

              <div className="mt-8 w-full">
                <Button
                  size="lg"
                  disabled={candidate.status !== 'Passed'}
                  className="w-full h-14 text-lg font-bold bg-gradient-to-r from-primary to-blue-600 shadow-[0_0_20px_rgba(37,99,235,0.4)] transition-all hover:scale-[1.02] disabled:opacity-40"
                >
                  {candidate.status === 'Passed' ? 'Approve for Technical Round — $5,000' : 'Candidate Did Not Pass Screening'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
