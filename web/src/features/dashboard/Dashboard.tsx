import { useQuery } from '@tanstack/react-query'
import { Activity, Server, Zap } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { api } from '@/api/client'

export default function Dashboard() {
  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['status'],
    queryFn: () => api.getStatus(),
    refetchInterval: 5000,
  })

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.getStats(),
    refetchInterval: 10000,
  })

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Dashboard</h2>
        <p className="text-xs text-muted-foreground">
          Monitor your CCRelay server status and performance
        </p>
      </div>

      {/* Status Cards - Compact grid */}
      <div className="grid gap-2 grid-cols-1 sm:grid-cols-3">
        <Card className="p-0">
          <CardHeader className="flex flex-row items-center justify-between p-3 pb-1">
            <CardTitle className="text-xs font-medium">Server Status</CardTitle>
            <Server className="h-3.5 w-3.5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-3 pt-0">
            {statusLoading ? (
              <div className="h-6 animate-pulse bg-muted rounded" />
            ) : (
              <>
                <div className="text-lg font-bold">
                  {status?.status === 'running' ? 'Running' : 'Stopped'}
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <Badge variant={status?.status === 'running' ? 'success' : 'destructive'} className="text-[10px] px-1.5 py-0">
                    {status?.port || 'N/A'}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {status?.host || 'N/A'}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="p-0">
          <CardHeader className="flex flex-row items-center justify-between p-3 pb-1">
            <CardTitle className="text-xs font-medium">Current Provider</CardTitle>
            <Activity className="h-3.5 w-3.5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-3 pt-0">
            {statusLoading ? (
              <div className="h-6 animate-pulse bg-muted rounded" />
            ) : (
              <>
                <div className="text-lg font-bold truncate">
                  {status?.providerName || 'None'}
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    {status?.providerMode || 'N/A'}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground truncate">
                    {status?.currentProvider || 'N/A'}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="p-0">
          <CardHeader className="flex flex-row items-center justify-between p-3 pb-1">
            <CardTitle className="text-xs font-medium">Total Requests</CardTitle>
            <Zap className="h-3.5 w-3.5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-3 pt-0">
            {statsLoading ? (
              <div className="h-6 animate-pulse bg-muted rounded" />
            ) : (
              <>
                <div className="text-lg font-bold">
                  {stats?.totalLogs || 0}
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[10px] text-green-500">
                    {stats?.successCount || 0} success
                  </span>
                  <span className="text-[10px] text-red-500">
                    {stats?.errorCount || 0} errors
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Performance Stats - Compact */}
      <Card className="p-0">
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs font-medium">Performance</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          {statsLoading ? (
            <div className="h-12 animate-pulse bg-muted rounded" />
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Average Response Time</span>
                <span className="text-xs font-medium">
                  {stats?.avgDuration || 0}ms
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Success Rate</span>
                <span className="text-xs font-medium">
                  {stats?.totalLogs
                    ? `${Math.round((stats.successCount / stats.totalLogs) * 100)}%`
                    : 'N/A'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Providers Used</span>
                <span className="text-xs font-medium">
                  {Object.keys(stats?.byProvider || {}).length}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
