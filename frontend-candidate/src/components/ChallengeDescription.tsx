import React, { useState } from 'react';

export function ChallengeDescription({
  question,
  onSelectAnswer,
}: {
  question?: any;
  /** Notifies parent when candidate picks MCQ option (letter A–D). */
  onSelectAnswer?: (letter: string) => void;
}) {
  const [selectedMcqAnswer, setSelectedMcqAnswer] = useState<string | null>(null);

  if (!question) {
    return (
      <div className="flex flex-col h-full bg-zinc-950 border-r border-zinc-800 text-sm">
        <div className="flex border-b border-zinc-800">
          <div className="px-4 py-2 border-b-2 border-primary text-primary font-medium tracking-wide">Problem</div>
        </div>
        <div className="flex-1 overflow-y-auto p-6 text-zinc-300 flex items-center justify-center">
          <p>Loading question...</p>
        </div>
      </div>
    );
  }

  const qType = question.type ?? question.question_type;
  const qText = question.text ?? question.question_text;
  const isMcq = qType === 'mcq';

  return (
    <div className="flex flex-col h-full bg-zinc-950 border-r border-zinc-800 text-sm">
      {/* Tabs */}
      <div className="flex border-b border-zinc-800">
        <div className="px-4 py-2 border-b-2 border-primary text-primary font-medium tracking-wide">
          {isMcq ? 'Multiple Choice' : 'Coding Problem'}
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-6 text-zinc-300 leading-relaxed font-sans">
        <h2 className="text-xl font-bold mb-4 text-white">
          {qType === 'mcq' ? 'Question' : (qText?.split('\n')[0] || 'Coding challenge')}
        </h2>
        <div className="flex gap-2 mb-6">
          <span className={`px-2 py-0.5 rounded text-xs ${
            question.difficulty === 'easy' ? 'bg-green-500/20 text-green-500' :
            question.difficulty === 'medium' ? 'bg-yellow-500/20 text-yellow-500' :
            'bg-red-500/20 text-red-500'
          }`}>
            {question.difficulty?.charAt(0).toUpperCase() + question.difficulty?.slice(1) || 'Medium'}
          </span>
          <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 text-xs">
            {qType === 'mcq' ? 'MCQ' : 'Coding'}
          </span>
        </div>

        {isMcq ? (
          <div>
            <p className="mb-6 text-white">{qText}</p>
            
            <div className="space-y-3">
              {question.options?.map((option: string, idx: number) => {
                const optionLetter = String.fromCharCode(65 + idx); // A, B, C, D
                const isSelected = selectedMcqAnswer === optionLetter;
                
                return (
                  <button
                    key={idx}
                    onClick={() => {
                      setSelectedMcqAnswer(optionLetter);
                      onSelectAnswer?.(optionLetter);
                    }}
                    className={`w-full p-3 rounded-lg border-2 text-left transition-all ${
                      isSelected
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-zinc-700 bg-zinc-900 hover:border-primary/50'
                    }`}
                  >
                    <div className="font-medium">{optionLetter}. {option}</div>
                  </button>
                );
              })}
            </div>
            
            {question.explanation && selectedMcqAnswer && (
              <div className="mt-6 p-4 bg-zinc-900 border border-zinc-700 rounded-lg">
                <p className="text-xs text-zinc-400 mb-2">Explanation:</p>
                <p className="text-sm">{question.explanation}</p>
              </div>
            )}
          </div>
        ) : (
          <div>
            <p className="mb-6 text-white whitespace-pre-wrap">{qText}</p>
            
            {question.constraints && (
              <div className="mb-6">
                <h3 className="font-semibold text-white mb-2">Constraints:</h3>
                <p className="text-sm">{question.constraints}</p>
              </div>
            )}
            
            {question.test_cases && question.test_cases.length > 0 && (
              <div className="mb-6">
                <h3 className="font-semibold text-white mb-2">Examples:</h3>
                <div className="space-y-2">
                  {question.test_cases.map((tc: any, idx: number) => (
                    <pre key={idx} className="bg-zinc-900 p-3 rounded-md border border-zinc-800 font-mono text-xs overflow-x-auto">
                      <strong>Input:</strong> {JSON.stringify(tc.input)}{'\n'}
                      <strong>Output:</strong> {JSON.stringify(tc.output)}
                    </pre>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
