import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { api } from '@/api/client'

export default function Providers() {
  const queryClient = useQueryClient()
  const [selectedProvider, setSelectedProvider] = useState<string>('')

  const { data: providersData, isLoading } = useQuery({
    queryKey: ['providers'],
    queryFn: () => api.getProviders(),
  })

  const { data: status } = useQuery({
    queryKey: ['status'],
    queryFn: () => api.getStatus(),
  })

  const switchMutation = useMutation({
    mutationFn: (providerId: string) => api.switchProvider(providerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['status'] })
      queryClient.invalidateQueries({ queryKey: ['providers'] })
    },
  })

  const handleSwitch = () => {
    if (selectedProvider) {
      switchMutation.mutate(selectedProvider)
    }
  }

  const providers = providersData?.providers || []
  const currentProvider = status?.currentProvider || providersData?.current

  // Build select options
  const selectOptions = providers.map((p) => ({
    value: p.id,
    label: `${p.name} (${p.mode})`,
  }))

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Providers</h2>
        <p className="text-xs text-muted-foreground">
          Manage and switch between AI API providers
        </p>
      </div>

      {/* Switch Provider - Compact */}
      <Card className="p-0">
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs font-medium">Switch Provider</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <Select
                value={selectedProvider || currentProvider || ''}
                options={selectOptions}
                onChange={(value) => setSelectedProvider(value)}
                placeholder="Select a provider"
                className="h-7 text-xs"
              />
            </div>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={handleSwitch}
              disabled={switchMutation.isPending || !selectedProvider}
            >
              {switchMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                'Switch'
              )}
            </Button>
          </div>
          {switchMutation.error && (
            <p className="text-xs text-destructive mt-1">
              {(switchMutation.error as Error).message}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Providers List - Compact grid */}
      <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
        {isLoading ? (
          <>
            <Card className="p-0">
              <CardContent className="p-3">
                <div className="h-12 animate-pulse bg-muted rounded" />
              </CardContent>
            </Card>
            <Card className="p-0">
              <CardContent className="p-3">
                <div className="h-12 animate-pulse bg-muted rounded" />
              </CardContent>
            </Card>
          </>
        ) : (
          providers.map((provider) => (
            <Card
              key={provider.id}
              className={`p-0 ${provider.active ? 'border-primary' : ''}`}
            >
              <CardHeader className="p-3 pb-1">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">{provider.name}</CardTitle>
                  {provider.active && (
                    <Badge variant="success" className="gap-0.5 text-[10px] px-1 py-0">
                      <Check className="h-2.5 w-2.5" />
                      Active
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-3 pt-0 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">ID</span>
                  <span className="font-mono text-[10px]">{provider.id}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Mode</span>
                  <Badge variant="outline" className="text-[10px] px-1 py-0">{provider.mode}</Badge>
                </div>
                {provider.baseUrl && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Base URL</span>
                    <span className="font-mono text-[10px] truncate max-w-[140px]">
                      {provider.baseUrl}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {providers.length === 0 && !isLoading && (
        <Card className="p-0">
          <CardContent className="p-6 text-center text-xs text-muted-foreground">
            No providers configured. Please add providers in your settings.
          </CardContent>
        </Card>
      )}
    </div>
  )
}
