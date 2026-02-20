import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

interface MarkdownViewerProps {
  content: string;
}

export function MarkdownViewer({ content }: MarkdownViewerProps) {
  return (
    <div
      className="prose prose-sm max-w-none p-0
      prose-headings:text-foreground prose-headings:font-medium 
      prose-h3:text-sm prose-h3:border-b prose-h3:border-border prose-h3:pb-1 prose-h3:mt-5 prose-h3:mb-3
      prose-p:text-foreground/80 prose-p:leading-relaxed prose-p:my-2
      prose-a:text-blue-500 hover:prose-a:text-blue-400
      prose-strong:text-foreground prose-strong:font-semibold
      prose-ul:text-foreground/80 prose-ol:text-foreground/80 prose-ul:my-2
      prose-li:marker:text-muted-foreground
      prose-blockquote:text-muted-foreground prose-blockquote:border-l-4 prose-blockquote:border-muted-foreground/30 prose-blockquote:bg-muted/20 prose-blockquote:pl-4 prose-blockquote:py-0.5 prose-blockquote:rounded-r prose-blockquote:not-italic prose-blockquote:my-3
      prose-code:text-foreground prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:font-mono prose-code:text-[11px] prose-code:before:content-none prose-code:after:content-none
      prose-pre:bg-transparent prose-pre:border-0 prose-pre:p-0 prose-pre:m-0
      prose-hr:border-border prose-hr:my-4
      text-foreground/80
    "
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({
            className,
            children,
            ...props
          }: React.ComponentPropsWithoutRef<"code"> & { inline?: boolean }) {
            const match = /language-(\w+)/.exec(className || "");
            const isInline = !match && !className?.includes("language-");

            return !isInline ? (
              <div className="rounded-md border border-border mt-3 mb-4 overflow-hidden bg-[#1e1e1e]">
                <div className="flex items-center px-3 py-1.5 bg-muted/80 border-b border-border text-[10px] text-muted-foreground uppercase font-semibold">
                  {match?.[1] || "code"}
                </div>
                <SyntaxHighlighter
                  {...props}
                  style={vscDarkPlus}
                  language={match?.[1] || "text"}
                  PreTag="div"
                  customStyle={{
                    margin: 0,
                    padding: "1rem",
                    background: "transparent",
                    fontSize: "12px",
                  }}
                >
                  {String(children).replace(/\n$/, "")}
                </SyntaxHighlighter>
              </div>
            ) : (
              <code {...props} className={className}>
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
