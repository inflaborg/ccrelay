import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/api/client";

export default function Providers() {
  const queryClient = useQueryClient();

  const { data: providersData, isLoading } = useQuery({
    queryKey: ["providers"],
    queryFn: () => api.getProviders(),
  });

  const switchMutation = useMutation({
    mutationFn: (providerId: string) => api.switchProvider(providerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["status"] });
      queryClient.invalidateQueries({ queryKey: ["providers"] });
    },
  });

  const handleSwitch = (providerId: string) => {
    switchMutation.mutate(providerId);
  };

  const providers = providersData?.providers || [];

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Providers</h2>
        <p className="text-xs text-muted-foreground">Manage and switch between AI API providers</p>
      </div>

      {/* Providers List - Compact grid */}
      <div className="grid gap-2 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {isLoading ? (
          <>
            <Card className="p-0">
              <CardContent className="p-3">
                <div className="h-16 animate-pulse bg-muted rounded" />
              </CardContent>
            </Card>
            <Card className="p-0">
              <CardContent className="p-3">
                <div className="h-16 animate-pulse bg-muted rounded" />
              </CardContent>
            </Card>
          </>
        ) : (
          providers.map(provider => (
            <Card key={provider.id} className={`p-0 ${provider.active ? "border-primary" : ""}`}>
              <CardHeader className="p-3 pb-1">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">{provider.name}</CardTitle>
                  <div className="flex items-center gap-1">
                    {provider.active && (
                      <Badge variant="success" className="gap-0.5 text-[10px] px-1 py-0">
                        <Check className="h-2.5 w-2.5" />
                        Active
                      </Badge>
                    )}
                    {!provider.active && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-5 text-[10px] px-2"
                        onClick={() => handleSwitch(provider.id)}
                        disabled={switchMutation.isPending}
                      >
                        {switchMutation.isPending && switchMutation.variables === provider.id ? (
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        ) : (
                          "Use"
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-3 pt-0 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">ID</span>
                  <span className="font-mono text-[10px]">{provider.id}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Mode</span>
                  <Badge variant="outline" className="text-[10px] px-1 py-0">
                    {provider.mode}
                  </Badge>
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

      {switchMutation.error && (
        <p className="text-xs text-destructive text-center">
          {(switchMutation.error as Error).message}
        </p>
      )}

      {providers.length === 0 && !isLoading && (
        <Card className="p-0">
          <CardContent className="p-6 text-center text-xs text-muted-foreground">
            No providers configured. Please add providers in your settings.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
