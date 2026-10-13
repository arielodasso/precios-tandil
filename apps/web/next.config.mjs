/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['pg'],
  async redirects() {
    return [
      {
        // El sitio vivo ahora es la SPA de Lovable en preciostandil.com.
        // Esta app quedó como legado: manda todo (308) al dominio nuevo.
        source: '/:path*',
        destination: 'https://preciostandil.com/:path*',
        permanent: true,
      },
    ];
  },
  outputFileTracingIncludes: {
    '/opengraph-image': ['./assets/fonts/*'],
    '/p/[slug]/opengraph-image': ['./assets/fonts/*'],
  },
  images: {
    unoptimized: true,
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
