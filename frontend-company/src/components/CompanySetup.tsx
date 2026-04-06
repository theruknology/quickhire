import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';

const API = 'http://localhost:8000';

export function CompanySetup({ onCreated }: { onCreated: (id: string, name: string) => void }) {
  const [name, setName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [jobDesc, setJobDesc] = useState('');
  const [requirements, setRequirements] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !jobTitle.trim() || !jobDesc.trim()) return;

    setLoading(true);
    try {
      const form = new FormData();
      form.append('name', name);
      form.append('job_title', jobTitle);
      form.append('job_description', jobDesc);
      form.append('requirements', requirements);

      const res = await fetch(`${API}/api/company`, { method: 'POST', body: form });
      const data = await res.json();
      onCreated(data.company_id, name);
    } catch (err) {
      console.error('Failed to create company:', err);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl border-primary/20 shadow-2xl">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="w-4 h-4 bg-primary rounded-full animate-pulse shadow-[0_0_15px_hsl(var(--primary))]"></div>
          </div>
          <CardTitle className="text-3xl font-bold tracking-tight">QuickHire</CardTitle>
          <p className="text-muted-foreground mt-2">Set up your hiring pipeline in 30 seconds.</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium mb-1.5 text-foreground/80">Company Name</label>
              <input
                value={name} onChange={e => setName(e.target.value)}
                placeholder="ACME Corp"
                className="w-full bg-muted border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-primary transition-colors"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5 text-foreground/80">Job Title</label>
              <input
                value={jobTitle} onChange={e => setJobTitle(e.target.value)}
                placeholder="Senior Full-Stack Engineer"
                className="w-full bg-muted border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-primary transition-colors"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5 text-foreground/80">Job Description</label>
              <textarea
                value={jobDesc} onChange={e => setJobDesc(e.target.value)}
                placeholder="We're looking for an engineer with 3+ years experience in React, Python, and cloud infrastructure..."
                rows={5}
                className="w-full bg-muted border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-primary transition-colors resize-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5 text-foreground/80">Key Requirements (comma-separated)</label>
              <input
                value={requirements} onChange={e => setRequirements(e.target.value)}
                placeholder="React, Python, AWS, System Design"
                className="w-full bg-muted border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-primary transition-colors"
              />
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="w-full h-12 text-base font-semibold bg-gradient-to-r from-primary to-blue-600 shadow-lg shadow-primary/20 transition-all hover:scale-[1.01]"
            >
              {loading ? 'Creating Pipeline...' : 'Launch Hiring Pipeline →'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
