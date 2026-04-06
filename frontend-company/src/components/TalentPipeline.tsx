import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Progress } from './ui/progress';

export function TalentPipeline({ candidates, onSelectCandidate }: { candidates: any[], onSelectCandidate: (c: any) => void }) {
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Talent Pipeline (RAG Matches)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <div className="grid grid-cols-4 gap-4 p-4 font-semibold border-b text-sm text-muted-foreground">
            <div>Candidate Name</div>
            <div>Match Score</div>
            <div>Core Competencies</div>
            <div>Status</div>
          </div>
          {candidates.map((candidate) => (
            <div 
              key={candidate.id} 
              className="grid grid-cols-4 gap-4 p-4 border-b last:border-0 items-center cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => onSelectCandidate(candidate)}
            >
              <div className="font-medium text-primary">{candidate.name}</div>
              <div className="flex items-center space-x-2">
                <Progress value={candidate.score} className="w-[60%]" />
                <span className="text-xs text-muted-foreground">{candidate.score}%</span>
              </div>
              <div className="text-sm flex gap-1 flex-wrap">
                {candidate.core_competencies.map((comp: string, i: number) => (
                  <span key={i} className="bg-primary/20 text-primary-foreground text-[10px] px-2 py-0.5 rounded-full border border-primary/30">
                    {comp}
                  </span>
                ))}
              </div>
              <div>
                <span className={`text-xs px-2 py-1 rounded-full ${candidate.status === 'Passed AI' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-500'}`}>
                  {candidate.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
