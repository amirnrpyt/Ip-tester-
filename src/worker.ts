// This is a minimal worker to serve the static assets of an Angular app.
// It intercepts requests and serves files from the __STATIC_CONTENT KV namespace,
// which is automatically populated by Wrangler from the directory specified in [site].bucket.

export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    const url = new URL(request.url);
    let pathname = url.pathname;

    // For Single Page Applications (SPA) like Angular, if the requested path
    // doesn't look like a file (e.g., /about, /user/123), we should serve
    // the main index.html file and let the client-side router take over.
    // A common way to detect asset requests is to check for a file extension.
    const isAsset = pathname.includes('.') && pathname.split('/').pop()!.includes('.');
    
    // The key for the KV namespace is the path without the leading slash.
    // e.g., for "https://example.com/styles.css", the key is "styles.css".
    let key = pathname.slice(1);
    
    // If it's not an asset or it's the root path, we serve index.html for SPA routing.
    if (pathname === '/' || !isAsset) {
        key = 'index.html';
    }

    try {
        // Try to get the file from the KV namespace.
        const object = await env.__STATIC_CONTENT.get(key);

        if (object === null) {
            // If the requested asset is not found, for an SPA, we should always
            // serve index.html as a fallback to let the client-side router handle the 404.
            const indexPage = await env.__STATIC_CONTENT.get('index.html');
            if (indexPage !== null) {
                return new Response(indexPage.body, {
                    headers: { 'Content-Type': 'text/html; charset=utf-8' },
                    status: 200,
                });
            }
            // Only if index.html itself is missing do we return a real 404.
            return new Response('Not Found', { status: 404 });
        }

        const headers = new Headers();
        // Add basic MIME types based on file extension.
        if (key.endsWith('.js')) headers.set('Content-Type', 'application/javascript; charset=utf-8');
        else if (key.endsWith('.css')) headers.set('Content-Type', 'text/css; charset=utf-8');
        else if (key.endsWith('.html')) headers.set('Content-Type', 'text/html; charset=utf-8');
        else if (key.endsWith('.ico')) headers.set('Content-Type', 'image/vnd.microsoft.icon');
        else if (key.endsWith('.svg')) headers.set('Content-Type', 'image/svg+xml');
        else if (key.endsWith('.png')) headers.set('Content-Type', 'image/png');
        else if (key.endsWith('.jpg') || key.endsWith('.jpeg')) headers.set('Content-Type', 'image/jpeg');
        else if (key.endsWith('.gif')) headers.set('Content-Type', 'image/gif');
        else if (key.endsWith('.woff')) headers.set('Content-Type', 'font/woff');
        else if (key.endsWith('.woff2')) headers.set('Content-Type', 'font/woff2');
        else if (key.endsWith('.json')) headers.set('Content-Type', 'application/json');
        
        return new Response(object.body, {
            headers,
        });

    } catch (e) {
        return new Response('An unexpected error occurred', { status: 500 });
    }
  },
};
