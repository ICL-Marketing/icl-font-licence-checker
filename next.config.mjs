/** @type {import('next').NextConfig} */
const nextConfig = {
  // The spell checker reads its dictionary from disk at runtime.
  outputFileTracingIncludes: {
    "/api/launch": ["./node_modules/dictionary-en-gb/index.aff", "./node_modules/dictionary-en-gb/index.dic"],
  },
};

export default nextConfig;
