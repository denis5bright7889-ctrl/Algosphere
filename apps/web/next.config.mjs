/** @type {import('next').NextConfig} */
const config = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },

  /**
   * Legacy `/dashboard/<path>` URLs are a no-op route-group leak —
   * `(dashboard)` does NOT add `/dashboard` to the URL. Dozens of
   * source files (and previously-sent emails / push payloads) still
   * link to that bogus prefix and hit a 404. We permanently 308 them
   * to the real route. The source sweep below removes the prefix at
   * origin so no future click pays the redirect hop.
   */
  async redirects() {
    return [
      { source: '/dashboard',          destination: '/overview', permanent: true },
      { source: '/dashboard/:path*',   destination: '/:path*',   permanent: true },
    ]
  },
}

export default config
