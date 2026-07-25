import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Loader2, MessageSquare, Plus, Send, Square, Trash2, Eraser } from "lucide-react";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/select-field";
import { MarkdownViewer } from "@/components/ui/markdown-viewer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  createSession,
  loadChatStore,
  newMessageId,
  saveChatStore,
  titleFromFirstUserMessage,
} from "./chatStorage";
import { defaultProtocolForProvider, fetchProxyModels, streamChat } from "./chatProxy";
import { modelsFromProvider } from "./models";
import type { ChatMessage, ChatProtocol, ChatSession, ChatStoreV1 } from "./types";

const PROTOCOLS: ChatProtocol[] = ["openai_chat", "openai_responses", "anthropic"];

function protocolLabelKey(p: ChatProtocol): string {
  switch (p) {
    case "openai_chat":
      return "chat.protocol.openaiChat";
    case "openai_responses":
      return "chat.protocol.openaiResponses";
    case "anthropic":
      return "chat.protocol.anthropic";
  }
}

export default function Chat() {
  const { t } = useTranslation();
  const [store, setStore] = useState<ChatStoreV1>(() => loadChatStore());
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [clearSessionOpen, setClearSessionOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  /** True while IME (e.g. Chinese Pinyin) has an open candidate window. */
  const imeComposingRef = useRef(false);

  const focusInput = useCallback(() => {
    // Keep caret in the composer after Enter / Send / Stop.
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, []);

  const { data: providersData, isLoading: providersLoading } = useQuery({
    queryKey: ["providers"],
    queryFn: () => api.getProviders(),
  });

  const activeProvider = useMemo(() => {
    if (!providersData) {
      return null;
    }
    return providersData.providers.find(p => p.id === providersData.current) ?? null;
  }, [providersData]);

  const configModels = useMemo(() => modelsFromProvider(activeProvider), [activeProvider]);

  const activeSession = useMemo(
    () => store.sessions.find(s => s.id === store.activeSessionId) ?? null,
    [store]
  );

  const activeProtocol =
    activeSession?.protocol ?? defaultProtocolForProvider(activeProvider?.providerType);

  const { data: upstreamModels, isFetching: upstreamFetching } = useQuery({
    queryKey: ["chat-proxy-models", activeProvider?.id, activeProtocol],
    queryFn: () => fetchProxyModels(activeProtocol),
    enabled: Boolean(activeProvider) && configModels.length === 0,
    retry: false,
    staleTime: 60_000,
  });

  const modelOptions = useMemo(() => {
    if (configModels.length > 0) {
      return configModels;
    }
    return (upstreamModels ?? []).map(id => ({ id, label: id }));
  }, [configModels, upstreamModels]);

  // Persist
  useEffect(() => {
    saveChatStore(store);
  }, [store]);

  // Ensure there is an active session when provider is ready
  useEffect(() => {
    if (!activeProvider) {
      return;
    }
    if (store.sessions.length > 0) {
      const exists =
        Boolean(store.activeSessionId) && store.sessions.some(s => s.id === store.activeSessionId);
      if (!exists) {
        setStore(prev => ({
          ...prev,
          activeSessionId: prev.sessions[0]?.id ?? null,
        }));
      }
      return;
    }
    const protocol = defaultProtocolForProvider(activeProvider.providerType);
    const model = modelOptions[0]?.id ?? "";
    const session = createSession(protocol, model);
    setStore({ version: 1, sessions: [session], activeSessionId: session.id });
  }, [activeProvider, store.sessions, store.activeSessionId, modelOptions]);

  // Keep model in sync when options load and session has empty/stale model
  useEffect(() => {
    if (!activeSession || modelOptions.length === 0) {
      return;
    }
    const ok = modelOptions.some(m => m.id === activeSession.model);
    if (!ok) {
      const next = modelOptions[0]!.id;
      setStore(prev => ({
        ...prev,
        sessions: prev.sessions.map(s =>
          s.id === activeSession.id ? { ...s, model: next, updatedAt: Date.now() } : s
        ),
      }));
    }
  }, [activeSession, modelOptions]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeSession?.messages, sending]);

  const updateSession = useCallback((sessionId: string, patch: Partial<ChatSession>) => {
    setStore(prev => ({
      ...prev,
      sessions: prev.sessions.map(s =>
        s.id === sessionId ? { ...s, ...patch, updatedAt: Date.now() } : s
      ),
    }));
  }, []);

  const handleNewSession = () => {
    const protocol =
      activeSession?.protocol ?? defaultProtocolForProvider(activeProvider?.providerType);
    const model = activeSession?.model || modelOptions[0]?.id || "";
    const session = createSession(protocol, model);
    setStore(prev => ({
      ...prev,
      sessions: [session, ...prev.sessions],
      activeSessionId: session.id,
    }));
    setInput("");
  };

  const handleDeleteSession = (id: string) => {
    setStore(prev => {
      const sessions = prev.sessions.filter(s => s.id !== id);
      let activeSessionId = prev.activeSessionId;
      if (activeSessionId === id) {
        activeSessionId = sessions[0]?.id ?? null;
      }
      if (sessions.length === 0 && activeProvider) {
        const protocol = defaultProtocolForProvider(activeProvider.providerType);
        const model = modelOptions[0]?.id ?? "";
        const session = createSession(protocol, model);
        return { version: 1, sessions: [session], activeSessionId: session.id };
      }
      return { ...prev, sessions, activeSessionId };
    });
  };

  const handleClearAll = () => {
    if (!activeProvider) {
      setStore({ version: 1, sessions: [], activeSessionId: null });
      setClearAllOpen(false);
      return;
    }
    const protocol = defaultProtocolForProvider(activeProvider.providerType);
    const model = modelOptions[0]?.id ?? "";
    const session = createSession(protocol, model);
    setStore({ version: 1, sessions: [session], activeSessionId: session.id });
    setClearAllOpen(false);
    setInput("");
  };

  const handleClearSessionMessages = () => {
    if (!activeSession) {
      return;
    }
    updateSession(activeSession.id, { messages: [], title: "New chat" });
    setClearSessionOpen(false);
  };

  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSending(false);
    focusInput();
  };

  const handleSend = async () => {
    if (!activeSession || sending) {
      return;
    }
    const text = input.trim();
    if (!text) {
      return;
    }
    if (!activeSession.model.trim()) {
      return;
    }

    const userMsg: ChatMessage = {
      id: newMessageId(),
      role: "user",
      content: text,
    };
    const assistantId = newMessageId();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
    };

    const nextMessages = [...activeSession.messages, userMsg];
    const title =
      activeSession.messages.length === 0 ? titleFromFirstUserMessage(text) : activeSession.title;

    setInput("");
    setStore(prev => ({
      ...prev,
      sessions: prev.sessions.map(s =>
        s.id === activeSession.id
          ? {
              ...s,
              title,
              messages: [...nextMessages, assistantMsg],
              updatedAt: Date.now(),
            }
          : s
      ),
    }));

    const controller = new AbortController();
    abortRef.current = controller;
    setSending(true);
    focusInput();

    try {
      await streamChat({
        protocol: activeSession.protocol,
        model: activeSession.model,
        messages: nextMessages,
        signal: controller.signal,
        onDelta: chunk => {
          setStore(prev => ({
            ...prev,
            sessions: prev.sessions.map(s => {
              if (s.id !== activeSession.id) {
                return s;
              }
              return {
                ...s,
                updatedAt: Date.now(),
                messages: s.messages.map(m =>
                  m.id === assistantId ? { ...m, content: m.content + chunk } : m
                ),
              };
            }),
          }));
        },
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setStore(prev => ({
          ...prev,
          sessions: prev.sessions.map(s => {
            if (s.id !== activeSession.id) {
              return s;
            }
            return {
              ...s,
              messages: s.messages.map(m =>
                m.id === assistantId && !m.content
                  ? { ...m, content: "", error: t("chat.stopped") }
                  : m
              ),
            };
          }),
        }));
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setStore(prev => ({
          ...prev,
          sessions: prev.sessions.map(s => {
            if (s.id !== activeSession.id) {
              return s;
            }
            return {
              ...s,
              messages: s.messages.map(m =>
                m.id === assistantId ? { ...m, error: message, content: m.content || "" } : m
              ),
            };
          }),
        }));
      }
    } finally {
      abortRef.current = null;
      setSending(false);
      focusInput();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey) {
      return;
    }
    // IME candidate confirm uses Enter — must not send mid-composition.
    // keyCode 229 is the legacy "IME processing" signal some browsers still emit.
    if (e.nativeEvent.isComposing || imeComposingRef.current || e.keyCode === 229) {
      return;
    }
    e.preventDefault();
    void handleSend();
  };

  const onCompositionStart = () => {
    imeComposingRef.current = true;
  };

  const onCompositionEnd = () => {
    imeComposingRef.current = false;
  };

  if (providersLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("chat.loading")}
      </div>
    );
  }

  if (!activeProvider) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground px-4 text-center">
        <MessageSquare className="h-8 w-8 opacity-50" />
        <p className="text-sm font-medium text-foreground">{t("chat.noProviderTitle")}</p>
        <p className="text-xs max-w-md">{t("chat.noProviderHint")}</p>
      </div>
    );
  }

  const sortedSessions = [...store.sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="flex min-h-0 flex-1 gap-2">
      {/* Session sidebar */}
      <aside className="flex w-44 sm:w-52 shrink-0 flex-col rounded-md border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-1 border-b border-border p-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1 text-xs gap-1"
            onClick={handleNewSession}
          >
            <Plus className="h-3 w-3" />
            {t("chat.newSession")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 shrink-0 p-0 text-muted-foreground"
            title={t("chat.clearAll")}
            onClick={() => setClearAllOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1 space-y-0.5">
          {sortedSessions.map(session => (
            <div
              key={session.id}
              className={cn(
                "group flex items-center gap-0.5 rounded-md px-1.5 py-1.5 cursor-pointer",
                session.id === store.activeSessionId
                  ? "bg-primary/15 text-foreground"
                  : "hover:bg-muted/60 text-muted-foreground"
              )}
              onClick={() => setStore(prev => ({ ...prev, activeSessionId: session.id }))}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-medium text-foreground">
                  {session.title}
                </div>
                <div className="truncate text-[10px] opacity-70">{session.model || "—"}</div>
              </div>
              <button
                type="button"
                className="opacity-0 group-hover:opacity-100 h-5 w-5 shrink-0 rounded flex items-center justify-center hover:bg-destructive/15 text-muted-foreground hover:text-destructive"
                title={t("chat.deleteSession")}
                onClick={e => {
                  e.stopPropagation();
                  handleDeleteSession(session.id);
                }}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
        <div className="border-t border-border px-2 py-1.5 text-[10px] text-muted-foreground truncate">
          {t("chat.activeProvider", { name: activeProvider.name || activeProvider.id })}
        </div>
      </aside>

      {/* Main chat */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-md border border-border bg-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-2 py-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[10px] text-muted-foreground shrink-0">
              {t("chat.protocolLabel")}
            </span>
            <SelectField
              value={activeSession?.protocol ?? "openai_chat"}
              options={PROTOCOLS.map(p => ({
                value: p,
                label: t(protocolLabelKey(p)),
              }))}
              onChange={v => {
                if (activeSession) {
                  updateSession(activeSession.id, { protocol: v as ChatProtocol });
                }
              }}
              triggerClassName="w-[10.5rem]"
              disabled={!activeSession || sending}
            />
          </div>
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="text-[10px] text-muted-foreground shrink-0">
              {t("chat.modelLabel")}
            </span>
            <SelectField
              value={activeSession?.model ?? ""}
              options={
                modelOptions.length > 0
                  ? modelOptions.map(m => ({ value: m.id, label: m.label }))
                  : [{ value: "", label: t("chat.noModels") }]
              }
              onChange={v => {
                if (activeSession) {
                  updateSession(activeSession.id, { model: v });
                }
              }}
              triggerClassName="min-w-[8rem] max-w-full flex-1"
              className="flex-1 min-w-0"
              disabled={!activeSession || sending || modelOptions.length === 0}
            />
            {upstreamFetching && configModels.length === 0 ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
            ) : null}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs gap-1 shrink-0"
            disabled={!activeSession?.messages.length || sending}
            onClick={() => setClearSessionOpen(true)}
          >
            <Eraser className="h-3 w-3" />
            <span className="hidden sm:inline">{t("chat.clearMessages")}</span>
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 space-y-3">
          {!activeSession?.messages.length ? (
            <div className="flex h-full min-h-[12rem] flex-col items-center justify-center text-muted-foreground gap-1 text-center px-4">
              <MessageSquare className="h-6 w-6 opacity-40" />
              <p className="text-xs">{t("chat.emptyHint")}</p>
            </div>
          ) : (
            activeSession.messages.map(msg => (
              <div
                key={msg.id}
                className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-md px-2.5 py-1.5 text-xs",
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/60 text-foreground border border-border"
                  )}
                >
                  {msg.role === "assistant" ? (
                    msg.error && !msg.content ? (
                      <p className="text-destructive whitespace-pre-wrap">{msg.error}</p>
                    ) : (
                      <>
                        {msg.content ? (
                          sending &&
                          msg.id ===
                            activeSession.messages[activeSession.messages.length - 1]?.id ? (
                            <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                          ) : (
                            <MarkdownViewer content={msg.content} />
                          )
                        ) : null}
                        {msg.error ? (
                          <p className="mt-1 text-destructive whitespace-pre-wrap text-[11px]">
                            {msg.error}
                          </p>
                        ) : null}
                        {sending &&
                        msg.id === activeSession.messages[activeSession.messages.length - 1]?.id &&
                        !msg.content &&
                        !msg.error ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        ) : null}
                      </>
                    )
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-border p-2 space-y-1.5">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
            rows={2}
            placeholder={t("chat.inputPlaceholder")}
            disabled={!activeSession?.model}
            className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          />
          <div className="flex items-center justify-end gap-2">
            <div className="flex-1 min-w-0 text-[10px] text-muted-foreground">
              {t("chat.enterHint")}
            </div>
            {sending ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={handleStop}
              >
                <Square className="h-3 w-3" />
                {t("chat.stop")}
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-7 text-xs gap-1 min-w-[5.5rem]"
                disabled={!input.trim() || !activeSession?.model}
                onClick={() => void handleSend()}
              >
                <Send className="h-3 w-3" />
                {t("chat.send")}
              </Button>
            )}
          </div>
        </div>
      </div>

      <AlertDialog open={clearAllOpen} onOpenChange={setClearAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("chat.clearAllTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("chat.clearAllDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearAll}>{t("chat.clearAll")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={clearSessionOpen} onOpenChange={setClearSessionOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("chat.clearMessagesTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("chat.clearMessagesDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearSessionMessages}>
              {t("chat.clearMessages")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
