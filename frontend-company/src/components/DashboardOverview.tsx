import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const data = [
  { name: 'Mon', applicants: 40 },
  { name: 'Tue', applicants: 30 },
  { name: 'Wed', applicants: 50 },
  { name: 'Thu', applicants: 20 },
  { name: 'Fri', applicants: 60 },
  { name: 'Sat', applicants: 90 },
  { name: 'Sun', applicants: 100 },
];

export function DashboardOverview({ stats }: { stats: any }) {
  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mt-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Candidates Screened</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats?.candidates_screened || 0}</div>
          <p className="text-xs text-muted-foreground">+20.1% from last month</p>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">AI Pass Rate</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats?.ai_pass_rate ? (stats.ai_pass_rate * 100).toFixed(1) : 0}%</div>
          <p className="text-xs text-muted-foreground">+4% from last week</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Avg. Time-to-Code</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats?.avg_time_to_code || 0}m</div>
          <p className="text-xs text-muted-foreground">Faster than industry avg (45m)</p>
        </CardContent>
      </Card>

      <Card className="col-span-1 md:col-span-2 lg:col-span-4 h-96">
        <CardHeader>
          <CardTitle>Inbound Talent Volume</CardTitle>
        </CardHeader>
        <CardContent className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorApplicants" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.8}/>
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}`} />
              <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
              <Area type="monotone" dataKey="applicants" stroke="hsl(var(--primary))" fillOpacity={1} fill="url(#colorApplicants)" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
