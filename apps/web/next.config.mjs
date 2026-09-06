/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['pg'],
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      { protocol: 'https', hostname: 'carrefourar.vteximg.com.br' },
      { protocol: 'https', hostname: 'www.golopolis.com.ar' },
      { protocol: 'https', hostname: 'jumboargentina.vteximg.com.br' },
      { protocol: 'https', hostname: 'd2n39a10pcqohq.cloudfront.net' },
      { protocol: 'https', hostname: 'ardiaprod.vteximg.com.br' },
      { protocol: 'https', hostname: 'www.lacoopeencasa.coop' },
      { protocol: 'https', hostname: 'ardiaprod.vtexassets.com' },
      { protocol: 'https', hostname: 'carrefourar.vtexassets.com' },
      { protocol: 'https', hostname: 'veaargentina.vtexassets.com' },
    ],
  },
};

export default nextConfig;
