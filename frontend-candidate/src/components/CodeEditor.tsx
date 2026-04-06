import React, { useRef, useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';

const DEFAULT_PY = "def solve(x: int) -> int:\n    # Write your solution here\n    pass";

export function CodeEditor({
  onTelemetryUpdate,
  onCodeChange,
  telemetrySnapshot,
  initialCode,
}: {
  onTelemetryUpdate: (data: any) => void;
  onCodeChange?: (code: string) => void;
  telemetrySnapshot?: Record<string, unknown>;
  /** When set (e.g. from coding question starter_code), seeds the editor. */
  initialCode?: string;
}) {
  const mountTime = useRef(Date.now());
  const ksCount = useRef(0);
  const deleteCount = useRef(0);
  const [code, setCode] = useState(() => initialCode?.trim() ? initialCode : DEFAULT_PY);
  const editorRef = useRef<any>(null);

  useEffect(() => {
    if (initialCode && initialCode.trim()) {
      setCode(initialCode);
      onCodeChange?.(initialCode);
      mountTime.current = Date.now();
      ksCount.current = 0;
      deleteCount.current = 0;
    }
  }, [initialCode, onCodeChange]);

  const handleEditorChange = (value: string | undefined, event: any) => {
    if (!value) return;
    setCode(value);
    onCodeChange?.(value);
    
    ksCount.current++;
    if (event.changes.some((c: any) => c.text === '')) {
      deleteCount.current++;
    }
  };

  useEffect(() => {
    const interval = setInterval(() => {
      onTelemetryUpdate({
        wpm: (ksCount.current / 5) / ((Date.now() - mountTime.current) / 60000),
        delete_ratio: ksCount.current > 0 ? deleteCount.current / ksCount.current : 0,
        keystrokes: ksCount.current
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [onTelemetryUpdate]);

  const runTests = async () => {
    console.log("Running tests with code:", code);
    // Would integrate with backend execution
  };

  const submitSolution = async () => {
    console.log("Submitting solution:", code);
    // Would integrate with backend for evaluation
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#1e1e1e]">
      <div className="flex items-center px-4 py-2 border-b border-zinc-800 bg-zinc-950 text-xs font-mono text-zinc-400 justify-between flex-wrap gap-y-2">
        <div className="flex items-center gap-2">
          <span>solution.py</span>
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse ml-2" title="Language Server Connected"></span>
        </div>
        {telemetrySnapshot && Object.keys(telemetrySnapshot).length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-zinc-500 max-w-[min(100%,42rem)]">
            <span title="Keystrokes in editor">ks: {String(telemetrySnapshot.keystrokes ?? '—')}</span>
            <span title="Deletes / keystrokes">del%: {typeof telemetrySnapshot.delete_ratio === 'number' ? `${(telemetrySnapshot.delete_ratio * 100).toFixed(0)}%` : '—'}</span>
            <span title="Approx typing rate">wpm: {typeof telemetrySnapshot.wpm === 'number' ? telemetrySnapshot.wpm.toFixed(0) : '—'}</span>
            <span title="Copy/paste events">cp: {String(telemetrySnapshot.copy_paste_count ?? '—')}</span>
            <span title="Focus / blur events">focus: {String(telemetrySnapshot.focus_loss_count ?? '—')}</span>
          </div>
        )}
        <div className="flex gap-2">
           <button 
             onClick={runTests}
             className="bg-zinc-800 hover:bg-zinc-700 px-3 py-1 rounded transition-colors text-white"
           >
             Run Tests
           </button>
           <button 
             onClick={submitSolution}
             className="bg-primary hover:bg-primary/90 text-primary-foreground px-3 py-1 rounded transition-colors font-medium shadow-lg shadow-primary/20"
           >
             Submit
           </button>
        </div>
      </div>
      <Editor
        ref={editorRef}
        height="100%"
        defaultLanguage="python"
        theme="vs-dark"
        value={code}
        onChange={handleEditorChange}
        options={{
          minimap: { enabled: true },
          fontSize: 14,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          padding: { top: 16 },
          scrollBeyondLastLine: false,
        }}
      />
    </div>
  );
}
