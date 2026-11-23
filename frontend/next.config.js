/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: false, // strict-mode double effects would double-fire proctoring listeners in dev
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "same-origin" },
        { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
      ],
    }];
  },
};
