import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";

/**
 * The StepCode Web host (src/server.ts) serves the API, the SSE streams and the
 * launch-token exchange. In development Vite serves the client and forwards
 * every host route to it.
 *
 * The host only accepts requests whose Origin is its own address, so the proxy
 * rewrites the browser's Origin (the Vite dev server) to the host origin. The
 * session cookie is host-only and ports are ignored by cookies, so the cookie
 * set through the proxy is sent back on later proxied requests.
 */
const serverOrigin = `http://127.0.0.1:${process.env.STEPCODE_WEB_PORT ?? "3077"}`;

const hostProxy: ProxyOptions = {
	target: serverOrigin,
	changeOrigin: true,
	configure: (proxy) => {
		proxy.on("proxyReq", (proxyRequest) => {
			if (proxyRequest.getHeader("origin")) proxyRequest.setHeader("origin", serverOrigin);
		});
	},
};

export default defineConfig({
	root: "client",
	plugins: [react()],
	build: {
		outDir: "../dist/public",
		emptyOutDir: true,
	},
	server: {
		proxy: {
			"/api": hostProxy,
			"/auth": hostProxy,
			"/healthz": hostProxy,
		},
	},
});
