import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Cross-origin isolation for ffmpeg.wasm on the upload screen ONLY.
        // App-wide COEP would break cross-origin resource loading elsewhere.
        //
        // Note: we deliberately run the SINGLE-THREAD ffmpeg core, which
        // doesn't need SharedArrayBuffer — these headers only take effect on
        // a full document load, and a client-side navigation into this route
        // never picks them up. The headers are set anyway so the
        // multi-threaded core is a drop-in upgrade later.
        //
        // COEP `require-corp` is safe here: the page's only cross-origin
        // loads are CORS fetches (Supabase REST/storage, the ffmpeg core via
        // toBlobURL), which COEP does not block. If a no-cors resource ever
        // lands on this page and breaks, switch to `credentialless`.
        source: "/creator/upload",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

export default nextConfig;
