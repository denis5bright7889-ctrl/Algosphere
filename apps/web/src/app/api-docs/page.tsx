import Logo from '@/components/brand/Logo'

export const metadata = {
  title: 'API Documentation — AlgoSphere Quant',
  description: 'OpenAPI 3.1 reference for the AlgoSphere institutional REST API.',
}

export default function ApiDocsPage() {
  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <a href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <Logo size="sm" alt="" priority />
            <span><span className="text-gradient">AlgoSphere</span> Quant API</span>
          </a>
          <div className="flex items-center gap-3 text-xs">
            <a href="/api/openapi" className="text-amber-300 hover:underline">openapi.json</a>
            <a href="/dashboard/api-keys" className="text-muted-foreground hover:text-foreground">
              Get a key
            </a>
          </div>
        </div>
      </header>

      {/* Swagger UI loaded from CDN — zero npm weight */}
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"
      />
      <div id="swagger-ui" className="bg-white min-h-[80vh]" />
      <script
        src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"
        async
      />
      <script
        // dangerouslySetInnerHTML is acceptable here — static, no user input
        dangerouslySetInnerHTML={{
          __html: `
            window.addEventListener('load', function() {
              if (!window.SwaggerUIBundle) {
                setTimeout(arguments.callee, 100); return;
              }
              window.SwaggerUIBundle({
                url: '/api/openapi',
                dom_id: '#swagger-ui',
                deepLinking: true,
                presets: [SwaggerUIBundle.presets.apis],
                layout: 'BaseLayout',
                tryItOutEnabled: true,
              });
            });
          `,
        }}
      />
    </main>
  )
}
