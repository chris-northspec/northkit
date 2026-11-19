import type { MetadataRoute } from 'next';
import { PRODUCT_NAME } from '@northkit/core';

// Installable on phones as a PWA (the offline inspection runner arrives in Sprint 3).
// A manifest can't read CSS variables: the colours mirror --colour-bg and --accent in
// src/styles/tokens.css (Hi-Vis Yellow). The icons are made from the BrandCentre mark (northkit/logo).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: PRODUCT_NAME,
    short_name: PRODUCT_NAME,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#F5F3EE',
    theme_color: '#f2c200',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
