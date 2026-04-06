import React, { useState, useEffect, useRef } from 'react';
import { Send, Terminal, Settings } from 'lucide-react';

export function AiAssistant({ ws, editorCode }: { ws: WebSocket | null, editorCode?: string }) {
  const [messages, setMessages] = useState<{role: string, text: string}[]>([]);
  const [input, setInput] = useState('');
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [apiKey, setApiKey] = useState(localStorage.getItem('qh_ai_api_key') || '');
  const [llmProvider, setLlmProvider] = useState(localStorage.getItem('qh_ai_provider') || 'groq');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!ws) return;
    
    const handleMsg = (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      if (data.type === 'chat_response') {
        setMessages(prev => [...prev, { role: 'ai', text: data.message }]);
      }
    };
    
    ws.addEventListener('message', handleMsg);
    return () => ws.removeEventListener('message', handleMsg);
  }, [ws]);

  const saveApiKey = () => {
    if (apiKey.trim()) {
      localStorage.setItem('qh_ai_api_key', apiKey);
      localStorage.setItem('qh_ai_provider', llmProvider);
      setShowApiKeyModal(false);
    }
  };

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !ws || ws.readyState !== WebSocket.OPEN) return;

    setMessages(prev => [...prev, { role: 'user', text: input }]);

    ws.send(
      JSON.stringify({
        type: 'chat',
        message: input.trim(),
        editor_code: editorCode ?? '',
        api_key: apiKey || undefined,
        provider: llmProvider,
      })
    );
    setInput('');
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 border-l border-zinc-800 w-80">
      <div className="flex items-center gap-2 p-4 border-b border-zinc-800 bg-zinc-900/50 justify-between">
        <div className="flex items-center gap-2">
          <Terminal size={16} className="text-primary" />
          <h3 className="font-semibold text-sm tracking-wide">Interview Assistant</h3>
        </div>
        <button
          onClick={() => setShowApiKeyModal(true)}
          className="p-1 hover:bg-zinc-800 rounded transition-colors"
          title="Configure AI provider"
        >
          <Settings size={14} className="text-zinc-400 hover:text-primary" />
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="text-xs text-center text-zinc-600 my-2 px-1">
          {apiKey
            ? `Using ${llmProvider} with your API key`
            : 'Hints via Groq (server) — answers and full solutions are blocked; you get guidance only.'}
        </div>
        
        {messages.map((msg, i) => (
          <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div className={`px-3 py-2 rounded-lg text-sm max-w-[90%] ${
              msg.role === 'user' 
                ? 'bg-primary text-primary-foreground rounded-br-none' 
                : 'bg-zinc-800 text-zinc-200 rounded-bl-none border border-zinc-700 font-sans shadow-lg'
            }`}>
              {msg.text}
            </div>
            <div className="text-[10px] text-zinc-600 mt-1 uppercase tracking-wider">{msg.role === 'ai' ? 'Assistant' : 'You'}</div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 bg-zinc-900/80 border-t border-zinc-800">
         <form onSubmit={sendMessage} className="relative">
           <input 
             type="text" 
             value={input}
             onChange={e => setInput(e.target.value)}
             placeholder="Ask anything — you'll get hints tied to your editor..."
             className="w-full bg-zinc-950 border border-zinc-700 rounded-md py-2 px-3 pr-10 text-sm outline-none focus:border-primary transition-colors placeholder:text-zinc-600"
             disabled={!ws || ws.readyState !== WebSocket.OPEN}
           />
           <button 
             type="submit" 
             disabled={!input.trim() || !ws || ws.readyState !== WebSocket.OPEN}
             className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-primary transition-colors disabled:opacity-50"
           >
             <Send size={16} />
           </button>
         </form>
      </div>

      {showApiKeyModal && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50 rounded-lg">
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-6 max-w-sm mx-4">
            <h3 className="text-lg font-bold mb-4">Configure AI Assistant</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-2 text-zinc-300">
                  AI Provider
                </label>
                <select
                  value={llmProvider}
                  onChange={(e) => setLlmProvider(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm outline-none focus:border-primary"
                >
                  <option value="groq">Groq (Default)</option>
                  <option value="openai">OpenAI</option>
                  <option value="custom">Custom</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium mb-2 text-zinc-300">
                  API Key
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={`Enter your ${llmProvider} API key (optional)`}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>

              <p className="text-xs text-zinc-400 mt-3">
                💡 Hints will be wrapped in guidance prompts to help you think through problems rather than giving direct answers.
              </p>
            </div>

            <div className="flex gap-2 mt-6">
              <button
                onClick={() => setShowApiKeyModal(false)}
                className="flex-1 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={saveApiKey}
                className="flex-1 px-3 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded transition-colors text-sm font-medium"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
