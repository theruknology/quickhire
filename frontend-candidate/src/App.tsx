import React, { useState, useEffect, useRef } from 'react';
import { ChallengeDescription } from './components/ChallengeDescription';
import { CodeEditor } from './components/CodeEditor';
import { AiAssistant } from './components/AiAssistant';
import { ChevronDown, Upload } from 'lucide-react';

const API = 'http://localhost:8000';

function App() {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [sessionId] = useState(`sess_${Math.random().toString(36).substr(2, 9)}`);
  const [connected, setConnected] = useState(false);
  const telemetryData = useRef<any>({});
  
  // Company selection and interview state
  const [view, setView] = useState<'company-select' | 'cv-upload' | 'interview' | 'results'>('company-select');
  const [companies, setCompanies] = useState<any[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<any>(null);
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [interviewSession, setInterviewSession] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [currentRound, setCurrentRound] = useState(1);
  const [editorCode, setEditorCode] = useState('');
  const [candidateName, setCandidateName] = useState(localStorage.getItem('qh_candidate_name') || '');
  const [candidateId] = useState(localStorage.getItem('qh_candidate_id') || `cand_${Math.random().toString(36).substr(2, 9)}`);
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [uploadingCv, setUploadingCv] = useState(false);
  const [interviewReport, setInterviewReport] = useState<any>(null);
  const [completingInterview, setCompletingInterview] = useState(false);

  // Telemetry tracking
  const copyPasteCount = useRef(0);
  const tabSwitchCount = useRef(0);
  const focusLossCount = useRef(0);
  const interviewSessionRef = useRef<any>(null);
  const telemetryPostTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [telemetrySnapshot, setTelemetrySnapshot] = useState<Record<string, unknown>>({});

  useEffect(() => {
    interviewSessionRef.current = interviewSession;
  }, [interviewSession]);

  // Load companies on mount
  useEffect(() => {
    const fetchCompanies = async () => {
      try {
        const res = await fetch(`${API}/api/companies`);
        const data = await res.json();
        setCompanies(data.companies || []);
      } catch (e) {
        console.error('Failed to load companies:', e);
      }
    };
    fetchCompanies();
  }, []);

  // WebSocket connection
  useEffect(() => {
    class MockWebSocket extends EventTarget {
      readyState = 1;
      OPEN = 1;
      send(data: string) {
        const parsed = JSON.parse(data);
        if (parsed.type === 'chat') {
           setTimeout(() => {
              this.dispatchEvent(new MessageEvent('message', {
                data: JSON.stringify({ type: 'chat_response', message: "Think about the edge cases. What happens with boundary conditions? Try working through an example first." })
              }));
           }, 1500);
        }
      }
      close() {}
    }

    const socket = new MockWebSocket() as unknown as WebSocket;
    
    setWs(socket);
    setConnected(true);

    return () => {
      socket.close();
    };
  }, [sessionId]);

  // Telemetry hooks
  useEffect(() => {
    // Track copy-paste
    const handleCopy = () => copyPasteCount.current++;
    const handlePaste = () => copyPasteCount.current++;
    
    window.addEventListener('copy', handleCopy);
    window.addEventListener('paste', handlePaste);

    // Track tab/window changes
    const handleVisibilityChange = () => {
      if (document.hidden) {
        focusLossCount.current++;
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Track window blur
    const handleBlur = () => {
      focusLossCount.current++;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'telemetry',
          data: { 
            event: 'blur', 
            timestamp: Date.now(),
            copy_paste_count: copyPasteCount.current,
            focus_loss_count: focusLossCount.current,
            tab_switch_count: tabSwitchCount.current
          }
        }));
      }
    };
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('copy', handleCopy);
      window.removeEventListener('paste', handlePaste);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [ws]);

  const handleTelemetryUpdate = (data: any) => {
    telemetryData.current = { 
      ...telemetryData.current, 
      ...data,
      copy_paste_count: copyPasteCount.current,
      focus_loss_count: focusLossCount.current,
      tab_switch_count: tabSwitchCount.current
    };
    setTelemetrySnapshot({ ...telemetryData.current });
    const sid = interviewSessionRef.current?.session_id;
    if (sid) {
      if (telemetryPostTimerRef.current) clearTimeout(telemetryPostTimerRef.current);
      telemetryPostTimerRef.current = setTimeout(() => {
        fetch(`${API}/api/interview/session/${sid}/telemetry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(telemetryData.current),
        }).catch(() => {});
      }, 1200);
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
         type: 'telemetry',
         data: telemetryData.current
      }));
    }
  };

  const uploadCvAndStart = async () => {
    if (!cvFile || !interviewSession) return;

    setUploadingCv(true);
    try {
      const formData = new FormData();
      formData.append('file', cvFile);
      formData.append('candidate_name', candidateName);

      const res = await fetch(`${API}/api/interview/session/${interviewSession.session_id}/upload-cv`, {
        method: 'POST',
        body: formData
      });

      if (!res.ok) throw new Error('CV upload failed');
      
      // Fetch questions and start interview
      const qRes = await fetch(`${API}/api/interview/questions/${selectedCompany.id}`);
      const qData = await qRes.json();
      setQuestions(qData.questions || []);
      
      setView('interview');
    } catch (e) {
      console.error('Failed to upload CV:', e);
      alert('CV upload failed. Continue without CV?');
      
      // Still fetch questions and start
      const qRes = await fetch(`${API}/api/interview/questions/${selectedCompany.id}`);
      const qData = await qRes.json();
      setQuestions(qData.questions || []);
      setView('interview');
    }
    setUploadingCv(false);
  };

  const skipCvAndStart = async () => {
    if (!interviewSession || !selectedCompany) return;
    setUploadingCv(true);
    try {
      const qRes = await fetch(`${API}/api/interview/questions/${selectedCompany.id}`);
      const qData = await qRes.json();
      setQuestions(qData.questions || []);
      setView('interview');
    } catch (e) {
      console.error('skipCvAndStart failed:', e);
      alert('Could not load interview questions. Check that the backend is running.');
    }
    setUploadingCv(false);
  };

  const startInterview = async () => {
    if (!selectedCompany || !candidateName) return;

    try {
      // Save candidate name
      localStorage.setItem('qh_candidate_name', candidateName);
      localStorage.setItem('qh_candidate_id', candidateId);

      // Create interview session
      const res = await fetch(`${API}/api/interview/session/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidate_id: candidateId,
          company_id: selectedCompany.id,
          candidate_name: candidateName,
        })
      });
      
      if (!res.ok) {
        throw new Error(`Failed to start interview: ${res.statusText}`);
      }

      const session = await res.json();
      setInterviewSession(session);
      setView('cv-upload');
      setShowVerificationModal(false);
    } catch (e) {
      console.error('Failed to start interview:', e);
      alert('Failed to start interview. Please try again.');
    }
  };

  if (view === 'company-select') {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <div className="w-4 h-4 bg-primary rounded-full animate-pulse shadow-[0_0_15px_hsl(var(--primary))] mx-auto mb-4"></div>
            <h1 className="text-3xl font-bold tracking-tight mb-2">QuickHire Interview</h1>
            <p className="text-muted-foreground">Select a company and begin your assessment</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Your Name</label>
              <input
                value={candidateName}
                onChange={(e) => setCandidateName(e.target.value)}
                placeholder="Enter your name"
                className="w-full bg-muted border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-primary transition-colors"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Select Company</label>
              <button
                onClick={() => setShowVerificationModal(true)}
                className="w-full bg-muted border border-border rounded-lg px-4 py-2.5 text-sm text-left outline-none focus:border-primary transition-colors flex items-center justify-between hover:border-primary/50"
              >
                <span>{selectedCompany?.name || 'Choose a company...'}</span>
                <ChevronDown size={16} className="text-muted-foreground" />
              </button>
              
              {companies.length > 0 && (
                <div className="mt-2 bg-muted border border-border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                  {companies.map((company) => (
                    <button
                      key={company.id}
                      onClick={() => setSelectedCompany(company)}
                      className={`w-full px-4 py-2 text-left text-sm hover:bg-muted/80 border-b border-border last:border-b-0 transition-colors ${
                        selectedCompany?.id === company.id ? 'bg-primary/10 text-primary' : ''
                      }`}
                    >
                      <div className="font-medium">{company.name}</div>
                      <div className="text-xs text-muted-foreground">{company.job_title}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() => setShowVerificationModal(true)}
              disabled={!selectedCompany || !candidateName}
              className="w-full h-10 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Start Interview
            </button>
          </div>
        </div>

        {showVerificationModal && selectedCompany && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-card border border-border rounded-lg p-6 max-w-sm mx-4">
              <h3 className="text-lg font-bold mb-4">Confirm Interview Start</h3>
              
              <div className="space-y-3 mb-6">
                <div>
                  <p className="text-xs text-muted-foreground">Candidate</p>
                  <p className="font-medium">{candidateName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Company</p>
                  <p className="font-medium">{selectedCompany.name}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Position</p>
                  <p className="font-medium">{selectedCompany.job_title}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Interview Round</p>
                  <p className="font-medium">Technical Assessment (3 MCQs + 1 Coding)</p>
                </div>
              </div>

              <p className="text-sm text-muted-foreground mb-6">
                You'll be asked to upload your CV, then complete 3 multiple-choice questions followed by a coding problem. Behavioral data and code submissions will be monitored.
              </p>

              <div className="flex gap-2">
                <button
                  onClick={() => setShowVerificationModal(false)}
                  className="flex-1 px-4 py-2 bg-muted hover:bg-muted/80 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={startInterview}
                  className="flex-1 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors font-medium"
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (view === 'cv-upload') {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <div className="w-4 h-4 bg-primary rounded-full animate-pulse shadow-[0_0_15px_hsl(var(--primary))] mx-auto mb-4"></div>
            <h1 className="text-2xl font-bold tracking-tight mb-2">Upload Your CV</h1>
            <p className="text-muted-foreground">This will be used for the assessment report</p>
          </div>

          <div className="space-y-4">
            <div className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer group">
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept=".pdf"
                  onChange={(e) => setCvFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
                <div className="flex flex-col items-center gap-2">
                  <Upload size={32} className="text-muted-foreground group-hover:text-primary transition-colors" />
                  <div>
                    <p className="font-medium">
                      {cvFile ? cvFile.name : 'Click to upload PDF'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">PDF format only</p>
                  </div>
                </div>
              </label>
            </div>

            <button
              onClick={uploadCvAndStart}
              disabled={!cvFile || uploadingCv}
              className="w-full h-10 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploadingCv ? 'Uploading...' : 'Continue to Interview'}
            </button>

            <button
              type="button"
              onClick={skipCvAndStart}
              disabled={uploadingCv}
              className="w-full h-10 bg-muted hover:bg-muted/80 rounded-lg font-medium transition-colors text-sm disabled:opacity-50"
            >
              Skip CV Upload
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'interview' && questions.length > 0) {
    const currentQuestion = questions[currentRound - 1];
    const isCoding = (currentQuestion?.type ?? currentQuestion?.question_type) === 'coding';

    return (
      <InterviewView
        currentQuestion={currentQuestion}
        isCoding={isCoding}
        selectedCompany={selectedCompany}
        currentRound={currentRound}
        connected={connected}
        sessionId={sessionId}
        ws={ws}
        editorCode={editorCode}
        setEditorCode={setEditorCode}
        handleTelemetryUpdate={handleTelemetryUpdate}
        telemetrySnapshot={telemetrySnapshot}
        setCurrentRound={setCurrentRound}
        setView={setView}
        questions={questions}
        interviewSession={interviewSession}
        setInterviewReport={setInterviewReport}
        completingInterview={completingInterview}
        setCompletingInterview={setCompletingInterview}
      />
    );
  }

  if (view === 'results' && interviewReport) {
    const b = interviewReport.behavioral_data || {};
    return (
      <div className="min-h-screen bg-background text-foreground p-6 overflow-y-auto">
        <div className="max-w-2xl mx-auto space-y-6">
          <h2 className="text-2xl font-bold">Your interview report</h2>
          <div className="rounded-xl border border-border bg-card p-6 space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Overall score</span>
              <span className="text-3xl font-bold text-primary">{Math.round(interviewReport.overall_score ?? 0)}%</span>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">MCQ</p>
                <p className="font-semibold">{Math.round(interviewReport.mcq_score ?? 0)}%</p>
              </div>
              <div>
                <p className="text-muted-foreground">Coding</p>
                <p className="font-semibold">{Math.round(interviewReport.code_score ?? 0)}%</p>
              </div>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Summary</p>
              <p className="text-sm">{interviewReport.feedback}</p>
            </div>
            {interviewReport.recommendations && (
              <div>
                <p className="text-sm text-muted-foreground mb-1">Recommendation</p>
                <p className="text-sm">{interviewReport.recommendations}</p>
              </div>
            )}
            <div className="border-t border-border pt-4">
              <p className="text-sm font-medium mb-2">Behavioral signals</p>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <span>Keystrokes: {b.keystrokes ?? '—'}</span>
                <span>WPM: {typeof b.wpm === 'number' ? b.wpm.toFixed(0) : '—'}</span>
                <span>Delete ratio: {typeof b.delete_ratio === 'number' ? `${(b.delete_ratio * 100).toFixed(0)}%` : '—'}</span>
                <span>Focus events: {b.focus_loss_count ?? '—'}</span>
                <span>Copy/paste: {b.copy_paste_count ?? '—'}</span>
                <span>Tab switches: {b.tab_switches ?? '—'}</span>
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              setView('company-select');
              setSelectedCompany(null);
              setCurrentRound(1);
              setQuestions([]);
              setEditorCode('');
              setCvFile(null);
              setInterviewReport(null);
              setInterviewSession(null);
              copyPasteCount.current = 0;
              tabSwitchCount.current = 0;
              focusLossCount.current = 0;
            }}
            className="w-full py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium transition-colors"
          >
            Start New Interview
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-4">Interview Completed!</h2>
        <p className="text-muted-foreground mb-8">Your responses have been recorded along with your CV and behavioral data. The hiring team will review your submission shortly.</p>
        <button
          onClick={() => {
            setView('company-select');
            setSelectedCompany(null);
            setCurrentRound(1);
            setQuestions([]);
            setEditorCode('');
            setCvFile(null);
            setInterviewReport(null);
            setInterviewSession(null);
            copyPasteCount.current = 0;
            tabSwitchCount.current = 0;
            focusLossCount.current = 0;
          }}
          className="px-6 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium transition-colors"
        >
          Start New Interview
        </button>
      </div>
    </div>
  );
}

function InterviewView({
  currentQuestion,
  isCoding,
  selectedCompany,
  currentRound,
  connected,
  sessionId,
  ws,
  editorCode,
  setEditorCode,
  handleTelemetryUpdate,
  telemetrySnapshot,
  setCurrentRound,
  setView,
  questions,
  interviewSession,
  setInterviewReport,
  completingInterview,
  setCompletingInterview,
}: {
  currentQuestion: any;
  isCoding: boolean;
  selectedCompany: any;
  currentRound: number;
  connected: boolean;
  sessionId: string;
  ws: WebSocket | null;
  editorCode: string;
  setEditorCode: (v: string) => void;
  handleTelemetryUpdate: (data: any) => void;
  telemetrySnapshot: Record<string, unknown>;
  setCurrentRound: React.Dispatch<React.SetStateAction<number>>;
  setView: React.Dispatch<React.SetStateAction<'company-select' | 'cv-upload' | 'interview' | 'results'>>;
  questions: any[];
  interviewSession: any;
  setInterviewReport: (r: any) => void;
  completingInterview: boolean;
  setCompletingInterview: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const mcqSelections = useRef<Record<string, string>>({});

  const submitMcqForCurrentRound = async () => {
    const sid = interviewSession?.session_id;
    if (!sid) return;
    const q = questions[currentRound - 1];
    const qt = q?.type ?? q?.question_type;
    if (qt !== 'mcq' || !q?.id) return;
    const letter = mcqSelections.current[q.id];
    if (!letter) return;
    await fetch(`${API}/api/interview/session/${sid}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question_id: q.id, selected_answer: letter }),
    });
  };

  const completeInterviewFlow = async () => {
    const sid = interviewSession?.session_id;
    if (!sid || !editorCode.trim()) return;
    setCompletingInterview(true);
    try {
      await fetch(`${API}/api/interview/session/${sid}/submit-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: editorCode }),
      });
      const res = await fetch(`${API}/api/interview/session/${sid}/complete`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setInterviewReport(data);
      setView('results');
    } catch (e) {
      console.error(e);
      alert('Could not finalize interview. Please try again.');
    } finally {
      setCompletingInterview(false);
    }
  };

  const handlePrimary = async () => {
    if (currentRound < 4) {
      await submitMcqForCurrentRound();
      setCurrentRound((r) => r + 1);
      return;
    }
    await completeInterviewFlow();
  };

  const starter =
    typeof currentQuestion?.starter_code === 'string' && currentQuestion.starter_code.trim()
      ? currentQuestion.starter_code
      : undefined;

  return (
    <div className="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden">
      <header className="h-10 bg-[#1e1e1e] border-b border-zinc-800 flex items-center px-4 justify-between shrink-0">
        <div className="text-xs font-semibold text-zinc-300 flex items-center gap-2">
          {selectedCompany?.name} Interview <span className="opacity-50">|</span>
          <span className="text-primary tracking-widest font-mono">ROUND {currentRound}/4</span>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          <span className={connected ? 'text-green-400' : 'text-yellow-500'}>
            {connected ? 'CONNECTED' : 'CONNECTING...'}
          </span>
          <span className="text-zinc-500">{sessionId}</span>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden min-h-0">
        <div className="flex-1 flex min-w-0 min-h-0 overflow-hidden">
          {isCoding ? (
            <div className="flex flex-1 flex-row min-h-0 min-w-0">
              <div className="w-[min(42%,26rem)] shrink-0 border-r border-zinc-800 flex flex-col min-h-0 bg-zinc-950">
                <ChallengeDescription question={currentQuestion} />
              </div>
              <div className="flex-1 min-w-0 flex flex-col min-h-0">
                <CodeEditor
                  key={currentQuestion?.id || 'code'}
                  onTelemetryUpdate={handleTelemetryUpdate}
                  onCodeChange={setEditorCode}
                  telemetrySnapshot={telemetrySnapshot}
                  initialCode={starter}
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <ChallengeDescription
                key={currentQuestion?.id}
                question={currentQuestion}
                onSelectAnswer={(letter) => {
                  if (currentQuestion?.id) mcqSelections.current[currentQuestion.id] = letter;
                }}
              />
            </div>
          )}
        </div>

        <AiAssistant ws={ws} editorCode={editorCode} />
      </div>

      <div className="h-12 bg-zinc-950 border-t border-zinc-800 flex items-center px-4 justify-between shrink-0">
        <button
          type="button"
          onClick={() => setCurrentRound((r) => Math.max(1, r - 1))}
          disabled={currentRound === 1}
          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors text-sm"
        >
          Previous
        </button>

        <div className="text-xs text-zinc-400">
          {currentRound === 4 && editorCode
            ? `Code buffer: ${editorCode.length} chars`
            : `Question ${currentRound}/4`}
        </div>

        <button
          type="button"
          onClick={() => void handlePrimary()}
          disabled={(currentRound === 4 && !editorCode.trim()) || completingInterview}
          className="px-4 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors text-sm font-medium"
        >
          {completingInterview ? 'Saving…' : currentRound === 4 ? 'Complete' : 'Next'}
        </button>
      </div>
    </div>
  );
}

export default App;
